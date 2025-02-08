class MastodonApi {
    constructor() {
        this.cache = new Map();
        this.CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
        this.BATCH_SIZE = 10; // Anzahl paralleler Requests
        this.DELAY_MS = 100; // Delay zwischen Requests
        
        // Check if refresh parameter is present
        this.shouldRefresh = new URLSearchParams(window.location.search).has('refresh');
        
        this.loadCache();
    }

    async loadCache() {
        // Try to load from local file first, unless refresh is requested
        if (!this.shouldRefresh) {
            try {
                console.log('Versuche fedipol_data.json zu laden...');
                const response = await fetch('fedipol_data.json');
                if (response.ok) {
                    const { data } = await response.json();
                    
                    // Validate cache entries have required fields
                    const validEntries = Object.entries(data).filter(([_, value]) => 
                        value && 
                        'posts_count' in value && 
                        'is_bot' in value && 
                        'recent_posts_count' in value &&
                        'created_at' in value);
                    
                    this.cache = new Map(validEntries);
                    console.log('✅ Daten erfolgreich aus fedipol_data.json geladen:', {
                        entries: this.cache.size,
                        firstKey: Array.from(this.cache.keys())[0]
                    });
                    return;
                } else {
                    console.log('❌ fedipol_data.json konnte nicht geladen werden:', response.status, response.statusText);
                }
            } catch (error) {
                console.log('❌ Fehler beim Laden von fedipol_data.json:', error);
            }
        }

        // Fall back to localStorage if file not found or refresh requested
        console.log('Versuche localStorage zu laden...');
        const cached = localStorage.getItem('mastodon_stats_cache');
        if (cached && !this.shouldRefresh) {
            try {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < this.CACHE_DURATION) {
                    const validEntries = Object.entries(data).filter(([_, value]) => 
                        value && 
                        'posts_count' in value && 
                        'is_bot' in value && 
                        'recent_posts_count' in value &&
                        'created_at' in value);
                    this.cache = new Map(validEntries);
                    console.log('Cache loaded from localStorage with', this.cache.size, 'entries');
                } else {
                    console.log('Cache expired, will fetch fresh data');
                    localStorage.removeItem('mastodon_stats_cache');
                }
            } catch (error) {
                console.error('Cache error:', error);
                localStorage.removeItem('mastodon_stats_cache');
            }
        }
    }

    exportCache() {
        const cacheData = Object.fromEntries(this.cache);
        const dataStr = JSON.stringify({data: cacheData, timestamp: Date.now()}, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'fedipol_data.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    saveCache() {
        const cacheData = Object.fromEntries(this.cache);
        localStorage.setItem('mastodon_stats_cache', JSON.stringify({
            data: cacheData,
            timestamp: Date.now()
        }));
    }

    async getAccountStats(accountUrl) {
        // Check cache first if not in refresh mode
        if (!this.shouldRefresh && this.cache.has(accountUrl)) {
            const cachedData = this.cache.get(accountUrl);
            if ('is_bot' in cachedData && 'recent_posts_count' in cachedData) {
                console.log(`Data found for ${accountUrl}`, cachedData);
                return cachedData;
            }
        }
        
        // If refresh mode is active, fetch from API
        if (this.shouldRefresh) {
            try {
                // Extract instance and username from URL
                const url = new URL(accountUrl);
                const pathParts = url.pathname.split('/').filter(Boolean);
                const username = pathParts[pathParts.length - 1].replace('@', '');
                const instance = url.hostname;

                // First get the account ID
                const lookupUrl = `https://${instance}/api/v1/accounts/lookup?acct=${username}`;
                console.log(`Looking up account at ${lookupUrl}`);

                const lookupResponse = await fetch(lookupUrl);
                if (!lookupResponse.ok) {
                    throw new Error(`HTTP error! status: ${lookupResponse.status}`);
                }
                
                const accountData = await lookupResponse.json();
                
                // Now get recent posts
                const sixtyDaysAgo = new Date();
                sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
                
                let recentPosts = [];
                let maxAttempts = 5; // Limit the number of pages to fetch
                let nextLink = `https://${instance}/api/v1/accounts/${accountData.id}/statuses?limit=40`;
                
                // Fetch posts until we either have all posts from the last 60 days or hit the limit
                while (maxAttempts > 0 && nextLink) {
                    console.log(`Fetching posts from ${nextLink}`);
                    
                    const statusesResponse = await fetch(nextLink);
                    if (!statusesResponse.ok) {
                        throw new Error(`HTTP error! status: ${statusesResponse.status}`);
                    }
                    
                    const posts = await statusesResponse.json();
                    if (!posts || posts.length === 0) break;
                    
                    // Check each post's date
                    let allPostsTooOld = true;
                    for (const post of posts) {
                        const postDate = new Date(post.created_at);
                        if (postDate >= sixtyDaysAgo) {
                            recentPosts.push(post);
                            allPostsTooOld = false;
                        } else {
                            // If we find an old post, all subsequent posts will be older
                            allPostsTooOld = true;
                            break;
                        }
                    }
                    
                    // Stop if we found posts older than 60 days
                    if (allPostsTooOld) break;
                    
                    // Get link to next page from headers
                    const linkHeader = statusesResponse.headers.get('Link');
                    nextLink = null;
                    if (linkHeader) {
                        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
                        if (nextMatch) nextLink = nextMatch[1];
                    }
                    
                    maxAttempts--;
                }
                
                const stats = {
                    posts_count: accountData.statuses_count,
                    recent_posts_count: recentPosts.length,
                    is_bot: Boolean(accountData.bot),
                    created_at: accountData.created_at,
                    timestamp: Date.now()
                };

                console.log(`Stats for ${username}:`, stats);

                // Cache the result
                this.cache.set(accountUrl, stats);
                this.saveCache();

                return stats;
            } catch (error) {
                console.error(`Error fetching stats for ${accountUrl}:`, error);
                return { 
                    posts_count: null, 
                    recent_posts_count: null,
                    is_bot: false,
                    error: error.message 
                };
            }
        }
        
        // Return empty stats if not in cache and not in refresh mode
        return { 
            posts_count: null, 
            recent_posts_count: null,
            is_bot: false,
            error: 'Account not found in local data'
        };
    }

    // Process accounts in batches
    async processBatch(accounts, startIndex) {
        console.log(`Processing batch ${startIndex} to ${startIndex + this.BATCH_SIZE}`);
        const batch = accounts.slice(startIndex, startIndex + this.BATCH_SIZE);
        const promises = batch.map(async (account, index) => {
            if (this.shouldRefresh) {
                // Add staggered delay within batch when refreshing
                await new Promise(resolve => setTimeout(resolve, index * this.DELAY_MS));
            }
            return this.getAccountStats(account.url);
        });
        return Promise.all(promises);
    }

    async getAccountsStats(accounts) {
        const results = new Map();
        let maxPosts = 0;

        // Process accounts in batches
        for (let i = 0; i < accounts.length; i += this.BATCH_SIZE) {
            const batchResults = await this.processBatch(accounts, i);
            
            // Add batch results to results map
            accounts.slice(i, i + this.BATCH_SIZE).forEach((account, index) => {
                const stats = batchResults[index];
                if (stats.posts_count !== null && !stats.error) {
                    maxPosts = Math.max(maxPosts, stats.posts_count);
                }
                results.set(account.url, stats);
            });

            // Add delay between batches when refreshing
            if (this.shouldRefresh && i + this.BATCH_SIZE < accounts.length) {
                await new Promise(resolve => setTimeout(resolve, this.DELAY_MS));
            }
        }

        return {
            stats: results,
            maxPosts
        };
    }
} 