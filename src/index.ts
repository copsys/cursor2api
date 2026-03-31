/**
 * Cursor2API v2 - Entry point
 *
 * Proxies the free Cursor Docs AI endpoint into the Anthropic Messages API
 * and injects prompts so Claude Code gains full tool-calling capabilities.
 */

import 'dotenv/config';
import { createRequire } from 'module';
import express from 'express';
import { getConfig, initConfigWatcher, stopConfigWatcher } from './config.js';
import { handleMessages, listModels, countTokens } from './handler.js';
import { handleOpenAIChatCompletions, handleOpenAIResponses } from './openai-handler.js';
import { serveLogViewer, apiGetLogs, apiGetRequests, apiGetStats, apiGetVueStats, apiGetPayload, apiLogsStream, serveLogViewerLogin, apiClearLogs, serveVueApp, apiGetRequestsMore } from './log-viewer.js';
import { apiGetConfig, apiSaveConfig } from './config-api.js';
import { loadLogsFromFiles } from './logger.js';
import { initDb } from './logger-db.js';

// Read version from package.json to keep a single source of truth
const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json') as { version: string };


const app = express();
const config = getConfig();

// Parse JSON body with a higher limit to support large base64 images (10MB+ per image)
app.use(express.json({ limit: '50mb' }));

// CORS
app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    if (_req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    next();
});

// Static assets (no auth required for CSS/JS/etc.)
app.use('/public', express.static('public'));

// Log viewer auth: require token when authTokens is configured
const logViewerAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const tokens = getConfig().authTokens;
    if (!tokens || tokens.length === 0) return next(); // no token configured → allow

    // Accept ?token=xxx, Authorization header, or x-api-key header
    const tokenFromQuery = req.query.token as string | undefined;
    const authHeader = req.headers['authorization'] || req.headers['x-api-key'];
    const tokenFromHeader = authHeader ? String(authHeader).replace(/^Bearer\s+/i, '').trim() : undefined;
    const token = tokenFromQuery || tokenFromHeader;

    if (!token || !tokens.includes(token)) {
        // HTML page → login; API → JSON error
        if (req.path === '/logs') {
            return serveLogViewerLogin(req, res);
        }
        res.status(401).json({ error: { message: 'Unauthorized. Provide token via ?token=xxx or Authorization header.', type: 'auth_error' } });
        return;
    }
    next();
};

// Log viewer routes (auth-protected)
app.get('/logs', logViewerAuth, serveLogViewer);
// Vue3 log UI (auth handled inside the Vue app)
app.get('/vuelogs', serveVueApp);
app.get('/api/logs', logViewerAuth, apiGetLogs);
app.get('/api/requests/more', logViewerAuth, apiGetRequestsMore);
app.get('/api/requests', logViewerAuth, apiGetRequests);
app.get('/api/stats', logViewerAuth, apiGetStats);
app.get('/api/vue/stats', logViewerAuth, apiGetVueStats);
app.get('/api/payload/:requestId', logViewerAuth, apiGetPayload);
app.get('/api/logs/stream', logViewerAuth, apiLogsStream);
app.post('/api/logs/clear', logViewerAuth, apiClearLogs);
app.get('/api/config', logViewerAuth, apiGetConfig);
app.post('/api/config', logViewerAuth, apiSaveConfig);

// API auth middleware: require Bearer token when authTokens is configured
app.use((req, res, next) => {
    // Allow unauthenticated GET and /health
    if (req.method === 'GET' || req.path === '/health') {
        return next();
    }
    const tokens = getConfig().authTokens;
    if (!tokens || tokens.length === 0) {
        return next(); // open access when no tokens
    }
    const authHeader = req.headers['authorization'] || req.headers['x-api-key'];
    if (!authHeader) {
        res.status(401).json({ error: { message: 'Missing authentication token. Use Authorization: Bearer <token>', type: 'auth_error' } });
        return;
    }
    const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
    if (!tokens.includes(token)) {
        console.log(`[Auth] Reject invalid token: ${token.substring(0, 8)}...`);
        res.status(403).json({ error: { message: 'Invalid authentication token', type: 'auth_error' } });
        return;
    }
    next();
});

// ==================== Routes ====================

// Anthropic Messages API
app.post('/v1/messages', handleMessages);
app.post('/messages', handleMessages);

// OpenAI Chat Completions API (compatible)
app.post('/v1/chat/completions', handleOpenAIChatCompletions);
app.post('/chat/completions', handleOpenAIChatCompletions);

// OpenAI Responses API (Cursor IDE Agent mode)
app.post('/v1/responses', handleOpenAIResponses);
app.post('/responses', handleOpenAIResponses);

// Token counting
app.post('/v1/messages/count_tokens', countTokens);
app.post('/messages/count_tokens', countTokens);

// OpenAI-compatible model list
app.get('/v1/models', listModels);

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: VERSION });
});

// Root endpoint
app.get('/', (_req, res) => {
    res.json({
        name: 'cursor2api',
        version: VERSION,
        description: 'Cursor Docs AI → Anthropic & OpenAI & Cursor IDE API Proxy',
        endpoints: {
            anthropic_messages: 'POST /v1/messages',
            openai_chat: 'POST /v1/chat/completions',
            openai_responses: 'POST /v1/responses',
            models: 'GET /v1/models',
            health: 'GET /health',
            log_viewer: 'GET /logs',
            log_viewer_vue: 'GET /vuelogs',
        },
        usage: {
            claude_code: 'export ANTHROPIC_BASE_URL=http://localhost:' + config.port,
            openai_compatible: 'OPENAI_BASE_URL=http://localhost:' + config.port + '/v1',
            cursor_ide: 'OPENAI_BASE_URL=http://localhost:' + config.port + '/v1 (use Claude models)',
        },
    });
});

// ==================== Startup ====================

// Initialize SQLite when enabled
if (config.logging?.db_enabled) {
    initDb(config.logging.db_path || './logs/cursor2api.db');
}

// Load historical logs from files before listen
loadLogsFromFiles();

app.listen(config.port, () => {
    const auth = config.authTokens?.length ? `${config.authTokens.length} token(s)` : 'open';
    const logParts: string[] = [];
    if (config.logging?.file_enabled) logParts.push(`file(${config.logging.persist_mode || 'summary'}) → ${config.logging.dir}`);
    if (config.logging?.db_enabled) logParts.push(`sqlite → ${config.logging.db_path || './logs/cursor2api.db'}`);
    const logPersist = logParts.length > 0 ? logParts.join(' + ') : 'memory only';
    
    // Tools configuration summary
    const toolsCfg = config.tools;
    let toolsInfo = 'default (full, desc=full)';
    if (toolsCfg) {
        if (toolsCfg.disabled) {
            toolsInfo = '\x1b[33mdisabled\x1b[0m (skip tool definitions to save context)';
        } else if (toolsCfg.passthrough) {
            toolsInfo = '\x1b[36mpassthrough\x1b[0m (embed raw JSON)';
        } else {
            const parts: string[] = [];
            parts.push(`schema=${toolsCfg.schemaMode}`);
            parts.push(toolsCfg.descriptionMaxLength === 0 ? 'desc=full' : `desc≤${toolsCfg.descriptionMaxLength}`);
            if (toolsCfg.includeOnly?.length) parts.push(`whitelist=${toolsCfg.includeOnly.length}`);
            if (toolsCfg.exclude?.length) parts.push(`blacklist=${toolsCfg.exclude.length}`);
            toolsInfo = parts.join(', ');
        }
    }
    
    console.log('');
    console.log(`  \x1b[36m⚡ Cursor2API v${VERSION}\x1b[0m`);
    console.log(`  ├─ Server:  \x1b[32mhttp://localhost:${config.port}\x1b[0m`);
    console.log(`  ├─ Model:   ${config.cursorModel}`);
    console.log(`  ├─ Auth:    ${auth}`);
    console.log(`  ├─ Tools:   ${toolsInfo}`);
    console.log(`  ├─ Logging: ${logPersist}`);
    console.log(`  └─ Logs:    \x1b[35mhttp://localhost:${config.port}/logs\x1b[0m`);
    console.log(`  └─ Logs Vue3: \x1b[35mhttp://localhost:${config.port}/vuelogs\x1b[0m`);
    console.log('');

    // Start config.yaml hot-reload watcher
    initConfigWatcher();
});

// Graceful shutdown: stop file watcher
process.on('SIGTERM', () => {
    stopConfigWatcher();
    process.exit(0);
});
process.on('SIGINT', () => {
    stopConfigWatcher();
    process.exit(0);
});
