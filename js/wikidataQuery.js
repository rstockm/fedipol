// Wikidata SPARQL endpoint
const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';

// Party instances to include regardless of Wikidata presence
const PARTY_INSTANCES = [
    'linke.social',
    'gruene.social',
    'die-partei.social',
    'piraten-partei.social',
    'spd.social'
];

// Institutional instances to include regardless of Wikidata presence
const INSTITUTION_INSTANCES = [
    'social.bund.de',
    'social.hessen.de',
    'social.schleswig-holstein.de'
];

function instanceToPartyName(instance) {
    if (instance === 'gruene.social') return 'Bündnis 90/Die Grünen';
    if (instance === 'linke.social') return 'Die Linke';
    if (instance === 'die-partei.social') return 'Die PARTEI';
    if (instance === 'piraten-partei.social') return 'Piratenpartei Deutschland';
    if (instance === 'spd.social') return 'Sozialdemokratische Partei Deutschlands';
    return '-';
}

// Fetch public directory of a Mastodon instance (discoverable local accounts)
async function fetchAccountsFromInstance(instance, maxAccounts = 500) {
    const results = [];
    const partyName = instanceToPartyName(instance);
    let offset = 0;
    const limit = 80; // Mastodon directory max is typically 80

    try {
        while (results.length < maxAccounts) {
            const url = `https://${instance}/api/v1/directory?local=true&order=active&limit=${limit}&offset=${offset}`;
            const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!resp.ok) break;
            const data = await resp.json();
            if (!Array.isArray(data) || data.length === 0) break;

            for (const acc of data) {
                const accountUrl = acc.url || `https://${instance}/@${acc.acct || acc.username}`;
                // Build object compatible with SPARQL bindings structure used downstream
                results.push({
                    itemLabel: { value: acc.display_name && acc.display_name.trim() ? acc.display_name : (acc.username || acc.acct || 'Unbekannt') },
                    partyLabel: { value: partyName },
                    // positionLabel intentionally omitted; later pipeline adds party as position if empty
                    account: { value: accountUrl }
                });
                if (results.length >= maxAccounts) break;
            }

            if (data.length < limit) break; // no more pages
            offset += limit;
        }
    } catch (e) {
        // Fail soft; just return what we have
    }

    return results;
}

// Fetch public directory for institutional instances
async function fetchInstitutionsFromInstance(instance, maxAccounts = 1000) {
    const results = [];
    let offset = 0;
    const limit = 80;
    try {
        while (results.length < maxAccounts) {
            const url = `https://${instance}/api/v1/directory?local=true&order=active&limit=${limit}&offset=${offset}`;
            const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!resp.ok) break;
            const data = await resp.json();
            if (!Array.isArray(data) || data.length === 0) break;
            for (const acc of data) {
                const accountUrl = acc.url || `https://${instance}/@${acc.acct || acc.username}`;
                results.push({
                    itemLabel: { value: acc.display_name && acc.display_name.trim() ? acc.display_name : (acc.username || acc.acct || 'Unbekannt') },
                    typeLabel: { value: 'Institution (Instanz)' },
                    account: { value: accountUrl }
                });
                if (results.length >= maxAccounts) break;
            }
            if (data.length < limit) break;
            offset += limit;
        }
    } catch (e) {
        // Soft fail
    }
    return results;
}

// SPARQL query to find German politicians with Fediverse accounts
const PARLIAMENT_QUERY = `
SELECT DISTINCT ?item ?itemLabel ?position ?positionLabel ?account ?party ?partyLabel ?qid WHERE {
  # German politicians with positions and Fediverse accounts
  {
    ?item wdt:P102 ?party     # Political party membership
  } UNION {
    ?item wdt:P1416 ?party    # Affiliations (broader than just membership)
  }
  
  # Party must be a major German party or a political party in Germany
  {
    VALUES ?party {
      wd:Q49768     # SPD
      wd:Q49762     # CDU
      wd:Q49763     # CSU
      wd:Q13124     # FDP
      wd:Q49764     # Die Linke
      wd:Q49766     # Bündnis 90/Die Grünen
      wd:Q6721203   # Alternative für Deutschland
      wd:Q13129     # Piratenpartei Deutschland
      wd:Q22748     # Die PARTEI
      wd:Q327389    # Freie Wähler
      wd:Q106205950 # Volt Deutschland
      wd:Q123121346 # Bündnis Sahra Wagenknecht
    }
  } UNION {
    ?party wdt:P31 wd:Q2023214   # Instance of political party in Germany
  }
  
  ?item p:P4033 ?statement .  # Mastodon address
  ?statement ps:P4033 ?account .
  FILTER NOT EXISTS { ?statement pq:P582 ?end }
  
  {
    # Current members of parliament and other positions
    VALUES ?membership { 
      wd:Q1939555   # Member of Bundestag
      wd:Q27169     # Member of the European Parliament
      wd:Q1939559   # Member of Landtag
      wd:Q708492    # Ratsherr/Ratsmitglied
      wd:Q30185     # Bürgermeister
      wd:Q3154693   # Stadtrat
      wd:Q113885691 # Bezirksverordneter
      wd:Q113134496 # Kreisrat
    }
    ?item p:P39 ?membershipStatement .
    ?membershipStatement ps:P39 ?membership .
    # Filter for current positions (no end date)
    FILTER NOT EXISTS { ?membershipStatement pq:P582 ?endtime }
    BIND(?membership AS ?position)
  }
  UNION
  {
    # Political parties in Germany
    ?item wdt:P31 wd:Q2023214 .  # Instance of political party in Germany
    BIND(wd:Q2023214 AS ?position)
  }
  UNION
  {
    # Local and regional party organizations
    VALUES ?organization_type {
      wd:Q131745197  # SPD local associations
      wd:Q91459453   # District associations
      wd:Q18744396   # State associations
      wd:Q86189847   # Local associations
    }
    ?item wdt:P31 ?organization_type .
    BIND(?organization_type AS ?position)
  }
  UNION
  {
    # Other political positions
    ?item p:P39 ?positionStatement .
    ?positionStatement ps:P39 ?position .
    
    # Filter for current positions (no end date)
    FILTER NOT EXISTS { ?positionStatement pq:P582 ?endtime }
    
    # Position must be either in Germany OR an EU position
    {
      # German positions
      ?position wdt:P17 wd:Q183 .
    } 
    UNION 
    {
      # EU Parliament and Landtag positions
      VALUES ?position { wd:Q27169 wd:Q1939559 }
    }
    UNION
    {
      # Specific positions that don't need country filtering
      VALUES ?position { 
        wd:Q1939555   # Member of Bundestag
        wd:Q708492    # Ratsherr/Ratsmitglied
        wd:Q30185     # Bürgermeister
        wd:Q3154693   # Stadtrat
        wd:Q113885691 # Bezirksverordneter
        wd:Q113134496 # Kreisrat
      }
    }
  }
  
  # Extract QID
  BIND(REPLACE(STR(?item), "http://www.wikidata.org/entity/", "") AS ?qid)
  
  # Labels in German only
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de" }
}
`;

const PARTY_INSTANCES_QUERY = `
SELECT DISTINCT ?item ?itemLabel ?position ?positionLabel ?account ?party ?partyLabel ?qid WHERE {
  # All accounts on party-specific instances
  ?item p:P4033 ?statement .
  ?statement ps:P4033 ?account .
  FILTER NOT EXISTS { ?statement pq:P582 ?end }
  
  # Filter for specific instances
  VALUES ?instance { "linke.social" "gruene.social" "die-partei.social" "piraten-partei.social" "spd.social" }
  FILTER(CONTAINS(STR(?account), ?instance))
  
  # Get party affiliation (both membership and broader affiliations)
  OPTIONAL {
    { ?item wdt:P102 ?party }    # Party membership
    UNION
    { ?item wdt:P1416 ?party }   # Affiliations
  }
  
  # Get position if available
  OPTIONAL {
    ?item p:P39 ?positionStatement .
    ?positionStatement ps:P39 ?position .
    FILTER NOT EXISTS { ?positionStatement pq:P582 ?endtime }
  }
  
  # Extract QID
  BIND(REPLACE(STR(?item), "http://www.wikidata.org/entity/", "") AS ?qid)
  
  # Labels in German only
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de" }
}
`;

// SPARQL query to find German political institutions with Fediverse accounts
const INSTITUTIONS_QUERY = `
SELECT DISTINCT ?item ?itemLabel ?type ?typeLabel ?account ?qid WHERE {
  {
    SELECT DISTINCT ?item ?type ?account WHERE {
      {
        # Regular institutions query
        ?item p:P4033 ?statement .  # Has Mastodon address
        ?statement ps:P4033 ?account .
        FILTER NOT EXISTS { ?statement pq:P582 ?end }
        
        # Must be in Germany
        ?item wdt:P17 wd:Q183 .
        
        # Type of institution
        ?item wdt:P31 ?type .
        
        # Filter for relevant types
        VALUES ?type {
          wd:Q7278     # political party
          wd:Q327333   # government ministry
          wd:Q31075    # legislature
          wd:Q2659904  # government agency
          wd:Q4471     # regional parliament
          wd:Q2166081  # youth organization
          wd:Q1663594  # political foundation
          wd:Q2023214  # political party in Germany
          wd:Q1672092  # Regionalverband (regional association)
          wd:Q2324813  # parliamentary group
        }
      }
      UNION
      {
        # regional groups of political parties in germany
        ?parent wdt:P17 wd:Q183 .  # located in (P17) Germany (Q183)
        ?parent wdt:P31 ?type .    # instance of (P31)
        
        VALUES ?type {
          wd:Q7278     # political party
          wd:Q2023214  # political party in Germany
        }

        ?item wdt:P749 ?parent. # parent organization or unit (P749)
        ?item wdt:P4033 ?account .  # Has Mastodon address
      }
      UNION
      {
        # All accounts on social.bund.de
        ?item p:P4033 ?statement .
        ?statement ps:P4033 ?account .
        FILTER NOT EXISTS { ?statement pq:P582 ?end }
        FILTER(CONTAINS(STR(?account), "social.bund.de"))
        
        # Get the type if available
        OPTIONAL {
          ?item wdt:P31 ?type .
        }
      }
      UNION
      {
        # All accounts on social.hessen.de
        ?item p:P4033 ?statement .
        ?statement ps:P4033 ?account .
        FILTER NOT EXISTS { ?statement pq:P582 ?end }
        FILTER(CONTAINS(STR(?account), "social.hessen.de"))
        
        # Get the type if available
        OPTIONAL {
          ?item wdt:P31 ?type .
        }
      }
    }
  }
  
  # Extract QID
  BIND(REPLACE(STR(?item), "http://www.wikidata.org/entity/", "") AS ?qid)
  
  # Labels in German only
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de" }
} LIMIT 10000
`;

let currentPoliticians = [];
let currentInstitutions = [];
let isDeduplicateEnabled = false;
let isActivityFilterEnabled = false;

async function fetchWikidataResults() {
    const loadingElement = document.getElementById('loading');
    const resultsElement = document.getElementById('results');
    
    try {
        loadingElement.classList.remove('d-none');
        
        // Fetch all queries in parallel
        const [parliamentResponse, partyInstancesResponse, institutionsResponse] = await Promise.all([
            fetch(WIKIDATA_ENDPOINT + '?' + new URLSearchParams({
                query: PARLIAMENT_QUERY,
                format: 'json'
            }), {
                headers: {
                    'Accept': 'application/sparql-results+json',
                    'User-Agent': 'FediPol/1.0 (https://github.com/rstockm/fedipol)'
                }
            }),
            fetch(WIKIDATA_ENDPOINT + '?' + new URLSearchParams({
                query: PARTY_INSTANCES_QUERY,
                format: 'json'
            }), {
                headers: {
                    'Accept': 'application/sparql-results+json',
                    'User-Agent': 'FediPol/1.0 (https://github.com/rstockm/fedipol)'
                }
            }),
            fetch(WIKIDATA_ENDPOINT + '?' + new URLSearchParams({
                query: INSTITUTIONS_QUERY,
                format: 'json'
            }), {
                headers: {
                    'Accept': 'application/sparql-results+json',
                    'User-Agent': 'FediPol/1.0 (https://github.com/rstockm/fedipol)'
                }
            })
        ]);

        if (!parliamentResponse.ok || !partyInstancesResponse.ok || !institutionsResponse.ok) {
            throw new Error('Network response was not ok');
        }

        const [parliamentData, partyInstancesData, institutionsData] = await Promise.all([
            parliamentResponse.json(),
            partyInstancesResponse.json(),
            institutionsResponse.json()
        ]);
        
        // Combine politician results from Wikidata
        currentPoliticians = [
            ...parliamentData.results.bindings,
            ...partyInstancesData.results.bindings
        ];

        // Additionally: fetch all accounts from party instances' public directories (independent of Wikidata)
        const instanceBatches = await Promise.all(
            PARTY_INSTANCES.map(inst => fetchAccountsFromInstance(inst))
        );
        const instanceAccounts = instanceBatches.flat();
        currentPoliticians = [
            ...currentPoliticians,
            ...instanceAccounts
        ];
        
        currentInstitutions = institutionsData.results.bindings;

        // Additionally fetch institutional instance directories and merge
        const instBatches = await Promise.all(
            INSTITUTION_INSTANCES.map(inst => fetchInstitutionsFromInstance(inst))
        );
        const instDirAccounts = instBatches.flat();
        // Merge with simple de-duplication by account URL
        const seen = new Set();
        const mergedInstitutions = [];
        for (const it of [...currentInstitutions, ...instDirAccounts]) {
            const url = (it.account?.value || '').toLowerCase().replace(/\/+$/, '');
            if (!url || seen.has(url)) continue;
            seen.add(url);
            mergedInstitutions.push(it);
        }
        currentInstitutions = mergedInstitutions;
        
        // Display results with current filter settings
        await updateDisplayedResults();
        
    } catch (error) {
        resultsElement.innerHTML = `
            <div class="alert alert-danger">
                Fehler beim Laden der Daten: ${error.message}
            </div>
        `;
    } finally {
        loadingElement.classList.add('d-none');
    }
}

async function updateDisplayedResults() {
    let politicians = [...currentPoliticians];
    let institutions = [...currentInstitutions];
    
    // Filter out bsky entries
    politicians = politicians.filter(result => {
        const account = result.account?.value || '';
        return !account.toLowerCase().includes('bsky');
    });
    
    institutions = institutions.filter(result => {
        const account = result.account?.value || '';
        return !account.toLowerCase().includes('bsky');
    });
    
    // Only perform deduplication if the button is active
    if (isDeduplicateEnabled) {
        politicians = await removeDuplicates(politicians);
        institutions = await removeDuplicates(institutions);
    }
    
    // Apply activity filter if enabled
    if (isActivityFilterEnabled) {
        politicians = await filterMostRecentAccounts(politicians);
    }
    
    // Count duplicates for button text
    const originalCount = currentPoliticians.length + currentInstitutions.length;
    const currentCount = politicians.length + institutions.length;
    const duplicatesCount = originalCount - currentCount;
    
    // Update button text with duplicate count
    const deduplicateBtn = document.getElementById('deduplicateBtn');
    const btnText = duplicatesCount > 0 ? 
        `<i class="bi bi-people"></i><span class="d-none d-md-inline">Deduplizieren (${duplicatesCount})</span>` :
        `<i class="bi bi-people"></i><span class="d-none d-md-inline">Deduplizieren</span>`;
    deduplicateBtn.innerHTML = btnText;
    
    // Assign parties based on instance
    politicians = politicians.map(politician => {
        const account = politician.account?.value || '';
        if (account.includes('gruene.social') && (!politician.partyLabel || !politician.partyLabel.value)) {
            return {
                ...politician,
                partyLabel: { value: 'Bündnis 90/Die Grünen' }
            };
        }
        if (account.includes('linke.social') && (!politician.partyLabel || !politician.partyLabel.value)) {
            return {
                ...politician,
                partyLabel: { value: 'Die Linke' }
            };
        }
        if (account.includes('die-partei.social') && (!politician.partyLabel || !politician.partyLabel.value)) {
            return {
                ...politician,
                partyLabel: { value: 'Die PARTEI' }
            };
        }
        if (account.includes('piraten-partei.social') && (!politician.partyLabel || !politician.partyLabel.value)) {
            return {
                ...politician,
                partyLabel: { value: 'Piratenpartei Deutschland' }
            };
        }
        if (account.includes('spd.social') && (!politician.partyLabel || !politician.partyLabel.value)) {
            return {
                ...politician,
                partyLabel: { value: 'Sozialdemokratische Partei Deutschlands' }
            };
        }
        return politician;
    });
    
    // Add party as position if position is empty
    politicians = politicians.map(politician => {
        if (!politician.positionLabel?.value && politician.partyLabel?.value) {
            return {
                ...politician,
                positionLabel: { value: politician.partyLabel.value }
            };
        }
        return politician;
    });
    
    // Sort politicians by position
    politicians.sort((a, b) => {
        const posA = a.positionLabel?.value || '';
        const posB = b.positionLabel?.value || '';
        return posA.localeCompare(posB, 'de');
    });
    
    // Sort institutions by type
    institutions.sort((a, b) => {
        const typeA = a.typeLabel?.value || '';
        const typeB = b.typeLabel?.value || '';
        return typeA.localeCompare(typeB, 'de');
    });
    
    displayResults(politicians, institutions);
}

// Event listeners for buttons
document.addEventListener('DOMContentLoaded', () => {
    const deduplicateBtn = document.getElementById('deduplicateBtn');
    const activityFilterBtn = document.getElementById('activityFilterBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    
    // Initialize tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    
    deduplicateBtn.addEventListener('click', async () => {
        isDeduplicateEnabled = !isDeduplicateEnabled;
        deduplicateBtn.classList.toggle('active');
        await updateDisplayedResults();
    });
    
    activityFilterBtn.addEventListener('click', async () => {
        const loadingElement = document.getElementById('loading');
        try {
            loadingElement.classList.remove('d-none');
            isActivityFilterEnabled = !isActivityFilterEnabled;
            activityFilterBtn.classList.toggle('active');
            await updateDisplayedResults();
        } finally {
            loadingElement.classList.add('d-none');
        }
    });
    
    downloadBtn.addEventListener('click', async () => {
        // Get the current filtered results
        let politicians = [...currentPoliticians];
        let institutions = [...currentInstitutions];
        
        // Apply bsky filter
        politicians = politicians.filter(result => {
            const account = result.account?.value || '';
            return !account.toLowerCase().includes('bsky');
        });
        
        institutions = institutions.filter(result => {
            const account = result.account?.value || '';
            return !account.toLowerCase().includes('bsky');
        });
        
        // Apply deduplication if enabled
        if (isDeduplicateEnabled) {
            politicians = await removeDuplicates(politicians);
            institutions = await removeDuplicates(institutions);
        }
        
        // Apply activity filter if enabled
        if (isActivityFilterEnabled) {
            politicians = await filterMostRecentAccounts(politicians);
        }
        
        const markdown = await generateMarkdown(politicians, institutions);
        downloadMarkdown(markdown, 'politiker-und-institutionen-im-fediverse.md');
    });
    
    // Initial load
    fetchWikidataResults();
});

function formatFediverseUrl(account) {
    // Remove any leading/trailing whitespace
    account = account.trim();
    
    // Handle @user@instance.tld format
    if (account.startsWith('@')) {
        const parts = account.substring(1).split('@'); // Remove first @ and split
        if (parts.length === 2) {
            return `https://${parts[1]}/@${parts[0]}`;
        }
    }
    
    // Handle https://instance.tld/@user format
    if (account.startsWith('http')) {
        return account;
    }
    
    // Handle instance.tld/@user format
    if (account.includes('/')) {
        if (!account.startsWith('https://')) {
            return `https://${account}`;
        }
    }
    
    // If nothing else matches, try to construct a valid URL
    if (account.includes('@')) {
        const parts = account.split('@').filter(p => p);
        if (parts.length >= 2) {
            const username = parts[parts.length - 2];
            const domain = parts[parts.length - 1];
            return `https://${domain}/@${username}`;
        }
    }
    
    return account;
}

function getPartyAbbreviation(partyName) {
    const partyMap = {
        'Sozialdemokratische Partei Deutschlands': 'SPD',
        'Christlich Demokratische Union Deutschlands': 'CDU',
        'Christlich Demokratische Union': 'CDU',
        'CDU/CSU-Bundestagsfraktion': 'CDU',
        'Junge Union': 'CDU',
        'Junge Union Deutschlands': 'CDU',
        'Demokratischer Aufbruch': 'CDU',
        'Bündnis 90/Die Grünen': 'Grüne',
        'BÜNDNIS 90/DIE GRÜNEN': 'Grüne',
        'Bündnis 90': 'Grüne',
        'Grüne Jugend': 'Grüne',
        'GRÜNE JUGEND': 'Grüne',
        'Federation of Young European Greens': 'Grüne',
        'Grüne-Fraktion der 15. Wahlperiode des Landtags Saarland': 'Grüne',
        'Alternative für Deutschland': 'AfD',
        'Freie Demokratische Partei': 'FDP',
        'FDP-Bundestagsfraktion': 'FDP',
        'Die Linke': 'Linke',
        'Fraktion Die Linke': 'Linke',
        'Partei des Demokratischen Sozialismus': 'Linke',
        'Sozialistische Einheitspartei Deutschlands': 'Linke',
        'PDS': 'Linke',
        'Arbeit & soziale Gerechtigkeit – Die Wahlalternative': 'Linke',
        'WASG': 'Linke',
        'Deutsche Kommunistische Partei': 'DKP',
        'Christlich-Soziale Union in Bayern': 'CSU',
        'Piratenpartei Deutschland': 'Piraten',
        'Ökologisch-Demokratische Partei': 'ÖDP',
        'Partei für Arbeit, Rechtsstaat, Tierschutz, Elitenförderung und basisdemokratische Initiative': 'Die PARTEI',
        'Volt Deutschland': 'Volt',
        'Volt Europa': 'Volt',
        'Bündnis Sahra Wagenknecht – Vernunft und Gerechtigkeit': 'BSW',
        'Bündnis Sahra Wagenknecht': 'BSW',
        'fraktionsloser Abgeordneter': 'Fraktionslos',
        'fraktionslose Abgeordnete': 'Fraktionslos',
        'Die Violetten – für spirituelle Politik': 'Violetten',
        'Die Violetten': 'Violetten'
    };
    
    return partyMap[partyName] || partyName;
}

function getPositionPriority(position) {
    if (!position) return 0;
    const pos = position.toLowerCase();
    
    // Höchste Priorität: Aktuelle Mandate
    if (pos.includes('bundestag')) return 100;
    if (pos.includes('europäisches parlament')) return 90;
    if (pos.includes('landtag')) return 80;
    if (pos.includes('minister')) return 70;
    if (pos.includes('staatssekretär')) return 60;
    
    // Mittlere Priorität: Andere politische Ämter
    if (pos.includes('vorsitzende')) return 50;
    if (pos.includes('sprecher')) return 40;
    
    // Basis-Priorität für alle anderen
    return 10;
}

function getInstancePriority(account) {
    if (!account) return 0;
    const acc = account.toLowerCase();
    
    // Höchste Priorität: Offizielle Regierungsinstanzen
    if (acc.includes('social.bund.de')) return 30;
    if (acc.includes('social.hessen.de')) return 25;
    if (acc.includes('social.schleswig-holstein.de')) return 25;
    
    // Hohe Priorität: Partei-spezifische Instanzen
    if (acc.includes('gruene.social')) return 20;
    if (acc.includes('linke.social')) return 20;
    if (acc.includes('die-partei.social')) return 20;
    if (acc.includes('piraten-partei.social')) return 20;
    if (acc.includes('spd.social')) return 20;
    
    // Standard-Priorität für alle anderen
    return 10;
}

async function removeDuplicates(results) {
    const accountsByPerson = new Map();
    
    // Gruppiere alle Accounts nach Person
    results.forEach(result => {
        const name = result.itemLabel?.value || 'Unbekannt';
        const account = result.account?.value || '';
        const key = name;
        
        if (!accountsByPerson.has(key)) {
            accountsByPerson.set(key, []);
        }
        accountsByPerson.get(key).push(result);
    });
    
    // Für jede Person, wähle den wichtigsten Account
    const filteredResults = [];
    
    // Verarbeite jede Person
    for (const [name, accounts] of accountsByPerson.entries()) {
        // Wenn nur ein Account vorhanden ist, füge ihn direkt hinzu
        if (accounts.length === 1) {
            filteredResults.push(accounts[0]);
            continue;
        }
        
        // Bei mehreren Accounts, verwende die Priorisierung
        const sortedAccounts = accounts.sort((a, b) => {
            // Vergleiche Position-Priorität
            const posA = getPositionPriority(a.positionLabel?.value);
            const posB = getPositionPriority(b.positionLabel?.value);
            if (posA !== posB) return posB - posA;
            
            // Bei gleicher Position-Priorität, vergleiche Instanz-Priorität
            const instA = getInstancePriority(a.account?.value);
            const instB = getInstancePriority(b.account?.value);
            if (instA !== instB) return instB - instA;
            
            // Bei gleicher Instanz-Priorität, bevorzuge den Account mit mehr Informationen
            const infoA = (a.partyLabel?.value ? 1 : 0) + (a.positionLabel?.value ? 1 : 0);
            const infoB = (b.partyLabel?.value ? 1 : 0) + (b.positionLabel?.value ? 1 : 0);
            return infoB - infoA;
        });
        
        filteredResults.push(sortedAccounts[0]);
    }
    
    return filteredResults;
}

function generatePartyStatistics(results) {
    const partyStats = {};
    
    // Institutionelle Accounts nicht in der Parteien-Statistik mitzählen
    const filtered = results.filter(result => {
        const account = (result.account?.value || '').toLowerCase();
        const isInstitutionInstance = INSTITUTION_INSTANCES.some(inst => account.includes(inst));
        const isInstitutionType = (result.typeLabel?.value || '').toLowerCase().includes('institution');
        return !isInstitutionInstance && !isInstitutionType;
    });

    filtered.forEach(result => {
        const party = result.partyLabel?.value || '-';
        const mappedParty = getPartyAbbreviation(party);
        partyStats[mappedParty] = (partyStats[mappedParty] || 0) + 1;
    });

    // Sort by count descending
    const sortedStats = Object.entries(partyStats)
        .sort(([,a], [,b]) => b - a);

    return `
        <div class="card mt-4 mb-4">
            <div class="card-header">
                <h5 class="mb-0">Statistik der Fediverse-Accounts nach Parteien</h5>
            </div>
            <div class="card-body">
                <div class="row">
                    ${sortedStats.map(([party, count]) => `
                        <div class="col-md-3 mb-2">
                            <strong>${party}:</strong> ${count}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

async function getMastodonAccountInfo(account) {
    try {
        const url = formatFediverseUrl(account);
        if (!url.startsWith('https://')) return null;
        
        const domain = new URL(url).hostname;
        const username = url.split('@').pop();
        
        const apiUrl = `https://${domain}/api/v1/accounts/lookup?acct=${username}`;
        const response = await fetch(apiUrl);
        
        if (!response.ok) return null;
        
        const data = await response.json();
        return {
            name: data.display_name || data.username,
            lastPost: data.last_status_at ? new Date(data.last_status_at) : null
        };
    } catch (error) {
        return null;
    }
}

async function filterMostRecentAccounts(results) {
    const accountsByPerson = {};
    let processedAccounts = 0;
    let totalAccountsToProcess = 0;
    
    // Group accounts by person
    results.forEach(result => {
        const name = result.itemLabel?.value || 'Unbekannt';
        if (!accountsByPerson[name]) {
            accountsByPerson[name] = [];
        }
        accountsByPerson[name].push(result);
        totalAccountsToProcess += 1; // Zähle jeden Account
    });
    
    // Zeige Fortschrittsanzeige
    const loadingElement = document.getElementById('loading');
    loadingElement.innerHTML = `
        <div class="text-center">
            <div class="spinner-border" role="status">
                <span class="visually-hidden">Laden...</span>
            </div>
            <div class="mt-2">
                Prüfe Aktivität: <span id="processedAccounts">0</span>/${totalAccountsToProcess}
            </div>
        </div>
    `;
    loadingElement.classList.remove('d-none');
    
    const filteredResults = [];
    
    // For each person, keep only the most recently active account
    for (const [name, accounts] of Object.entries(accountsByPerson)) {
        if (accounts.length === 1) {
            // If name is a Q-number, try to get real name from Mastodon
            if (name.match(/^Q\d+$/)) {
                const info = await getMastodonAccountInfo(accounts[0].account.value);
                processedAccounts++;
                // Update Fortschrittsanzeige
                const counterElement = document.getElementById('processedAccounts');
                if (counterElement) {
                    counterElement.textContent = processedAccounts;
                }
                if (info?.name) {
                    accounts[0].itemLabel.value = info.name;
                }
            }
            filteredResults.push(accounts[0]);
            continue;
        }
        
        // Get last post dates and names for all accounts
        const accountDates = await Promise.all(
            accounts.map(async (result) => {
                const info = await getMastodonAccountInfo(result.account.value);
                processedAccounts++;
                // Update Fortschrittsanzeige
                const counterElement = document.getElementById('processedAccounts');
                if (counterElement) {
                    counterElement.textContent = processedAccounts;
                }
                // If name is a Q-number and we got a name from Mastodon, update it
                if (name.match(/^Q\d+$/) && info?.name) {
                    result.itemLabel.value = info.name;
                }
                return { result, lastPost: info?.lastPost || null };
            })
        );
        
        // Sort by last post date (most recent first) and keep the first one
        const sortedAccounts = accountDates
            .filter(({ lastPost }) => lastPost !== null)
            .sort((a, b) => b.lastPost - a.lastPost);
            
        if (sortedAccounts.length > 0) {
            filteredResults.push(sortedAccounts[0].result);
        } else {
            // If no valid dates found, keep the first account
            filteredResults.push(accounts[0]);
        }
    }
    
    // Verstecke Fortschrittsanzeige nach Abschluss
    loadingElement.classList.add('d-none');
    
    return filteredResults;
}

// Function to normalize Fediverse URLs
function normalizeUrl(url) {
    try {
        // Remove trailing slashes and convert to lowercase
        return url.toLowerCase().replace(/\/+$/, '');
    } catch (error) {
        console.error('Error normalizing URL:', error);
        return url;
    }
}

// Function to load excluded accounts
async function loadExcludedAccounts() {
    try {
        const response = await fetch('/exclude.json');
        if (!response.ok) {
            console.warn('Could not load exclude.json');
            return [];
        }
        const data = await response.json();
        return data.excluded_accounts.map(url => formatFediverseUrl(url));
    } catch (error) {
        console.error('Error loading exclude.json:', error);
        return [];
    }
}

// Function to filter out excluded accounts
function filterExcludedAccounts(accounts, excludedAccounts) {
    return accounts.filter(account => {
        const accountUrl = formatFediverseUrl(account.account?.value || '');
        return !excludedAccounts.includes(accountUrl);
    });
}

// Function to generate markdown
async function generateMarkdown(politicians, institutions) {
    // Load excluded accounts
    const excludedAccounts = await loadExcludedAccounts();
    
    // Filter out excluded accounts
    politicians = filterExcludedAccounts(politicians, excludedAccounts);
    institutions = filterExcludedAccounts(institutions, excludedAccounts);

    let markdown = '# Politiker und Institutionen im Fediverse\n\n';
    
    // Group politicians by position
    const politiciansByPosition = {};
    politicians.forEach(politician => {
        const position = politician.positionLabel?.value || '';
        const party = politician.partyLabel?.value || '-';
        const partyAbbr = getPartyAbbreviation(party);
        const positionKey = `${position} (${partyAbbr})`;
        
        if (!politiciansByPosition[positionKey]) {
            politiciansByPosition[positionKey] = [];
        }
        politiciansByPosition[positionKey].push(politician);
    });
    
    // Generate markdown for politicians
    Object.entries(politiciansByPosition).forEach(([position, politicians]) => {
        markdown += `\n## ${position}\n\n`;
        markdown += '| Wer | Link |\n';
        markdown += '| :-- | :-- |\n';
        politicians.forEach(politician => {
            const name = politician.itemLabel?.value || 'Unbekannt';
            const account = politician.account?.value || '';
            const url = formatFediverseUrl(account);
            markdown += `| ${name} | ${url} |\n`;
        });
        markdown += '\n';
    });
    
    // Group institutions by type
    const institutionsByType = {};
    institutions.forEach(institution => {
        const type = institution.typeLabel?.value || 'Sonstige';
        if (!institutionsByType[type]) {
            institutionsByType[type] = [];
        }
        institutionsByType[type].push(institution);
    });
    
    // Generate markdown for institutions
    Object.entries(institutionsByType).forEach(([type, institutions]) => {
        markdown += `\n## ${type}\n\n`;
        markdown += '| Institution | Link |\n';
        markdown += '| :-- | :-- |\n';
        institutions.forEach(institution => {
            const name = institution.itemLabel?.value || 'Unbekannt';
            const account = institution.account?.value || '';
            const url = formatFediverseUrl(account);
            markdown += `| ${name} | ${url} |\n`;
        });
        markdown += '\n';
    });
    
    return markdown;
}

function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

function convertToCodebergFormat(markdown) {
    const lines = markdown.split('\n');
    let currentPosition = '';
    let currentParty = '';
    let result = '# Politiker und Institutionen im Fediverse\n\n';
    
    // Map to store accounts by party
    const accountsByParty = new Map();
    
    lines.forEach(line => {
        // Check for position headers (## Something (PARTY))
        if (line.startsWith('## ')) {
            const match = line.match(/## (.*?) \((.*?)\)/);
            if (match) {
                currentPosition = match[1];
                currentParty = match[2];
            }
        }
        // Check for table rows (| Name | Link |)
        else if (line.startsWith('|') && !line.startsWith('| :') && !line.startsWith('| Wer') && !line.startsWith('| Institution')) {
            const parts = line.split('|').map(part => part.trim());
            if (parts.length >= 3) {
                const name = parts[1];
                const url = parts[2];
                
                // Create account entry
                const account = {
                    name: `${name} (${currentPosition})`,
                    url: url,
                    category: 'Mandatsträger:innen'
                };
                
                // Add to party map
                if (!accountsByParty.has(currentParty)) {
                    accountsByParty.set(currentParty, []);
                }
                accountsByParty.get(currentParty).push(account);
            }
        }
    });
    
    // Generate output in codeberg.org format
    accountsByParty.forEach((accounts, party) => {
        result += `## ${party}\n\n`;
        accounts.forEach(account => {
            result += `- [${account.name}](${account.url}) #${account.category}\n`;
        });
        result += '\n';
    });
    
    return result;
}

function downloadCodebergFormat(content, filename) {
    const markdown = convertToCodebergFormat(content);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

async function displayResults(politicians, institutions) {
    // Filter out bsky.brid.gy entries
    politicians = politicians.filter(result => {
        const account = result.account?.value || '';
        return !account.includes('bsky.brid.gy');
    });
    
    institutions = institutions.filter(result => {
        const account = result.account?.value || '';
        return !account.includes('bsky.brid.gy');
    });

    const resultsElement = document.getElementById('results');
    
    if (!politicians.length && !institutions.length) {
        resultsElement.innerHTML = '<div class="alert alert-info">Keine Ergebnisse gefunden.</div>';
        return;
    }

    const html = `
        ${generatePartyStatistics(politicians)}
        
        <h2 class="mt-4">Politiker im Fediverse</h2>
        <div class="table-responsive">
            <table class="table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Partei</th>
                        <th>Position</th>
                        <th>Fediverse</th>
                    </tr>
                </thead>
                <tbody>
                    ${politicians.map((result, index) => {
                        const name = result.itemLabel?.value || 'Unbekannt';
                        const party = result.partyLabel?.value || '-';
                        const partyAbbr = getPartyAbbreviation(party);
                        const position = result.positionLabel?.value || party;
                        const positionWithParty = `${position} (${partyAbbr})`;
                        const account = result.account?.value || '';
                        const accountUrl = formatFediverseUrl(account);
                        const displayAccount = account.startsWith('@') ? account : account.replace('https://', '');
                        
                        return `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${name}</td>
                                <td>${party}</td>
                                <td>${positionWithParty}</td>
                                <td>
                                    <a href="${accountUrl}" 
                                       target="_blank" rel="noopener noreferrer">
                                        ${displayAccount}
                                    </a>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <h2 class="mt-5">Politische Institutionen im Fediverse</h2>
        <div class="table-responsive">
            <table class="table table-striped table-hover">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Institution</th>
                        <th>Typ</th>
                        <th>Fediverse</th>
                    </tr>
                </thead>
                <tbody>
                    ${institutions.map((result, index) => {
                        const name = result.itemLabel?.value || 'Unbekannt';
                        const type = result.typeLabel?.value || '-';
                        const account = result.account?.value || '';
                        const accountUrl = formatFediverseUrl(account);
                        const displayAccount = account.startsWith('@') ? account : account.replace('https://', '');
                        
                        return `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${name}</td>
                                <td>${type}</td>
                                <td>
                                    <a href="${accountUrl}" 
                                       target="_blank" rel="noopener noreferrer">
                                        ${displayAccount}
                                    </a>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    resultsElement.innerHTML = html;
} 
