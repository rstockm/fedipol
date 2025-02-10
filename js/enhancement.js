// Global variables
let allAccounts = [];
let loadedCount = 0;
const BATCH_SIZE = 10; // Number of parallel requests
const BATCH_DELAY = 1000; // Delay between batches in ms
let isPaused = false; // Track pause state
let isScanning = false; // Track scanning state
let isLoading = false;

// Function to fetch and parse the markdown file
async function loadAccountsFromMarkdown() {
    try {
        const response = await fetch('politiker-und-institutionen-im-fediverse.md');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const text = await response.text();
        
        // Parse markdown content
        allAccounts = parseMarkdownContent(text);
        
        // Initialize Mastodon data
        allAccounts = allAccounts.map(account => ({
            ...account,
            created_at: null,
            posts_count: null,
            recent_posts_count: null,
            is_bot: null,
            loading: false,
            error: null  // Explicitly set error to null for unloaded accounts
        }));
        
        // Render initial accounts
        renderAccounts(allAccounts);
        
        // Update export button state after initialization
        updateExportButton();
        
    } catch (error) {
        console.error('Error loading markdown file:', error);
        document.getElementById('accountsTableBody').innerHTML = `
            <tr>
                <td colspan="8" class="text-danger">
                    Error loading data: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Function to toggle scan pause state
async function togglePause() {
    const scanButton = document.getElementById('scanButton');
    isPaused = !isPaused;
    
    if (isPaused) {
        scanButton.innerHTML = 'Fortsetzen';
        scanButton.classList.remove('btn-warning');
        scanButton.classList.add('btn-success');
    } else {
        scanButton.innerHTML = 'Pause';
        scanButton.classList.remove('btn-success');
        scanButton.classList.add('btn-warning');
        // Resume scanning
        loadMastodonData(allAccounts, false);
    }
}

// Function to start scanning
async function startScan() {
    // If already scanning, handle pause
    if (isScanning) {
        togglePause();
        return;
    }
    
    // Reset states
    isPaused = false;
    isScanning = true;
    
    // Update button appearance
    const scanButton = document.getElementById('scanButton');
    scanButton.innerHTML = 'Pause';
    scanButton.classList.remove('btn-primary');
    scanButton.classList.add('btn-warning');
    
    // Show progress bar
    const progressElement = document.getElementById('loadingProgress');
    progressElement.classList.remove('d-none');
    progressElement.classList.add('d-flex');
    
    // Reset counter
    loadedCount = 0;
    updateLoadingProgress(loadedCount, allAccounts.length);
    
    // Start loading data
    await loadMastodonData(allAccounts, false);
    
    // Reset button and hide progress when complete
    if (!isPaused) {
        progressElement.classList.remove('d-flex');
        progressElement.classList.add('d-none');
        scanButton.innerHTML = 'Scan abgeschlossen';
        scanButton.classList.remove('btn-warning');
        scanButton.classList.add('btn-success');
        scanButton.disabled = true;
        isScanning = false;
        
        // Update export button state
        updateExportButton();
    }
}

// Function to check if an account needs updating
function needsUpdate(account) {
    return !account.posts_count && !account.recent_posts_count && !account.created_at;
}

// Function to load Mastodon data in batches
async function loadMastodonData(accounts, updateOnly = false) {
    if (isLoading) return;
    isLoading = true;
    
    // Show progress bar
    const progressElement = document.getElementById('loadingProgress');
    if (progressElement) {
        progressElement.classList.remove('d-none');
        progressElement.classList.add('d-flex');
    }
    
    // Filter accounts that need updating if in update mode
    const accountsToProcess = updateOnly ? 
        accounts.filter(account => needsUpdate(account)) : 
        accounts;
    
    loadedCount = accounts.length - accountsToProcess.length; // Start from already loaded count
    updateProgress();
    
    // Process in batches
    for (let i = 0; i < accountsToProcess.length; i += BATCH_SIZE) {
        const batch = accountsToProcess.slice(i, i + BATCH_SIZE);
        const promises = batch.map(account => loadAccountData(account));
        
        try {
            await Promise.all(promises);
            loadedCount += batch.length;
            updateProgress();
            
            // Update UI after each batch
            renderAccounts(allAccounts);
            
            if (i + BATCH_SIZE < accountsToProcess.length) {
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
            }
        } catch (error) {
            console.error('Error processing batch:', error);
            // Don't break the loop, continue with next batch
        }
    }
    
    isLoading = false;
    if (progressElement) {
        progressElement.classList.remove('d-flex');
        progressElement.classList.add('d-none');
    }
    const exportButton = document.getElementById('exportButton');
    if (exportButton) {
        exportButton.disabled = false;
    }
}

// Function to update progress bar and counter
function updateProgress() {
    const progressBar = document.getElementById('loadingBar');
    const progressCounter = document.getElementById('loadingCounter');
    const total = allAccounts.length;
    const percentage = (loadedCount / total * 100).toFixed(1);
    
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
    }
    if (progressCounter) {
        progressCounter.textContent = `${loadedCount}/${total} geladen`;
    }
}

// Function to load data for a single account
async function loadAccountData(account) {
    try {
        // Mark account as loading
        account.loading = true;
        renderAccounts(allAccounts);
        
        // Extract instance and username from URL
        const url = new URL(account.link);
        const username = url.pathname.split('/').pop().replace('@', '');
        const instance = url.hostname;
        
        // First get the account ID and basic info
        const lookupUrl = `https://${instance}/api/v1/accounts/lookup?acct=${username}`;
        const lookupResponse = await fetch(lookupUrl);
        if (!lookupResponse.ok) throw new Error('Account lookup failed');
        
        const accountData = await lookupResponse.json();
        
        // Get recent posts
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        
        let recentPosts = [];
        let maxAttempts = 3;
        let nextLink = `https://${instance}/api/v1/accounts/${accountData.id}/statuses?limit=40`;
        
        while (maxAttempts > 0 && nextLink) {
            const statusesResponse = await fetch(nextLink);
            if (!statusesResponse.ok) break;
            
            const posts = await statusesResponse.json();
            if (!posts || posts.length === 0) break;
            
            let allPostsTooOld = true;
            for (const post of posts) {
                const postDate = new Date(post.created_at);
                if (postDate >= sixtyDaysAgo) {
                    recentPosts.push(post);
                    allPostsTooOld = false;
                }
            }
            
            if (allPostsTooOld) break;
            
            const linkHeader = statusesResponse.headers.get('Link');
            nextLink = null;
            if (linkHeader) {
                const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
                if (nextMatch) nextLink = nextMatch[1];
            }
            
            maxAttempts--;
        }
        
        // Update account data
        account.created_at = accountData.created_at;
        account.posts_count = accountData.statuses_count;
        account.recent_posts_count = recentPosts.length;
        account.is_bot = accountData.bot;
        
        // Mark as loaded and update counter
        account.loading = false;
        loadedCount++;
        updateLoadingProgress(loadedCount, allAccounts.length);
        
        // Re-render table
        renderAccounts(allAccounts);
        
        // Check if all accounts are loaded and update export button
        updateExportButton();
        
    } catch (error) {
        console.error(`Error loading data for ${account.name}:`, error);
        account.loading = false;
        account.error = error.message;
        loadedCount++;
        updateLoadingProgress(loadedCount, allAccounts.length);
        renderAccounts(allAccounts);
        
        // Check if all accounts are loaded and update export button
        updateExportButton();
    }
}

// Function to update loading progress
function updateLoadingProgress(loaded, total) {
    const progress = (loaded / total) * 100;
    document.getElementById('loadingBar').style.width = `${progress}%`;
    document.getElementById('loadingCounter').textContent = `${loaded}/${total} geladen`;
}

// Function to format date
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('de-DE');
}

// Function to format number
function formatNumber(num) {
    if (num === null || num === undefined) return '-';
    return num.toLocaleString('de-DE');
}

// Function to format link
function formatLink(url) {
    try {
        const urlObj = new URL(url);
        const username = urlObj.pathname.split('/').pop();
        return `${urlObj.hostname}/${username}`;
    } catch (e) {
        return url;
    }
}

// Function to render accounts in the table
function renderAccounts(accounts) {
    const tbody = document.getElementById('accountsTableBody');
    
    tbody.innerHTML = accounts.map(account => `
        <tr>
            <td class="name-col">${account.name}</td>
            <td class="position-col">${account.position}</td>
            <td class="party-col">${account.party}</td>
            <td class="link-col">
                <a href="${account.link}" target="_blank" title="${account.link}">
                    ${formatLink(account.link)}
                </a>
            </td>
            <td class="date-col">${formatDate(account.created_at)}</td>
            <td class="posts-col text-end">
                ${account.loading ? 
                    '<div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div>' :
                    formatNumber(account.posts_count)}
            </td>
            <td class="posts-col text-end">
                ${account.loading ? 
                    '<div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div>' :
                    account.recent_posts_count !== null ? 
                        `<span class="text-success">${formatNumber(account.recent_posts_count)}</span>` : 
                        '-'}
            </td>
            <td class="bot-col text-center">
                ${account.is_bot === null ? '-' : 
                 account.is_bot ? '<i class="text-secondary">Bot</i>' : ''}
            </td>
        </tr>
    `).join('');
}

// Function to parse markdown content into structured data
function parseMarkdownContent(content) {
    const accounts = [];
    const lines = content.split('\n');
    let currentPosition = '';
    let currentParty = '';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim() || '';
        
        // Skip empty lines
        if (!line) continue;
        
        // Check for section headers (## Position (Party))
        if (line.startsWith('## ')) {
            const match = line.match(/## (.*?)(?:\s*\((.*?)\))?$/);
            if (match) {
                currentPosition = match[1].trim();
                currentParty = match[2]?.trim() || '';
            }
            continue;
        }
        
        // Skip table headers and separators
        if (line.startsWith('| Wer') || line.startsWith('|:--')) continue;
        
        // Parse table rows
        if (line.startsWith('|')) {
            const cells = line.split('|')
                .map(cell => cell.trim())
                .filter(cell => cell); // Remove empty cells from start/end
                
            if (cells.length >= 2) {
                const name = cells[0];
                const link = cells[1];
                
                accounts.push({
                    name,
                    position: currentPosition,
                    party: currentParty,
                    link
                });
            }
        }
    }
    
    return accounts;
}

// Function to filter accounts based on search term
function filterAccounts(searchTerm) {
    if (!searchTerm) {
        renderAccounts(allAccounts);
        return;
    }
    
    searchTerm = searchTerm.toLowerCase();
    const filteredAccounts = allAccounts.filter(account => {
        return account.name.toLowerCase().includes(searchTerm) ||
               account.position.toLowerCase().includes(searchTerm) ||
               account.party.toLowerCase().includes(searchTerm) ||
               account.link.toLowerCase().includes(searchTerm);
    });
    
    renderAccounts(filteredAccounts);
}

// Function to export data
function exportData() {
    // Create data object in the required format
    const exportData = {};
    
    allAccounts.forEach(account => {
        if (account.created_at !== null) { // Only export accounts that have been scanned
            exportData[account.link] = {
                account: {
                    name: account.name,
                    url: account.link,
                    category: `${account.position}${account.party ? ` (${account.party})` : ''}`
                },
                posts_count: account.posts_count,
                recent_posts_count: account.recent_posts_count,
                created_at: account.created_at,
                is_bot: account.is_bot
            };
        }
    });
    
    // Create JSON file
    const dataStr = JSON.stringify({ data: exportData }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Create download link and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fedipol_data.json';
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Function to check if all accounts are loaded
function areAllAccountsLoaded() {
    return allAccounts.length > 0 && allAccounts.every(account => 
        account.created_at !== null || 
        (account.error && account.error.length > 0)
    );
}

// Function to update export button state
function updateExportButton() {
    const exportButton = document.getElementById('exportButton');
    if (areAllAccountsLoaded()) {
        exportButton.disabled = false;
        exportButton.classList.remove('btn-secondary');
        exportButton.classList.add('btn-primary');
    } else {
        exportButton.disabled = true;
        exportButton.classList.remove('btn-primary');
        exportButton.classList.add('btn-secondary');
    }
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // First load accounts from markdown
        await loadAccountsFromMarkdown();
        
        // Then try to load existing data from JSON
        try {
            const response = await fetch('fedipol_data.json');
            if (response.ok) {
                const data = await response.json();
                const jsonData = data.data || data;
                
                // Enhance existing accounts with data from JSON
                allAccounts = allAccounts.map(account => {
                    const existingData = jsonData[account.link];
                    if (existingData) {
                        return {
                            ...account,
                            posts_count: existingData.posts_count,
                            recent_posts_count: existingData.recent_posts_count,
                            created_at: existingData.created_at,
                            is_bot: existingData.is_bot,
                            loading: false,
                            error: null
                        };
                    }
                    return account;
                });
                
                // Re-render with enhanced data
                renderAccounts(allAccounts);
                updateExportButton();
            }
        } catch (jsonError) {
            console.log('No existing JSON data found or error loading it:', jsonError);
            // Continue without JSON data
        }
        
        // Set up button event listeners
        const scanButton = document.getElementById('scanButton');
        const updateButton = document.getElementById('updateButton');
        const exportButton = document.getElementById('exportButton');
        
        if (scanButton) {
            scanButton.addEventListener('click', startScan);
        }
        
        if (updateButton) {
            updateButton.addEventListener('click', () => {
                loadMastodonData(allAccounts, true);
            });
        }
        
        if (exportButton) {
            exportButton.addEventListener('click', exportData);
        }
        
        // Set up search functionality
        const searchInput = document.getElementById('searchInput');
        const clearButton = document.getElementById('clearSearch');
        
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                filterAccounts(e.target.value);
                if (clearButton) {
                    clearButton.style.display = e.target.value ? 'block' : 'none';
                }
            });
        }
        
        if (clearButton) {
            clearButton.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    filterAccounts('');
                    clearButton.style.display = 'none';
                }
            });
        }
        
    } catch (error) {
        console.error('Error initializing:', error);
        document.getElementById('accountsTableBody').innerHTML = `
            <tr>
                <td colspan="8" class="text-danger">
                    Error loading data: ${error.message}
                </td>
            </tr>
        `;
    }
}); 