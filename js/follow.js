// Fedipol „Folgen“: OAuth/PKCE gegen die eigene Mastodon-Instanz (nach FediWings)
// und Folgen der Dashboard-Accounts über die API der eigenen Instanz.
//
// Ablauf:
// - Erster Klick auf einen „Folgen“-Button ohne Session öffnet die Eingabe des
//   eigenen Handles; daraufhin OAuth/PKCE gegen diese Instanz (einmalig).
// - Nach erfolgreichem Login liegt die Session im `sessionStorage` und gilt für
//   alle weiteren „Folgen“-Buttons (kein erneuter Login).
// - Ein „Folgen“-Klick löst den Ziel-Account über `accounts/search` auf und
//   folgt ihm via `accounts/:id/follow` (idempotent).
//
// Namespace: `window.FediPolFollow`.

(function (global) {
    'use strict';

    var OAUTH_SCOPE = 'read:accounts write:follows';
    var HANDLE_KEY = 'fedipol:follow-handle';
    var HANDSHAKE_KEY = 'fedipol:oauth-handshake-v1';
    var SESSION_KEY = 'fedipol:follow-session-v1';
    var PENDING_FOLLOW_KEY = 'fedipol:pending-follow-v1';
    var TIMEOUT_MS = 12000;
    var followStates = new Map();
    var checkingFollowing = false;
    var dashboardIsReady = false;
    var returnContext = null;
    var capturedView = null;

    // ------------------------------------------------------------------
    // Zustand
    // ------------------------------------------------------------------

    var uiState = {
        pending: false,   // ein Follow-Vorgang läuft gerade
        authPending: false, // OAuth wird gerade gestartet (Redirekt folgt)
        error: null,
        session: null,
        lastFollowAccountUrl: null, // zuletzt erfolgreich gefolgter Account (für Rückmeldung)
    };

    // ------------------------------------------------------------------
    // Kleine Helfer
    // ------------------------------------------------------------------

    function base64Url(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function randomString(length) {
        var bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return base64Url(bytes);
    }

    function isSecureOrigin(value) {
        if (typeof value !== 'string') return false;
        try {
            var url = new URL(value);
            return url.protocol === 'https:' && url.origin === value && isPublicDomain(url.hostname);
        } catch (e) {
            return false;
        }
    }

    function isPublicDomain(domain) {
        return domain.length <= 253 && domain.includes('.')
            && !/^[\d.]+$/.test(domain)
            && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(domain)
            && domain.split('.').every(function (label) {
                return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
            });
    }

    function redirectUri() {
        return window.location.origin + window.location.pathname;
    }

    // Handle aus einer Profil-URL ableiten: "https://instanz.social/@alice"
    // -> acct "alice@instanz.social". Liefert null bei ungültigen URLs.
    function acctFromProfileUrl(value) {
        try {
            var url = new URL(value);
            if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) {
                return null;
            }
            var m = url.pathname.match(/^\/(?:@|users\/)([a-z0-9_][a-z0-9_.-]{0,63})\/?$/i);
            if (!m) return null;
            return m[1] + '@' + url.hostname;
        } catch (e) {
            return null;
        }
    }

    // Handle der eigenen Instanz parsen: "@alice@instanz.de" / "alice@instanz.de"
    // -> { acct, origin } oder null.
    function parseOwnHandle(value) {
        var normalized = String(value || '').trim().replace(/^@/, '');
        var at = normalized.lastIndexOf('@');
        if (at < 1 || at === normalized.length - 1) return null;
        var username = normalized.slice(0, at);
        var domain = normalized.slice(at + 1).toLowerCase();
        if (!/^[a-z0-9_][a-z0-9_.-]*$/i.test(username)) return null;
        var origin;
        try {
            origin = new URL('https://' + domain);
        } catch (e) {
            return null;
        }
        if (/[\s/:?#\\@%\[\]]/.test(domain) || !isPublicDomain(origin.hostname)
            || origin.username || origin.password || origin.port) return null;
        return { acct: username + '@' + origin.hostname, origin: origin.origin };
    }

    // ------------------------------------------------------------------
    // Session-Speicherung (sessionStorage)
    // ------------------------------------------------------------------

    function saveSession(session) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }

    function loadSession() {
        try {
            var raw = sessionStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (
                typeof parsed !== 'object' || parsed === null ||
                typeof parsed.token !== 'string' || parsed.token === '' ||
                typeof parsed.origin !== 'string' || !isSecureOrigin(parsed.origin) ||
                typeof parsed.clientId !== 'string' ||
                typeof parsed.clientSecret !== 'string'
            ) {
                sessionStorage.removeItem(SESSION_KEY);
                return null;
            }
            return parsed;
        } catch (e) {
            try { sessionStorage.removeItem(SESSION_KEY); } catch (e2) {}
            return null;
        }
    }

    function clearSession() {
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
        followStates.clear();
    }

    function saveHandshake(handshake) {
        sessionStorage.setItem(HANDSHAKE_KEY, JSON.stringify(handshake));
    }

    function loadHandshake() {
        try {
            var raw = sessionStorage.getItem(HANDSHAKE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (
                typeof parsed !== 'object' || parsed === null ||
                !isSecureOrigin(parsed.origin) ||
                typeof parsed.clientId !== 'string' ||
                typeof parsed.clientSecret !== 'string' ||
                typeof parsed.verifier !== 'string' ||
                typeof parsed.state !== 'string' || !parsed.state ||
                typeof parsed.acct !== 'string' ||
                !Number.isFinite(parsed.createdAt) || Date.now() - parsed.createdAt > 15 * 60 * 1000 ||
                parsed.createdAt > Date.now() ||
                !acctFromProfileUrl(parsed.target)
            ) {
                return null;
            }
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function clearHandshake() {
        try { sessionStorage.removeItem(HANDSHAKE_KEY); } catch (e) {}
    }

    // Wartender Follow-Zielaccount (wird über den OAuth-Rücksprung hinweg
    // gemerkt und danach ausgeführt).
    function savePendingFollow(accountUrl) {
        try { sessionStorage.setItem(PENDING_FOLLOW_KEY, String(accountUrl)); } catch (e) {}
    }

    function takePendingFollow() {
        try {
            var value = sessionStorage.getItem(PENDING_FOLLOW_KEY);
            sessionStorage.removeItem(PENDING_FOLLOW_KEY);
            return value;
        } catch (e) {
            return null;
        }
    }

    function getOwnHandle() {
        try { return sessionStorage.getItem(HANDLE_KEY) || ''; } catch (e) { return ''; }
    }

    function setOwnHandle(handle) {
        try { sessionStorage.setItem(HANDLE_KEY, handle); } catch (e) {}
    }

    // ------------------------------------------------------------------
    // API-Zugriff mit Bearer-Token (eigene Instanz)
    // ------------------------------------------------------------------

    function authorizedFetch(origin, token, path, options) {
        var headers = Object.assign(
            { Accept: 'application/json', Authorization: 'Bearer ' + token },
            options && options.headers
        );
        return fetch(origin + path, Object.assign({}, options, {
            headers: headers, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS),
        }));
    }

    // ------------------------------------------------------------------
    // OAuth/PKCE (nach FediWings)
    // ------------------------------------------------------------------

    async function createPkcePair() {
        var verifier = randomString(64);
        var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        return { verifier: verifier, challenge: base64Url(new Uint8Array(digest)) };
    }

    function randomState() {
        return randomString(16);
    }

    async function postForm(origin, path, body, signal) {
        var controller = signal ? signal : new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
        var response;
        try {
            response = await fetch(origin + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
                signal: controller.signal,
                redirect: 'error',
                credentials: 'omit',
            });
        } catch (error) {
            throw new Error('Der Server der eigenen Instanz ist nicht erreichbar.');
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            throw new Error('Der Login wurde abgelehnt (Status ' + response.status + ').');
        }
        return response.json();
    }

    async function registerApp(origin, signal) {
        var body = new URLSearchParams({
            client_name: 'Fedipol',
            redirect_uris: redirectUri(),
            scopes: OAUTH_SCOPE,
            website: window.location.origin + window.location.pathname,
        });
        var json = await postForm(origin, '/api/v1/apps', body, signal);
        if (!json || typeof json.client_id !== 'string' || typeof json.client_secret !== 'string') {
            throw new Error('Die Instanz hat die App-Registrierung abgelehnt.');
        }
        return { clientId: json.client_id, clientSecret: json.client_secret };
    }

    function buildAuthorizeUrl(origin, clientId, challenge, state) {
        var params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri(),
            response_type: 'code',
            scope: OAUTH_SCOPE,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state: state,
            force_login: 'true',
        });
        return origin + '/oauth/authorize?' + params;
    }

    async function exchangeCode(origin, client, code, verifier, signal) {
        var body = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            client_id: client.clientId,
            client_secret: client.clientSecret,
            redirect_uri: redirectUri(),
            code_verifier: verifier,
        });
        var json = await postForm(origin, '/oauth/token', body, signal);
        if (!json || typeof json.access_token !== 'string') {
            throw new Error('Der Login-Token konnte nicht ausgetauscht werden.');
        }
        return json.access_token;
    }

    async function verifyCredentials(origin, token, signal) {
        var controller = signal ? signal : new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
        var response;
        try {
            response = await fetch(origin + '/api/v1/accounts/verify_credentials', {
                headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
                signal: controller.signal,
                redirect: 'error',
                credentials: 'omit',
            });
        } catch (error) {
            throw new Error('Der eigene Account konnte nicht bestätigt werden.');
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            throw new Error('Der eigene Account konnte nicht bestätigt werden.');
        }
        var json = await response.json();
        if (!json || typeof json.id !== 'string') {
            throw new Error('Der eigene Account konnte nicht bestätigt werden.');
        }
        return json;
    }

    async function revokeToken(origin, client, token) {
        var body = new URLSearchParams({
            client_id: client.clientId,
            client_secret: client.clientSecret,
            token: token,
        });
        // Widerruf nur „best effort“; Fehler werden vom Aufrufer bemerkt.
        var response = await fetch(origin + '/oauth/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new Error('Token-Widerruf fehlgeschlagen.');
    }

    // ------------------------------------------------------------------
    // Folgen über die eigene Instanz
    // ------------------------------------------------------------------

    // Ziel-Account auf der eigenen Instanz auflösen und folgen. Idempotent.
    async function followAccount(session, accountUrl) {
        var acct = acctFromProfileUrl(accountUrl);
        if (!acct) {
            throw new Error('Kein gültiger Profil-Link für ' + accountUrl);
        }

        // accounts/lookup kennt nur bereits bekannte Accounts. Die Account-Suche
        // mit resolve=true löst auch neue Remote-Accounts auf (read:accounts).
        var lookupResponse = await authorizedFetch(
            session.origin, session.token,
            '/api/v1/accounts/search?resolve=true&limit=1&q=' + encodeURIComponent(accountUrl)
        );
        if (lookupResponse.status === 401) {
            throw new Error('SESSION_EXPIRED');
        }
        if (!lookupResponse.ok) {
            throw new Error('Der Account ' + acct + ' konnte nicht gefunden werden.');
        }
        var results = await lookupResponse.json();
        var target = Array.isArray(results) && results.find(function (item) {
            return item && typeof item.id === 'string' && item.id
                && (item.url === accountUrl || item.acct === acct);
        });
        if (!target) {
            throw new Error('Der Account ' + acct + ' konnte nicht gefunden werden.');
        }

        // 2) Folgen (write:follows)
        var followResponse = await authorizedFetch(
            session.origin, session.token, '/api/v1/accounts/' + encodeURIComponent(target.id) + '/follow',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json',
                    Authorization: 'Bearer ' + session.token,
                },
                body: new URLSearchParams({ reblogs: 'true' }).toString(),
            }
        );
        if (followResponse.status === 401) {
            throw new Error('SESSION_EXPIRED');
        }
        if (!followResponse.ok) {
            throw new Error('Das Folgen von ' + acct + ' wurde abgelehnt.');
        }
        var relationship = await followResponse.json();
        if (!relationship || relationship.id !== target.id
            || (relationship.following !== true && relationship.requested !== true)) {
            throw new Error('Die Instanz hat das Folgen nicht bestätigt.');
        }
        return relationship;
    }

    function profileKey(url) {
        return (acctFromProfileUrl(url) || url || '').toLowerCase();
    }

    function rememberRelationship(url, relationship) {
        var state = relationship.following ? 'following' : 'requested';
        followStates.set(profileKey(url), state);
        var session = uiState.session || loadSession();
        if (session) {
            var requests = new Set(session.requestedTargets || []);
            if (state === 'requested') requests.add(url);
            else requests.delete(url);
            session.requestedTargets = Array.from(requests);
            try { saveSession(session); } catch (e) {}
        }
        refreshButtons();
    }

    // Die eigene Following-Liste erlaubt vorhandene Follows ohne zusätzlichen
    // OAuth-Scope und ohne einen Lookup pro Dashboard-Zeile zu erkennen.
    async function loadFollowing(session) {
        if (!session.account || !session.account.id) return;
        checkingFollowing = true;
        refreshButtons();
        var path = '/api/v1/accounts/' + encodeURIComponent(session.account.id) + '/following?limit=80';
        var visited = new Set();
        try {
            while (path) {
                if (visited.has(path) || visited.size >= 100) throw new Error('Zu viele Statusseiten.');
                visited.add(path);
                var response = await authorizedFetch(session.origin, session.token, path);
                if (uiState.session !== session) return; // inzwischen abgemeldet
                if (response.status === 401) throw new Error('SESSION_EXPIRED');
                if (!response.ok) throw new Error('Statusabfrage fehlgeschlagen.');
                var accounts = await response.json();
                if (!Array.isArray(accounts)) throw new Error('Ungültige Following-Liste.');
                accounts.forEach(function (account) {
                    if (account && typeof account.url === 'string') {
                        followStates.set(profileKey(account.url), 'following');
                    }
                    if (account && typeof account.acct === 'string') {
                        var acct = account.acct.includes('@') ? account.acct
                            : account.acct + '@' + new URL(session.origin).hostname;
                        followStates.set(acct.toLowerCase(), 'following');
                    }
                });
                refreshButtons();
                var link = response.headers && response.headers.get('Link');
                var next = link && link.match(/<([^>]+)>;\s*rel="next"/);
                path = null;
                if (next) {
                    var url = new URL(next[1], session.origin);
                    if (url.origin !== session.origin || url.pathname !== '/api/v1/accounts/'
                        + encodeURIComponent(session.account.id) + '/following') {
                        throw new Error('Ungültige Status-Pagination.');
                    }
                    path = url.pathname + url.search;
                }
            }
        } catch (error) {
            if (error.message === 'SESSION_EXPIRED') {
                clearSession();
                uiState.session = null;
                statusMessage('Die Verbindung ist abgelaufen. Bitte erneut anmelden.', true);
            } else {
                statusMessage('Bestehende Follows konnten nicht vollständig geprüft werden. Bestätigte Follows bleiben markiert.', true);
            }
        } finally {
            checkingFollowing = false;
            refreshButtons();
        }
    }

    function restoreReturnContext() {
        if (!dashboardIsReady || !returnContext) return;
        var context = returnContext;
        returnContext = null;
        if (typeof window.restoreFollowView === 'function') {
            window.restoreFollowView(context.view, context.target);
        }
    }

    function dashboardReady() {
        dashboardIsReady = true;
        refreshButtons();
        restoreReturnContext();
    }

    // ------------------------------------------------------------------
    // UI-Rückmeldung (an das Dashboard angepasst)
    // ------------------------------------------------------------------

    function setButtonsPending(pending) {
        uiState.pending = pending;
        refreshButtons();
    }

    function refreshButtons() {
        var buttons = document.querySelectorAll('.follow-action');
        buttons.forEach(function (button) {
            var url = button.getAttribute('data-follow-url');
            var state = followStates.get(profileKey(url));
            var session = uiState.session;
            var own = session && session.account && session.account.url
                && profileKey(url) === profileKey(session.account.url);
            var label = own ? 'Dein Account' : state === 'following' ? 'Folge ich'
                : state === 'requested' ? 'Angefragt' : checkingFollowing ? 'Prüfe …' : 'Folgen';
            button.querySelectorAll('.action-label-desktop, .action-label-mobile').forEach(function (span) {
                span.textContent = label;
            });
            button.title = state === 'following' ? 'Diesem Account folgst du bereits.'
                : state === 'requested' ? 'Deine Folgeanfrage wartet auf Bestätigung.'
                : own ? 'Du bist mit diesem Account angemeldet.' : 'Auf deiner Mastodon-Instanz folgen';
            button.setAttribute('aria-label', label + ': ' + (acctFromProfileUrl(url) || 'Account'));
            button.classList.toggle('is-following', state === 'following');
            button.classList.toggle('is-requested', state === 'requested');
            button.classList.toggle('is-pending', uiState.pending && !state);
            button.disabled = Boolean(uiState.pending || uiState.authPending || checkingFollowing || state || own);
            var icon = button.querySelector('i');
            if (icon) icon.className = 'fa-solid ' + (state === 'following' ? 'fa-user-check'
                : state === 'requested' ? 'fa-clock' : 'fa-user-plus');
        });
    }

    function statusMessage(text, isError) {
        var container = document.getElementById('followStatus');
        if (!container) return;
        container.textContent = text || '';
        container.classList.toggle('text-danger', Boolean(isError));
        container.classList.toggle('text-success', !isError && Boolean(text));
    }

    function clearStatusMessage() {
        statusMessage('');
    }

    // ------------------------------------------------------------------
    // Öffentliche API
    // ------------------------------------------------------------------

    // Vom OAuth-Rücksprung: Session aus Handshake aufbauen und speichern.
    async function completeLogin(handshake, code) {
        var client = { clientId: handshake.clientId, clientSecret: handshake.clientSecret };
        var token = await exchangeCode(handshake.origin, client, code, handshake.verifier);
        var account;
        try {
            account = await verifyCredentials(handshake.origin, token);
            var acct = account.acct && (account.acct.includes('@')
                ? account.acct : account.acct + '@' + new URL(handshake.origin).hostname);
            if (!acct || acct.toLowerCase() !== handshake.acct.toLowerCase()) {
                throw new Error('Du hast dich mit einem anderen Account angemeldet. Bitte erneut verbinden.');
            }
        } catch (error) {
            await revokeToken(handshake.origin, client, token).catch(function () {});
            throw error;
        }
        var session = {
            token: token,
            origin: handshake.origin,
            clientId: handshake.clientId,
            clientSecret: handshake.clientSecret,
            account: account,
        };
        try { saveSession(session); } catch (error) {
            await revokeToken(handshake.origin, client, token).catch(function () {});
            throw new Error('Der Sitzungsspeicher ist nicht verfügbar.');
        }
        clearHandshake();
        uiState.session = session;
        uiState.authPending = false;
        return session;
    }

    // Startet die OAuth-PKCE-Anmeldung gegen `origin` der eigenen Instanz.
    // `pendingAccountUrl` wird über den Rücksprung gemerkt und danach gefolgt.
    async function startLogin(ownHandle) {
        var parsed = parseOwnHandle(ownHandle);
        if (!parsed) throw new Error('Bitte gib dein Handle an, z. B. @du@instanz.de');

        var pendingFollow = takePendingFollow() || uiState.lastFollowAccountUrl;
        if (pendingFollow) savePendingFollow(pendingFollow);

        uiState.authPending = true;
        var origin = parsed.origin;
        var pkce = await createPkcePair();
        var state = randomState();
        var client = await registerApp(origin);
        saveHandshake({
            origin: origin,
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            verifier: pkce.verifier,
            state: state,
            acct: parsed.acct,
            createdAt: Date.now(),
            target: pendingFollow,
            returnView: capturedView,
        });
        setOwnHandle(parsed.acct);
        window.location.assign(buildAuthorizeUrl(origin, client.clientId, pkce.challenge, state));
    }

    // Verbindet das Handle-Eingabe-Modal für die OAuth-Anmeldung.
    function bindAuthModal() {
        var form = document.getElementById('followAuthForm');
        if (!form) return;
        if (form._bound) return;
        form._bound = true;

        var input = document.getElementById('followAuthHandle');
        var submit = document.getElementById('followAuthSubmit');
        var errorBox = document.getElementById('followAuthError');
        var modalEl = document.getElementById('followAuthModal');
        if (input) input.value = getOwnHandle();
        if (errorBox) errorBox.textContent = '';

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            if (!input || uiState.authPending) return;
            if (errorBox) errorBox.textContent = '';
            if (submit) submit.disabled = true;
            startLogin(input.value).catch(function (error) {
                if (errorBox) errorBox.textContent = error.message || 'Anmeldung fehlgeschlagen.';
                if (submit) submit.disabled = false;
                uiState.authPending = false;
            });
        });

        // Beim erneuten Öffnen das Eingabefeld zurücksetzen / vorbelegen
        if (modalEl) {
            modalEl.addEventListener('hidden.bs.modal', function () {
                if (!uiState.authPending) {
                    takePendingFollow();
                    uiState.lastFollowAccountUrl = null;
                }
            });
            modalEl.addEventListener('shown.bs.modal', function () {
                if (input) {
                    input.value = getOwnHandle();
                    input.focus();
                }
            });
        }
    }

    // Beim Laden: bestehende Session wiederherstellen und ggf. einen
    // OAuth-Rücksprung sowie einen wartenden Follow abarbeiten.
    async function init() {
        bindAuthModal();
        var session = loadSession();
        if (session) {
            uiState.session = session;
            (Array.isArray(session.requestedTargets) ? session.requestedTargets : []).forEach(function (url) {
                if (typeof url === 'string') followStates.set(profileKey(url), 'requested');
            });
        }

        var params = new URLSearchParams(window.location.search);
        var code = params.get('code');
        var state = params.get('state');
        var callbackError = params.get('error');

        var handshake = loadHandshake();

        var pending = null;
        if (params.has('state') || params.has('code') || params.has('error')) {
            uiState.authPending = true;
            clearHandshake();
            var valid = handshake && state === handshake.state
                && ['code', 'state', 'error'].every(function (key) { return params.getAll(key).length <= 1; });
            if (valid) {
                returnContext = { view: handshake.returnView, target: handshake.target };
                restoreReturnContext();
            }
            // Vor jedem Netzaufruf entfernen: kein Replay, keine Weitergabe an Links.
            var clean = new URL(window.location.href);
            ['code', 'state', 'error', 'error_description'].forEach(function (key) { clean.searchParams.delete(key); });
            window.history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
            if (!valid || (code && callbackError)) {
                statusMessage('Die Anmeldung ist nicht gültig.', true);
            } else if (callbackError) {
                uiState.authPending = false;
                statusMessage(
                    callbackError === 'access_denied'
                        ? 'Die Anmeldung wurde abgebrochen.'
                        : 'Die Anmeldung wurde abgelehnt.',
                    true
                );
            } else if (code) {
                try {
                    uiState.session = await completeLogin(handshake, code);
                    pending = handshake.target;
                    statusMessage('Mit deiner Instanz verbunden.');
                } catch (error) {
                    uiState.authPending = false;
                    statusMessage(error.message, true);
                }
            } else {
                uiState.authPending = false;
                statusMessage('Die Anmeldung ist nicht gültig.', true);
            }
            uiState.authPending = false;
        } else if (handshake && !state) {
            // Abbruch- oder unterbrochener Login ohne Rücksprung: aufräumen
            clearHandshake();
        }

        // Wartender Follow (nach OAuth-Rücksprung oder Session vorhanden)
        takePendingFollow();
        if (pending && uiState.session) {
            setButtonsPending(true);
            try {
                var relationship = await followAccount(uiState.session, pending);
                rememberRelationship(pending, relationship);
                var name = acctFromProfileUrl(pending);
                statusMessage(relationship.requested ? 'Folgeanfrage gesendet.' : 'Du folgst jetzt ' + name + '.');
                uiState.lastFollowAccountUrl = pending;
            } catch (error) {
                if (error.message === 'SESSION_EXPIRED') {
                    clearSession();
                    uiState.session = null;
                    statusMessage('Die Verbindung ist abgelaufen. Bitte erneut anmelden.', true);
                } else {
                    statusMessage(error.message, true);
                }
            } finally { setButtonsPending(false); }
        }
        refreshButtons();
        // Bei abgelehnten/ungültigen Callbacks keine Requests mit einer alten Session.
        if (uiState.session && (!params.has('state') && !params.has('code') && !params.has('error') || pending)) {
            await loadFollowing(uiState.session);
        }
    }

    // Der „Folgen“-Button-Handler. Ohne Session startet er die Anmeldung;
    // mit Session folgt er sofort.
    async function follow(accountUrl) {
        if (uiState.pending || uiState.authPending) return;
        if (followStates.has(profileKey(accountUrl))) return;
        clearStatusMessage();
        capturedView = typeof window.captureFollowView === 'function'
            ? window.captureFollowView(accountUrl) : null;

        var session = loadSession() || uiState.session;
        if (session) uiState.session = session;
        if (!session) {
            uiState.lastFollowAccountUrl = accountUrl;
            savePendingFollow(accountUrl);
            var modal = document.getElementById('followAuthModal');
            if (modal && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                var inst = bootstrap.Modal.getOrCreateInstance(modal);
                inst.show();
            }
            return;
        }

        setButtonsPending(true);
        try {
            var relationship = await followAccount(session, accountUrl);
            rememberRelationship(accountUrl, relationship);
            var n = acctFromProfileUrl(accountUrl);
            statusMessage(relationship.requested ? 'Folgeanfrage gesendet.' : 'Du folgst jetzt ' + n + '.');
            uiState.lastFollowAccountUrl = accountUrl;
        } catch (error) {
            if (error.message === 'SESSION_EXPIRED') {
                clearSession();
                uiState.session = null;
                uiState.lastFollowAccountUrl = accountUrl;
                savePendingFollow(accountUrl);
                statusMessage('Die Verbindung ist abgelaufen. Bitte erneut anmelden.', true);
                var modal2 = document.getElementById('followAuthModal');
                if (modal2 && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    bootstrap.Modal.getOrCreateInstance(modal2).show();
                }
            } else {
                statusMessage(error.message, true);
            }
        } finally {
            setButtonsPending(false);
        }
    }

    // Abmelden (Token widerrufen, Session löschen)
    async function disconnect() {
        var session = loadSession() || uiState.session;
        if (session) {
            try {
                await revokeToken(
                    session.origin,
                    { clientId: session.clientId, clientSecret: session.clientSecret },
                    session.token
                );
            } catch (e) {
                // Widerruf konnte nicht bestätigt werden; lokal trotzdem löschen.
            }
        }
        clearSession();
        uiState.session = null;
        refreshButtons();
        statusMessage('Verbindung getrennt.');
    }

    function isAuthenticated() {
        return Boolean(loadSession() || uiState.session);
    }

    function getSession() {
        return loadSession() || uiState.session;
    }

    function getOwnHandleValue() {
        return getOwnHandle();
    }

    global.FediPolFollow = {
        init: init,
        follow: follow,
        startLogin: startLogin,
        disconnect: disconnect,
        isAuthenticated: isAuthenticated,
        getSession: getSession,
        getOwnHandle: getOwnHandleValue,
        parseOwnHandle: parseOwnHandle,
        acctFromProfileUrl: acctFromProfileUrl,
        completeLogin: completeLogin,
        dashboardReady: dashboardReady,
    };
})(window);
