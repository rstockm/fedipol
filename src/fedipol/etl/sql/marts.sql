-- Marts: Kanonisierung, Deduplizierung und neueste Beobachtungen.
-- Fachliche Prioritaeten werden beim Staging-Write in Python berechnet und
-- hier nur noch als sortierbare Spalten verwendet.

CREATE SCHEMA IF NOT EXISTS mart;

-- Repraesentant pro kanonischer URL (hoechste Prioritaet gewinnt).
CREATE OR REPLACE TABLE mart.canonical_accounts AS
WITH ranked AS (
    SELECT
        canonical_url,
        name,
        kind,
        position_label,
        party_label,
        qid,
        instance,
        source,
        instance_priority,
        position_priority,
        (party_label IS NOT NULL)::INTEGER AS has_party,
        (position_label IS NOT NULL)::INTEGER AS has_position,
        row_number() OVER (
            PARTITION BY canonical_url
            ORDER BY
                instance_priority DESC,
                position_priority DESC,
                has_position DESC,
                has_party DESC,
                qid DESC NULLS LAST,
                name DESC
        ) AS rn
    FROM staging.candidates
    WHERE canonical_url IS NOT NULL
)
SELECT
    canonical_url,
    name,
    kind,
    position_label,
    party_label,
    qid,
    instance,
    source
FROM ranked
WHERE rn = 1;

-- Neueste Beobachtung pro Account; LKG nur, wenn der aktuelle Lauf keinen
-- gueltigen Wert geliefert hat.
CREATE OR REPLACE TABLE mart.account_facts AS
WITH current_obs AS (
    SELECT
        o.url,
        o.posts_count,
        o.recent_posts_count,
        o.created_at,
        o.is_bot,
        o.capped,
        o.fetched_at,
        row_number() OVER (PARTITION BY o.url ORDER BY o.fetched_at DESC) AS rn
    FROM staging.observations o
    WHERE o.status = 'ok'
),
current_best AS (
    SELECT
        url,
        posts_count,
        recent_posts_count,
        created_at,
        is_bot,
        capped,
        fetched_at,
        'fresh' AS freshness
    FROM current_obs
    WHERE rn = 1
),
lkg_obs AS (
    SELECT
        l.url,
        l.posts_count,
        l.recent_posts_count,
        l.created_at,
        l.is_bot,
        FALSE AS capped,
        l.observed_at AS fetched_at,
        'stale' AS freshness
    FROM staging.lkg_observations l
    WHERE l.url NOT IN (SELECT url FROM current_best)
),
combined AS (
    SELECT *, row_number() OVER (PARTITION BY url ORDER BY freshness DESC) AS pick
    FROM (
        SELECT * FROM current_best
        UNION ALL
        SELECT * FROM lkg_obs
    )
)
SELECT
    url,
    posts_count,
    recent_posts_count,
    created_at,
    is_bot,
    capped,
    fetched_at,
    freshness
FROM combined
WHERE pick = 1;
