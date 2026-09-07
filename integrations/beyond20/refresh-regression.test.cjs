/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS harness for the upstream extension checkout. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness({ delayed = false, origins = ['http://localhost/*'] } = {}) {
    const source = fs.readFileSync(require('node:path').resolve(process.argv[2] || '.working/beyond20-refresh-fix', 'src/extension/background.js'), 'utf8');
    const start = source.indexOf('function onTabsUpdated(');
    const end = source.indexOf('\nfunction onTabRemoved(', start);
    let registered = true;
    let injected = 0;
    let receiver = false;
    let serial = 0;
    const timers = new Map();
    const messages = [];
    const context = {
        tabRemovalTimers: {}, customTabChecks: new Map(),
        currentPermissions: { origins }, URL,
        isFVTTTabAdded: () => false, isRoll20TabAdded: () => false,
        isFVTT: () => false, isRoll20: () => false,
        isCustomTabAdded: () => registered,
        isCustomDomainUrl: () => true, isSupportedVTT: () => false,
        urlMatches: (url, pattern) => url.match(pattern.replace(/\*/g, '[^]*')) !== null,
        removeCustomTab: () => { registered = false; },
        addCustomTab: () => { registered = true; },
        injectGenericSiteScripts: (_tabs, callback) => {
            injected++; receiver = true; registered = true; callback?.();
        },
        setTimeout: (fn) => { const id = ++serial; timers.set(id, fn); return id; },
        clearTimeout: id => timers.delete(id),
        chrome: { runtime: {}, tabs: { sendMessage: (_id, _message, callback) => {
            const reply = () => callback(receiver ? { beyond20: true } : undefined);
            if (delayed) messages.push(reply); else reply();
        } } },
    };
    vm.createContext(context);
    const helperStart = source.indexOf('function ensureCustomTab(');
    if (helperStart >= 0) vm.runInContext(source.slice(helperStart, source.indexOf('\nfunction ', helperStart + 1)), context);
    vm.runInContext(source.slice(start, end), context);
    const tab = { id: 7, title: 'D&D Battle Map', url: 'http://localhost:3001/' };
    return {
        update: status => context.onTabsUpdated(tab.id, { status }, tab),
        expire: () => { for (const [id, fn] of timers) { timers.delete(id); fn(); } },
        discardDocument: () => { receiver = false; },
        setReceiver: () => { receiver = true; },
        reply: () => messages.shift()?.(),
        close: () => context.customTabChecks.delete(tab.id),
        get pending() { return messages.length; },
        get injected() { return injected; },
    };
}

test('fast reload replaces the discarded content script before the 100ms timer expires', () => {
    const h = harness();
    h.update('loading');
    h.update('complete');
    assert.equal(h.injected, 1);
});
test('overlapping completed loads coalesce then recheck the current document', () => {
    const h = harness({ delayed: true });
    h.update('complete'); h.update('complete');
    assert.equal(h.pending, 1);
    h.reply();
    assert.equal(h.injected, 1);
    assert.equal(h.pending, 1);
    h.reply();
    assert.equal(h.injected, 1);
    assert.equal(h.pending, 0);
});
test('closing a tab during a probe does not inject into a discarded tab', () => {
    const h = harness({ delayed: true });
    h.update('complete'); h.close(); h.reply();
    assert.equal(h.injected, 0);
});
test('slow reload also reconnects', () => {
    const h = harness();
    h.update('loading'); h.expire(); h.update('complete');
    assert.equal(h.injected, 1);
});
test('Chrome port-specific localhost grant permits the matching custom page', () => {
    const h = harness({ origins: ['http://localhost:3001/*'] });
    h.update('complete');
    assert.equal(h.injected, 1);
});
test('a different localhost port grant does not permit this page', () => {
    const h = harness({ origins: ['http://localhost:3002/*'] });
    h.update('complete');
    assert.equal(h.injected, 0);
});
test('an existing content script is not injected twice', () => {
    const h = harness(); h.setReceiver();
    h.update('loading'); h.update('complete');
    assert.equal(h.injected, 0);
});
test('repeated fast refreshes reconnect once per new document', () => {
    const h = harness();
    for (let i = 0; i < 5; i++) {
        h.discardDocument(); h.update('loading'); h.update('complete');
    }
    assert.equal(h.injected, 5);
});
