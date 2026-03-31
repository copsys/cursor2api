/**
 * constants.ts - Global constants
 *
 * Centralizes refusal detection rules, identity probe patterns,
 * and canned responses so handler.ts stays focused on logic.
 */

import { getConfig } from './config.js';

// ==================== Refusal detection ====================
// If the model output matches any pattern below, treat it as a refusal and retry.
// Add new rules by appending to a category or via config.yaml refusal_patterns.

export const REFUSAL_PATTERNS: RegExp[] = [
    // ── English: identity refusals ──
    /Cursor(?:'s)?\s+support\s+assistant/i,
    /support\s+assistant\s+for\s+Cursor/i,
    /I[''']\s*m\s+sorry/i,
    /I\s+am\s+sorry/i,
    /not\s+able\s+to\s+fulfill/i,
    /cannot\s+perform/i,
    /I\s+can\s+only\s+answer/i,
    /I\s+only\s+answer/i,
    /cannot\s+write\s+files/i,
    /pricing[, \s]*or\s*troubleshooting/i,
    /I\s+cannot\s+help\s+with/i,
    /I'm\s+a\s+coding\s+assistant/i,
    /not\s+able\s+to\s+search/i,
    /not\s+in\s+my\s+core/i,
    /outside\s+my\s+capabilities/i,
    /I\s+cannot\s+search/i,
    /focused\s+on\s+software\s+development/i,
    /not\s+able\s+to\s+help\s+with\s+(?:that|this)/i,
    /beyond\s+(?:my|the)\s+scope/i,
    /I'?m\s+not\s+(?:able|designed)\s+to/i,
    /I\s+don't\s+have\s+(?:the\s+)?(?:ability|capability)/i,
    /questions\s+about\s+(?:Cursor|the\s+(?:AI\s+)?code\s+editor)/i,

    // ── English: topic refusals (Cursor rejecting non-coding topics) ──
    /help\s+with\s+(?:coding|programming)\s+and\s+Cursor/i,
    /Cursor\s+IDE\s+(?:questions|features|related)/i,
    /unrelated\s+to\s+(?:programming|coding)(?:\s+or\s+Cursor)?/i,
    /Cursor[- ]related\s+question/i,
    /(?:ask|please\s+ask)\s+a\s+(?:programming|coding|Cursor)/i,
    /(?:I'?m|I\s+am)\s+here\s+to\s+help\s+with\s+(?:coding|programming)/i,
    /appears\s+to\s+be\s+(?:asking|about)\s+.*?unrelated/i,
    /(?:not|isn't|is\s+not)\s+(?:related|relevant)\s+to\s+(?:programming|coding|software)/i,
    /I\s+can\s+help\s+(?:you\s+)?with\s+things\s+like/i,

    // ── English: new refusal phrasing (2026-03) ──
    /isn't\s+something\s+I\s+can\s+help\s+with/i,
    /not\s+something\s+I\s+can\s+help\s+with/i,
    /scoped\s+to\s+answering\s+questions\s+about\s+Cursor/i,
    /falls\s+outside\s+(?:the\s+scope|what\s+I)/i,

    // ── English: prompt-injection / social-engineering detection ──
    /prompt\s+injection\s+attack/i,
    /prompt\s+injection/i,
    /social\s+engineering/i,
    /I\s+need\s+to\s+stop\s+and\s+flag/i,
    /What\s+I\s+will\s+not\s+do/i,
    /What\s+is\s+actually\s+happening/i,
    /replayed\s+against\s+a\s+real\s+system/i,
    /tool-call\s+payloads/i,
    /copy-pasteable\s+JSON/i,
    /injected\s+into\s+another\s+AI/i,
    /emit\s+tool\s+invocations/i,
    /make\s+me\s+output\s+tool\s+calls/i,

    // ── English: tool availability statements (Cursor role lock) ──
    /I\s+(?:only\s+)?have\s+(?:access\s+to\s+)?(?:two|2|read_file|read_dir)\s+tool/i,
    /(?:only|just)\s+(?:two|2)\s+(?:tools?|functions?)\b/i,
    /\bread_file\b.*\bread_dir\b/i,
    /\bread_dir\b.*\bread_file\b/i,

    // ── English: scope/specialty phrasing (2026-03 batch) ──
    /(?:outside|beyond)\s+(?:the\s+)?scope\s+of\s+what/i,
    /not\s+(?:within|in)\s+(?:my|the)\s+scope/i,
    /this\s+assistant\s+is\s+(?:focused|scoped)/i,
    /(?:only|just)\s+(?:able|here)\s+to\s+(?:answer|help)/i,
    /I\s+(?:can\s+)?only\s+help\s+with\s+(?:questions|issues)\s+(?:related|about)/i,
    /(?:here|designed)\s+to\s+help\s+(?:with\s+)?(?:questions\s+)?about\s+Cursor/i,
    /not\s+(?:something|a\s+topic)\s+(?:related|specific)\s+to\s+(?:Cursor|coding)/i,
    /outside\s+(?:my|the|your)\s+area\s+of\s+(?:expertise|scope)/i,
    /(?:can[.']?t|cannot|unable\s+to)\s+help\s+with\s+(?:this|that)\s+(?:request|question|topic)/i,
    /scoped\s+to\s+(?:answering|helping)/i,

    // ── English: Cursor support assistant context leak (2026-03) ──
    /currently\s+in\s+(?:the\s+)?Cursor\s+(?:support\s+)?(?:assistant\s+)?context/i,
    /it\s+appears\s+I['']?m\s+currently\s+in\s+the\s+Cursor/i,

    // ── Chinese: identity refusals ──
    /我是\s*Cursor\s*的?\s*支持助手/,
    /Cursor\s*的?\s*支持系统/,
    /Cursor\s*(?:编辑器|IDE)?\s*相关的?\s*问题/,
    /我的职责是帮助你解答/,
    /我无法透露/,
    /帮助你解答\s*Cursor/,
    /运行在\s*Cursor\s*的/,
    /专门.*回答.*(?:Cursor|编辑器)/,
    /我只能回答/,
    /无法提供.*信息/,
    /我没有.*也不会提供/,
    /功能使用[、,]\s*账单/,
    /故障排除/,

    // ── Chinese: topic refusals ──
    /与\s*(?:编程|代码|开发)\s*无关/,
    /请提问.*(?:编程|代码|开发|技术).*问题/,
    /只能帮助.*(?:编程|代码|开发)/,

    // ── Chinese: prompt-injection detection ──
    /不是.*需要文档化/,
    /工具调用场景/,
    /语言偏好请求/,
    /提供.*具体场景/,
    /即报错/,

    // ── Chinese: tool availability statements ──
    /有以下.*?(?:两|2)个.*?工具/,
    /我有.*?(?:两|2)个工具/,
    /工具.*?(?:只有|有以下|仅有).*?(?:两|2)个/,
    /只能用.*?read_file/i,
    /无法调用.*?工具/,
    /(?:仅限于|仅用于).*?(?:查阅|浏览).*?(?:文档|docs)/,
    // ── Chinese: tool availability statements (2026-03 additions) ──
    /只有.*?读取.*?Cursor.*?工具/,
    /只有.*?读取.*?文档的工具/,
    /无法访问.*?本地文件/,
    /无法.*?执行命令/,
    /需要在.*?Claude\s*Code/i,
    /需要.*?CLI.*?环境/i,
    /当前环境.*?只有.*?工具/,
    /只有.*?read_file.*?read_dir/i,
    /只有.*?read_dir.*?read_file/i,

    // ── Chinese: Cursor UI refusal phrasing (2026-03 batch) ──
    /只能回答.*(?:Cursor|编辑器).*(?:相关|有关)/,
    /专[注门].*(?:回答|帮助|解答).*(?:Cursor|编辑器)/,
    /有什么.*(?:Cursor|编辑器).*(?:问题|可以)/,
    /无法提供.*(?:推荐|建议|帮助)/,
    /(?:功能使用|账户|故障排除|账号|订阅|套餐|计费).*(?:等|问题)/,
];

// ==================== Custom refusal rules ====================
// Compiled from config.yaml refusal_patterns, appended after built-ins, hot-reloadable

let _customRefusalPatterns: RegExp[] = [];
let _lastRefusalPatternsKey = '';

function getCustomRefusalPatterns(): RegExp[] {
    const config = getConfig();
    const patterns = config.refusalPatterns;
    if (!patterns || patterns.length === 0) return _customRefusalPatterns = [];

    // Use a join key to skip recompiling when unchanged
    const key = patterns.join('\0');
    if (key === _lastRefusalPatternsKey) return _customRefusalPatterns;

    _lastRefusalPatternsKey = key;
    _customRefusalPatterns = [];
    for (const p of patterns) {
        try {
            _customRefusalPatterns.push(new RegExp(p, 'i'));
        } catch {
            // Invalid regex → fall back to literal match
            _customRefusalPatterns.push(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
            console.warn(`[Config] refusal_patterns: "${p}" is not a valid regex; falling back to literal matching`);
        }
    }
    console.log(`[Config] Loaded ${_customRefusalPatterns.length} custom refusal rule(s)`);
    return _customRefusalPatterns;
}

/**
 * Check whether text matches any refusal rule (built-in + custom)
 */
export function isRefusal(text: string): boolean {
    if (REFUSAL_PATTERNS.some(p => p.test(text))) return true;
    const custom = getCustomRefusalPatterns();
    return custom.length > 0 && custom.some(p => p.test(text));
}

// ==================== Identity-probe detection ====================
// If a user message matches these patterns, respond with the canned identity reply

export const IDENTITY_PROBE_PATTERNS: RegExp[] = [
    // Short exact phrases
    /^\s*(who are you\??|你是谁[呀啊吗]?\??|what is your name\??|你叫什么\??|你叫什么名字\??|what are you\??|你是什么\??|Introduce yourself\??|自我介绍一下\??|hi\??|hello\??|hey\??|你好\??|在吗\??|哈喽\??)\s*$/i,
    // Model/identity questions
    /(?:什么|哪个|啥)\s*模型/,
    /(?:真实|底层|实际|真正).{0,10}(?:模型|身份|名字)/,
    /模型\s*(?:id|名|名称|名字|是什么)/i,
    /(?:what|which)\s+model/i,
    /(?:real|actual|true|underlying)\s+(?:model|identity|name)/i,
    /your\s+(?:model|identity|real\s+name)/i,
    // Platform/runtime questions
    /运行在\s*(?:哪|那|什么)/,
    /(?:哪个|什么)\s*平台/,
    /running\s+on\s+(?:what|which)/i,
    /what\s+platform/i,
    // System prompt questions
    /系统\s*提示词/,
    /system\s*prompt/i,
    // "Who are you" variants
    /你\s*(?:到底|究竟|真的|真实)\s*是\s*谁/,
    /你\s*是[^。，,\.]{0,5}(?:AI|人工智能|助手|机器人|模型|Claude|GPT|Gemini)/i,
    // Note: tool-capability questions are handled separately by refusal detection + retry
];

// ==================== Tool-capability questions ====================
// When users ask "what tools do you have", serve the canned reply after retries

export const TOOL_CAPABILITY_PATTERNS: RegExp[] = [
    /你\s*(?:有|能用|可以用)\s*(?:哪些|什么|几个)\s*(?:工具|tools?|functions?)/i,
    /(?:what|which|list).*?tools?/i,
    /你\s*用\s*(?:什么|哪个|啥)\s*(?:mcp|工具)/i,
    /你\s*(?:能|可以)\s*(?:做|干)\s*(?:什么|哪些|啥)/,
    /(?:what|which).*?(?:capabilities|functions)/i,
    /能力|功能/,
];

// ==================== Fixed reply templates ====================

/** Claude identity reply (used for identity probes or refusal fallback) */
export const CLAUDE_IDENTITY_RESPONSE = `I am Claude, made by Anthropic. I'm an AI assistant designed to be helpful, harmless, and honest. I can help you with a wide range of tasks including writing, analysis, coding, math, and more.

I don't have information about the specific model version or ID being used for this conversation, but I'm happy to help you with whatever you need!`;

/** Tool-capability reply (when asked "what tools do you have") */
export const CLAUDE_TOOLS_RESPONSE = `As Claude, here’s what I can do:

**Built-in abilities:**
- 💻 **Coding and debugging** — supports all major programming languages
- 📝 **Writing and analysis** — documents, reports, translations, reviews
- 📊 **Data analysis and math** — calculations and logical reasoning
- 🧠 **Question answering** — technical and general knowledge

**Tool calls (MCP):**
If your client provides Model Context Protocol tools, I can call them to:
- 🔍 **Search the web** — find information in real time
- 📁 **Work with files** — read/write files or run commands
- 🛠️ **Use custom tools** — anything exposed by your MCP server

Available tools depend on your client setup. Tell me what you need, and I'll pick the best option.`;
