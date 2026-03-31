/**
 * cursor-client.ts - Cursor API client
 *
 * Responsibilities:
 * 1. Send requests to https://cursor.com/api/chat (with Chrome-like TLS headers)
 * 2. Stream-parse SSE responses
 * 3. Auto-retry (up to 2 times)
 *
 * Note: Cursor no longer validates the x-is-human token, so an empty string is fine.
 */

import type { CursorChatRequest, CursorSSEEvent } from './types.js';
import { getConfig } from './config.js';
import { getProxyFetchOptions } from './proxy-agent.js';

const CURSOR_CHAT_API = 'https://cursor.com/api/chat';

// Mimic Chrome request headers
function getChromeHeaders(): Record<string, string> {
    const config = getConfig();
    return {
        'Content-Type': 'application/json',
        'sec-ch-ua-platform': '"Windows"',
        'x-path': '/api/chat',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'x-method': 'POST',
        'sec-ch-ua-bitness': '"64"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-arch': '"x86"',
        'sec-ch-ua-platform-version': '"19.0.0"',
        'origin': 'https://cursor.com',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': 'https://cursor.com/',
        'accept-language': 'en-US,en;q=0.9',
        'priority': 'u=1, i',
        'user-agent': config.fingerprint.userAgent,
        'x-is-human': '',  // Cursor no longer validates this field
    };
}

// ==================== API requests ====================

/** Send a request to Cursor /api/chat and stream the response (with retries) */
export async function sendCursorRequest(
    req: CursorChatRequest,
    onChunk: (event: CursorSSEEvent) => void,
    externalSignal?: AbortSignal,
): Promise<void> {
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await sendCursorRequestInner(req, onChunk, externalSignal);
            return;
        } catch (err) {
            // Do not retry if the caller aborted
            if (externalSignal?.aborted) throw err;
            // Degenerate-loop abort should not be retried; existing content is valid
            if (err instanceof Error && err.message === 'DEGENERATE_LOOP_ABORTED') return;
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Cursor] Request failed (${attempt}/${maxRetries}): ${msg.substring(0, 100)}`);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 2000));
            } else {
                throw err;
            }
        }
    }
}

async function sendCursorRequestInner(
    req: CursorChatRequest,
    onChunk: (event: CursorSSEEvent) => void,
    externalSignal?: AbortSignal,
): Promise<void> {
    const headers = getChromeHeaders();

    // Detailed logging happens in handler.ts

    const config = getConfig();
    const controller = new AbortController();
    // Connect external abort signal to the internal controller
    if (externalSignal) {
        if (externalSignal.aborted) { controller.abort(); }
        else { externalSignal.addEventListener('abort', () => controller.abort(), { once: true }); }
    }

    // Idle timeout: reset whenever data arrives; abort only when no data within the configured window.
    // Prevents long outputs (long articles, many tool calls) from being killed by a fixed wall-clock timeout.
    const IDLE_TIMEOUT_MS = config.timeout * 1000; // reuse timeout as idle window
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            console.warn(`[Cursor] Idle timeout (${config.timeout}s without data); aborting request`);
            controller.abort();
        }, IDLE_TIMEOUT_MS);
    };

    // Start initial timer while waiting for the first bytes
    resetIdleTimer();

    try {
        const resp = await fetch(CURSOR_CHAT_API, {
            method: 'POST',
            headers,
            body: JSON.stringify(req),
            signal: controller.signal,
            ...getProxyFetchOptions(),
        } as any);

        if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`Cursor API error: HTTP ${resp.status} - ${body}`);
        }

        if (!resp.body) {
            throw new Error('Cursor API response has no body');
        }

        // Stream-read SSE response
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Degenerate repetition detector (#66)
        // The model can loop on tokens like </s> or </br>; track repeated deltas and abort past a threshold.
        let lastDelta = '';
        let repeatCount = 0;
        const REPEAT_THRESHOLD = 8;       // Same delta 8 times in a row → degenerate
        let degenerateAborted = false;

        // HTML token repetition: long histories can trigger repeated <br> or </s>; detect across deltas.
        let tagBuffer = '';
        let htmlRepeatAborted = false;
        const HTML_TOKEN_RE = /(<\/?[a-z][a-z0-9]*\s*\/?>|&[a-z]+;)/gi;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Reset idle timer on every chunk
            resetIdleTimer();

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (!data) continue;

                try {
                    const event: CursorSSEEvent = JSON.parse(data);

                    // Degenerate repeat detection: abort when the same short snippet repeats
                    if (event.type === 'text-delta' && event.delta) {
                        const trimmedDelta = event.delta.trim();
                        // Only check short tokens; longer repeats can be valid (e.g., repeated code lines)
                        if (trimmedDelta.length > 0 && trimmedDelta.length <= 20) {
                            if (trimmedDelta === lastDelta) {
                                repeatCount++;
                                if (repeatCount >= REPEAT_THRESHOLD) {
                                    console.warn(`[Cursor] ⚠️ Detected degenerate loop: "${trimmedDelta}" repeated ${repeatCount} times, aborting stream`);
                                    degenerateAborted = true;
                                    reader.cancel();
                                    break;
                                }
                            } else {
                                lastDelta = trimmedDelta;
                                repeatCount = 1;
                            }
                        } else {
                            // Long text or whitespace → reset counters
                            lastDelta = '';
                            repeatCount = 0;
                        }

                        // HTML token repeat detection across deltas
                        // Handles cases where tokens like <br>, </s>, &nbsp; are split across frames.
                        tagBuffer += event.delta;
                        const tagMatches = [...tagBuffer.matchAll(new RegExp(HTML_TOKEN_RE.source, 'gi'))];
                        if (tagMatches.length > 0) {
                            const lastTagMatch = tagMatches[tagMatches.length - 1];
                            tagBuffer = tagBuffer.slice(lastTagMatch.index! + lastTagMatch[0].length);
                            for (const m of tagMatches) {
                                const token = m[0].toLowerCase();
                                if (token === lastDelta) {
                                    repeatCount++;
                                    if (repeatCount >= REPEAT_THRESHOLD) {
                                        console.warn(`[Cursor] ⚠️ Detected repeated HTML token: "${token}" repeated ${repeatCount} times, aborting stream`);
                                        htmlRepeatAborted = true;
                                        reader.cancel();
                                        break;
                                    }
                                } else {
                                    lastDelta = token;
                                    repeatCount = 1;
                                }
                            }
                            if (htmlRepeatAborted) break;
                        } else if (tagBuffer.length > 20) {
                            // If no full HTML token after 20 chars, clear to avoid growth
                            tagBuffer = '';
                        }
                    }

                    onChunk(event);
                } catch {
                    // Ignore non-JSON data
                }
            }

            if (degenerateAborted || htmlRepeatAborted) break;
        }

        // Degenerate-loop abort: throw sentinel error to skip outer retries
        if (degenerateAborted) {
            throw new Error('DEGENERATE_LOOP_ABORTED');
        }
        // HTML token repetition abort: throw normal error so outer layer retries
        if (htmlRepeatAborted) {
            throw new Error('HTML_REPEAT_ABORTED');
        }

        // Handle remaining buffered data
        if (buffer.startsWith('data: ')) {
            const data = buffer.slice(6).trim();
            if (data) {
                try {
                    const event: CursorSSEEvent = JSON.parse(data);
                    onChunk(event);
                } catch { /* ignore */ }
            }
        }
    } finally {
        if (idleTimer) clearTimeout(idleTimer);
    }
}

/**
 * Send a non-streaming request and collect full response plus usage
 */
export async function sendCursorRequestFull(req: CursorChatRequest): Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }> {
    let fullText = '';
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    await sendCursorRequest(req, (event) => {
        if (event.type === 'text-delta' && event.delta) {
            fullText += event.delta;
        }
        if (event.messageMetadata?.usage) {
            usage = event.messageMetadata.usage;
        }
    });
    return { text: fullText, usage };
}
