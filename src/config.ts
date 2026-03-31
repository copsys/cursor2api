import { readFileSync, existsSync, watch, type FSWatcher } from 'fs';
import { parse as parseYaml } from 'yaml';
import type { AppConfig } from './types.js';

let config: AppConfig;
let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Config change callbacks
type ConfigReloadCallback = (newConfig: AppConfig, changes: string[]) => void;
const reloadCallbacks: ConfigReloadCallback[] = [];

/**
 * Register a config hot-reload callback
 */
export function onConfigReload(cb: ConfigReloadCallback): void {
    reloadCallbacks.push(cb);
}

/**
 * Parse config.yaml (raw parsing without env overrides)
 */
function parseYamlConfig(defaults: AppConfig): { config: AppConfig; raw: Record<string, unknown> | null } {
    const result = { ...defaults, fingerprint: { ...defaults.fingerprint } };
    let raw: Record<string, unknown> | null = null;

    if (!existsSync('config.yaml')) return { config: result, raw };

    try {
        const content = readFileSync('config.yaml', 'utf-8');
        const yaml = parseYaml(content);
        raw = yaml;

        if (yaml.port) result.port = yaml.port;
        if (yaml.timeout) result.timeout = yaml.timeout;
        if (yaml.proxy) result.proxy = yaml.proxy;
        if (yaml.cursor_model) result.cursorModel = yaml.cursor_model;
        if (typeof yaml.max_auto_continue === 'number') result.maxAutoContinue = yaml.max_auto_continue;
        if (typeof yaml.max_history_messages === 'number') result.maxHistoryMessages = yaml.max_history_messages;
        if (typeof yaml.max_history_tokens === 'number') result.maxHistoryTokens = yaml.max_history_tokens;
        if (yaml.fingerprint) {
            if (yaml.fingerprint.user_agent) result.fingerprint.userAgent = yaml.fingerprint.user_agent;
        }
        if (yaml.vision) {
            result.vision = {
                enabled: yaml.vision.enabled !== false,
                mode: yaml.vision.mode || 'ocr',
                baseUrl: yaml.vision.base_url || 'https://api.openai.com/v1/chat/completions',
                apiKey: yaml.vision.api_key || '',
                model: yaml.vision.model || 'gpt-4o-mini',
                proxy: yaml.vision.proxy || undefined,
            };
        }
        // API auth tokens
        if (yaml.auth_tokens) {
            result.authTokens = Array.isArray(yaml.auth_tokens)
                ? yaml.auth_tokens.map(String)
                : String(yaml.auth_tokens).split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        // History compression
        if (yaml.compression !== undefined) {
            const c = yaml.compression;
            result.compression = {
                enabled: c.enabled !== false, // default on
                level: [1, 2, 3].includes(c.level) ? c.level : 1,
                keepRecent: typeof c.keep_recent === 'number' ? c.keep_recent : 10,
                earlyMsgMaxChars: typeof c.early_msg_max_chars === 'number' ? c.early_msg_max_chars : 4000,
            };
        }
        // Thinking toggle (highest priority)
        if (yaml.thinking !== undefined) {
            result.thinking = {
                enabled: yaml.thinking.enabled !== false, // default on
            };
        }
        // Log persistence
        if (yaml.logging !== undefined) {
            const persistModes = ['compact', 'full', 'summary'];
            result.logging = {
                file_enabled: yaml.logging.file_enabled === true, // default off
                dir: yaml.logging.dir || './logs',
                max_days: typeof yaml.logging.max_days === 'number' ? yaml.logging.max_days : 7,
                persist_mode: persistModes.includes(yaml.logging.persist_mode) ? yaml.logging.persist_mode : 'summary',
                db_enabled: yaml.logging.db_enabled === true,
                db_path: yaml.logging.db_path || './logs/cursor2api.db',
            };
        }
        // Tool handling configuration
        if (yaml.tools !== undefined) {
            const t = yaml.tools;
            const validModes = ['compact', 'full', 'names_only'];
            result.tools = {
                schemaMode: validModes.includes(t.schema_mode) ? t.schema_mode : 'full',
                descriptionMaxLength: typeof t.description_max_length === 'number' ? t.description_max_length : 0,
                includeOnly: Array.isArray(t.include_only) ? t.include_only.map(String) : undefined,
                exclude: Array.isArray(t.exclude) ? t.exclude.map(String) : undefined,
                passthrough: t.passthrough === true,
                disabled: t.disabled === true,
                adaptiveBudget: t.adaptive_budget === true,    // default off
                smartTruncation: t.smart_truncation === true,   // default off
            };
        }
        // Response sanitization toggle (default off)
        if (yaml.sanitize_response !== undefined) {
            result.sanitizeEnabled = yaml.sanitize_response === true;
        }
        // Custom refusal patterns
        if (Array.isArray(yaml.refusal_patterns)) {
            result.refusalPatterns = yaml.refusal_patterns.map(String).filter(Boolean);
        }
        // Context pressure inflation factor
        if (typeof yaml.context_pressure === 'number') {
            result.contextPressure = yaml.context_pressure;
        }
    } catch (e) {
        console.warn('[Config] Failed to read config.yaml:', e);
    }

    return { config: result, raw };
}

/**
 * Apply environment-variable overrides (highest priority, not affected by hot reload)
 */
function applyEnvOverrides(cfg: AppConfig): void {
    if (process.env.PORT) cfg.port = parseInt(process.env.PORT);
    if (process.env.TIMEOUT) cfg.timeout = parseInt(process.env.TIMEOUT);
    if (process.env.PROXY) cfg.proxy = process.env.PROXY;
    if (process.env.CURSOR_MODEL) cfg.cursorModel = process.env.CURSOR_MODEL;
    if (process.env.MAX_AUTO_CONTINUE !== undefined) cfg.maxAutoContinue = parseInt(process.env.MAX_AUTO_CONTINUE);
    if (process.env.MAX_HISTORY_MESSAGES !== undefined) cfg.maxHistoryMessages = parseInt(process.env.MAX_HISTORY_MESSAGES);
    if (process.env.MAX_HISTORY_TOKENS !== undefined) cfg.maxHistoryTokens = parseInt(process.env.MAX_HISTORY_TOKENS);
    if (process.env.AUTH_TOKEN) {
        cfg.authTokens = process.env.AUTH_TOKEN.split(',').map(s => s.trim()).filter(Boolean);
    }
    // Compression overrides
    if (process.env.COMPRESSION_ENABLED !== undefined) {
        if (!cfg.compression) cfg.compression = { enabled: false, level: 1, keepRecent: 10, earlyMsgMaxChars: 4000 };
        cfg.compression.enabled = process.env.COMPRESSION_ENABLED !== 'false' && process.env.COMPRESSION_ENABLED !== '0';
    }
    if (process.env.COMPRESSION_LEVEL) {
        if (!cfg.compression) cfg.compression = { enabled: false, level: 1, keepRecent: 10, earlyMsgMaxChars: 4000 };
        const lvl = parseInt(process.env.COMPRESSION_LEVEL);
        if (lvl >= 1 && lvl <= 3) cfg.compression.level = lvl as 1 | 2 | 3;
    }
    // Thinking overrides (highest priority)
    if (process.env.THINKING_ENABLED !== undefined) {
        cfg.thinking = {
            enabled: process.env.THINKING_ENABLED !== 'false' && process.env.THINKING_ENABLED !== '0',
        };
    }
    // Logging overrides
    if (process.env.LOG_FILE_ENABLED !== undefined) {
        if (!cfg.logging) cfg.logging = { file_enabled: false, dir: './logs', max_days: 7, persist_mode: 'summary', db_enabled: false, db_path: './logs/cursor2api.db' };
        cfg.logging.file_enabled = process.env.LOG_FILE_ENABLED === 'true' || process.env.LOG_FILE_ENABLED === '1';
    }
    if (process.env.LOG_DIR) {
        if (!cfg.logging) cfg.logging = { file_enabled: false, dir: './logs', max_days: 7, persist_mode: 'summary', db_enabled: false, db_path: './logs/cursor2api.db' };
        cfg.logging.dir = process.env.LOG_DIR;
    }
    if (process.env.LOG_PERSIST_MODE) {
        if (!cfg.logging) cfg.logging = { file_enabled: false, dir: './logs', max_days: 7, persist_mode: 'summary', db_enabled: false, db_path: './logs/cursor2api.db' };
        cfg.logging.persist_mode = process.env.LOG_PERSIST_MODE === 'full'
            ? 'full'
            : process.env.LOG_PERSIST_MODE === 'summary'
                ? 'summary'
                : 'compact';
    }
    if (process.env.LOG_DB_ENABLED !== undefined) {
        if (!cfg.logging) cfg.logging = { file_enabled: false, dir: './logs', max_days: 7, persist_mode: 'summary', db_enabled: false, db_path: './logs/cursor2api.db' };
        cfg.logging.db_enabled = process.env.LOG_DB_ENABLED === 'true' || process.env.LOG_DB_ENABLED === '1';
    }
    if (process.env.LOG_DB_PATH) {
        if (!cfg.logging) cfg.logging = { file_enabled: false, dir: './logs', max_days: 7, persist_mode: 'summary', db_enabled: false, db_path: './logs/cursor2api.db' };
        cfg.logging.db_path = process.env.LOG_DB_PATH;
    }
    // Tool passthrough env override
    if (process.env.TOOLS_PASSTHROUGH !== undefined) {
        if (!cfg.tools) cfg.tools = { schemaMode: 'full', descriptionMaxLength: 0 };
        cfg.tools.passthrough = process.env.TOOLS_PASSTHROUGH === 'true' || process.env.TOOLS_PASSTHROUGH === '1';
    }
    // Tool disable env override
    if (process.env.TOOLS_DISABLED !== undefined) {
        if (!cfg.tools) cfg.tools = { schemaMode: 'full', descriptionMaxLength: 0 };
        cfg.tools.disabled = process.env.TOOLS_DISABLED === 'true' || process.env.TOOLS_DISABLED === '1';
    }
    // Adaptive history budget env override
    if (process.env.TOOLS_ADAPTIVE_BUDGET !== undefined) {
        if (!cfg.tools) cfg.tools = { schemaMode: 'full', descriptionMaxLength: 0 };
        cfg.tools.adaptiveBudget = process.env.TOOLS_ADAPTIVE_BUDGET !== 'false' && process.env.TOOLS_ADAPTIVE_BUDGET !== '0';
    }
    // Smart truncation env override
    if (process.env.TOOLS_SMART_TRUNCATION !== undefined) {
        if (!cfg.tools) cfg.tools = { schemaMode: 'full', descriptionMaxLength: 0 };
        cfg.tools.smartTruncation = process.env.TOOLS_SMART_TRUNCATION !== 'false' && process.env.TOOLS_SMART_TRUNCATION !== '0';
    }

    // Response sanitization env override
    if (process.env.SANITIZE_RESPONSE !== undefined) {
        cfg.sanitizeEnabled = process.env.SANITIZE_RESPONSE === 'true' || process.env.SANITIZE_RESPONSE === '1';
    }
    // Context pressure inflation override
    if (process.env.CONTEXT_PRESSURE !== undefined) {
        cfg.contextPressure = parseFloat(process.env.CONTEXT_PRESSURE);
    }

    // Parse fingerprint from base64 FP env var
    if (process.env.FP) {
        try {
            const fp = JSON.parse(Buffer.from(process.env.FP, 'base64').toString());
            if (fp.userAgent) cfg.fingerprint.userAgent = fp.userAgent;
        } catch (e) {
            console.warn('[Config] Failed to parse FP environment variable:', e);
        }
    }
}

/**
 * Build default configuration
 */
function defaultConfig(): AppConfig {
    return {
        port: 3010,
        timeout: 120,
        cursorModel: 'anthropic/claude-sonnet-4.6',
        maxAutoContinue: 0,
        maxHistoryMessages: -1,
        maxHistoryTokens: 150000,
        sanitizeEnabled: false,  // response sanitization off by default
        fingerprint: {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        },
    };
}

/**
 * Detect configuration changes and return descriptions
 */
function detectChanges(oldCfg: AppConfig, newCfg: AppConfig): string[] {
    const changes: string[] = [];

    if (oldCfg.port !== newCfg.port) changes.push(`port: ${oldCfg.port} → ${newCfg.port}`);
    if (oldCfg.timeout !== newCfg.timeout) changes.push(`timeout: ${oldCfg.timeout} → ${newCfg.timeout}`);
    if (oldCfg.proxy !== newCfg.proxy) changes.push(`proxy: ${oldCfg.proxy || '(none)'} → ${newCfg.proxy || '(none)'}`);
    if (oldCfg.cursorModel !== newCfg.cursorModel) changes.push(`cursor_model: ${oldCfg.cursorModel} → ${newCfg.cursorModel}`);
    if (oldCfg.maxAutoContinue !== newCfg.maxAutoContinue) changes.push(`max_auto_continue: ${oldCfg.maxAutoContinue} → ${newCfg.maxAutoContinue}`);
    if (oldCfg.maxHistoryMessages !== newCfg.maxHistoryMessages) changes.push(`max_history_messages: ${oldCfg.maxHistoryMessages} → ${newCfg.maxHistoryMessages}`);
    if (oldCfg.maxHistoryTokens !== newCfg.maxHistoryTokens) changes.push(`max_history_tokens: ${oldCfg.maxHistoryTokens} → ${newCfg.maxHistoryTokens}`);

    // auth_tokens
    const oldTokens = (oldCfg.authTokens || []).join(',');
    const newTokens = (newCfg.authTokens || []).join(',');
    if (oldTokens !== newTokens) changes.push(`auth_tokens: ${oldCfg.authTokens?.length || 0} → ${newCfg.authTokens?.length || 0} token(s)`);

    // thinking
    if (JSON.stringify(oldCfg.thinking) !== JSON.stringify(newCfg.thinking)) changes.push(`thinking: ${JSON.stringify(oldCfg.thinking)} → ${JSON.stringify(newCfg.thinking)}`);

    // vision
    if (JSON.stringify(oldCfg.vision) !== JSON.stringify(newCfg.vision)) changes.push('vision: (changed)');

    // compression
    if (JSON.stringify(oldCfg.compression) !== JSON.stringify(newCfg.compression)) changes.push('compression: (changed)');

    // logging
    if (JSON.stringify(oldCfg.logging) !== JSON.stringify(newCfg.logging)) changes.push('logging: (changed)');

    // tools
    if (JSON.stringify(oldCfg.tools) !== JSON.stringify(newCfg.tools)) changes.push('tools: (changed)');

    // refusalPatterns
    // sanitize_response
    if (oldCfg.sanitizeEnabled !== newCfg.sanitizeEnabled) changes.push(`sanitize_response: ${oldCfg.sanitizeEnabled} → ${newCfg.sanitizeEnabled}`);

    if (JSON.stringify(oldCfg.refusalPatterns) !== JSON.stringify(newCfg.refusalPatterns)) changes.push(`refusal_patterns: ${oldCfg.refusalPatterns?.length || 0} → ${newCfg.refusalPatterns?.length || 0} rule(s)`);

    // fingerprint
    if (oldCfg.fingerprint.userAgent !== newCfg.fingerprint.userAgent) changes.push('fingerprint: (changed)');

    return changes;
}

/**
 * Get the current configuration (single source for all modules)
 */
export function getConfig(): AppConfig {
    if (config) return config;

    // First load
    const defaults = defaultConfig();
    const { config: parsed } = parseYamlConfig(defaults);
    applyEnvOverrides(parsed);
    config = parsed;
    return config;
}

/**
 * Initialize config.yaml watcher for hot reload.
 *
 * Port changes are only warned (require restart); other fields apply on next request.
 * Env overrides always take precedence and are not affected by hot reload.
 */
export function initConfigWatcher(): void {
    if (watcher) return; // avoid duplicate watchers
    if (!existsSync('config.yaml')) {
        console.log('[Config] config.yaml not found; skip hot-reload watcher');
        return;
    }

    const DEBOUNCE_MS = 500;

    watcher = watch('config.yaml', (eventType) => {
        if (eventType !== 'change') return;

        // Debounce multiple quick writes into a single reload
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            try {
                if (!existsSync('config.yaml')) {
                    console.warn('[Config] ⚠️  config.yaml was removed; keeping current config');
                    return;
                }

                const oldConfig = config;
                const oldPort = oldConfig.port;

                // Re-parse YAML + env overrides
                const defaults = defaultConfig();
                const { config: newConfig } = parseYamlConfig(defaults);
                applyEnvOverrides(newConfig);

                // Detect changes
                const changes = detectChanges(oldConfig, newConfig);
                if (changes.length === 0) return; // no-op

                // Port changes: warn only, do not apply without restart
                if (newConfig.port !== oldPort) {
                    console.warn(`[Config] ⚠️  Detected port change (${oldPort} → ${newConfig.port}); restart required to apply`);
                    newConfig.port = oldPort; // keep existing port
                }

                // Replace global config (next getConfig() call returns the new one)
                config = newConfig;

                console.log(`[Config] 🔄 config.yaml hot-reloaded with ${changes.length} change(s):`);
                changes.forEach(c => console.log(`  └─ ${c}`));

                // Trigger callbacks
                for (const cb of reloadCallbacks) {
                    try {
                        cb(newConfig, changes);
                    } catch (e) {
                        console.warn('[Config] Hot-reload callback failed:', e);
                    }
                }
            } catch (e) {
                console.error('[Config] ❌ Hot reload failed; keeping current config:', e);
            }
        }, DEBOUNCE_MS);
    });

    // Error handling: try to recreate watcher on failure
    watcher.on('error', (err) => {
        console.error('[Config] ❌ File watch error:', err);
        watcher = null;
        // Retry after 2 seconds
        setTimeout(() => {
            console.log('[Config] 🔄 Attempting to re-establish config.yaml watcher...');
            initConfigWatcher();
        }, 2000);
    });

    console.log('[Config] 👁️  Watching config.yaml for changes (hot reload enabled)');
}

/**
 * Stop file watcher (for graceful shutdown)
 */
export function stopConfigWatcher(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    if (watcher) {
        watcher.close();
        watcher = null;
    }
}
