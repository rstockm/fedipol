class AccountParser {
    constructor() {
        this.accounts = [];
        this.instances = [];
    }

    async fetchAndParse(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const markdown = await response.text();
            
            if (!markdown || markdown.length === 0) {
                throw new Error('Received empty markdown content');
            }

            this.parseMarkdown(markdown);
            return {
                accounts: this.accounts,
                instances: this.instances
            };
        } catch (error) {
            console.error('Error fetching or parsing markdown:', error);
            throw error;
        }
    }

    parseMarkdown(markdown) {
        this.accounts = [];
        this.instances = [];
        let currentCategory = '';

        const lines = markdown.split('\n');

        for (const line of lines) {
            const trimmedLine = line.trim();

            // Skip empty lines and horizontal rules
            if (!trimmedLine || trimmedLine.match(/^[-*_]{3,}$/)) {
                continue;
            }

            // Update category if line is a header
            if (trimmedLine.startsWith('#')) {
                currentCategory = trimmedLine.replace(/^#+\s*/, '').trim();
                continue;
            }

            // Process table rows
            if (trimmedLine.includes('|')) {
                const cells = trimmedLine
                    .split('|')
                    .map(cell => cell.trim())
                    .filter(cell => cell);

                if (cells.length >= 2) {
                    const name = cells[0];
                    const url = this.extractUrl(cells[1]);
                    
                    if (url && !this.isTableFormatting(name)) {
                        this.accounts.push({
                            name,
                            url,
                            category: currentCategory
                        });
                    }
                }
            }
        }

        this.extractInstancesFromAccounts();
    }

    isTableFormatting(text) {
        return text.includes(':-') || text.includes('-:') || 
               text.toLowerCase() === 'wer' || text.toLowerCase() === 'link';
    }

    extractUrl(cell) {
        const url = cell.replace(/^<|>$/g, '').trim().split(/\s+/)[0];
        return url.startsWith('http') ? url : null;
    }

    extractInstancesFromAccounts() {
        const instanceMap = new Map();
        const remainingAccounts = [];

        for (const account of this.accounts) {
            try {
                const url = new URL(account.url);
                const instanceUrl = `${url.protocol}//${url.hostname}`;
                
                const isUserUrl = url.pathname.includes('@') || 
                                url.pathname.includes('/users/') || 
                                url.pathname.includes('/web/');

                if (!isUserUrl && !instanceMap.has(instanceUrl)) {
                    instanceMap.set(instanceUrl, {
                        name: url.hostname,
                        url: instanceUrl,
                        category: account.category
                    });
                }

                if (isUserUrl) {
                    remainingAccounts.push(account);
                }
            } catch (e) {
                remainingAccounts.push(account);
            }
        }

        this.instances = Array.from(instanceMap.values());
        this.accounts = remainingAccounts;
    }
} 