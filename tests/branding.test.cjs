const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

for (const source of ['../index.html', '../service-app/dashboard/index.html']) {
    if (!fs.existsSync(path.join(__dirname, source))) continue;
    test(`${source}: keeps Fedipol branding and introduces a compact, localised hero`, () => {
        const html = fs.readFileSync(path.join(__dirname, source), 'utf8');
        assert.match(html, /<title>Fedipol<\/title>/);
        const brand = html.match(/<div class="h3 mb-0 fedipol-brand">([\s\S]*?)<\/div>/)[1];
        assert.equal(brand.replace(/<[^>]*>/g, '').trim(), 'Fedipol');
        assert.match(brand, /<svg[^>]*class="fedipol-brand-icon"[^>]*aria-hidden="true"[^>]*focusable="false"/);
        assert.ok(brand.indexOf('<svg') < brand.indexOf('Fedipol'));
        assert.equal((html.match(/<h1\b/g) || []).length, 1);
        const hero = html.match(/<section class="dashboard-hero"[\s\S]*?<\/section>/)[0];
        assert.match(hero, /aria-labelledby="hero-heading"/);
        assert.match(hero, /<h1 id="hero-heading"/);
        for (const key of ['eyebrow', 'title', 'description']) {
            assert.ok(hero.includes(`data-i18n="hero.${key}"`));
        }
        assert.match(hero, /<span class="hero-accent">Fediverse\.<\/span>/);
        assert.doesNotMatch(hero, /hero\.accent|Auf einen Blick\./);
        assert.ok(html.indexOf(hero) < html.indexOf('id="settingsStatus"'));
        assert.match(html, /href="css\/hero.css"/);
        assert.doesNotMatch(html, /Fediverse Activity Tracker/);
    });
}

test('hero styles and local font assets match in both dashboard copies', () => {
    const css = fs.readFileSync(path.join(__dirname, '../css/hero.css'), 'utf8');
    assert.match(css, /font-family: 'Inter Tight'/);
    assert.match(css, /\[data-bs-theme="dark"\]/);
    assert.match(css, /clamp\(/);
    assert.match(css, /\.hero-heading > span \{ display: inline; \}/);
    assert.match(css, /prefers-reduced-motion/);
    for (const file of ['hero.css', 'fonts/inter-tight-latin.woff2', 'fonts/OFL.txt']) {
        const asset = fs.readFileSync(path.join(__dirname, '../css', file));
        const mirror = path.join(__dirname, '../service-app/dashboard/css', file);
        if (fs.existsSync(mirror)) assert.deepEqual(asset, fs.readFileSync(mirror));
    }
});

test('both catalogs translate every hero text and retain the Germany scope', () => {
    for (const base of ['..', '../service-app/dashboard']) {
        if (!fs.existsSync(path.join(__dirname, base))) continue;
        const context = vm.createContext({ window: {} });
        for (const file of ['de.js', 'en.js']) {
            vm.runInContext(fs.readFileSync(path.join(__dirname, base, 'js', file), 'utf8'), context);
        }
        const { de, en } = context.window.FedipolMessages;
        for (const key of ['eyebrow', 'title', 'description']) {
            assert.ok(de[`hero.${key}`]);
            assert.ok(en[`hero.${key}`]);
            assert.notEqual(de[`hero.${key}`], en[`hero.${key}`]);
        }
        assert.match(de['hero.description'], /Deutschlands/);
        assert.match(en['hero.description'], /German politics/);
    }
});

test('both headers use a bold wordmark and a shared alignment system', () => {
    for (const base of ['..', '../service-app/dashboard']) {
        if (!fs.existsSync(path.join(__dirname, base))) continue;
        const html = fs.readFileSync(path.join(__dirname, base, 'index.html'), 'utf8');
        const css = fs.readFileSync(path.join(__dirname, base, 'css/styles.css'), 'utf8');
        assert.match(html, /align-items-center header-row/);
        assert.match(css, /--brand-weight: 750/);
        assert.match(css, /font-weight: var\(--brand-weight\)/);
        assert.ok(css.includes('--brand-icon-size: 1em;'), 'icon scales with wordmark, not an oversized fixed box');
        assert.ok(css.includes('--brand-wordmark-lift: 0.02em;'), 'letter bodies align to controls without compensating for the p descender');
        assert.ok(css.includes('translateY(calc(-1.5625% + var(--brand-icon-lift)))'));
        assert.match(css, /\.header-controls :is\(\.btn, \.language-switch\)/);
        assert.match(css, /height: var\(--header-control-size\)/);
        assert.match(css, /\.sticky-header \.header-row \{ flex-wrap: wrap !important;/);
    }
});
