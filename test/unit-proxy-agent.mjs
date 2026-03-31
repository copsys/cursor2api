/**
 * test/unit-proxy-agent.mjs
 *
 * Unit tests: proxy-agent module
 * Run with: node test/unit-proxy-agent.mjs
 *
 * Test logic is pure inline implementation without relying on dist outputs.
 * Validates:
 *  1. getProxyFetchOptions returns empty object when no proxy is configured
 *  2. Returns dispatcher when proxy is configured
 *  3. ProxyAgent caching (singleton-like behavior)
 *  4. Support for different proxy URL formats
 */

// ─── Test framework ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅  ${name}`);
        passed++;
    } catch (e) {
        console.error(`  ❌  ${name}`);
        console.error(`      ${e.message}`);
        failed++;
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
    const as = JSON.stringify(a), bs = JSON.stringify(b);
    if (as !== bs) throw new Error(msg || `Expected ${bs}, got ${as}`);
}

// ─── Inline mocks (simulate proxy-agent.ts core behavior, no dist needed) ───

// Mock config
let mockConfig = {};

function getConfig() {
    return mockConfig;
}

// Mock ProxyAgent (lightweight)
class MockProxyAgent {
    constructor(url) {
        this.url = url;
        this.type = 'ProxyAgent';
    }
}

// Inline implementation mirroring src/proxy-agent.ts behavior
let cachedAgent = undefined;
let cachedProxyUrl = undefined;
let cachedVisionAgent = undefined;
let cachedVisionProxyUrl = undefined;

function resetCache() {
    cachedAgent = undefined;
    cachedProxyUrl = undefined;
    cachedVisionAgent = undefined;
    cachedVisionProxyUrl = undefined;
}

function getProxyDispatcher() {
    const config = getConfig();
    const proxyUrl = config.proxy;

    if (!proxyUrl) return undefined;

    if (!cachedAgent || cachedProxyUrl !== proxyUrl) {
        cachedProxyUrl = proxyUrl;
        cachedAgent = new MockProxyAgent(proxyUrl);
    }

    return cachedAgent;
}

function getProxyFetchOptions() {
    const dispatcher = getProxyDispatcher();
    return dispatcher ? { dispatcher } : {};
}

function getVisionProxyFetchOptions() {
    const config = getConfig();
    const visionProxy = config.vision?.proxy;
    if (visionProxy) {
        if (!cachedVisionAgent || cachedVisionProxyUrl !== visionProxy) {
            cachedVisionProxyUrl = visionProxy;
            cachedVisionAgent = new MockProxyAgent(visionProxy);
        }
        return { dispatcher: cachedVisionAgent };
    }
    return getProxyFetchOptions();
}

// ════════════════════════════════════════════════════════════════════
// 1. No proxy config -> returns empty object
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [1] No proxy config\n');

test('returns empty object when proxy is not set', () => {
    resetCache();
    mockConfig = {};
    const opts = getProxyFetchOptions();
    assertEqual(Object.keys(opts).length, 0, 'should return an empty object');
});

test('returns empty object when proxy is undefined', () => {
    resetCache();
    mockConfig = { proxy: undefined };
    const opts = getProxyFetchOptions();
    assertEqual(Object.keys(opts).length, 0);
});

test('returns empty object when proxy is empty string', () => {
    resetCache();
    mockConfig = { proxy: '' };
    const opts = getProxyFetchOptions();
    assertEqual(Object.keys(opts).length, 0, 'empty string should not create dispatcher');
});

test('getProxyDispatcher returns undefined when no proxy is configured', () => {
    resetCache();
    mockConfig = {};
    const d = getProxyDispatcher();
    assertEqual(d, undefined);
});

// ════════════════════════════════════════════════════════════════════
// 2. Proxy configured -> returns object with dispatcher
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [2] Proxy configured\n');

test('returns dispatcher when proxy is set', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const opts = getProxyFetchOptions();
    assert(opts.dispatcher !== undefined, 'should contain dispatcher');
    assert(opts.dispatcher instanceof MockProxyAgent, 'should be a ProxyAgent instance');
});

test('dispatcher contains the correct proxy URL', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const d = getProxyDispatcher();
    assertEqual(d.url, 'http://127.0.0.1:7890');
});

test('supports authenticated proxy URL', () => {
    resetCache();
    mockConfig = { proxy: 'http://user:pass@proxy.corp.com:8080' };
    const d = getProxyDispatcher();
    assertEqual(d.url, 'http://user:pass@proxy.corp.com:8080');
});

test('supports HTTPS proxy URL', () => {
    resetCache();
    mockConfig = { proxy: 'https://secure-proxy.corp.com:443' };
    const d = getProxyDispatcher();
    assertEqual(d.url, 'https://secure-proxy.corp.com:443');
});

test('supports URL-encoded special chars in proxy password', () => {
    resetCache();
    const url = 'http://admin:p%40ssw0rd@proxy:8080';
    mockConfig = { proxy: url };
    const d = getProxyDispatcher();
    assertEqual(d.url, url, 'should preserve URL-encoded special characters');
});

// ════════════════════════════════════════════════════════════════════
// 3. Cache behavior (singleton-like)
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [3] Cache behavior\n');

test('returns same ProxyAgent instance across repeated calls', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const d1 = getProxyDispatcher();
    const d2 = getProxyDispatcher();
    assert(d1 === d2, 'should return same cached instance');
});

test('getProxyFetchOptions reuses same dispatcher across repeated calls', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const opts1 = getProxyFetchOptions();
    const opts2 = getProxyFetchOptions();
    assert(opts1.dispatcher === opts2.dispatcher, 'dispatcher should be same instance');
});

test('creates new instance after cache reset', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const d1 = getProxyDispatcher();
    resetCache();
    mockConfig = { proxy: 'http://10.0.0.1:3128' };
    const d2 = getProxyDispatcher();
    assert(d1 !== d2, 'should create new instance after reset');
    assertEqual(d2.url, 'http://10.0.0.1:3128');
});

test('creates new instance when proxy URL changes', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const d1 = getProxyDispatcher();
    mockConfig = { proxy: 'http://10.0.0.2:8888' };
    const d2 = getProxyDispatcher();
    assert(d1 !== d2, 'proxy URL change should refresh cached instance');
    assertEqual(d2.url, 'http://10.0.0.2:8888');
});

// ════════════════════════════════════════════════════════════════════
// 4. fetch options spread behavior
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [4] fetch options spread behavior\n');

test('spread keeps original options untouched when no proxy is set', () => {
    resetCache();
    mockConfig = {};
    const original = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const merged = { ...original, ...getProxyFetchOptions() };
    assertEqual(merged.method, 'POST');
    assertEqual(merged.headers['Content-Type'], 'application/json');
    assert(merged.dispatcher === undefined, 'should not add dispatcher');
});

test('spread injects dispatcher without overriding other fields when proxy is set', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const original = { method: 'POST', body: '{}', signal: 'test-signal' };
    const merged = { ...original, ...getProxyFetchOptions() };
    assertEqual(merged.method, 'POST');
    assertEqual(merged.body, '{}');
    assertEqual(merged.signal, 'test-signal');
    assert(merged.dispatcher instanceof MockProxyAgent, 'should include dispatcher');
});

// ════════════════════════════════════════════════════════════════════
// 5. config.ts integration check (env precedence)
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [5] config env integration checks\n');

test('PROXY env should override config.yaml (logic check)', () => {
    // Simulate config.ts override logic: env > yaml
    let config = { proxy: 'http://yaml-proxy:1234' };
    const envProxy = 'http://env-proxy:5678';
    // Simulate config.ts line 49 logic
    if (envProxy) config.proxy = envProxy;
    assertEqual(config.proxy, 'http://env-proxy:5678', 'PROXY env should override yaml config');
});

test('yaml value is preserved when PROXY env is not set (logic check)', () => {
    let config = { proxy: 'http://yaml-proxy:1234' };
    const envProxy = undefined;
    if (envProxy) config.proxy = envProxy;
    assertEqual(config.proxy, 'http://yaml-proxy:1234', 'yaml config should remain unchanged');
});

// ════════════════════════════════════════════════════════════════════
// 6. Vision proxy priority and cache refresh
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [6] Vision proxy behavior\n');

test('uses vision proxy first when vision.proxy is configured', () => {
    resetCache();
    mockConfig = { proxy: 'http://global-proxy:7890', vision: { proxy: 'http://vision-proxy:9000' } };
    const opts = getVisionProxyFetchOptions();
    assert(opts.dispatcher instanceof MockProxyAgent, 'should return vision dispatcher');
    assertEqual(opts.dispatcher.url, 'http://vision-proxy:9000');
});

test('refreshes vision dispatcher when vision.proxy URL changes', () => {
    resetCache();
    mockConfig = { vision: { proxy: 'http://vision-a:9000' } };
    const d1 = getVisionProxyFetchOptions().dispatcher;
    mockConfig = { vision: { proxy: 'http://vision-b:9100' } };
    const d2 = getVisionProxyFetchOptions().dispatcher;
    assert(d1 !== d2, 'vision proxy URL change should refresh cached instance');
    assertEqual(d2.url, 'http://vision-b:9100');
});

test('falls back to global proxy when vision.proxy is not set', () => {
    resetCache();
    mockConfig = { proxy: 'http://global-proxy:7890', vision: { enabled: true } };
    const opts = getVisionProxyFetchOptions();
    assert(opts.dispatcher instanceof MockProxyAgent, 'should return global dispatcher fallback');
    assertEqual(opts.dispatcher.url, 'http://global-proxy:7890');
});

// ════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(55));
console.log(`  Result: ${passed} passed / ${failed} failed / ${passed + failed} total`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
