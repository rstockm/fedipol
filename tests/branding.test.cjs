const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

for (const source of ['../index.html', '../service-app/dashboard/index.html']) {
    if (!fs.existsSync(path.join(__dirname, source))) continue;
    test(`${source}: uses Fedipol title and a decorative institution/statistics icon`, () => {
        const html = fs.readFileSync(path.join(__dirname, source), 'utf8');
        assert.match(html, /<title>Fedipol<\/title>/);
        const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)[1];
        assert.equal(heading.replace(/<[^>]*>/g, '').trim(), 'Fedipol');
        assert.match(heading, /<svg[^>]*class="fedipol-brand-icon"[^>]*aria-hidden="true"[^>]*focusable="false"/);
        assert.ok(heading.indexOf('<svg') < heading.indexOf('Fedipol'));
        assert.doesNotMatch(html, /Fediverse Activity Tracker/);
    });
}
