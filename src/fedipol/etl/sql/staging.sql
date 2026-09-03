-- Staging-Schema der fedipol-Pipeline (unveraenderlich pro Generation).
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS ref;

CREATE OR REPLACE TABLE staging.candidates (
    canonical_url      VARCHAR NOT NULL,
    original_url       VARCHAR,
    name               VARCHAR,
    kind               VARCHAR,          -- person | institution
    position_label     VARCHAR,
    party_label        VARCHAR,          -- vollstaendiger Parteiname
    qid                VARCHAR,
    instance           VARCHAR,
    source             VARCHAR,          -- wikidata:parliament | directory:gruene.social | ...
    instance_priority  INTEGER,
    position_priority  INTEGER
);

CREATE OR REPLACE TABLE staging.observations (
    url                VARCHAR NOT NULL,
    posts_count        BIGINT,
    recent_posts_count BIGINT,
    created_at         VARCHAR,
    is_bot             BOOLEAN,
    capped             BOOLEAN DEFAULT FALSE,
    fetched_at         VARCHAR,
    status             VARCHAR NOT NULL DEFAULT 'ok'   -- ok | error
);

-- Last-known-good-Beobachtungen aus der vorherigen Generation
CREATE OR REPLACE TABLE staging.lkg_observations (
    url                VARCHAR NOT NULL,
    posts_count        BIGINT,
    recent_posts_count BIGINT,
    created_at         VARCHAR,
    is_bot             BOOLEAN,
    observed_at        VARCHAR
);

-- Referenztabelle fuer Partei-Kuerzel (aus Python-Normalisierung befuellt)
CREATE OR REPLACE TABLE ref.party_aliases (
    name VARCHAR PRIMARY KEY,
    abbreviation VARCHAR NOT NULL
);
