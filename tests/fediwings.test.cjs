const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sources = ['../js/ui.js', '../service-app/dashboard/js/ui.js']
    .filter(source => fs.existsSync(path.join(__dirname, source)));

for (const source of sources) {
    function loadUI() {
        const ui = vm.createContext({ URL, document: { addEventListener() {} } });
        vm.runInContext(fs.readFileSync(path.join(__dirname, source), 'utf8'), ui);
        return ui;
    }

    test(`${source}: creates fixed-origin FediWings links with encoded handles`, () => {
        const ui = loadUI();
        for (const profile of ['https://mastodon.social/@Alice', 'https://mastodon.social/users/Alice']) {
            assert.equal(ui.getFediWingsUrl(profile), 'https://rstockm.github.io/fediwings/?handle=Alice%40mastodon.social&autostart=1');
        }
        assert.equal(ui.getFediWingsUrl('https://bawü.social/@lfdi'), 'https://rstockm.github.io/fediwings/?handle=lfdi%40xn--baw-joa.social&autostart=1');
        for (const profile of [
            'javascript:alert(1)', 'http://mastodon.social/@alice',
            'https://evil@mastodon.social/@alice', 'https://mastodon.social:8443/@alice',
            'https://mastodon.social/@alice/posts', 'https://mastodon.social/@alice?x=1',
            'https://mastodon.social/@%22%3E%3Cscript%3E', 'not a URL',
        ]) assert.equal(ui.getFediWingsUrl(profile), null);
    });

    test(`${source}: renders safe analysis actions for people and institutions`, () => {
        const ui = loadUI();
        const account = { name: 'Alice', category: 'Mitglied des Deutschen Bundestages (Linke)',
            url: 'https://mastodon.social/@alice', recent_posts_count: 5, posts_count: 10 };
        const html = ui.renderAccountRow(account);
        assert.match(html, /class="[^"]*fediwings-link/);
        assert.match(html, /href="https:\/\/rstockm.github.io\/fediwings\/\?handle=alice%40mastodon.social&amp;autostart=1"/);
        assert.match(html, /target="_blank" rel="noopener noreferrer"/);
        assert.match(html, /<td class="account-actions-cell">/);
        assert.match(html, /class="account-actions"/);
        assert.match(html, /action-label-desktop">Analyse</);
        assert.match(html, /action-label-mobile">In FediWings analysieren</);
        assert.ok(html.indexOf('account-actions-cell') > html.indexOf('posts-bar-container'));
        const identity = html.match(/<td class="account-identity">([\s\S]*?)<\/td>/);
        assert.ok(identity);
        assert.doesNotMatch(identity[1], /fediwings-link/);
        assert.match(ui.renderAccountRow({ ...account, category: 'Bundesbehörde' }), /fediwings-link/);
        assert.doesNotMatch(ui.renderAccountRow({ ...account, url: 'not a URL' }), /fediwings-link/);
    });

    test(`${source}: sorting targets the posts header, not the trailing actions header`, () => {
        const ui = loadUI();
        const selectors = [];
        ui.document.querySelectorAll = () => [];
        ui.document.querySelector = () => ({ closest: () => ({ querySelector: selector => {
            selectors.push(selector);
            return { innerHTML: '' };
        } }) });
        ui.document.getElementById = () => null;
        ui.toggleSort('posts_count');
        assert.equal(selectors.length, 2);
        assert.ok(selectors.every(selector => selector === 'thead .posts-header'));
    });
}
