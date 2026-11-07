const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const uiSources = ['../js/ui.js', '../service-app/dashboard/js/ui.js']
    .filter(source => fs.existsSync(path.join(__dirname, source)));

// Läd js/follow.js in einem Browser-ähnlichen Kontext. `window` wird an den
// IIFE-Namespace übergeben; sessionStorage wird simuliert.
function loadFollow() {
    const storage = new Map();
    const windowObj = {
        location: { origin: 'https://fedipol.example', pathname: '/', search: '', hash: '' },
        history: { replaceState() {} },
        addEventListener() {},
        crypto: globalThis.crypto,
        TextEncoder: globalThis.TextEncoder,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        fetch() { throw new Error('fetch not expected'); },
    };
    windowObj.window = windowObj;
    windowObj.self = windowObj;
    const sessionStorage = {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k),
    };
    const context = vm.createContext({ window: windowObj, sessionStorage, URL, console });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/follow.js'), 'utf8'), context);
    return { context, F: context.window.FediPolFollow, sessionStorage };
}

test('follow.js: acctFromProfileUrl extracts acct from profile URLs', () => {
    const { F } = loadFollow();
    assert.equal(F.acctFromProfileUrl('https://mastodon.social/@Alice'), 'Alice@mastodon.social');
    assert.equal(F.acctFromProfileUrl('https://mastodon.social/users/Alice'), 'Alice@mastodon.social');
    assert.equal(F.acctFromProfileUrl('https://bawü.social/@lfdi'), 'lfdi@xn--baw-joa.social');
    for (const bad of [
        'javascript:alert(1)', 'http://mastodon.social/@a', 'https://evil@mastodon.social/@a',
        'https://mastodon.social:8443/@a', 'https://mastodon.social/@a/x', 'not a url',
    ]) {
        assert.equal(F.acctFromProfileUrl(bad), null);
    }
});

test('follow.js: parseOwnHandle validates own handle and derives origin', () => {
    const { F } = loadFollow();
    const check = (input, expectedAcct, expectedOrigin) => {
        const r = F.parseOwnHandle(input);
        assert.ok(r, `expected a result for ${input}`);
        assert.equal(r.acct, expectedAcct);
        assert.equal(r.origin, expectedOrigin);
    };
    check('@alice@mastodon.social', 'alice@mastodon.social', 'https://mastodon.social');
    check('alice@mastodon.social', 'alice@mastodon.social', 'https://mastodon.social');
    assert.equal(F.parseOwnHandle('@alice'), null);
    assert.equal(F.parseOwnHandle('alice@mastodon.social:8443'), null);
    assert.equal(F.parseOwnHandle('http://alice@mastodon.social'), null);
    assert.equal(F.parseOwnHandle(''), null);
    for (const bad of ['a@localhost', 'a@127.0.0.1', 'a@host.local', 'a@mastodon.social/path',
        'a@mastodon.social?x=1', 'a@mastodon.social#x', 'a@mastodon.social\\evil', 'a@bad domain.org']) {
        assert.equal(F.parseOwnHandle(bad), null, bad);
    }
});

// Vollständiger Browser-Lebenszyklus mit gemockten HTTP-Antworten; keine echten
// Tokens, Instanz-Registrierungen oder Follows im Test.
function browser(source, saved = new Map(), search = '') {
    const calls = [];
    const status = { textContent: '', classList: { toggle() {} } };
    function button(url) {
        const classes = new Set();
        return {
            disabled: false, labels: [{ textContent: '' }, { textContent: '' }], title: '',
            getAttribute: key => key === 'data-follow-url' ? url : null,
            setAttribute() {},
            querySelectorAll() { return this.labels; },
            querySelector() { return { className: '' }; },
            classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
        };
    }
    const buttons = [button('https://remote.social/@bob'), button('https://remote.social/@charlie')];
    const location = new URL('https://fedipol.example.org/' + search);
    location.assign = url => { location.assigned = url; };
    const sessionStorage = {
        getItem: key => saved.get(key) ?? null,
        setItem: (key, value) => saved.set(key, value),
        removeItem: key => saved.delete(key),
    };
    const ctx = vm.createContext({
        URL, URLSearchParams, AbortController, AbortSignal, TextEncoder,
        crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout,
        btoa: s => Buffer.from(s, 'binary').toString('base64'),
        sessionStorage,
        document: {
            getElementById: id => id === 'followStatus' ? status : null,
            querySelectorAll: () => buttons,
        },
        fetch: async (url, options) => {
            calls.push({ url, options });
            return ctx.respond(url, options);
        },
        respond: url => {
            const body = url.endsWith('/apps') ? { client_id: 'client', client_secret: 'secret' }
                : url.endsWith('/token') ? { access_token: 'token' }
                : url.endsWith('/verify_credentials') ? { id: 'own', acct: 'alice' }
                // Mastodons accounts/search löst Handles auf, keine Profil-URLs.
                : url.includes('/search?') ? (() => {
                    const acct = new URL(url).searchParams.get('q');
                    return /^[a-z0-9_.-]+@[a-z0-9.-]+$/i.test(acct) ? [{ id: 'remote', acct }] : [];
                })()
                : url.includes('/following?') ? []
                : { id: 'remote', following: true, requested: false };
            return { ok: true, status: 200, json: async () => body };
        },
        window: { location, history: { replaceState: (_, __, url) => { ctx.cleanedUrl = url; } } },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, source), 'utf8'), ctx);
    return { F: ctx.window.FediPolFollow, ctx, calls, status, saved, location, buttons };
}

for (const source of ['../js/follow.js', '../service-app/dashboard/js/follow.js'].filter(file => fs.existsSync(path.join(__dirname, file)))) {
    test(`${source}: PKCE round trip follows pending target, then reuses session for another click`, async () => {
        const first = browser(source);
        await first.F.follow('https://remote.social/@bob');
        await first.F.startLogin('@alice@mastodon.social');
        const auth = new URL(first.location.assigned);
        assert.equal(auth.origin, 'https://mastodon.social');
        assert.equal(auth.searchParams.get('scope'), 'read:accounts write:follows');
        assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
        const handshake = JSON.parse(first.saved.get('fedipol:oauth-handshake-v1'));
        assert.equal(auth.searchParams.get('code_challenge'), require('node:crypto')
            .createHash('sha256').update(handshake.verifier).digest('base64url'));
        const returned = browser(source, first.saved, `?code=code&state=${handshake.state}`);
        await returned.F.init();
        assert.equal(returned.F.isAuthenticated(), true);
        assert.equal(returned.ctx.cleanedUrl, '/');
        assert.equal(first.saved.has('fedipol:oauth-handshake-v1'), false);
        assert.equal(first.saved.has('fedipol:pending-follow-v1'), false);
        assert.equal(returned.calls.length, 5);
        assert.match(returned.calls[2].url, /accounts\/search\?resolve=true/);
        assert.match(returned.calls[3].url, /accounts\/remote\/follow$/);
        assert.equal(returned.calls[3].options.headers.Authorization, 'Bearer token');
        assert.equal(returned.calls[3].options.redirect, 'error');
        await returned.F.follow('https://remote.social/@charlie');
        assert.equal(returned.calls.length, 7); // kein zweiter Login/Token-Austausch
        assert.equal(new URL(returned.calls[5].url).searchParams.get('q'), 'charlie@remote.social');
        assert.equal(returned.buttons[0].labels[0].textContent, 'Folge ich');
        const reload = browser(source, first.saved);
        await reload.F.init();
        assert.equal(reload.calls.length, 1); // nur Status lesen, kein Follow-Replay
        assert.ok(reload.calls[0].url.includes('/following?'));
    });

    test(`${source}: rejected, missing, duplicated or stale OAuth states never execute a pending follow`, async () => {
        for (const kind of ['wrong', 'missing', 'duplicate', 'denied', 'stale']) {
            const first = browser(source);
            await first.F.follow('https://remote.social/@bob');
            await first.F.startLogin('alice@mastodon.social');
            const h = JSON.parse(first.saved.get('fedipol:oauth-handshake-v1'));
            if (kind === 'stale') {
                h.createdAt -= 16 * 60 * 1000;
                first.saved.set('fedipol:oauth-handshake-v1', JSON.stringify(h));
            }
            const query = kind === 'wrong' ? '?code=x&state=wrong'
                : kind === 'missing' ? '?code=x'
                : kind === 'duplicate' ? `?code=x&state=${h.state}&state=extra`
                : kind === 'denied' ? `?error=access_denied&state=${h.state}`
                : `?code=x&state=${h.state}`;
            const next = browser(source, first.saved, query);
            await next.F.init();
            assert.equal(next.calls.length, 0, kind);
            assert.equal(next.F.isAuthenticated(), false, kind);
            assert.equal(first.saved.has('fedipol:pending-follow-v1'), false);
            assert.equal(next.ctx.cleanedUrl, '/');
        }
    });

    test(`${source}: rejects wrong login account and revokes issued token`, async () => {
        const first = browser(source);
        await first.F.follow('https://remote.social/@bob');
        await first.F.startLogin('alice@mastodon.social');
        const h = JSON.parse(first.saved.get('fedipol:oauth-handshake-v1'));
        const next = browser(source, first.saved, `?code=x&state=${h.state}`);
        const respond = next.ctx.respond;
        next.ctx.respond = url => url.endsWith('/verify_credentials')
            ? { ok: true, json: async () => ({ id: 'other', acct: 'eve' }) } : respond(url);
        await next.F.init();
        assert.equal(next.F.isAuthenticated(), false);
        assert.ok(next.calls.some(c => c.url.endsWith('/oauth/revoke')));
        assert.ok(!next.calls.some(c => c.url.endsWith('/follow')));
    });

    test(`${source}: denied callback cannot use an older session to follow`, async () => {
        const first = browser(source);
        await first.F.follow('https://remote.social/@bob');
        await first.F.startLogin('alice@mastodon.social');
        const h = JSON.parse(first.saved.get('fedipol:oauth-handshake-v1'));
        first.saved.set('fedipol:follow-session-v1', JSON.stringify({
            token: 'old', origin: 'https://mastodon.social', clientId: 'c', clientSecret: 's',
        }));
        const next = browser(source, first.saved, `?error=access_denied&state=${h.state}`);
        await next.F.init();
        assert.equal(next.calls.length, 0);
        assert.match(next.status.textContent, /abgebrochen/);
        assert.equal(first.saved.has('fedipol:pending-follow-v1'), false);
    });

    test(`${source}: expired sessions cleared; pending requests and malformed follow replies handled`, async () => {
        const session = { token: 'token', origin: 'https://mastodon.social', clientId: 'c', clientSecret: 's' };
        const saved = new Map([['fedipol:follow-session-v1', JSON.stringify(session)]]);
        const b = browser(source, saved);
        b.ctx.respond = () => ({ ok: false, status: 401 });
        await b.F.follow('https://remote.social/@bob');
        assert.equal(b.F.isAuthenticated(), false);
        assert.equal(saved.get('fedipol:pending-follow-v1'), 'https://remote.social/@bob');
        assert.equal(b.buttons[0].disabled, false);
        saved.set('fedipol:follow-session-v1', JSON.stringify(session));
        const pending = browser(source, saved);
        const respond = pending.ctx.respond;
        pending.ctx.respond = url => url.endsWith('/follow')
            ? { ok: true, json: async () => ({ id: 'remote', following: false, requested: true }) } : respond(url);
        await pending.F.follow('https://remote.social/@bob');
        assert.equal(pending.status.textContent, 'Folgeanfrage gesendet.');
        assert.equal(pending.buttons[0].labels[0].textContent, 'Angefragt');
        assert.equal(pending.buttons[0].disabled, true);
        const reload = browser(source, saved);
        await reload.F.init();
        assert.equal(reload.buttons[0].labels[0].textContent, 'Angefragt');
        pending.ctx.respond = url => url.endsWith('/follow')
            ? { ok: true, json: async () => ({}) } : respond(url);
        await pending.F.follow('https://remote.social/@charlie');
        assert.match(pending.status.textContent, /nicht bestätigt/);
    });

    test(`${source}: loads existing follows across pages and marks buttons without writing`, async () => {
        const saved = new Map([['fedipol:follow-session-v1', JSON.stringify({
            token: 'token', origin: 'https://mastodon.social', clientId: 'c', clientSecret: 's',
            account: { id: 'own', acct: 'alice' },
        })]]);
        const b = browser(source, saved);
        b.ctx.respond = url => ({ ok: true, status: 200,
            headers: { get: () => url.includes('max_id') ? null
                : '<https://mastodon.social/api/v1/accounts/own/following?limit=80&max_id=42>; rel="next"' },
            json: async () => url.includes('max_id')
                ? [{ url: 'https://remote.social/@charlie', acct: 'charlie@remote.social' }]
                : [{ url: 'https://remote.social/@bob', acct: 'bob@remote.social' }],
        });
        await b.F.init();
        assert.equal(b.calls.length, 2);
        for (const button of b.buttons) {
            assert.equal(button.labels[0].textContent, 'Folge ich');
            assert.equal(button.disabled, true);
        }
        await b.F.follow('https://remote.social/@bob');
        assert.equal(b.calls.length, 2); // bereits gefolgt, kein POST
    });

    test(`${source}: returns to saved dashboard view only after data is ready`, async () => {
        const first = browser(source);
        const view = { scrollY: 1900, search: 'bob', party: 'Linke', sortField: 'created_at', sortDirection: 'asc', rowOffset: 150 };
        first.ctx.window.captureFollowView = () => view;
        await first.F.follow('https://remote.social/@bob');
        await first.F.startLogin('alice@mastodon.social');
        const h = JSON.parse(first.saved.get('fedipol:oauth-handshake-v1'));
        assert.equal(h.returnView.scrollY, 1900);
        const next = browser(source, first.saved, `?code=x&state=${h.state}`);
        const restored = [];
        next.ctx.window.restoreFollowView = (snapshot, target) => restored.push({ snapshot, target });
        await next.F.init();
        assert.equal(restored.length, 0);
        next.F.dashboardReady();
        assert.equal(restored.length, 1);
        assert.equal(restored[0].snapshot.search, 'bob');
        assert.equal(restored[0].snapshot.sortDirection, 'asc');
        assert.equal(restored[0].target, 'https://remote.social/@bob');
        next.F.dashboardReady();
        assert.equal(restored.length, 1); // einmalige Wiederherstellung
    });

    test(`${source}: following pagination never sends token to another origin`, async () => {
        const saved = new Map([['fedipol:follow-session-v1', JSON.stringify({
            token: 'token', origin: 'https://mastodon.social', clientId: 'c', clientSecret: 's',
            account: { id: 'own', acct: 'alice' },
        })]]);
        const b = browser(source, saved);
        b.ctx.respond = () => ({ ok: true, headers: {
            get: () => '<https://evil.social/api/v1/accounts/own/following?max_id=42>; rel="next"',
        }, json: async () => [] });
        await b.F.init();
        assert.equal(b.calls.length, 1);
        assert.match(b.status.textContent, /nicht vollständig geprüft/);
        assert.equal(b.buttons[0].disabled, false);
        b.ctx.respond = () => ({ ok: false, status: 401 });
        await b.F.init();
        assert.equal(b.F.isAuthenticated(), false);
        assert.match(b.status.textContent, /abgelaufen/);
    });

    test(`${source}: resolves handles on own instance and follows only exact account matches`, async () => {
        for (const [profile, result, expected] of [
            ['https://remote.social/users/Bob', { id: 'remote', acct: 'bob@remote.social' }, true],
            ['https://mastodon.social/@bob', { id: 'local', acct: 'bob' }, true],
            ['https://remote.social/@bob', { id: 'wrong', acct: 'bob@unrelated.social' }, false],
        ]) {
            const b = browser(source, new Map([['fedipol:follow-session-v1', JSON.stringify({
                token: 'token', origin: 'https://mastodon.social', clientId: 'c', clientSecret: 's',
            })]]));
            b.ctx.respond = url => ({ ok: true, status: 200, json: async () => url.includes('/search?')
                ? [result] : { id: result.id, following: true, requested: false } });
            await b.F.follow(profile);
            assert.equal(new URL(b.calls[0].url).searchParams.get('q'), profile.includes('remote.social')
                ? (profile.includes('Bob') ? 'Bob' : 'bob') + '@remote.social' : 'bob@mastodon.social');
            assert.equal(b.calls.length, expected ? 2 : 1);
            if (expected) assert.equal(new URL(b.calls[1].url).pathname, `/api/v1/accounts/${result.id}/follow`);
        }
    });

    test(`${source}: rejected account searches report HTTP errors, not missing accounts`, async () => {
        const b = browser(source, new Map([['fedipol:follow-session-v1', JSON.stringify({
            token: 'token', origin: 'https://mastodon.social', clientId: 'c', clientSecret: 's',
        })]]));
        b.ctx.respond = () => ({ ok: false, status: 403 });
        await b.F.follow('https://remote.social/@bob');
        assert.match(b.status.textContent, /403/);
        assert.doesNotMatch(b.status.textContent, /nicht gefunden/);
        assert.equal(b.calls.length, 1);
    });
}

test('follow.js: loads a stored session from sessionStorage', () => {
    const { sessionStorage, F } = loadFollow();
    const session = { token: 'tok', origin: 'https://mastodon.social', clientId: 'c', clientSecret: 's' };
    sessionStorage.setItem('fedipol:follow-session-v1', JSON.stringify(session));
    assert.equal(F.isAuthenticated(), true);
    assert.equal(F.getSession().origin, 'https://mastodon.social');
});

for (const source of uiSources) {
    test(`${source}: renders a follow action button in the actions cell for parties`, () => {
        const context = vm.createContext({ URL, document: { addEventListener() {} } });
        vm.runInContext(fs.readFileSync(path.join(__dirname, source), 'utf8'), context);
        const html = context.renderAccountRow({
            name: 'Alice', category: 'Mitglied des Deutschen Bundestages (Linke)',
            url: 'https://mastodon.social/@alice', recent_posts_count: 5, posts_count: 10,
        });
        assert.match(html, /class="[^"]*follow-action/);
        assert.match(html, /data-follow-url="https:\/\/mastodon.social\/@alice"/);
        assert.match(html, /action-label-desktop">Folgen</);
        assert.match(html, /<td class="account-actions-cell">/);
        assert.ok(html.indexOf('action-label-desktop">Folgen<') > html.indexOf('action-label-desktop">Analyse<'));
    });

    test(`${source}: renders a follow action button for institution accounts too`, () => {
        const context = vm.createContext({ URL, document: { addEventListener() {} } });
        vm.runInContext(fs.readFileSync(path.join(__dirname, source), 'utf8'), context);
        const html = context.renderAccountRow({
            name: 'Bundesbehörde', category: 'Bundesbehörde',
            url: 'https://mastodon.social/@behoerde', recent_posts_count: 5, posts_count: 10,
        });
        assert.match(html, /class="[^"]*follow-action/);
        assert.match(html, /fediwings-link/);
    });

    test(`${source}: does not render a follow button for an invalid profile URL`, () => {
        const context = vm.createContext({ URL, document: { addEventListener() {} } });
        vm.runInContext(fs.readFileSync(path.join(__dirname, source), 'utf8'), context);
        const html = context.renderAccountRow({
            name: 'Alice', category: 'Mitglied des Deutschen Bundestages (Linke)',
            url: 'not a url', recent_posts_count: 5, posts_count: 10,
        });
        assert.doesNotMatch(html, /follow-action/);
    });
}
