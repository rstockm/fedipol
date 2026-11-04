const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadUI(relativePath = '../js/ui.js') {
    const context = vm.createContext({ document: { addEventListener() {} } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'), context);
    return context;
}

const sources = ['../js/ui.js', '../service-app/dashboard/js/ui.js']
    .filter(source => fs.existsSync(path.join(__dirname, source)));
for (const source of sources) {
    test(`${source}: formats account creation date in German, independent of local timezone`, () => {
        const ui = loadUI(source);
        assert.equal(ui.formatAccountStartDate('2026-11-02T00:00:00.000Z'), '02.11.2026');
        for (const value of [null, undefined, '', 'invalid']) {
            assert.equal(ui.formatAccountStartDate(value), '–');
        }
    });

    test(`${source}: sorts chronologically in both directions, unknown dates last`, () => {
        const ui = loadUI(source);
        const accounts = [
            { created_at: null },
            { created_at: '2026-01-01T00:00:00Z' },
            { created_at: '2025-12-31T00:00:00Z' },
            { created_at: 'invalid' },
        ];
        for (const direction of ['asc', 'desc']) {
            vm.runInContext(`currentSortField = 'created_at'; currentSortDirection = '${direction}';`, ui);
            const sorted = [...accounts].sort(ui.compareAccountData);
            assert.equal(sorted[0].created_at, direction === 'asc' ? accounts[2].created_at : accounts[1].created_at);
            assert.deepEqual(sorted.slice(2), [accounts[0], accounts[3]]);
        }
    });

    test(`${source}: keeps post sorting descending`, () => {
        const ui = loadUI(source);
        assert.ok(ui.compareAccountData({ recent_posts_count: 2 }, { recent_posts_count: 10 }) > 0);
    });

    test(`${source}: toggles date direction and resets when switching back from posts`, () => {
        const ui = loadUI(source);
        const attributes = {};
        const button = { classList: { toggle() {} }, textContent: '' };
        const header = {
            setAttribute(name, value) { attributes[name] = value; },
            querySelector() { return button; },
        };
        ui.document.querySelectorAll = () => [header];
        ui.document.querySelector = () => ({ closest: () => ({ querySelector: () => ({}) }) });
        ui.document.getElementById = () => null;
        ui.toggleSort('created_at');
        assert.equal(attributes['aria-sort'], 'descending');
        assert.equal(button.textContent, 'Startdatum ↓');
        ui.toggleSort('created_at');
        assert.equal(attributes['aria-sort'], 'ascending');
        ui.toggleSort('posts_count');
        assert.equal(attributes['aria-sort'], 'none');
        ui.toggleSort('created_at');
        assert.equal(attributes['aria-sort'], 'descending');
    });

    test(`${source}: renders creation date between party and posts`, () => {
        const ui = loadUI(source);
        const html = ui.renderAccountRow({
            name: 'Stella Merendino', category: 'Mitglied des Deutschen Bundestages (Linke)',
            url: 'https://mastodon.social/@socialist_stella', created_at: '2026-11-02T00:00:00Z',
            posts_count: 5, recent_posts_count: 5,
        });
        assert.match(html, /02\.11\.2026/);
        assert.ok(html.indexOf('<td>Linke</td>') < html.indexOf('02.11.2026'));
        assert.ok(html.indexOf('02.11.2026') < html.indexOf('posts-bar-container'));
    });
}
