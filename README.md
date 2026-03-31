# Cursor2API v2.7.8

Proxy the free Cursor Docs AI endpoint into the Anthropic Messages API and an OpenAI-compatible API so Claude Code, Cursor IDE, and other OpenAI clients can talk to Cursor’s backend seamlessly.

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ Claude Code  │────▶│              │────▶│              │
│ (Anthropic)  │     │  cursor2api  │     │  Cursor API  │
│              │◀────│  (proxy+fx)  │◀────│  /api/chat   │
└─────────────┘     └──────────────┘     └──────────────┘
       ▲                    ▲
       │                    │
┌──────┴──────┐     ┌──────┴──────┐
│  Cursor IDE  │     │ OpenAI chat │
│(/v1/responses│     │(/v1/chat/   │
│ + Agent mode)│     │ completions)│
└─────────────┘     └─────────────┘
```

Requests from Anthropic or OpenAI clients are translated into Cursor’s `/api/chat` format, streamed, post-processed (tool parsing, truncation recovery, refusal handling, identity cleaning), and then emitted back in the client’s native shape.

## Key Capabilities

- Anthropic Messages API compatibility for `/v1/messages`, streaming and non‑streaming.
- OpenAI Chat Completions compatibility for `/v1/chat/completions`.
- Cursor IDE Agent mode support for `/v1/responses` with flat tool format and incremental tool deltas.
- Logging UI (HTML + Vue3) for full request/response/tool-call timelines; optional auth.
- Auth tokens for public deployments (Bearer or `x-api-key`).
- Thinking blocks and `response_format` (`json_object` / `json_schema`) support.
- Dynamic tool result truncation and adaptive history budgeting to minimize `max_output_tokens` truncation.
- Context pressure inflation to nudge clients to compress earlier.
- Schema compression for tools (compact signatures) and optional passthrough/disable modes.
- Identity protection: refusal detection, identity probes, and response sanitization.
- Vision support with optional per-vision proxy and OCR/API fallback.
- Token counting endpoint and OpenAI-compatible model listing.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a config:
   ```bash
   cp config.yaml.example config.yaml
   ```
3. Start the server:
   ```bash
   npm run build && npm start
   ```

## Configuration Highlights (`config.yaml`)

- `port`: server port (default `3010`)
- `timeout`: idle timeout in seconds (default `120`)
- `cursor_model`: target model for Cursor (default `anthropic/claude-sonnet-4.6`)
- `proxy`: optional upstream proxy; `PROXY` env var overrides
- `auth_tokens`: list of API tokens; when set, all POST routes require Bearer/`x-api-key`
- `thinking.enabled`: force thinking on/off (overrides client)
- `compression`: enable history compression with levels `1` (light)–`3` (aggressive)
- `tools`: schema mode (`compact`/`full`/`names_only`), description length limit, whitelist/blacklist, passthrough, disable, adaptive budget, smart truncation
- `sanitize_response`: clean Cursor identity leaks (also via `SANITIZE_RESPONSE`)
- `context_pressure`: inflate reported `input_tokens` to trigger client-side compression sooner
- `logging`: file/SQLite persistence and retention settings
- `vision`: OCR/API mode, endpoint, key, model, optional dedicated proxy

See `config.ts` for full env overrides; env vars always have highest priority.

## Endpoints

- `POST /v1/messages` and `/messages` — Anthropic Messages API
- `POST /v1/chat/completions` and `/chat/completions` — OpenAI-compatible chat
- `POST /v1/responses` and `/responses` — Cursor IDE Agent mode
- `POST /v1/messages/count_tokens` — token estimation for inputs
- `GET /v1/models` — model listing for OpenAI clients
- `GET /health` — health check
- `GET /logs` — HTML log viewer (token-protected if `auth_tokens` set)
- `GET /vuelogs` — Vue3 log UI (auth handled in the app)

## Logging UI

Static assets live under `public/`. Vue3 UI is under `vue-ui/` and served via `/vuelogs`. When `auth_tokens` is configured, `/logs` and the API routes `/api/logs`, `/api/requests`, `/api/stats`, etc., require a token (query `?token=` or `Authorization` / `x-api-key`).

## Development

- Build: `npm run build`
- Unit tests: `npm run test:all`
- Agentic/e2e tests: `npm run test:e2e`, `npm run test:agentic`

## Deployment

- Docker: see `Dockerfile` and `docker-compose.yml`.
- Persist logs by enabling file or SQLite logging in `config.yaml`.

## Notes

- Response sanitization and refusal detection rules are defined in `src/constants.ts`.
- Tool parsing, truncation recovery, and continuation logic live in `src/handler.ts` and `src/converter.ts`.
- Vision handling and proxy settings are in `src/vision.ts` and `src/proxy-agent.ts`.

