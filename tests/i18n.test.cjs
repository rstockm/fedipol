const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function language({ stored, browser = 'de-DE', blocked = false } = {}) {
    const saved = new Map(stored ? [['fedipol:locale-v1', stored]] : []);
    const context = vm.createContext({
        navigator: { language: browser },
        localStorage: {
            getItem: key => { if (blocked) throw Error('blocked'); return saved.get(key); },
            setItem: (key, value) => { if (blocked) throw Error('blocked'); saved.set(key, value); },
        },
        document: { documentElement: { lang: 'de' }, addEventListener() {}, readyState: 'loading' },
        window: {},
    });
    for (const file of ['de.js', 'en.js', 'i18n.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file), 'utf8'), context);
    }
    return { api: context.window.FedipolI18n, saved, context };
}

test('locale selection matches FediWings: saved choice, browser hint, German fallback', () => {
    assert.equal(language({ stored: 'de', browser: 'en-GB' }).api.currentLocale(), 'de');
    assert.equal(language({ browser: 'en-GB' }).api.currentLocale(), 'en');
    assert.equal(language({ browser: 'fr-FR' }).api.currentLocale(), 'de');
    assert.equal(language({ stored: 'bad', browser: 'en-US' }).api.currentLocale(), 'en');
    assert.equal(language({ blocked: true, browser: 'en-US' }).api.currentLocale(), 'en');
});

test('switch persists, updates document language and safely interpolates values', () => {
    const { api, saved, context } = language();
    api.setLocale('en');
    assert.equal(saved.get('fedipol:locale-v1'), 'en');
    assert.equal(context.document.documentElement.lang, 'en');
    assert.equal(api.msg('Folgen'), 'Follow');
    assert.equal(api.translate('Du folgst jetzt bob@example.org.'), 'You are now following bob@example.org.');
    assert.equal(api.translate('Gefundene Accounts: 42, davon 10 aktiv (23.8%)'), 'Accounts found: 42, of which 10 active (23.8%)');
    assert.equal(api.translate('SESSION_EXPIRED'), 'SESSION_EXPIRED');
    assert.equal(api.translate('Stefka Wiese'), 'Stefka Wiese');
    api.setLocale('invalid');
    assert.equal(api.currentLocale(), 'en');
    api.setLocale('de');
    assert.equal(api.msg('Folgen'), 'Folgen');
});

test('translation catalogs cover identical keys and placeholders', () => {
    const { context } = language();
    const { de, en } = context.window.FedipolMessages;
    assert.deepEqual(Object.keys(en).sort(), Object.keys(de).sort());
    for (const key of Object.keys(de)) {
        assert.deepEqual((en[key].match(/\{\w+\}/g) || []).sort(), (de[key].match(/\{\w+\}/g) || []).sort(), key);
    }
});

test('both pages load shared catalogs and offer a language switch; dashboard copies match', () => {
    for (const file of ['index.html', 'info.html']) {
        const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(html, /data-language-switch/);
        for (const script of ['de.js', 'en.js', 'i18n.js']) assert.ok(html.includes(`js/${script}`));
        assert.equal(html, fs.readFileSync(path.join(__dirname, '../service-app/dashboard', file), 'utf8'));
    }
    assert.match(fs.readFileSync(path.join(__dirname, '../info.html'), 'utf8'), /ausschließlich.*deutsche/);
    assert.match(language().context.window.FedipolMessages.en['scope.text'], /exclusively.*German/);
    for (const file of ['de.js', 'en.js', 'i18n.js', 'ui.js']) {
        assert.equal(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'),
            fs.readFileSync(path.join(__dirname, '../service-app/dashboard/js', file), 'utf8'));
    }
});

test('generated messages translate without altering values, source data or markup', () => {
    const { api } = language({ browser: 'en' });
    const examples = [
        ['Folge ich: bob@remote.social', 'Following: bob@remote.social'],
        ['Der Account bob@remote.social konnte nicht gefunden werden.', 'The account bob@remote.social could not be found.'],
        ['Startdatum ↑', 'Joined ↑'],
        ['Alice (Grüne)\nBeigetreten: 28/06/2019', 'Alice (Grüne) Joined: 28/06/2019'],
        ['Grüne: 3 (gesamt 9) · Jun 2019\nZum Vormonat: +1 (Grüne), +2 gesamt',
            'Grüne: 3 (total 9) · Jun 2019 Compared with previous month: +1 (Grüne), +2 total'],
        ['Fehler beim Laden der Daten: HTTP 503', 'Error loading data: HTTP 503'],
        ['Du folgst jetzt <img src=x>.', 'You are now following <img src=x>.'],
    ];
    for (const [source, expected] of examples) assert.equal(api.translate(source), expected, source);
    assert.equal(api.translate('https://gruene.social/@stefka'), 'https://gruene.social/@stefka');
    assert.equal(api.translate('Bündnis 90/Die Grünen'), 'Bündnis 90/Die Grünen');
    assert.doesNotThrow(() => language({ blocked: true }).api.setLocale('en'));
});

test('join dates use English locale when selected and keep UTC dates stable', () => {
    for (const file of ['../js/ui.js', '../service-app/dashboard/js/ui.js']) {
        const context = vm.createContext({
            window: { FedipolI18n: { currentLocale: () => 'en' } },
            document: { addEventListener() {} }, URL,
        });
        vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
        assert.equal(context.formatAccountStartDate('2019-06-28T00:00:00Z'), '28/06/2019');
        assert.equal(context.formatAccountStartDate(null), '–');
    }
});
