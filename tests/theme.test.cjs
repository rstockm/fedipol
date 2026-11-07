const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const STORAGE_KEY = 'fedipol:theme-v1';

function theme({ stored = null, blocked = false, systemDark = false, mediaApi = 'modern' } = {}) {
    const saved = new Map(stored ? [[STORAGE_KEY, stored]] : []);
    const media = { matches: systemDark, listeners: [] };
    media.addEventListener = (type, callback) => {
        if (type === 'change') media.listeners.push(callback);
    };
    media.addListener = callback => media.listeners.push(callback);
    if (mediaApi === 'legacy') delete media.addEventListener;
    media.dispatch = () => media.listeners.forEach(callback => callback());
    const buttons = [
        {
            dataset: {},
            attributes: new Map(),
            setAttribute(name, value) { this.attributes.set(name, value); },
            getAttribute(name) { return this.attributes.get(name); },
            querySelector() { return { className: '' }; },
            addEventListener(type, callback) { if (type === 'click') buttons.handler = callback; },
        },
    ];
    const html = { dataset: {} };
    let domReady = null;
    const events = {};
    const context = vm.createContext({
        localStorage: {
            getItem: key => { if (blocked) throw Error('blocked'); return saved.get(key); },
            setItem: (key, value) => { if (blocked) throw Error('blocked'); saved.set(key, value); },
        },
        document: {
            documentElement: html,
            readyState: 'loading',
            addEventListener(type, callback) { if (type === 'DOMContentLoaded') domReady = callback; },
            querySelectorAll: () => buttons,
        },
        window: {
            matchMedia: mediaApi === 'missing' ? undefined : () => media,
            addEventListener(type, callback) { events[type] = callback; },
        },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/theme.js'), 'utf8'), context);
    return { api: context.window.FedipolTheme, saved, media, html, buttons, domReady, events };
}

test('theme stays in sync across tabs and back/forward cache restores', () => {
    const state = theme();
    state.domReady();
    state.saved.set(STORAGE_KEY, 'dark');
    state.events.storage({ key: 'unrelated' });
    assert.equal(state.api.currentMode(), 'auto');
    state.events.storage({ key: STORAGE_KEY });
    assert.equal(state.html.dataset.bsTheme, 'dark');
    state.saved.set(STORAGE_KEY, 'light');
    state.events.pageshow({ persisted: true });
    assert.equal(state.html.dataset.bsTheme, 'light');
    state.saved.clear();
    state.events.storage({ key: null });
    assert.equal(state.api.currentMode(), 'auto');
    const blocked = theme({ blocked: true });
    blocked.api.setMode('dark');
    blocked.events.pageshow({ persisted: true });
    assert.equal(blocked.api.currentMode(), 'dark');
});

test('missing and legacy matchMedia APIs degrade gracefully', () => {
    const missing = theme({ mediaApi: 'missing' });
    missing.domReady();
    assert.equal(missing.html.dataset.bsTheme, 'light');
    missing.api.setMode('dark');
    assert.equal(missing.html.dataset.bsTheme, 'dark');
    const legacy = theme({ mediaApi: 'legacy' });
    legacy.domReady();
    legacy.media.matches = true;
    legacy.media.dispatch();
    assert.equal(legacy.html.dataset.bsTheme, 'dark');
});

test('theme follows saved choice over system preference, auto is the fallback', () => {
    assert.equal(theme({ systemDark: false }).api.currentMode(), 'auto');
    assert.equal(theme({ systemDark: false }).html.dataset.bsTheme, 'light');
    assert.equal(theme({ systemDark: true }).html.dataset.bsTheme, 'dark');
    assert.equal(theme({ stored: 'dark', systemDark: false }).api.currentMode(), 'dark');
    assert.equal(theme({ stored: 'dark', systemDark: false }).html.dataset.bsTheme, 'dark');
    assert.equal(theme({ stored: 'light', systemDark: true }).html.dataset.bsTheme, 'light');
    assert.equal(theme({ stored: 'bad' }).api.currentMode(), 'auto');
    assert.equal(theme({ blocked: true, systemDark: true }).api.currentMode(), 'auto');
    assert.equal(theme({ blocked: true, systemDark: true }).html.dataset.bsTheme, 'dark');
});

test('auto mode tracks system changes without dropping the mode', () => {
    const state = theme({ systemDark: false });
    const { api, html, media } = state;
    state.domReady();
    media.matches = true;
    media.dispatch();
    assert.equal(html.dataset.bsTheme, 'dark');
    media.matches = false;
    media.dispatch();
    assert.equal(html.dataset.bsTheme, 'light');
    api.setMode('light');
    media.matches = true;
    media.dispatch();
    assert.equal(html.dataset.bsTheme, 'light');
    api.setMode('auto');
    media.dispatch();
    assert.equal(html.dataset.bsTheme, 'dark'); // auto resolves again
    media.matches = false;
    media.dispatch();
    assert.equal(html.dataset.bsTheme, 'light');
});

test('switch cycles auto, light, dark and persists each choice', () => {
    const state = theme({ systemDark: false });
    const { api, saved, buttons } = state;
    state.domReady();
    const cycle = ['light', 'dark', 'auto'];
    for (const expected of cycle) {
        buttons.handler();
        assert.equal(api.currentMode(), expected);
        assert.equal(saved.get(STORAGE_KEY), expected);
    }
    assert.match(buttons[0].attributes.get('title'), /Farbschema/);
    api.setMode('bogus');
    assert.equal(api.currentMode(), 'auto');
    assert.doesNotThrow(() => theme({ blocked: true }).api.setMode('dark'));
});

test('both pages load the theme early and offer a matching switch', () => {
    for (const file of ['index.html', 'info.html']) {
        const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(html, /js\/theme\.js/);
        assert.match(html, /data-theme-switch/);
        assert.match(html, /Farbschema: automatisch/);
        assert.ok(html.indexOf('js/theme.js') < html.indexOf('</head>'));
        assert.ok(html.indexOf('data-theme-switch') < html.indexOf('data-language-switch'));
    }
});

test('service-app worktree mirrors the theme files when present', { skip: !fs.existsSync(path.join(__dirname, '../service-app/dashboard')) }, () => {
    for (const file of ['index.html', 'info.html']) {
        assert.equal(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
            fs.readFileSync(path.join(__dirname, '../service-app/dashboard', file), 'utf8'));
    }
    for (const file of ['css/styles.css', 'js/theme.js', 'js/ui.js', 'js/en.js', 'js/i18n.js']) {
        assert.equal(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
            fs.readFileSync(path.join(__dirname, '../service-app/dashboard', file), 'utf8'));
    }
});

test('dark charts and header controls use contrast-aware colors', () => {
    const css = fs.readFileSync(path.join(__dirname, '../css/styles.css'), 'utf8');
    const ui = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
    assert.match(ui, /'CDU': 'rgba\(var\(--party-union-rgb\)/);
    assert.match(ui, /'CSU': 'rgba\(var\(--party-union-rgb\)/);
    assert.match(css, /--party-union-rgb: 173, 181, 189/);
    assert.match(css, /--bs-btn-color: var\(--app-primary\)/);
    assert.match(css, /\.sticky-header \.header-row \{ flex-wrap: wrap !important;/);
});

test('English catalog verifies the theme labels', () => {
    const context = vm.createContext({ window: {} });
    for (const file of ['de.js', 'en.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file), 'utf8'), context);
    }
    const { en, de } = context.window.FedipolMessages;
    assert.equal(en['Farbschema: automatisch (hell/dunkel)'], 'Color scheme: automatic (light/dark)');
    assert.equal(en['Farbschema: hell'], 'Color scheme: light');
    assert.equal(en['Farbschema: dunkel'], 'Color scheme: dark');
    // The mirror keeps both catalogs synchronized (identity fallback in DE).
    assert.equal(de['Farbschema: hell'], 'Farbschema: hell');
});

test('styles and histogram render dark mode via variables instead of hardcoded colors', () => {
    const css = fs.readFileSync(path.join(__dirname, '../css/styles.css'), 'utf8');
    assert.match(css, /\[data-bs-theme="dark"\]/);
    assert.doesNotMatch(css, /background-color: white;|background: #fff;/);
    const ui = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
    assert.match(ui, /class="chart-grid"/);
    assert.doesNotMatch(ui, /stroke="#[0-9a-fA-F]{3,8}"/);
    for (const file of ['index.html', 'info.html']) {
        const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.ok(!html.includes('bg-white'));
        assert.doesNotMatch(html, /background-color: white;|background-color: #f8f9fa/);
    }
});
