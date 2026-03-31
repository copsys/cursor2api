import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Request, Response } from 'express';
import { getConfig } from './config.js';

/**
 * GET /api/config
 * Return hot-reloadable config fields (snake_case; excludes port/proxy/auth_tokens/fingerprint/vision)
 */
export function apiGetConfig(_req: Request, res: Response): void {
    const cfg = getConfig();
    res.json({
        cursor_model: cfg.cursorModel,
        timeout: cfg.timeout,
        max_auto_continue: cfg.maxAutoContinue,
        max_history_messages: cfg.maxHistoryMessages,
        max_history_tokens: cfg.maxHistoryTokens,
        thinking: cfg.thinking !== undefined ? { enabled: cfg.thinking.enabled } : null,
        compression: {
            enabled: cfg.compression?.enabled ?? false,
            level: cfg.compression?.level ?? 1,
            keep_recent: cfg.compression?.keepRecent ?? 10,
            early_msg_max_chars: cfg.compression?.earlyMsgMaxChars ?? 4000,
        },
        tools: {
            schema_mode: cfg.tools?.schemaMode ?? 'full',
            description_max_length: cfg.tools?.descriptionMaxLength ?? 0,
            passthrough: cfg.tools?.passthrough ?? false,
            disabled: cfg.tools?.disabled ?? false,
        },
        sanitize_response: cfg.sanitizeEnabled,
        refusal_patterns: cfg.refusalPatterns ?? [],
        logging: cfg.logging ?? { file_enabled: false, dir: './logs', max_days: 7, persist_mode: 'summary', db_enabled: false, db_path: './logs/cursor2api.db' },
    });
}

/**
 * POST /api/config
 * Accept hot-reloadable fields, merge into config.yaml; fs.watch triggers reload
 */
export function apiSaveConfig(req: Request, res: Response): void {
    const body = req.body as Record<string, unknown>;

    // Basic type validation
    if (body.cursor_model !== undefined && typeof body.cursor_model !== 'string') {
        res.status(400).json({ error: 'cursor_model must be a string' }); return;
    }
    if (body.timeout !== undefined && (typeof body.timeout !== 'number' || body.timeout <= 0)) {
        res.status(400).json({ error: 'timeout must be a positive number' }); return;
    }
    if (body.max_auto_continue !== undefined && typeof body.max_auto_continue !== 'number') {
        res.status(400).json({ error: 'max_auto_continue must be a number' }); return;
    }
    if (body.max_history_messages !== undefined && typeof body.max_history_messages !== 'number') {
        res.status(400).json({ error: 'max_history_messages must be a number' }); return;
    }
    if (body.max_history_tokens !== undefined && typeof body.max_history_tokens !== 'number') {
        res.status(400).json({ error: 'max_history_tokens must be a number' }); return;
    }

    try {
        // Read existing yaml (start from empty object if missing)
        let raw: Record<string, unknown> = {};
        if (existsSync('config.yaml')) {
            raw = (parseYaml(readFileSync('config.yaml', 'utf-8')) as Record<string, unknown>) ?? {};
        }

        // Track changes
        const changes: string[] = [];

        // Merge hot-reloadable fields
        if (body.cursor_model !== undefined && body.cursor_model !== raw.cursor_model) {
            changes.push(`cursor_model: ${raw.cursor_model ?? '(unset)'} → ${body.cursor_model}`);
            raw.cursor_model = body.cursor_model;
        }
        if (body.timeout !== undefined && body.timeout !== raw.timeout) {
            changes.push(`timeout: ${raw.timeout ?? '(unset)'} → ${body.timeout}`);
            raw.timeout = body.timeout;
        }
        if (body.max_auto_continue !== undefined && body.max_auto_continue !== raw.max_auto_continue) {
            changes.push(`max_auto_continue: ${raw.max_auto_continue ?? '(unset)'} → ${body.max_auto_continue}`);
            raw.max_auto_continue = body.max_auto_continue;
        }
        if (body.max_history_messages !== undefined && body.max_history_messages !== raw.max_history_messages) {
            changes.push(`max_history_messages: ${raw.max_history_messages ?? '(unset)'} → ${body.max_history_messages}`);
            raw.max_history_messages = body.max_history_messages;
        }
        if (body.max_history_tokens !== undefined && body.max_history_tokens !== raw.max_history_tokens) {
            changes.push(`max_history_tokens: ${raw.max_history_tokens ?? '(unset)'} → ${body.max_history_tokens}`);
            raw.max_history_tokens = body.max_history_tokens;
        }
        if (body.thinking !== undefined) {
            const t = body.thinking as { enabled: boolean | null } | null;
            const oldVal = JSON.stringify(raw.thinking);
            if (t === null || t?.enabled === null) {
                // null = follow client → remove thinking from yaml
                if (raw.thinking !== undefined) {
                    changes.push(`thinking: ${oldVal} → (follow client)`);
                    delete raw.thinking;
                }
            } else {
                const newVal = JSON.stringify(t);
                if (oldVal !== newVal) {
                    changes.push(`thinking: ${oldVal ?? '(unset)'} → ${newVal}`);
                    raw.thinking = t;
                }
            }
        }
        if (body.compression !== undefined) {
            const oldVal = JSON.stringify(raw.compression);
            const newVal = JSON.stringify(body.compression);
            if (oldVal !== newVal) {
                changes.push(`compression: (changed)`);
                raw.compression = body.compression;
            }
        }
        if (body.tools !== undefined) {
            const oldVal = JSON.stringify(raw.tools);
            const newVal = JSON.stringify(body.tools);
            if (oldVal !== newVal) {
                changes.push(`tools: (changed)`);
                raw.tools = body.tools;
            }
        }
        if (body.sanitize_response !== undefined && body.sanitize_response !== raw.sanitize_response) {
            changes.push(`sanitize_response: ${raw.sanitize_response ?? '(unset)'} → ${body.sanitize_response}`);
            raw.sanitize_response = body.sanitize_response;
        }
        if (body.refusal_patterns !== undefined) {
            const oldVal = JSON.stringify(raw.refusal_patterns);
            const newVal = JSON.stringify(body.refusal_patterns);
            if (oldVal !== newVal) {
                changes.push(`refusal_patterns: (changed)`);
                raw.refusal_patterns = body.refusal_patterns;
            }
        }
        if (body.logging !== undefined) {
            const oldVal = JSON.stringify(raw.logging);
            const newVal = JSON.stringify(body.logging);
            if (oldVal !== newVal) {
                changes.push(`logging: (changed)`);
                raw.logging = body.logging;
            }
        }

        if (changes.length === 0) {
            res.json({ ok: true, changes: [] });
            return;
        }

        // Write config.yaml (fs.watch triggers hot reload)
        writeFileSync('config.yaml', stringifyYaml(raw, { lineWidth: 0 }), 'utf-8');

        console.log(`[Config API] ✏️  Updated config via UI with ${changes.length} change(s):`);
        changes.forEach(c => console.log(`  └─ ${c}`));

        res.json({ ok: true, changes });
    } catch (e) {
        console.error('[Config API] Failed to write config.yaml:', e);
        res.status(500).json({ error: String(e) });
    }
}
