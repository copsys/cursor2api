/**
 * proxy-agent.ts - proxy support
 *
 * Creates an undici ProxyAgent from config.proxy or PROXY env so Node fetch()
 * can send requests through HTTP/HTTPS proxies. Native fetch does not read
 * HTTP_PROXY / HTTPS_PROXY automatically; dispatcher must be passed explicitly.
 */

import { ProxyAgent } from 'undici';
import { getConfig } from './config.js';

let cachedAgent: ProxyAgent | undefined;
let cachedVisionAgent: ProxyAgent | undefined;
let cachedProxyUrl: string | undefined;
let cachedVisionProxyUrl: string | undefined;

/**
 * Get proxy dispatcher (if configured). Undefined = direct connection.
 */
export function getProxyDispatcher(): ProxyAgent | undefined {
    const config = getConfig();
    const proxyUrl = config.proxy;

    if (!proxyUrl) return undefined;

    if (!cachedAgent || cachedProxyUrl !== proxyUrl) {
        console.log(`[Proxy] Using global proxy: ${proxyUrl}`);
        cachedProxyUrl = proxyUrl;
        cachedAgent = new ProxyAgent(proxyUrl);
    }

    return cachedAgent;
}

/**
 * Build extra fetch options (includes dispatcher).
 * Usage: fetch(url, { ...options, ...getProxyFetchOptions() })
 */
export function getProxyFetchOptions(): Record<string, unknown> {
    const dispatcher = getProxyDispatcher();
    return dispatcher ? { dispatcher } : {};
}

/**
 * Vision-specific proxy: prefer vision.proxy, otherwise fall back to global proxy.
 * Cursor API itself typically needs no proxy, but vision APIs might.
 */
export function getVisionProxyFetchOptions(): Record<string, unknown> {
    const config = getConfig();
    const visionProxy = config.vision?.proxy;

    if (visionProxy) {
        if (!cachedVisionAgent || cachedVisionProxyUrl !== visionProxy) {
            console.log(`[Proxy] Vision proxy: ${visionProxy}`);
            cachedVisionProxyUrl = visionProxy;
            cachedVisionAgent = new ProxyAgent(visionProxy);
        }
        return { dispatcher: cachedVisionAgent };
    }

    // Fallback to global proxy
    return getProxyFetchOptions();
}
