// Initialize UI state
const loadedAccounts = new Map();
let activePartyFilter = null;
let activeSearchFilter = '';
let currentSortField = 'recent_posts_count';

// Color mapping for parties
const partyColorMap = {
    'SPD': 'rgba(255, 0, 0, 1.0)',
    'CDU': 'rgba(0, 0, 0, 1.0)',
    'CSU': 'rgba(0, 0, 0, 1.0)',
    'Grüne': 'rgba(67, 176, 42, 1.0)',
    'FDP': 'rgba(255, 237, 0, 1.0)',
    'Linke': 'rgba(178, 0, 178, 1.0)',
    'AfD': 'rgba(0, 158, 224, 1.0)',
    'Piraten': 'rgba(255, 165, 0, 1.0)',
    'Volt': 'rgba(128, 0, 128, 1.0)',
    'Die PARTEI': 'rgba(0, 255, 255, 1.0)',
    'Freie Wähler': 'rgba(0, 0, 139, 1.0)',
    'DKP': 'rgba(180, 0, 0, 1.0)',
    'BSW': 'rgba(140, 0, 0, 1.0)',
    'ÖDP': 'rgba(255, 140, 0, 1.0)',
    'Violetten': 'rgba(147, 112, 219, 1.0)',
    'Fraktionslos': 'rgba(128, 128, 128, 1.0)'
};

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
        const baseColor = partyColorMap[category] || 'rgba(200, 200, 200, 0.5)';
        const color = baseColor.replace('0.5', '0.8').replace('0.4', '0.8');
        const barId = `stats-bar-${category.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        
        return `
            <div class="row mb-2 align-items-center">
                <div class="col-4 stats-label">${category}</div>
                <div class="col-7">
                    <div id="${barId}" class="stats-bar" style="width: ${percentage}%; background-color: ${color} !important"></div>
                </div>
                <div class="col-1 stats-count">${count}</div>
            </div>
        `;
    }).join('');
    
    document.getElementById('statsContent').innerHTML = `<div class="mb-3">${statsHtml}</div>`;
    
    // Apply colors again after DOM is updated
    sortedStats.forEach(([category]) => {
        const barId = `stats-bar-${category.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        const barElement = document.getElementById(barId);
        if (barElement) {
            const baseColor = partyColorMap[category] || 'rgba(200, 200, 200, 0.5)';
            const color = baseColor.replace('0.5', '0.8').replace('0.4', '0.8');
            barElement.style.setProperty('background-color', color, 'important');
        }
    });
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
        return '<i class="fa-brands fa-mastodon" title="Mastodon"></i>';
    }
}

// Function to determine party affiliation
function getPartyAffiliation(name, category, url) {
    const allParentheses = Array.from(category.matchAll(/\((.*?)\)/g));
    if (!allParentheses.length) return '-';

    // Falls die Klammer nur die Instanz markiert (z. B. "Institution (Instanz)"),
    // nicht als Partei werten
    const partyInBrackets = allParentheses[allParentheses.length - 1][1].trim();
    if (/^instanz$/i.test(partyInBrackets)) return '-';
    if (/^institution/i.test(category)) return '-';
    
    const partyMap = {
        'SPD': 'SPD',
        'CDU': 'CDU',
        'CSU': 'CSU',
        'Grüne': 'Grüne',
        'GRÜNE': 'Grüne',
        'FDP': 'FDP',
        'LINKE': 'Linke',
        'Linke': 'Linke',
        'AfD': 'AfD',
        'Piraten': 'Piraten',
        'Volt': 'Volt',
        'Die PARTEI': 'Die PARTEI',
        'Freie Wähler': 'Freie Wähler',
        'DKP': 'DKP',
        'BSW': 'BSW',
        'ÖDP': 'ÖDP',
        'Die Violetten': 'Violetten'
    };

    return partyMap[partyInBrackets] || partyInBrackets;
}

// Function to check if account has party affiliation
function hasPartyAffiliation(name, category, url) {
    const allParentheses = Array.from(category.matchAll(/\((.*?)\)/g));
    if (!allParentheses.length) return false;
    const last = allParentheses[allParentheses.length - 1][1].trim();
    if (/^instanz$/i.test(last)) return false;
    if (/^institution/i.test(category)) return false;
    return true;
}

// Function to get party class name
function getPartyClass(name, category, url) {
    const party = getPartyAffiliation(name, category, url);
    if (party === '-') return 'party-none';
    
    // Special handling for Grüne to ensure consistency
    if (party === 'Grüne') return 'party-gruene';
    
    return 'party-' + party.toLowerCase()
        .replace('ä', 'ae')
        .replace('ö', 'oe')
        .replace('ü', 'ue')
        .replace('ß', 'ss')
        .replace(/\s+/g, '-');
}

// Function to determine political party color
function getPartyColor(name, category, url) {
    const party = getPartyAffiliation(name, category, url);
    return partyColorMap[party] || 'rgba(0, 0, 0, 0.1)';
}

// Function to check if account is a bot
function isBot(name) {
    return name.toLowerCase().includes('(bot)') || 
           name.toLowerCase().includes('[bot]') ||
           name.toLowerCase().endsWith('bot') ||
           name.toLowerCase().includes('🤖');
}

// Function to render a single account row
function renderAccountRow(account) {
    const partyClass = getPartyClass(account.name, account.category, account.url);
    const accountData = loadedAccounts.get(account.url);
    const isAccountBot = accountData?.is_bot || false;
    const isInactive = Number(account.recent_posts_count) === 0;
    
    // Get post counts
    const posts_count = Number(account.posts_count) || 0;
    const recent_posts_count = Number(account.recent_posts_count) || 0;
    
    // Calculate bar widths
    const maxPosts = 5000; // Fixed maximum for total posts
    const maxRecentPosts = Math.max(...Array.from(loadedAccounts.values()).map(a => a.recent_posts_count || 0));
    
    const recentPostsPercentage = maxRecentPosts > 0 ? (recent_posts_count / maxRecentPosts * 100) : 0;
    const totalPostsPercentage = Math.min(posts_count / maxPosts * 100, 100); // Cap at 100%
    
    return `
        <tr class="${partyClass}${isAccountBot ? ' is-bot' : ''}${isInactive ? ' is-inactive' : ''}" 
            data-party="${partyClass}" 
            data-account-url="${account.url}"
            title="${isInactive ? 'Inaktiv (keine Posts in den letzten 200 Tagen)' : ''}">
            <td class="text-center">
                <div class="d-flex flex-column align-items-center gap-1">
                    <div>
                        ${isInactive ? 
                            '<i class="fa-solid fa-moon text-muted" title="Inaktiv"></i>' : 
                            '<i class="fa-brands fa-mastodon" title="Mastodon"></i>'}
                    </div>
                    ${isAccountBot ? 
                        '<div><i class="fa-solid fa-robot text-muted" title="Bot"></i></div>' : 
                        ''}
                </div>
            </td>
            <td>
                <div><a href="${account.url}" target="_blank" title="${account.url}">${account.name}</a></div>
                <div class="text-muted small">${account.category}</div>
            </td>
            ${hasPartyAffiliation(account.name, account.category, account.url) ? `<td>${getPartyAffiliation(account.name, account.category, account.url)}</td>` : ''}
            <td>
                <div class="posts-bar-container" data-account-url="${account.url}">
                    <div class="d-flex flex-column flex-grow-1 gap-1">
                        <div class="posts-bar recent-posts">
                            <div class="posts-bar-fill" style="width: ${recentPostsPercentage}%; background-color: #198754;"></div>
                        </div>
                        <div class="posts-bar total-posts">
                            <div class="posts-bar-fill" style="width: ${totalPostsPercentage}%; background-color: #0d6efd;"></div>
                        </div>
                    </div>
                    <div class="d-flex flex-column">
                        <span class="recent-posts-count small">${Number(recent_posts_count) === 120 ? '>120' : recent_posts_count}</span>
                        <span class="total-posts-count small">${posts_count}</span>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

// Function to render accounts in the tables
function renderAccounts(accounts) {
    // Store accounts in loadedAccounts with initial data first
    accounts.forEach(account => {
        loadedAccounts.set(account.url, {
            account,
            posts_count: Number(account.posts_count) || 0,
            recent_posts_count: Number(account.recent_posts_count) || 0,
            created_at: account.created_at || null,
            is_bot: account.is_bot || false  // Use the is_bot property from the account data
        });
    });

    // Split accounts into parties and institutions
    const partyAccounts = accounts.filter(account => hasPartyAffiliation(account.name, account.category, account.url));
    const institutionAccounts = accounts.filter(account => !hasPartyAffiliation(account.name, account.category, account.url));
    
    // Sort accounts by recent_posts_count initially
    partyAccounts.sort((a, b) => {
        const aData = loadedAccounts.get(a.url);
        const bData = loadedAccounts.get(b.url);
        return (bData?.recent_posts_count || 0) - (aData?.recent_posts_count || 0);
    });
    
    institutionAccounts.sort((a, b) => {
        const aData = loadedAccounts.get(a.url);
        const bData = loadedAccounts.get(b.url);
        return (bData?.recent_posts_count || 0) - (aData?.recent_posts_count || 0);
    });
    
    // Count inactive accounts
    const activePartyAccounts = partyAccounts.filter(account => {
        const data = loadedAccounts.get(account.url);
        return Number(data?.recent_posts_count) > 0;
    });
    const activeInstitutionAccounts = institutionAccounts.filter(account => {
        const data = loadedAccounts.get(account.url);
        return Number(data?.recent_posts_count) > 0;
    });
    
    // Render party accounts
    const partyTbody = document.getElementById('accountsTableBody');
    const partyTable = partyTbody.closest('table');
    const partyHeader = partyTable.closest('.card').querySelector('.card-header h2');
    if (partyHeader) {
        const activePercentage = ((activePartyAccounts.length / partyAccounts.length) * 100).toFixed(1);
        partyHeader.innerHTML = `Gefundene Accounts: ${partyAccounts.length}, davon ${activePartyAccounts.length} aktiv (${activePercentage}%)`;
    }
    
    const partyTableHeader = partyTable.querySelector('thead tr');
    partyTableHeader.innerHTML = `
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
    partyTbody.innerHTML = partyAccounts.map(account => renderAccountRow(account)).join('');
    
    // Render institution accounts
    const institutionsTbody = document.getElementById('institutionsTableBody');
    const institutionsTable = institutionsTbody.closest('table');
    const institutionsHeader = institutionsTable.closest('.card').querySelector('.card-header h2');
    if (institutionsHeader) {
        const activePercentage = ((activeInstitutionAccounts.length / institutionAccounts.length) * 100).toFixed(1);
        institutionsHeader.innerHTML = `Institutionen (${institutionAccounts.length}, davon ${activeInstitutionAccounts.length} aktiv (${activePercentage}%))`;
    }
    
    const institutionsTableHeader = institutionsTable.querySelector('thead tr');
    institutionsTableHeader.innerHTML = `
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
    institutionsTbody.innerHTML = institutionAccounts.map(account => renderAccountRow(account)).join('');

    // Update initial account count
    updateAccountCount();
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

// Function to update a single row with account data
function updateRow(account, data) {
    const row = document.querySelector(`tr[data-account-url="${account.url}"]`);
    if (!row) return;

    // Update bot and inactive status
    const isAccountBot = data.is_bot || false;
    const isInactive = Number(data.recent_posts_count) === 0;
    
    if (isAccountBot) {
        row.classList.add('is-bot');
    }
    if (isInactive) {
        row.classList.add('is-inactive');
        row.title = 'Inaktiv (keine Posts in den letzten 200 Tagen)';
    } else {
        row.classList.remove('is-inactive');
        row.title = '';
    }

    const iconCell = row.querySelector('td:first-child');
    iconCell.innerHTML = `
        <div class="d-flex flex-column align-items-center gap-1">
            <div>
                ${isInactive ? 
                    '<i class="fa-solid fa-moon text-muted" title="Inaktiv"></i>' : 
                    '<i class="fa-brands fa-mastodon" title="Mastodon"></i>'}
            </div>
            ${isAccountBot ? 
                '<div><i class="fa-solid fa-robot text-muted" title="Bot"></i></div>' : 
                ''}
        </div>
    `;

    // Get the posts container
    const postsContainer = row.querySelector('.posts-bar-container');
    if (postsContainer) {
        const recentPostsBar = postsContainer.querySelector('.recent-posts .posts-bar-fill');
        const totalPostsBar = postsContainer.querySelector('.total-posts .posts-bar-fill');
        const recentPostsCount = postsContainer.querySelector('.recent-posts-count');
        const totalPostsCount = postsContainer.querySelector('.total-posts-count');

        // Update post counts
        const posts_count = Number(data.posts_count) || 0;
        const recent_posts_count = Number(data.recent_posts_count) || 0;

        // Calculate percentages
        const maxPosts = 5000; // Fixed maximum for total posts
        const maxRecentPosts = Math.max(...Array.from(loadedAccounts.values()).map(a => a.recent_posts_count));

        const recentPostsPercentage = maxRecentPosts > 0 ? (recent_posts_count / maxRecentPosts * 100) : 0;
        const totalPostsPercentage = Math.min(posts_count / maxPosts * 100, 100); // Cap at 100%

        // Update bars
        recentPostsBar.style.width = `${recentPostsPercentage}%`;
        totalPostsBar.style.width = `${totalPostsPercentage}%`;

        // Update counts
        recentPostsCount.textContent = recent_posts_count;
        totalPostsCount.textContent = posts_count;
    }

    // Store updated data
    loadedAccounts.set(account.url, {
        account,
        posts_count: Number(data.posts_count) || 0,
        recent_posts_count: Number(data.recent_posts_count) || 0,
        created_at: data.created_at || null,
        is_bot: isAccountBot
    });

    // Reorder appropriate table
    const tableId = hasPartyAffiliation(account.name, account.category, account.url) ? 
        'accountsTableBody' : 'institutionsTableBody';
    reorderTable(tableId);

    // Update party distribution
    renderPartyDistribution();
}

// Function to reorder table based on current sort field
function reorderTable(tableId) {
    const tbody = document.getElementById(tableId);
    if (!tbody) return;

    const rows = Array.from(tbody.getElementsByTagName('tr'));
    
    rows.sort((a, b) => {
        const aUrl = a.getAttribute('data-account-url');
        const bUrl = b.getAttribute('data-account-url');
        const aData = loadedAccounts.get(aUrl);
        const bData = loadedAccounts.get(bUrl);
        
        if (!aData || !bData) return 0;
        
        return bData[currentSortField] - aData[currentSortField];
    });
    
    // Clear and re-append rows
    tbody.innerHTML = '';
    rows.forEach(row => tbody.appendChild(row));
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
    const timelineBar = document.querySelector('.timeline-bar');
    if (!timelineBar) {
        return;
    }

    // Filter accounts based on party affiliation
    let partyAccounts = Array.from(loadedAccounts.values())
        .filter(({account}) => hasPartyAffiliation(account.name, account.category, account.url))
        .filter(({created_at}) => created_at); // Only accounts with creation date

    // Apply active party filter if set
    if (activePartyFilter) {
        partyAccounts = partyAccounts.filter(({account}) => {
            const party = getPartyAffiliation(account.name, account.category, account.url);
            return party === activePartyFilter;
        });
        timelineBar.classList.add('filtered');
    } else {
        timelineBar.classList.remove('filtered');
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

    // If we have a party filter, we don't need to group by party
    let timelineHtml = '';
    if (activePartyFilter) {
        // For filtered view, show all accounts in a single row
        const color = partyColorMap[activePartyFilter] || 'rgba(200, 200, 200, 1.0)';
        const markers = partyAccounts.map(({account, created_at, is_bot}) => {
            if (!created_at) return '';
            
            const date = new Date(created_at);
            if (isNaN(date.getTime())) return '';
            
            const position = ((date - earliestDate) / timeSpan * 100).toFixed(2);
            
            return `
                <div class="timeline-marker${is_bot ? ' is-bot' : ''}" 
                     style="left: ${position}%; background-color: ${color};"
                     title="${account.name} (${activePartyFilter})${is_bot ? ' [Bot]' : ''}\nBeigetreten: ${date.toLocaleDateString()}">
                </div>
            `;
        }).filter(html => html).join('');

        timelineHtml = `<div class="timeline-party-row">${markers}</div>`;
    } else {
        // For unfiltered view, group by party as before
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
        timelineHtml = sortedParties.map(([party, accounts]) => {
        const markers = accounts.map(({account, created_at, is_bot}) => {
            if (!created_at) return '';
            
            const date = new Date(created_at);
            if (isNaN(date.getTime())) return '';
            
            const position = ((date - earliestDate) / timeSpan * 100).toFixed(2);
                const color = partyColorMap[party] || 'rgba(200, 200, 200, 1.0)';
            
            return `
                <div class="timeline-marker${is_bot ? ' is-bot' : ''}" 
                     style="left: ${position}%; background-color: ${color};"
                     title="${account.name} (${party})${is_bot ? ' [Bot]' : ''}\nBeigetreten: ${date.toLocaleDateString()}">
                </div>
            `;
        }).filter(html => html).join('');

            return `<div class="timeline-party-row">${markers}</div>`;
    }).join('');
    }

    // Generate year scale
    const startYear = earliestDate.getFullYear();
    const endYear = now.getFullYear();
    const yearScale = [];
    const monthScale = [];

    for (let year = startYear; year <= endYear; year++) {
        const yearDate = new Date(year, 0, 1);
        const position = ((yearDate - earliestDate) / timeSpan * 100).toFixed(2);
        
        // Skip the first year label to prevent overflow
        if (year > startYear) {
        yearScale.push(`
            <div class="timeline-year" style="left: ${position}%">
                ${year}
            </div>
        `);
        }

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
    const segments = sortedParties.map(([party, count]) => {
        const percentage = (count / total * 100).toFixed(1);
        const botCount = partyBotStats.get(party) || 0;
        const botPercentage = (botCount / count * 100).toFixed(1);
        const color = partyColorMap[party] || 'rgba(200, 200, 200, 1.0)';
        const partyClass = `party-${party.toLowerCase().replace(/\s+/g, '-')}`;
        
        // Calculate active non-bot accounts
        const activeNonBotAccounts = partyAccounts
            .filter(({account, is_bot, recent_posts_count}) => {
                const accountParty = getPartyAffiliation(account.name, account.category, account.url);
                return accountParty === party && !is_bot && Number(recent_posts_count) > 0;
            }).length;
        
        const activePercentage = (activeNonBotAccounts / count * 100).toFixed(1);
        
        return `
            <div class="party-segment${activePartyFilter === party ? ' active' : ''}" 
                 style="width: ${percentage}%; position: relative;" 
                 data-party="${party}"
                 onclick="applyPartyFilter('${party}')"
                 title="${party}: ${count} Accounts (${percentage}%), davon ${botCount} Bots (${botPercentage}%), ${activeNonBotAccounts} aktive Accounts ohne Bots (${activePercentage}%)">
                <div style="position: absolute; top: 0; left: 0; right: 0; bottom: ${activePercentage}%; background-color: ${color.replace('1.0', '0.65')}"></div>
                <div style="position: absolute; bottom: 0; left: 0; right: 0; height: ${activePercentage}%; background-color: ${color}"></div>
            </div>
        `;
    }).join('');
    
    bar.innerHTML = segments;
    
    // Update legend with click handlers
    legend.innerHTML = sortedParties.map(([party, count]) => {
        const color = partyColorMap[party] || 'rgba(200, 200, 200, 1.0)';
        const botCount = partyBotStats.get(party) || 0;
        const percentage = (count / total * 100).toFixed(1);
        const botPercentage = (botCount / count * 100).toFixed(1);
        
        return `
            <div class="party-legend-item${activePartyFilter === party ? ' active' : ''}" 
                 data-party="${party}"
                 onclick="applyPartyFilter('${party}')"
                 style="cursor: pointer;">
                <span class="party-color" style="background-color: ${color};"></span>
                <span class="party-name">${party}</span>
                <span class="party-count">${count}</span>
                <span class="party-percentage">(${percentage}%)</span>
            </div>
        `;
    }).join('');
}

// Function to update account count in the party distribution header
function updateAccountCount() {
    const partyAccounts = Array.from(loadedAccounts.values())
        .filter(({account}) => hasPartyAffiliation(account.name, account.category, account.url));
    const total = partyAccounts.length;
    const bots = partyAccounts.filter(({is_bot}) => is_bot).length;
    
    const element = document.getElementById('partyDistributionTotal');
    if (element) {
        element.textContent = `${total} Accounts${bots > 0 ? ` (davon ${bots} Bots)` : ''}`;
    }
}

// Function to apply party filter
function applyPartyFilter(party) {
    activePartyFilter = party;
    
    // Update visual state of party segments and legend items
    document.querySelectorAll('.party-segment').forEach(segment => {
        segment.classList.toggle('active', segment.getAttribute('data-party') === party);
    });
    document.querySelectorAll('.party-legend-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-party') === party);
    });
    
    // Show/hide reset filter button
    const resetButton = document.getElementById('resetFilter');
    if (resetButton) {
        resetButton.style.display = party ? 'inline-block' : 'none';
    }
    
    // Filter tables
    filterTables();
    
    // Re-render timeline with new filter
    renderTimeline();
}

// Function to filter tables based on active filters
function filterTables() {
    const searchTerm = document.getElementById('accountSearch').value.toLowerCase();
    const partyRows = document.querySelectorAll('#accountsTableBody tr');
    const institutionRows = document.querySelectorAll('#institutionsTableBody tr');
    
    // Filter party accounts
    partyRows.forEach(row => {
        const partyClass = row.getAttribute('data-party');
        const text = row.textContent.toLowerCase();
        // Special handling for Grüne
        const expectedClass = activePartyFilter === 'Grüne' ? 
            'party-gruene' : 
            `party-${activePartyFilter?.toLowerCase().replace(/\s+/g, '-')}`;
        const matchesParty = !activePartyFilter || partyClass === expectedClass;
        const matchesSearch = !searchTerm || text.includes(searchTerm);
        row.style.display = (matchesParty && matchesSearch) ? '' : 'none';
    });
    
    // Filter institution accounts if search is active
    institutionRows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const matchesSearch = !searchTerm || text.includes(searchTerm);
        row.style.display = matchesSearch ? '' : 'none';
    });
    
    // Update counts in headers
    updateFilteredCounts();
    
    // Show/hide clear button
    const clearButton = document.getElementById('clearSearch');
    if (clearButton) {
        clearButton.style.display = searchTerm ? 'block' : 'none';
    }
}

// Function to update counts when filtered
function updateFilteredCounts() {
    // Update party accounts count
    const partyTbody = document.getElementById('accountsTableBody');
    const visiblePartyRows = Array.from(partyTbody.getElementsByTagName('tr')).filter(row => row.style.display !== 'none');
    const activePartyRows = visiblePartyRows.filter(row => !row.classList.contains('is-inactive'));
    
    const partyHeader = partyTbody.closest('.card').querySelector('.card-header h2');
    if (partyHeader) {
        const activePercentage = ((activePartyRows.length / visiblePartyRows.length) * 100).toFixed(1);
        partyHeader.innerHTML = `Gefundene Accounts: ${visiblePartyRows.length}, davon ${activePartyRows.length} aktiv (${activePercentage}%)`;
    }
    
    // Update institutions count if needed
    const institutionsTbody = document.getElementById('institutionsTableBody');
    const visibleInstitutionRows = Array.from(institutionsTbody.getElementsByTagName('tr')).filter(row => row.style.display !== 'none');
    const activeInstitutionRows = visibleInstitutionRows.filter(row => !row.classList.contains('is-inactive'));
    
    const institutionsHeader = institutionsTbody.closest('.card').querySelector('.card-header h2');
    if (institutionsHeader) {
        const activePercentage = ((activeInstitutionRows.length / visibleInstitutionRows.length) * 100).toFixed(1);
        institutionsHeader.innerHTML = `Institutionen: ${visibleInstitutionRows.length}, davon ${activeInstitutionRows.length} aktiv (${activePercentage}%)`;
    }
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Load fedipol data with cache buster
        const response = await fetch('fedipol_data.json?' + new Date().getTime());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const jsonData = await response.json();
        const fedipolData = jsonData.data || jsonData;

        // Validate data structure
        if (!fedipolData || typeof fedipolData !== 'object') {
            throw new Error('Invalid data structure in fedipol_data.json');
        }

        // Convert fedipol data to account list with validation
        const accounts = Object.entries(fedipolData)
            .filter(([url, data]) => {
                return data && data.account && 
                       typeof data.account === 'object' &&
                       data.account.url && 
                       data.account.name;
            })
            .map(([url, data]) => ({
                ...data.account,
                posts_count: Number(data.posts_count) || 0,
                recent_posts_count: Number(data.recent_posts_count) || 0,
                created_at: data.created_at || null,
                is_bot: data.is_bot === true  // Explicitly check for true to avoid falsy values
            }));

        if (accounts.length === 0) {
            throw new Error('No valid accounts found in fedipol_data.json');
        }

        // Extract instances from account URLs with validation
        const instances = new Map();
        accounts.forEach(account => {
            try {
                const url = new URL(account.url);
                const instanceUrl = `${url.protocol}//${url.hostname}`;
                if (!instances.has(instanceUrl)) {
                    instances.set(instanceUrl, {
                        name: url.hostname,
                        url: instanceUrl,
                        category: 'Instance'
                    });
                }
            } catch (e) {
                console.warn('Invalid URL:', account.url);
            }
        });

        // Render all components
        renderAccounts(accounts);
        renderInstances(Array.from(instances.values()));
        renderStats(accounts);
        renderTimeline();
        renderPartyDistribution();

        // Add scroll event listener
        window.addEventListener('scroll', updateActiveButtonOnScroll);
        
        // Add search event listeners
        const searchInput = document.getElementById('accountSearch');
        const clearButton = document.getElementById('clearSearch');
        
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                filterTables();
            });
        }
        
        if (clearButton) {
            clearButton.addEventListener('click', () => {
            searchInput.value = '';
                filterTables();
        });
        }

    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('error').classList.remove('d-none');
        document.getElementById('error').textContent = `Fehler beim Laden der Daten: ${error.message}`;
    }
});