class Settings {
    constructor() {
        this.settings = null;
    }

    async load() {
        try {
            const response = await fetch('settings.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.settings = await response.json();
            console.log('Settings loaded:', this.settings);
            return this.settings;
        } catch (error) {
            console.error('Error loading settings:', error);
            throw error;
        }
    }

    getAccountListUrl() {
        return this.settings?.accountListUrl;
    }
} 