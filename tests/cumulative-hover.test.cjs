const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sources = ['../js/ui.js', '../service-app/dashboard/js/ui.js']
    .filter(source => fs.existsSync(path.join(__dirname, source)));

function renderTitles(source, filter = null) {
    const container = { innerHTML: '' };
    class FixedDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : ['2026-03-15T12:00:00Z']));
        }
    }
    const context = vm.createContext({
        Date: FixedDate,
        document: { addEventListener() {}, querySelector() { return container; } },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, source), 'utf8'), context);
    const accounts = [
        ['SPD', '2026-01-15'], ['SPD', '2026-02-10'],
        ['SPD', '2026-02-20'], ['Linke', '2026-02-15'],
    ];
    vm.runInContext(`
        ${JSON.stringify(accounts)}.forEach(([party, date], index) => {
            loadedAccounts.set(String(index), {
                account: { name: 'Test', category: '(' + party + ')', url: 'https://example.org/@' + index },
                created_at: date + 'T12:00:00Z'
            });
        });
        activePartyFilter = ${JSON.stringify(filter)};
        renderCumulativeHistogram();
    `, context);
    return [...container.innerHTML.matchAll(/<title>([\s\S]*?)<\/title>/g)].map(match => match[1]);
}

for (const source of sources) {
    test(`${source}: hover includes party and overall change from previous month`, () => {
        const titles = renderTitles(source);
        assert.match(titles[1], /SPD: 3 \(gesamt 4\)/);
        assert.match(titles[1], /Zum Vormonat: \+2 \(SPD\), \+3 gesamt/);
        assert.match(titles[2], /Zum Vormonat: \+1 \(Linke\), \+3 gesamt/);
    });

    test(`${source}: first month compares against zero, unchanged months show +0`, () => {
        const titles = renderTitles(source);
        assert.match(titles[0], /Zum Vormonat: \+1 \(SPD\), \+1 gesamt/);
        assert.match(titles[3], /Zum Vormonat: \+0 \(SPD\), \+0 gesamt/);
    });

    test(`${source}: previous-month change respects the active party filter`, () => {
        const titles = renderTitles(source, 'SPD');
        assert.match(titles[1], /SPD: 3 \(gesamt 3\)/);
        assert.match(titles[1], /Zum Vormonat: \+2 \(SPD\), \+2 gesamt/);
        assert.equal(titles.length, 3);
    });
}
