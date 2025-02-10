class MastodonApi {
    constructor() {
        this.cache = new Map();
        this.CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
        this.BATCH_SIZE = 10; // Anzahl paralleler Requests
        this.DELAY_MS = 100; // Delay zwischen Requests
        
        // Check if refresh parameter is present
        this.shouldRefresh = new URLSearchParams(window.location.search).has('refresh');
        
        // Get the absolute path to the project directory
        const pathParts = window.location.pathname.split('/');
        pathParts.pop(); // Remove the HTML file name
        this.projectPath = pathParts.join('/');
        
        this.loadCache();
    }

    async loadCache() {
        // Don't load cache if refresh is requested
        if (this.shouldRefresh) {
            return;
        }

        // Load from fedipol_data.json
        try {
            const response = await fetch('fedipol_data.json');
            if (response.ok) {
                const jsonData = await response.json();
                
                // Check if data is nested under 'data' property or directly in root
                const rawCacheData = jsonData.data || jsonData;
                
                // Normalize URLs and validate data structure
                const normalizedCacheData = {};
                let validEntries = 0;
                let invalidEntries = 0;
                
                Object.entries(rawCacheData).forEach(([url, data]) => {
                    const normalizedUrl = url.toLowerCase().replace(/\/+$/, '');
                    
                    // Validate required fields
                    if (data && 
                        typeof data === 'object' &&
                        'posts_count' in data && 
                        'recent_posts_count' in data && 
                        'is_bot' in data) {
                        normalizedCacheData[normalizedUrl] = data;
                        validEntries++;
                    } else {
                        invalidEntries++;
                    }
                });

                this.cache = new Map(Object.entries(normalizedCacheData));
            }
        } catch (error) {
            // Silent fail
        }
    }

    exportCache() {
        const cacheData = Object.fromEntries(this.cache);
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
    }

    async getAccountStats(accountUrl) {
        // Normalize URL (remove trailing slashes and normalize case)
        const normalizedUrl = accountUrl.toLowerCase().replace(/\/+$/, '');
        
        // In refresh mode, skip cache and fetch from API
        if (this.shouldRefresh) {
            return this.fetchFromAPI(normalizedUrl);
        } else {
            if (this.cache.has(normalizedUrl)) {
                const cachedData = this.cache.get(normalizedUrl);
                // Validate cache data structure
                if (cachedData && 
                    'posts_count' in cachedData && 
                    'recent_posts_count' in cachedData && 
                    'is_bot' in cachedData) {
                    return cachedData;
                }
            }
        }
        
        // If we get here, we need to fetch from API
        return this.fetchFromAPI(normalizedUrl);
    }

    async fetchFromAPI(normalizedUrl) {
        try {
            // Extract instance and username from URL
            const url = new URL(normalizedUrl);
            const pathParts = url.pathname.split('/').filter(Boolean);
            const username = pathParts[pathParts.length - 1].replace('@', '');
            const instance = url.hostname;

            // First get the account ID
            const lookupUrl = `https://${instance}/api/v1/accounts/lookup?acct=${username}`;

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

            // Only update in-memory cache, don't save to file
            this.cache.set(normalizedUrl, stats);

            return stats;
        } catch (error) {
            return { 
                posts_count: null, 
                recent_posts_count: null,
                is_bot: false,
                error: error.message 
            };
        }
    }

    // Process accounts in batches
    async processBatch(accounts, startIndex) {
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