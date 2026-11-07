// FediWings policy: saved choice > browser language > German fallback.
// Static DOM adapter instead of a Svelte store. Never translate HTML or URLs.
(function (global) {
    'use strict';
    var catalogs = global.FedipolMessages;
    var storageKey = 'fedipol:locale-v1';
    function initialLocale() {
        try {
            var saved = localStorage.getItem(storageKey);
            if (saved === 'de' || saved === 'en') return saved;
        } catch (error) { /* Storage can be blocked. */ }
        return /^en/i.test(navigator.language || '') ? 'en' : 'de';
    }
    var locale = initialLocale();
    var subscribers = [];
    var originals = new WeakMap();
    var observer;
    var active = false;
    var attributes = ['title', 'aria-label', 'placeholder', 'data-bs-original-title'];
    var skip = 'script, style, code, [data-no-i18n], .account-identity, .account-party, .party-name, .stats-label, #instancesTableBody';
    function normalize(text) { return text.replace(/\s+/g, ' ').trim(); }
    function interpolate(text, values) {
        return text.replace(/\{(\w+)\}/g, function (match, name) {
            return values && Object.hasOwn(values, name) ? String(values[name]) : match;
        });
    }
    function msg(id, values) {
        return interpolate(catalogs[locale][id] || catalogs.de[id] || id, values);
    }
    // Legacy renderers produce German strings. Match catalog templates, keeping
    // runtime handles, counts and percentages unchanged (no HTML interpolation).
    var templates = Object.keys(catalogs.de).filter(function (key) {
        return key.includes('{');
    }).map(function (key) {
        var names = [];
        var pieces = normalize(catalogs.de[key]).split(/(\{\w+\})/).map(function (part) {
            if (/^\{\w+\}$/.test(part)) {
                names.push(part.slice(1, -1));
                return '(.+?)';
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        });
        return { key: key, names: names, pattern: new RegExp('^' + pieces.join('') + '$') };
    });
    var sourceKeys = new Map(Object.keys(catalogs.de).map(function (key) {
        return [normalize(catalogs.de[key]), key];
    }));
    function translate(text) {
        if (!text || locale === 'de') return text;
        var source = normalize(text);
        if (!source || !/[A-Za-zÄÖÜäöüß]/.test(source)) return text;
        var key = sourceKeys.get(source);
        var result;
        if (key) result = msg(key);
        else {
            for (var template of templates) {
                var match = source.match(template.pattern);
                if (!match) continue;
                var values = {};
                template.names.forEach(function (name, index) { values[name] = match[index + 1]; });
                result = msg(template.key, values);
                break;
            }
        }
        if (result === undefined) return text;
        return (text.match(/^\s*/) || [''])[0] + result + (text.match(/\s*$/) || [''])[0];
    }
    function updateValue(node, key, current, write) {
        if (!current.trim()) return;
        var records = originals.get(node) || {};
        var record = records[key];
        var source = record && current === record.last ? record.source : current;
        var next = translate(source);
        if (next !== current) write(next);
        records[key] = { source: source, last: next };
        originals.set(node, records);
    }
    function localize(root) {
        if (!root) return;
        if (root.nodeType === 3) {
            if (root.parentElement && !root.parentElement.closest(skip)) {
                updateValue(root, 'text', root.nodeValue, function (text) { root.nodeValue = text; });
            }
            return;
        }
        if (root.nodeType !== 1 && root.nodeType !== 9) return;
        if (root.nodeType === 1) {
            if (root.matches(skip)) return;
            if (root.hasAttribute('data-i18n')) {
                var text = msg(root.getAttribute('data-i18n'));
                if (root.textContent !== text) root.textContent = text;
                return;
            }
            attributes.forEach(function (attribute) {
                if (!root.hasAttribute(attribute)) return;
                updateValue(root, attribute, root.getAttribute(attribute), function (text) { root.setAttribute(attribute, text); });
            });
        }
        Array.from(root.childNodes).forEach(localize);
    }
    function observe() {
        observer.observe(document.documentElement, {
            subtree: true, childList: true, characterData: true,
            attributes: true, attributeFilter: attributes,
        });
    }
    function apply() {
        if (!active) return;
        observer.disconnect();
        localize(document.documentElement);
        document.querySelectorAll('[data-language-switch]').forEach(function (select) { select.value = locale; });
        observe();
    }
    function setLocale(next) {
        if (next !== 'de' && next !== 'en') return;
        locale = next;
        document.documentElement.lang = locale;
        try { localStorage.setItem(storageKey, next); } catch (error) { /* Session-only choice. */ }
        apply();
        subscribers.forEach(function (callback) { callback(locale); });
    }
    function start() {
        active = true;
        observer = new MutationObserver(function (records) {
            // Disconnect during writes to avoid observer loops.
            observer.disconnect();
            var roots = new Set();
            records.forEach(function (record) {
                if (record.type === 'childList') record.addedNodes.forEach(function (node) { roots.add(node); });
                else roots.add(record.target);
            });
            roots.forEach(function (root) {
                if (root.isConnected && !(root.parentElement && root.parentElement.closest(skip))) localize(root);
            });
            observe();
        });
        document.querySelectorAll('[data-language-switch]').forEach(function (select) {
            select.addEventListener('change', function () { setLocale(select.value); });
        });
        apply();
    }
    document.documentElement.lang = locale;
    global.FedipolI18n = {
        currentLocale: function () { return locale; }, setLocale: setLocale,
        msg: msg, translate: translate,
        subscribe: function (callback) { subscribers.push(callback); }, apply: apply,
    };
    document.addEventListener('DOMContentLoaded', start);
})(window);
