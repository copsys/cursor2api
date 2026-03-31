// ==================== Anthropic API Types ====================

export interface AnthropicRequest {
    model: string;
    messages: AnthropicMessage[];
    max_tokens: number;
    stream?: boolean;
    system?: string | AnthropicContentBlock[];
    tools?: AnthropicTool[];
    tool_choice?: AnthropicToolChoice;
    temperature?: number;
    top_p?: number;
    stop_sequences?: string[];
    thinking?: { type: 'enabled' | 'disabled' | 'adaptive'; budget_tokens?: number };
}

/** tool_choice controls whether the model must call a tool
 *  - auto: model decides (default)
 *  - any:  must call at least one tool
 *  - tool: must call the specified tool
 */
export type AnthropicToolChoice =
    | { type: 'auto' }
    | { type: 'any' }
    | { type: 'tool'; name: string };

export interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
    type: 'text' | 'tool_use' | 'tool_result' | 'image';
    text?: string;
    // image fields
    source?: { type: string; media_type?: string; data: string; url?: string };
    // tool_use fields
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    // tool_result fields
    tool_use_id?: string;
    content?: string | AnthropicContentBlock[];
    is_error?: boolean;
}

export interface AnthropicTool {
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
}

export interface AnthropicResponse {
    id: string;
    type: 'message';
    role: 'assistant';
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: string;
    stop_sequence: string | null;
    usage: { input_tokens: number; output_tokens: number };
}

// ==================== Cursor API Types ====================

export interface CursorChatRequest {
    context?: CursorContext[];
    model: string;
    id: string;
    messages: CursorMessage[];
    trigger: string;
}

export interface CursorContext {
    type: string;
    content: string;
    filePath: string;
}

export interface CursorMessage {
    parts: CursorPart[];
    id: string;
    role: string;
}

export interface CursorPart {
    type: string;
    text: string;
}

export interface CursorSSEEvent {
    type: string;
    delta?: string;
    finishReason?: string;
    messageMetadata?: {
        usage?: {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
        };
    };
}

// ==================== Internal Types ====================

export interface ParsedToolCall {
    name: string;
    arguments: Record<string, unknown>;
}

export interface AppConfig {
    port: number;
    timeout: number;
    proxy?: string;
    cursorModel: string;
    authTokens?: string[];  // API auth token list; empty → no auth
    maxAutoContinue: number;        // Max automatic continuation attempts; default 3; 0 disables
    maxHistoryMessages: number;     // Hard limit for history message count; default -1 (unlimited)
    maxHistoryTokens: number;       // History token cap (tiktoken estimate plus Cursor overhead ~1300 + per-tool cost); default 150000; -1 unlimited
    vision?: {
        enabled: boolean;
        mode: 'ocr' | 'api';
        baseUrl: string;
        apiKey: string;
        model: string;
        proxy?: string;  // dedicated proxy for vision; does not affect Cursor API direct calls
    };
    compression?: {
        enabled: boolean;          // Enable history compression
        level: 1 | 2 | 3;         // Compression level: 1=light, 2=medium (default), 3=aggressive
        keepRecent: number;        // Keep the most recent N messages uncompressed
        earlyMsgMaxChars: number;  // Max characters for early messages
    };
    thinking?: {
        enabled: boolean;          // Force thinking on/off (highest priority over client)
    };
    logging?: {
        file_enabled: boolean;     // Persist logs to files
        dir: string;               // Log directory
        max_days: number;          // Log retention days
        persist_mode: 'compact' | 'full' | 'summary'; // Storage mode: compact/full/summary
        db_enabled: boolean;       // Persist logs to SQLite
        db_path: string;           // SQLite path; default './logs/cursor2api.db'
    };
    tools?: {
        schemaMode: 'compact' | 'full' | 'names_only';  // Schema rendering mode
        descriptionMaxLength: number;                     // Description truncation length (0 = full)
        includeOnly?: string[];                           // Whitelist: only keep these tool names
        exclude?: string[];                               // Blacklist: exclude these tool names
        passthrough?: boolean;                            // Passthrough: skip few-shot injection and embed raw tool definitions
        disabled?: boolean;                               // Disable: do not inject tool definitions to maximize context space
        adaptiveBudget?: boolean;                         // Adaptive history budget based on tool count
        smartTruncation?: boolean;                        // Smart truncation tuned per tool type (Read/Bash/Search strategies)
    };
    sanitizeEnabled: boolean;    // Clean responses to strip Cursor identity (default false)
    contextPressure?: number;    // Context pressure inflation factor (default 1.35) to nudge clients to compress earlier
    refusalPatterns?: string[];  // Custom refusal detection rules appended to built-ins
    fingerprint: {
        userAgent: string;
    };
}
