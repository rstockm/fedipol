const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

for (const base of ['..', '../service-app/dashboard']) {
    if (!fs.existsSync(path.join(__dirname, base))) continue;
    test(`${base}: dashboard and info expose bookmark and home-screen icons`, () => {
        for (const page of ['index.html', 'info.html']) {
            const html = fs.readFileSync(path.join(__dirname, base, page), 'utf8');
            assert.ok(html.includes('rel="icon" type="image/svg+xml"'));
            assert.ok(html.includes('rel="apple-touch-icon" sizes="180x180"'));
            assert.ok(html.includes('rel="manifest" href="site.webmanifest"'));
            for (const match of html.matchAll(/href="(icons\/[^"]+)"/g)) {
                assert.ok(fs.existsSync(path.join(__dirname, base, match[1])));
            }
        }
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, base, 'site.webmanifest'), 'utf8'));
        assert.equal(manifest.name, 'Fedipol');
        assert.equal(manifest.start_url, './');
        assert.equal(manifest.scope, './');
        assert.equal(manifest.display, 'standalone');
        assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
        for (const icon of manifest.icons) {
            assert.equal(icon.type, 'image/png');
            checkPng(base, icon.src, Number(icon.sizes.split('x')[0]));
        }
        checkPng(base, 'icons/apple-touch-icon.png', 180);
        checkPng(base, 'icons/favicon-32.png', 32);
    });
}

function checkPng(base, file, size) {
    const data = fs.readFileSync(path.join(__dirname, base, file));
    assert.equal(data.subarray(1, 4).toString(), 'PNG');
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
    const mirror = path.join(__dirname, '../service-app/dashboard', file);
    if (fs.existsSync(mirror)) assert.deepEqual(data, fs.readFileSync(mirror));
}
