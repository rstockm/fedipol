// Wikidata SPARQL endpoint
const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';

// SPARQL query to find German politicians with Fediverse accounts
const POLITICIANS_QUERY = `
SELECT DISTINCT ?item ?itemLabel ?position ?positionLabel ?account ?party ?partyLabel WHERE {
  {
    # German politicians with positions and Fediverse accounts
    ?item wdt:P102 ?party ;    # Political party
          p:P4033 ?statement . # Mastodon address
    ?statement ps:P4033 ?account .
    
    {
      # Current members of parliament (Bundestag, EU, Landtage)
      VALUES ?membership { 
        wd:Q131745197  # Member of 20th Bundestag
        wd:Q91459453   # Member of 19th Bundestag
        wd:Q18744396   # Member of 9th European Parliament
        wd:Q86189847   # Member of 8th European Parliament
        wd:Q2023214    # Member of Landtag
      }
      ?item wdt:P31 ?membership .
      ?item wdt:P102 ?party .
      BIND(?membership AS ?position)
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
        # EU Parliament
        VALUES ?position { wd:Q27169 wd:Q1755693 }  # Include both Landtag and MEP positions
      }
    }
    
    # German citizenship
    ?item wdt:P27 wd:Q183 .
  }
  UNION
  {
    # All accounts on linke.social
    ?item p:P4033 ?statement .
    ?statement ps:P4033 ?account .
    FILTER(CONTAINS(STR(?account), "linke.social"))
    
    # Get party affiliation if available
    OPTIONAL {
      ?item wdt:P102 ?party .
    }
    
    # Get position if available
    OPTIONAL {
      ?item p:P39 ?positionStatement .
      ?positionStatement ps:P39 ?position .
      FILTER NOT EXISTS { ?positionStatement pq:P582 ?endtime }
    }
  }
  UNION
  {
    # All accounts on gruene.social
    ?item p:P4033 ?statement .
    ?statement ps:P4033 ?account .
    FILTER(CONTAINS(STR(?account), "gruene.social"))
    
    # Get party affiliation if available
    OPTIONAL {
      ?item wdt:P102 ?party .
    }
    
    # Get position if available
    OPTIONAL {
      ?item p:P39 ?positionStatement .
      ?positionStatement ps:P39 ?position .
      FILTER NOT EXISTS { ?positionStatement pq:P582 ?endtime }
    }
  }
  
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
}
ORDER BY ?partyLabel ?itemLabel
`;

// SPARQL query to find German political institutions with Fediverse accounts
const INSTITUTIONS_QUERY = `
SELECT DISTINCT ?item ?itemLabel ?type ?typeLabel ?account WHERE {
  {
    # Regular institutions query
    ?item p:P4033 ?statement .  # Has Mastodon address
    ?statement ps:P4033 ?account .
    
    # Must be in Germany
    ?item wdt:P17 wd:Q183 .
    
    # Type of institution
    ?item wdt:P31 ?type .
    
    # Filter for relevant types
    VALUES ?type {
      wd:Q7278     # political party
      wd:Q327333   # government ministry
      wd:Q2478897  # regional association
      wd:Q31075    # legislature
      wd:Q2659904  # government agency
      wd:Q4471     # regional parliament
      wd:Q2166081  # youth organization
      wd:Q1663594  # political foundation
    }
  }
  UNION
  {
    # All accounts on social.bund.de
    ?item p:P4033 ?statement .
    ?statement ps:P4033 ?account .
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
    FILTER(CONTAINS(STR(?account), "social.hessen.de"))
    
    # Get the type if available
    OPTIONAL {
      ?item wdt:P31 ?type .
    }
  }
  
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
}
ORDER BY ?typeLabel ?itemLabel
`;

async function fetchWikidataResults() {
    const loadingElement = document.getElementById('loading');
    const resultsElement = document.getElementById('results');
    
    try {
        loadingElement.classList.remove('d-none');
        
        // Fetch politicians
        const politiciansUrl = WIKIDATA_ENDPOINT + '?' + new URLSearchParams({
            query: POLITICIANS_QUERY,
            format: 'json'
        });

        const politiciansResponse = await fetch(politiciansUrl, {
            headers: {
                'Accept': 'application/sparql-results+json',
                'User-Agent': 'FediPol/1.0 (https://github.com/rstockm/fedipol)'
            }
        });

        // Fetch institutions
        const institutionsUrl = WIKIDATA_ENDPOINT + '?' + new URLSearchParams({
            query: INSTITUTIONS_QUERY,
            format: 'json'
        });

        const institutionsResponse = await fetch(institutionsUrl, {
            headers: {
                'Accept': 'application/sparql-results+json',
                'User-Agent': 'FediPol/1.0 (https://github.com/rstockm/fedipol)'
            }
        });

        if (!politiciansResponse.ok || !institutionsResponse.ok) {
            throw new Error('Network response was not ok');
        }

        const politiciansData = await politiciansResponse.json();
        const institutionsData = await institutionsResponse.json();
        
        displayResults(politiciansData.results.bindings, institutionsData.results.bindings);
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
        'Junge Union': 'CDU',
        'Junge Union Deutschlands': 'CDU',
        'Demokratischer Aufbruch': 'CDU',
        'Bündnis 90/Die Grünen': 'Grüne',
        'BÜNDNIS 90/DIE GRÜNEN': 'Grüne',
        'Bündnis 90': 'Grüne',
        'Grüne Jugend': 'Grüne',
        'GRÜNE JUGEND': 'Grüne',
        'Alternative für Deutschland': 'AfD',
        'Freie Demokratische Partei': 'FDP',
        'Die Linke': 'Linke',
        'Partei des Demokratischen Sozialismus': 'Linke',
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

function removeDuplicates(results) {
    const seen = new Set();
    return results.filter(result => {
        const name = result.itemLabel?.value || 'Unbekannt';
        const account = result.account?.value || '';
        const key = `${name}-${account}`;
        
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function generatePartyStatistics(results) {
    const partyStats = {};
    
    results.forEach(result => {
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
    
    // Group accounts by person
    results.forEach(result => {
        const name = result.itemLabel?.value || 'Unbekannt';
        if (!accountsByPerson[name]) {
            accountsByPerson[name] = [];
        }
        accountsByPerson[name].push(result);
    });
    
    const filteredResults = [];
    
    // For each person, keep only the most recently active account
    for (const [name, accounts] of Object.entries(accountsByPerson)) {
        if (accounts.length === 1) {
            // If name is a Q-number, try to get real name from Mastodon
            if (name.match(/^Q\d+$/)) {
                const info = await getMastodonAccountInfo(accounts[0].account.value);
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
    
    return filteredResults;
}

function generateMarkdown(politicians, institutions) {
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
    const resultsElement = document.getElementById('results');
    
    if (!politicians.length && !institutions.length) {
        resultsElement.innerHTML = '<div class="alert alert-info">Keine Ergebnisse gefunden.</div>';
        return;
    }

    // Process politicians
    let uniquePoliticians = removeDuplicates(politicians);
    uniquePoliticians = await filterMostRecentAccounts(uniquePoliticians);
    
    // Assign parties based on instance
    uniquePoliticians = uniquePoliticians.map(politician => {
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
        return politician;
    });
    
    // Add party as position if position is empty
    uniquePoliticians = uniquePoliticians.map(politician => {
        if (!politician.positionLabel?.value && politician.partyLabel?.value) {
            return {
                ...politician,
                positionLabel: { value: politician.partyLabel.value }
            };
        }
        return politician;
    });
    
    // Sort politicians by position after all transformations
    uniquePoliticians.sort((a, b) => {
        const posA = a.positionLabel?.value || '';
        const posB = b.positionLabel?.value || '';
        return posA.localeCompare(posB, 'de');
    });

    // Process institutions and sort by type
    const uniqueInstitutions = removeDuplicates(institutions);
    uniqueInstitutions.sort((a, b) => {
        const typeA = a.typeLabel?.value || '';
        const typeB = b.typeLabel?.value || '';
        return typeA.localeCompare(typeB, 'de');
    });

    const html = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            ${generatePartyStatistics(uniquePoliticians)}
            <button id="downloadBtn" class="btn btn-primary">
                Als Markdown herunterladen
            </button>
        </div>
        
        <h2 class="mt-4">Politiker im Fediverse</h2>
        <div class="table-responsive">
            <table class="table table-striped table-hover">
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
                    ${uniquePoliticians.map((result, index) => {
                        const name = result.itemLabel?.value || 'Unbekannt';
                        const party = result.partyLabel?.value || '-';
                        const partyAbbr = getPartyAbbreviation(party);
                        // Use party value if position is empty
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
                    ${uniqueInstitutions.map((result, index) => {
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

    // Add click handler for download button
    document.getElementById('downloadBtn').addEventListener('click', () => {
        const markdown = generateMarkdown(uniquePoliticians, uniqueInstitutions);
        downloadMarkdown(markdown, 'politiker-und-institutionen-im-fediverse.md');
    });
}

// Load results when the page loads
document.addEventListener('DOMContentLoaded', fetchWikidataResults); 