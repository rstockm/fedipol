// Initialize settings and parser
const settings = new Settings();
const parser = new AccountParser();
let mastodonApi = null; // Will be initialized in DOMContentLoaded

// Konfigurationskonstanten
const ACCOUNTS_STATS_LIMIT = 300; // Auf 300 erhöht, vorher 200
const loadedAccounts = new Map(); // Global state for loaded accounts
let maxPosts = 0; // Global state for max posts
let maxRecentPosts = 0;
let tableSortable = null; // Sortable instance
let activePartyFilter = null;
let activeSearchFilter = '';

// Check if we're in refresh mode
const isRefreshing = new URLSearchParams(window.location.search).has('refresh');
if (isRefreshing) {
    // Clear all cached data
    loadedAccounts.clear();
    maxPosts = 0;
    maxRecentPosts = 0;
}

// Add sorting state
let currentSortField = 'recent_posts_count'; // Default sort by recent posts

// Function to scroll to section
function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    const headerHeight = document.querySelector('.sticky-header').offsetHeight;
    const elementPosition = section.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 20;
    
    window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
    });

    updateActiveButton(sectionId);
}

// Function to update active button based on section ID
function updateActiveButton(sectionId) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[onclick="scrollToSection('${sectionId}')"]`).classList.add('active');
}

// Function to update active button based on scroll position
function updateActiveButtonOnScroll() {
    const sections = ['accountsContainer', 'institutionsContainer', 'instancesContainer', 'statsContainer'];
    const headerHeight = document.querySelector('.sticky-header').offsetHeight;

    for (const sectionId of sections) {
        const section = document.getElementById(sectionId);
        const rect = section.getBoundingClientRect();
        
        if (rect.top <= headerHeight + 50 && rect.bottom >= headerHeight) {
            updateActiveButton(sectionId);
            break;
        }
    }
}

// Function to render statistics
function renderStats(accounts) {
    const stats = {};
    accounts.forEach(account => {
        const category = account.category || 'Sonstige';
        stats[category] = (stats[category] || 0) + 1;
    });
    
    const sortedStats = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    const maxCount = Math.max(...Object.values(stats));
    
    const statsHtml = sortedStats.map(([category, count]) => {
        const percentage = (count / maxCount * 100).toFixed(1);
        return `
            <div class="row mb-2 align-items-center">
                <div class="col-4 stats-label">${category}</div>
                <div class="col-7">
                    <div class="stats-bar" style="width: ${percentage}%"></div>
                </div>
                <div class="col-1 stats-count">${count}</div>
            </div>
        `;
    }).join('');
    
    document.getElementById('statsContent').innerHTML = statsHtml;
}

// Function to determine platform type from URL
function getPlatformIcon(url) {
    const urlLower = url.toLowerCase();
    if (urlLower.includes('peertube')) {
        return '<i class="fa-solid fa-video" title="PeerTube"></i>';
    } else if (urlLower.includes('pixelfed')) {
        return '<i class="fa-solid fa-camera" title="Pixelfed"></i>';
    } else if (urlLower.includes('lemmy')) {
        return '<i class="fa-solid fa-comments" title="Lemmy"></i>';
    } else if (urlLower.includes('pleroma')) {
        return '<i class="fa-solid fa-comment-dots" title="Pleroma"></i>';
    } else if (urlLower.includes('misskey')) {
        return '<i class="fa-solid fa-comment-alt" title="Misskey"></i>';
    } else {
        // Default to Mastodon
        return '<i class="fa-brands fa-mastodon" title="Mastodon"></i>';
    }
}

// Function to check for "Linke" party variations
function isLinkeParty(text) {
    return text.includes('linke') || 
           text.includes('pds') || 
           text.includes('linksfraktion') || 
           text.includes('linksjugend') || 
           (text.includes('links') && 
            (text.includes('partei') || 
             text.includes('fraktion') || 
             text.includes('jugend') || 
             text.includes('solid')));
}

// Function to determine political party color
function getPartyColor(name, category, url) {
    const text = (name + ' ' + url).toLowerCase();
    
    // Kräftigere Varianten der Parteifarben
    if (text.includes('spd') || text.includes('sozialdemokrat')) {
        return 'rgba(255, 0, 0, 0.3)'; // Rot
    } else if (text.includes('cdu') || text.includes('csu') || text.includes('christlich')) {
        return 'rgba(0, 0, 0, 0.2)'; // Schwarz
    } else if (text.includes('grüne') || text.includes('gruene') || text.includes('bündnis 90')) {
        return 'rgba(67, 176, 42, 0.3)'; // Grün
    } else if (text.includes('fdp') || text.includes('liberal')) {
        return 'rgba(255, 237, 0, 0.35)'; // Gelb
    } else if (isLinkeParty(text)) {
        return 'rgba(223, 0, 0, 0.35)'; // Dunkleres Rot
    } else if (text.includes('piraten')) {
        return 'rgba(255, 165, 0, 0.3)'; // Orange
    } else if (text.includes('afd')) {
        return 'rgba(0, 158, 224, 0.3)'; // Blau
    } else if (text.includes('freie wähler') || text.includes('freie waehler')) {
        return 'rgba(0, 0, 139, 0.3)'; // Dunkelblau
    } else if (text.includes('volt')) {
        return 'rgba(128, 0, 128, 0.3)'; // Lila
    } else if (text.includes('die partei') || text.includes('partei partei')) {
        return 'rgba(0, 255, 255, 0.3)'; // Cyan
    }
    
    return 'rgba(0, 0, 0, 0.1)'; // Hellgrau als Fallback
}

// Function to determine party affiliation
function getPartyAffiliation(name, category, url) {
    const text = (name + ' ' + url).toLowerCase();
    
    if (text.includes('spd') || text.includes('sozialdemokrat')) {
        return 'SPD';
    } else if (text.includes('cdu') || text.includes('csu') || text.includes('christlich')) {
        return text.includes('csu') ? 'CSU' : 'CDU';
    } else if (text.includes('grüne') || text.includes('gruene') || text.includes('bündnis 90')) {
        return 'Grüne';
    } else if (text.includes('fdp') || text.includes('liberal')) {
        return 'FDP';
    } else if (isLinkeParty(text)) {
        return 'Linke';
    } else if (text.includes('piraten')) {
        return 'Piraten';
    } else if (text.includes('afd')) {
        return 'AfD';
    } else if (text.includes('freie wähler') || text.includes('freie waehler')) {
        return 'Freie Wähler';
    } else if (text.includes('volt')) {
        return 'Volt';
    } else if (text.includes('die partei') || text.includes('partei partei')) {
        return 'Die PARTEI';
    }
    
    return '-';
}

// Function to get party class name
function getPartyClass(name, category, url) {
    const text = (name + ' ' + url).toLowerCase();
    
    if (text.includes('spd') || text.includes('sozialdemokrat')) {
        return 'party-spd';
    } else if (text.includes('csu')) {
        return 'party-csu';
    } else if (text.includes('cdu') || text.includes('christlich')) {
        return 'party-cdu';
    } else if (text.includes('grüne') || text.includes('gruene') || text.includes('bündnis 90')) {
        return 'party-gruene';
    } else if (text.includes('fdp') || text.includes('liberal')) {
        return 'party-fdp';
    } else if (isLinkeParty(text)) {
        return 'party-linke';
    } else if (text.includes('piraten')) {
        return 'party-piraten';
    } else if (text.includes('afd')) {
        return 'party-afd';
    } else if (text.includes('freie wähler') || text.includes('freie waehler') || text.includes('fw')) {
        return 'party-freie-waehler';
    } else if (text.includes('volt')) {
        return 'party-volt';
    } else if (text.includes('die partei') || text.includes('partei partei')) {
        return 'party-die-partei';
    }
    
    return 'party-none';
}

// Function to check if account is a bot
function isBot(name, apiData = null) {
    // Check API data first if available
    if (apiData && apiData.is_bot) {
        return true;
    }
    
    // Fallback to name-based detection
    return name.toLowerCase().includes('(bot)') || 
           name.toLowerCase().includes('[bot]') ||
           name.toLowerCase().endsWith('bot') ||
           name.toLowerCase().includes('🤖');
}

// Function to check if account has party affiliation
function hasPartyAffiliation(name, category, url) {
    const affiliation = getPartyAffiliation(name, category, url);
    return affiliation !== '-';
}

// Function to render a single account row
function renderAccountRow(account, isLoading = false) {
    const partyClass = getPartyClass(account.name, account.category, account.url);
    const isAccountBot = isBot(account.name);
    return `
        <tr class="${partyClass}${isAccountBot ? ' is-bot' : ''}" data-party="${partyClass}" data-account-url="${account.url}">
            <td class="text-center">${getPlatformIcon(account.url)}${isAccountBot ? ' <i class="fa-solid fa-robot text-muted" title="Bot"></i>' : ''}</td>
            <td>
                <div><a href="${account.url}" target="_blank" title="${account.url}">${account.name}</a></div>
                <div class="text-muted small">${account.category}</div>
            </td>
            ${hasPartyAffiliation(account.name, account.category, account.url) ? `<td>${getPartyAffiliation(account.name, account.category, account.url)}</td>` : ''}
            <td>
                <div class="posts-bar-container${isLoading ? ' loading' : ''}" data-account-url="${account.url}">
                    <div class="d-flex flex-column flex-grow-1 gap-1">
                        <div class="posts-bar recent-posts">
                            <div class="posts-bar-fill"></div>
                        </div>
                        <div class="posts-bar total-posts">
                            <div class="posts-bar-fill"></div>
                        </div>
                    </div>
                    <div class="d-flex flex-column">
                        <span class="recent-posts-count small">-</span>
                        <span class="total-posts-count small">-</span>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

// Function to render accounts in the tables
function renderAccounts(accounts) {
    // Split accounts into parties and institutions
    const partyAccounts = accounts.filter(account => hasPartyAffiliation(account.name, account.category, account.url));
    const institutionAccounts = accounts.filter(account => !hasPartyAffiliation(account.name, account.category, account.url));
    
    // Render party accounts
    const partyTbody = document.getElementById('accountsTableBody');
    const partyTable = partyTbody.closest('table');
    const partyHeader = partyTable.querySelector('thead tr');
    partyHeader.innerHTML = `
        <th style="width: 40px">Art</th>
        <th>Account</th>
        <th>Partei</th>
        <th>
            <div class="d-flex flex-column">
                <span>Posts</span>
                <small class="text-muted">
                    <span class="text-success fw-bold" style="cursor: pointer" onclick="toggleSort('recent_posts_count')">Letzte 60 Tage</span> / 
                    <span class="text-primary" style="cursor: pointer" onclick="toggleSort('posts_count')">Gesamt</span>
                </small>
            </div>
        </th>
    `;
    partyTbody.innerHTML = partyAccounts.map(account => renderAccountRow(account, true)).join('');
    
    // Render institution accounts
    const institutionsTbody = document.getElementById('institutionsTableBody');
    const institutionsTable = institutionsTbody.closest('table');
    const institutionsHeader = institutionsTable.querySelector('thead tr');
    institutionsHeader.innerHTML = `
        <th style="width: 40px">Art</th>
        <th>Account</th>
        <th>
            <div class="d-flex flex-column">
                <span>Posts</span>
                <small class="text-muted">
                    <span class="text-success fw-bold" style="cursor: pointer" onclick="toggleSort('recent_posts_count')">Letzte 60 Tage</span> / 
                    <span class="text-primary" style="cursor: pointer" onclick="toggleSort('posts_count')">Gesamt</span>
                </small>
            </div>
        </th>
    `;
    institutionsTbody.innerHTML = institutionAccounts.map(account => renderAccountRow(account, true)).join('');

    // Update initial account count
    updateAccountCount();

    // Start loading post counts for all accounts
    loadPostCounts(accounts);
}

// Function to toggle sort
function toggleSort(field) {
    currentSortField = field;
    
    // Update header styles
    const partyHeader = document.querySelector('#accountsTableBody').closest('table').querySelector('thead tr th:last-child');
    const institutionsHeader = document.querySelector('#institutionsTableBody').closest('table').querySelector('thead tr th:last-child');
    
    [partyHeader, institutionsHeader].forEach(header => {
        if (header) {
            header.innerHTML = `
                <div class="d-flex flex-column">
                    <span>Posts</span>
                    <small class="text-muted">
                        <span class="text-success${field === 'recent_posts_count' ? ' fw-bold' : ''}" 
                              style="cursor: pointer" 
                              onclick="toggleSort('recent_posts_count')">Letzte 60 Tage</span> / 
                        <span class="text-primary${field === 'posts_count' ? ' fw-bold' : ''}" 
                              style="cursor: pointer" 
                              onclick="toggleSort('posts_count')">Gesamt</span>
                    </small>
                </div>
            `;
        }
    });
    
    // Reorder both tables
    reorderTable('accountsTableBody');
    reorderTable('institutionsTableBody');
}

// Function to update a single row
function updateRow(account, stats, error = false) {
    const row = document.querySelector(`tr[data-account-url="${account.url}"]`);
    if (!row) return;

    // Update bot status if needed
    const isAccountBot = isBot(account.name, stats);
    if (isAccountBot) {
        row.classList.add('is-bot');
        const iconCell = row.querySelector('td:first-child');
        if (!iconCell.innerHTML.includes('fa-robot')) {
            iconCell.innerHTML += ' <i class="fa-solid fa-robot text-muted" title="Bot"></i>';
        }
    }

    // Update posts count and bars
    const barContainer = row.querySelector('.posts-bar-container');
    const recentBarFill = row.querySelector('.recent-posts .posts-bar-fill');
    const totalBarFill = row.querySelector('.total-posts .posts-bar-fill');
    const recentCountSpan = row.querySelector('.recent-posts-count');
    const totalCountSpan = row.querySelector('.total-posts-count');
    
    barContainer.classList.remove('loading');
    if (error) {
        recentCountSpan.textContent = '?';
        totalCountSpan.textContent = '?';
        recentBarFill.style.width = '0%';
        totalBarFill.style.width = '0%';
    } else {
        const recentPosts = stats.recent_posts_count || 0;
        const totalPosts = stats.posts_count || 0;
        
        // Cap recent posts at 200 for the bar
        const recentPostsCapped = Math.min(recentPosts, 200);
        // Cap total posts at 4000 for the bar
        const totalPostsCapped = Math.min(totalPosts, 4000);
        
        // Show '>' symbol if exceeding limits
        recentCountSpan.textContent = recentPosts >= 200 ? 
            `>${recentPostsCapped.toLocaleString()}` : 
            recentPosts.toLocaleString();
        
        totalCountSpan.textContent = totalPosts >= 4000 ? 
            `>${totalPostsCapped.toLocaleString()}` : 
            totalPosts.toLocaleString();
        
        // Calculate percentages based on fixed maximums
        const recentPercentage = (recentPostsCapped / 200 * 100).toFixed(1);
        const totalPercentage = (totalPostsCapped / 4000 * 100).toFixed(1);
        
        recentBarFill.style.width = `${recentPercentage}%`;
        totalBarFill.style.width = `${totalPercentage}%`;
    }

    // Store in loaded accounts
    loadedAccounts.set(account.url, {
        account,
        posts_count: error ? -1 : stats.posts_count,
        recent_posts_count: error ? -1 : stats.recent_posts_count,
        is_bot: isAccountBot,
        created_at: stats.created_at  // Add created_at to stored data
    });

    // Reorder appropriate table
    const tableId = hasPartyAffiliation(account.name, account.category, account.url) ? 
        'accountsTableBody' : 'institutionsTableBody';
    reorderTable(tableId);

    // Update party distribution with current data
    renderPartyDistribution();
}

// Function to load post counts
async function loadPostCounts(accounts) {
    console.log(`Versuche Statistiken für maximal ${ACCOUNTS_STATS_LIMIT} Accounts zu laden...`);
    
    // Split accounts into parties and institutions
    const partyAccounts = accounts.filter(account => hasPartyAffiliation(account.name, account.category, account.url));
    const institutionAccounts = accounts.filter(account => !hasPartyAffiliation(account.name, account.category, account.url));
    
    // Get all accounts up to the limit, regardless of category
    const allAccounts = [...partyAccounts, ...institutionAccounts];
    const limitedAccounts = allAccounts.slice(0, ACCOUNTS_STATS_LIMIT);
    
    console.log(`Lade ${limitedAccounts.length} Accounts (${partyAccounts.length} Parteien, ${institutionAccounts.length} Institutionen)`);

    // Process limited accounts in batches
    for (let i = 0; i < limitedAccounts.length; i += mastodonApi.BATCH_SIZE) {
        const batch = limitedAccounts.slice(i, i + mastodonApi.BATCH_SIZE);
        const batchPromises = batch.map(async account => {
            try {
                const stats = await mastodonApi.getAccountStats(account.url);
                if (!stats.error && stats.posts_count !== null) {
                    maxPosts = Math.max(maxPosts, stats.posts_count);
                    maxRecentPosts = Math.max(maxRecentPosts, stats.recent_posts_count || 0);
                    updateRow(account, stats);
                } else {
                    updateRow(account, stats, true);
                }
            } catch (error) {
                console.error(`Fehler beim Laden von ${account.url}:`, error);
                updateRow(account, { posts_count: 0, recent_posts_count: 0 }, true);
            }
        });

        await Promise.all(batchPromises);
        
        if (i + mastodonApi.BATCH_SIZE < limitedAccounts.length) {
            await new Promise(resolve => setTimeout(resolve, mastodonApi.DELAY_MS));
        }
    }

    // Enable export button after ALL data is loaded
    const exportButton = document.getElementById('exportButton');
    if (exportButton) {
        exportButton.disabled = false;
        exportButton.onclick = () => {
            const cacheData = Object.fromEntries(loadedAccounts);
            const dataStr = JSON.stringify({
                data: cacheData,
                timestamp: Date.now()
            }, null, 2);
            
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'fedipol_data.json';
            a.click();
            URL.revokeObjectURL(url);
        };
    }

    // Update account count after all data is loaded
    updateAccountCount();
}

// Function to render instances in the table
function renderInstances(instances) {
    const tbody = document.getElementById('instancesTableBody');
    tbody.innerHTML = instances.map(instance => `
        <tr>
            <td>${instance.name}</td>
            <td><a href="${instance.url}" target="_blank">${instance.url}</a></td>
            <td>${instance.category}${instance.subCategory ? ` - ${instance.subCategory}` : ''}</td>
        </tr>
    `).join('');
}

// Function to render timeline
function renderTimeline() {
    console.log('Rendering timeline...');
    
    const timelineBar = document.querySelector('.timeline-bar');
    if (!timelineBar) {
        console.error('Timeline bar element not found!');
        return;
    }

    // Filter accounts based on party affiliation and active filter
    let partyAccounts = Array.from(loadedAccounts.values())
        .filter(({account}) => hasPartyAffiliation(account.name, account.category, account.url))
        .filter(({created_at}) => created_at); // Only accounts with creation date

    // Apply active party filter if set
    if (activePartyFilter) {
        partyAccounts = partyAccounts.filter(({account}) => {
            const party = getPartyAffiliation(account.name, account.category, account.url);
            return party === activePartyFilter;
        });
    }

    if (partyAccounts.length === 0) {
        timelineBar.innerHTML = '<div class="text-muted text-center p-3">Keine Daten verfügbar</div>';
        return;
    }

    // Find earliest and latest dates
    const now = new Date();
    let earliestDate = now;
    
    partyAccounts.forEach(({created_at}) => {
        if (!created_at) return;
        const date = new Date(created_at);
        if (!isNaN(date.getTime()) && date < earliestDate) {
            earliestDate = date;
        }
    });

    // Calculate total time span
    const timeSpan = now - earliestDate;

    // Group accounts by party
    const partyGroups = new Map();
    partyAccounts.forEach((accountData) => {
        const party = getPartyAffiliation(accountData.account.name, accountData.account.category, accountData.account.url);
        if (!partyGroups.has(party)) {
            partyGroups.set(party, []);
        }
        partyGroups.get(party).push(accountData);
    });

    // Sort parties by number of accounts (descending)
    const sortedParties = Array.from(partyGroups.entries())
        .sort((a, b) => b[1].length - a[1].length);

    // Generate timeline rows for each party
    const timelineHtml = sortedParties.map(([party, accounts]) => {
        const markers = accounts.map(({account, created_at, is_bot}) => {
            if (!created_at) return '';
            
            const date = new Date(created_at);
            if (isNaN(date.getTime())) return '';
            
            const position = ((date - earliestDate) / timeSpan * 100).toFixed(2);
            const color = getPartyColor(party, '', '').replace('0.3', '0.8');
            
            return `
                <div class="timeline-marker${is_bot ? ' is-bot' : ''}" 
                     style="left: ${position}%; background-color: ${color};"
                     title="${account.name} (${party})${is_bot ? ' [Bot]' : ''}\nBeigetreten: ${date.toLocaleDateString()}">
                </div>
            `;
        }).filter(html => html).join('');

        return `
            <div class="timeline-party-row">
                ${markers}
            </div>
        `;
    }).join('');

    // Generate year scale
    const startYear = earliestDate.getFullYear();
    const endYear = now.getFullYear();
    const yearScale = [];
    const monthScale = [];

    for (let year = startYear; year <= endYear; year++) {
        const yearDate = new Date(year, 0, 1);
        const position = ((yearDate - earliestDate) / timeSpan * 100).toFixed(2);
        yearScale.push(`
            <div class="timeline-year" style="left: ${position}%">
                ${year}
            </div>
        `);

        // Add month markers for each year
        for (let month = 1; month <= 12; month++) {
            if (year === endYear && month > now.getMonth() + 1) break;
            if (year === startYear && month < earliestDate.getMonth() + 1) continue;
            
            const monthDate = new Date(year, month - 1, 1);
            const monthPosition = ((monthDate - earliestDate) / timeSpan * 100).toFixed(2);
            monthScale.push(`
                <div class="timeline-month" style="left: ${monthPosition}%"></div>
            `);
        }
    }

    // Combine all HTML
    timelineBar.innerHTML = `
        ${timelineHtml}
        <div class="timeline-months">${monthScale.join('')}</div>
        <div class="timeline-scale">${yearScale.join('')}</div>
    `;
}

// Function to render party distribution
function renderPartyDistribution() {
    // Use loadedAccounts data instead of original accounts
    const partyAccounts = Array.from(loadedAccounts.values())
        .filter(({account}) => hasPartyAffiliation(account.name, account.category, account.url));
    
    const partyStats = new Map();
    const partyBotStats = new Map();
    
    // Count accounts and bots per party
    partyAccounts.forEach(({account, is_bot}) => {
        const party = getPartyAffiliation(account.name, account.category, account.url);
        partyStats.set(party, (partyStats.get(party) || 0) + 1);
        
        if (is_bot) {
            partyBotStats.set(party, (partyBotStats.get(party) || 0) + 1);
        }
    });
    
    // Sort parties by count
    const sortedParties = Array.from(partyStats.entries())
        .sort((a, b) => b[1] - a[1]);
    
    const total = partyAccounts.length;
    const bar = document.querySelector('.party-distribution-bar');
    const legend = document.querySelector('.party-distribution-legend');
    
    // Update or create segments
    sortedParties.forEach(([party, count]) => {
        const percentage = (count / total * 100).toFixed(1);
        const botCount = partyBotStats.get(party) || 0;
        const botPercentage = (botCount / count * 100).toFixed(1);
        const color = getPartyColor(party, '', '').replace('0.3', '0.8');
        
        // Calculate heights for regular and bot accounts
        const regularHeight = 100 - botPercentage;
        const botHeight = botPercentage;
        
        // Try to find existing segment
        let segment = bar.querySelector(`[data-party="${party}"]`);
        if (!segment) {
            // Create new segment if it doesn't exist
            segment = document.createElement('div');
            segment.className = 'party-segment';
            segment.dataset.party = party;
            segment.onclick = () => applyPartyFilter(party);
            bar.appendChild(segment);
        }
        
        // Update segment
        segment.className = `party-segment${party === activePartyFilter ? ' active' : ''}`;
        segment.style.width = `${percentage}%`;
        segment.title = `${party}: ${count} Accounts (${percentage}%), davon ${botCount} Bots (${botPercentage}%)`;
        
        // Update or create inner elements
        segment.innerHTML = `
            <div class="regular-accounts" style="background-color: ${color}; height: ${regularHeight}%"></div>
            ${botCount > 0 ? `<div class="bot-accounts" style="background-color: ${color}; height: ${botHeight}%"></div>` : ''}
        `;
    });
    
    // Remove obsolete segments
    Array.from(bar.children).forEach(segment => {
        const party = segment.dataset.party;
        if (!partyStats.has(party)) {
            segment.remove();
        }
    });
    
    // Update legend
    legend.innerHTML = sortedParties.map(([party, count]) => {
        const botCount = partyBotStats.get(party) || 0;
        const botPercentage = (botCount / count * 100).toFixed(1);
        const color = getPartyColor(party, '', '').replace('0.3', '0.8');
        
        return `
            <div class="legend-item">
                <div class="color-box${botCount > 0 ? ' with-bots' : ''}" style="background-color: ${color}">
                    ${botCount > 0 ? `<div class="bot-indicator" style="height: ${botPercentage}%"></div>` : ''}
                </div>
                <span>${party} (${count}${botCount > 0 ? `, ${botCount} Bots` : ''})</span>
            </div>
        `;
    }).join('');
    
    // Update total count
    document.getElementById('partyDistributionTotal').textContent = 
        `${total} Accounts insgesamt`;
    
    // Reapply active filter if exists
    if (activePartyFilter) {
        applyPartyFilter(activePartyFilter);
    }

    // Render timeline
    renderTimeline();
}

// Function to apply party filter
function applyPartyFilter(party = null) {
    activePartyFilter = party;
    
    // Update active state of segments
    document.querySelectorAll('.party-segment').forEach(segment => {
        segment.classList.toggle('active', segment.dataset.party === party);
    });
    
    // Show/hide reset filter button
    const resetFilter = document.getElementById('resetFilter');
    resetFilter.classList.toggle('visible', party !== null);
    
    // Add/remove filtered class on timeline
    const timelineBar = document.querySelector('.timeline-bar');
    timelineBar.classList.toggle('filtered', party !== null);
    
    // Filter table rows
    const tbody = document.getElementById('accountsTableBody');
    const rows = tbody.getElementsByTagName('tr');
    
    for (let row of rows) {
        if (!party) {
            row.style.display = '';
            continue;
        }

        // Normalize party name for comparison
        const normalizedParty = party.toLowerCase()
            .replace('ä', 'ae')
            .replace('ö', 'oe')
            .replace('ü', 'ue')
            .replace('ß', 'ss')
            .replace(/\s+/g, '-');  // Replace spaces with hyphens
        
        const expectedClass = `party-${normalizedParty}`;
        
        if (row.dataset.party === expectedClass) {
            // If there's an active search filter, check if the row matches it
            if (activeSearchFilter) {
                const accountUrl = row.dataset.accountUrl;
                const accountData = loadedAccounts.get(accountUrl);
                if (accountData) {
                    const { account } = accountData;
                    const searchText = `${account.name} ${account.url} ${account.category}`.toLowerCase();
                    row.style.display = searchText.includes(activeSearchFilter) ? '' : 'none';
                }
            } else {
                row.style.display = '';
            }
        } else {
            row.style.display = 'none';
        }
    }

    updateAccountCount();
    
    // Re-render timeline with new filter
    renderTimeline();
}

// Function to reorder a specific table
function reorderTable(tableId) {
    const tbody = document.getElementById(tableId);
    if (!tbody) return;
    
    // Sort loaded accounts that belong to this table
    const sortedAccounts = Array.from(loadedAccounts.values())
        .filter(({account}) => {
            const isPartyAccount = hasPartyAffiliation(account.name, account.category, account.url);
            return (tableId === 'accountsTableBody' && isPartyAccount) ||
                   (tableId === 'institutionsTableBody' && !isPartyAccount);
        })
        .sort((a, b) => {
            // Sort by selected field
            const aValue = a[currentSortField] || 0;
            const bValue = b[currentSortField] || 0;
            return bValue - aValue;
        });
    
    // Get current order
    const currentRows = Array.from(tbody.children);
    
    // Create new order array with actual DOM elements
    const newOrder = [];
    const seen = new Set();
    
    // First add sorted accounts
    sortedAccounts.forEach(({account}) => {
        const row = currentRows.find(r => r.dataset.accountUrl === account.url);
        if (row && !seen.has(account.url)) {
            newOrder.push(row);
            seen.add(account.url);
        }
    });
    
    // Then add remaining rows in their current order
    currentRows.forEach(row => {
        if (!seen.has(row.dataset.accountUrl)) {
            newOrder.push(row);
            seen.add(row.dataset.accountUrl);
        }
    });

    // Apply the new order manually
    newOrder.forEach((row, index) => {
        const currentIndex = Array.from(tbody.children).indexOf(row);
        if (currentIndex !== index) {
            const referenceNode = tbody.children[index];
            tbody.insertBefore(row, referenceNode);
        }
    });
}

// Add scroll event listener
window.addEventListener('scroll', updateActiveButtonOnScroll);

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize API
    mastodonApi = new MastodonApi();
    console.log('MastodonApi initialized:', mastodonApi);
    
    // Initialize tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl, {
            trigger: 'hover focus',
            enabled: window.innerWidth < 768  // Only enable tooltips on mobile
        });
    });
    
    // Remove footer creation code
    const mainContainer = document.querySelector('.container.main-content');
    mainContainer.style.paddingBottom = '3rem';

    try {
        await settings.load();
        const settingsStatus = document.getElementById('settingsStatus');
        
        // Show cache status
        const isRefreshing = new URLSearchParams(window.location.search).has('refresh');
        settingsStatus.innerHTML = `
            <div class="alert alert-info">
                ${isRefreshing ? 
                    'Daten werden neu geladen... <a href="?" class="alert-link">Zum Cache zurückkehren</a>' : 
                    'Daten werden aus dem Cache geladen... <a href="?refresh" class="alert-link">Neu laden</a>'}
            </div>
        `;
        
        const {accounts, instances} = await parser.fetchAndParse(settings.getAccountListUrl());
        renderStats(accounts);
        renderAccounts(accounts);
        renderInstances(instances);
        // Initial party distribution
        renderPartyDistribution();

        // Hide status after loading
        setTimeout(() => {
            settingsStatus.innerHTML = '';
        }, isRefreshing ? 10000 : 3000);  // Show status longer when refreshing

        // Add search functionality
        const searchInput = document.getElementById('accountSearch');
        const clearSearchButton = document.getElementById('clearSearch');
        
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                applySearchFilter(e.target.value);
                clearSearchButton.style.display = e.target.value.length > 0 ? 'block' : 'none';
            }, 300); // Debounce search for better performance
        });

        clearSearchButton.addEventListener('click', () => {
            searchInput.value = '';
            applySearchFilter('');
            clearSearchButton.style.display = 'none';
        });

    } catch (error) {
        // Nur bei Fehlern eine Statusmeldung anzeigen
        document.getElementById('settingsStatus').innerHTML = 
            `<div class="alert alert-danger">Error: ${error.message}</div>`;
    }
});

// Add after the applyPartyFilter function
function applySearchFilter(searchTerm) {
    activeSearchFilter = searchTerm.toLowerCase();
    
    // Get all account rows
    const tbody = document.getElementById('accountsTableBody');
    const rows = tbody.getElementsByTagName('tr');
    
    for (let row of rows) {
        // If there's an active party filter, first check if the row matches the party
        if (activePartyFilter) {
            const normalizedParty = activePartyFilter.toLowerCase()
                .replace('ä', 'ae')
                .replace('ö', 'oe')
                .replace('ü', 'ue')
                .replace('ß', 'ss')
                .replace(/\s+/g, '-');
            
            const expectedClass = `party-${normalizedParty}`;
            
            // If row doesn't match party filter, keep it hidden
            if (row.dataset.party !== expectedClass) {
                row.style.display = 'none';
                continue;
            }
        }

        // If we get here, either there's no party filter or the row matches the party filter
        const accountUrl = row.dataset.accountUrl;
        const accountData = loadedAccounts.get(accountUrl);
        
        if (!accountData) {
            row.style.display = 'none';
            continue;
        }

        const { account } = accountData;
        const searchText = `${account.name} ${account.url} ${account.category}`.toLowerCase();
        
        if (!activeSearchFilter || searchText.includes(activeSearchFilter)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    }
    
    updateAccountCount();
}

// Add after the existing global variables
function updateAccountCount() {
    const tbody = document.getElementById('accountsTableBody');
    const visibleRows = Array.from(tbody.getElementsByTagName('tr')).filter(row => row.style.display !== 'none');
    const totalRows = tbody.getElementsByTagName('tr').length;
    const title = document.querySelector('#accountsContainer .card-header h2');
    
    // Count active accounts (those with at least 1 post in last 60 days)
    const activeAccounts = visibleRows.filter(row => {
        const accountUrl = row.dataset.accountUrl;
        const accountData = loadedAccounts.get(accountUrl);
        return accountData && accountData.recent_posts_count > 0;
    }).length;
    
    // Calculate percentage of active accounts
    const activePercentage = ((activeAccounts / visibleRows.length) * 100).toFixed(1);
    
    if (visibleRows.length === totalRows) {
        title.textContent = `Gefundene Accounts (${totalRows}, davon ${activeAccounts} aktiv, ${activePercentage}%)`;
    } else {
        title.textContent = `Gefundene Accounts (${visibleRows.length} von ${totalRows}, davon ${activeAccounts} aktiv, ${activePercentage}%)`;
    }
}

function showError(message, type = 'error') {
  const statusElement = document.getElementById('settingsStatus');
  statusElement.innerHTML = `
    <div class="alert alert-${type}">
      ${message}
    </div>
  `;
} 