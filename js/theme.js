// Farbschema: gespeicherte Wahl > Systemeinstellung (prefers-color-scheme).
// FediWings-Stil wie js/i18n.js. Lädt früh im <head> und setzt data-bs-theme
// am <html>-Element, damit kein heller Blitz beim Dunkelstart entsteht.
(function (global) {
    'use strict';
    var storageKey = 'fedipol:theme-v1';
    var modes = ['auto', 'light', 'dark'];
    var labels = {
        auto: 'Farbschema: automatisch (hell/dunkel)',
        light: 'Farbschema: hell',
        dark: 'Farbschema: dunkel',
    };
    var icons = { auto: 'bi bi-circle-half', light: 'bi bi-sun-fill', dark: 'bi bi-moon-stars-fill' };
    var systemQuery = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

    function readMode(fallback) {
        try {
            var saved = localStorage.getItem(storageKey);
            if (modes.indexOf(saved) !== -1) return saved;
        } catch (error) { return fallback; /* Session-Wahl bei gesperrtem Storage behalten. */ }
        return 'auto';
    }

    var mode = readMode('auto');
    var subscribers = [];

    function systemPrefersDark() {
        return !!(systemQuery && systemQuery.matches);
    }
    function resolvedTheme() {
        return mode === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
    }

    function apply() {
        if (document.documentElement) document.documentElement.dataset.bsTheme = resolvedTheme();
        var buttons = document.querySelectorAll('[data-theme-switch]');
        for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i];
            if (button.dataset.mode !== mode) button.dataset.mode = mode;
            button.setAttribute('title', labels[mode]);
            button.setAttribute('aria-label', labels[mode]);
            var icon = button.querySelector('i');
            if (icon) icon.className = icons[mode];
        }
    }

    function setMode(next) {
        if (modes.indexOf(next) === -1) return;
        mode = next;
        try { localStorage.setItem(storageKey, mode); } catch (error) { /* Session-only choice. */ }
        apply();
        subscribers.forEach(function (callback) { callback(mode); });
    }

    function start() {
        document.querySelectorAll('[data-theme-switch]').forEach(function (button) {
            button.addEventListener('click', function () {
                setMode(modes[(modes.indexOf(mode) + 1) % modes.length]);
            });
        });
        apply();
        if (!systemQuery) return;
        var listener = function () { if (mode === 'auto') apply(); };
        if (systemQuery.addEventListener) systemQuery.addEventListener('change', listener);
        else if (systemQuery.addListener) systemQuery.addListener(listener);
    }

    // Sofort anwenden: das Skript läuft synchron im <head>, bevor der body gerendert wird.
    apply();
    function restoreMode() {
        mode = readMode(mode);
        apply();
        subscribers.forEach(function (callback) { callback(mode); });
    }
    // Bereits offene Seiten und aus dem Back/Forward-Cache restaurierte Seiten
    // müssen dieselbe gespeicherte Wahl wie neu geladene Seiten verwenden.
    global.addEventListener('storage', function (event) {
        if (event.key === storageKey || event.key === null) restoreMode();
    });
    global.addEventListener('pageshow', function (event) {
        if (event.persisted) restoreMode();
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    global.FedipolTheme = {
        currentMode: function () { return mode; },
        resolvedTheme: resolvedTheme,
        setMode: setMode,
        subscribe: function (callback) { subscribers.push(callback); },
    };
})(window);
