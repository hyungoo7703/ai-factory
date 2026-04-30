/**
 * BotAdapter — abstraction over the LLM execution backend.
 *
 * MVP only ships ClaudeCodeAdapter, but every call site goes through this
 * interface so v2 can add Codex/Gemini/Ollama without touching the engine.
 */

export interface BotInvocation {
  /** Display name (e.g. "main", "reviewer", "frontend-spec"). */
  name: string;
  /** Optional model identifier (passed through to the backend). */
  model?: string;
  /** Optional persona / role suffix appended to the system prompt. */
  persona?: string;
  /** Full prompt to send. */
  prompt: string;
  /** Working directory for the subprocess (typically a worktree). */
  cwd: string;
  /** Files whose contents should be appended to the system prompt as skills. */
  skillFiles?: string[];
  /** Optional system prompt prefix. */
  systemPrompt?: string;
  /** Cancellation. */
  signal?: AbortSignal;
  /** Hard timeout. */
  timeoutMs?: number;
  /** Permitted tool whitelist (backend-specific). undefined = backend default. */
  allowedTools?: string[];
  /** Tool blacklist — applied after allowedTools. Default blocks AskUserQuestion. */
  disallowedTools?: string[];
  /**
   * Permission mode for the underlying CLI. In headless `-p` mode, the default
   * mode silently denies tool calls that would normally prompt — defeating any
   * code-generating station. Adapters default to "bypassPermissions" since the
   * factory runs each code-producing station inside an isolated git worktree.
   */
  permissionMode?: "acceptEdits" | "bypassPermissions" | "default" | "plan";
  /** Disable network for safety. */
  disableNetwork?: boolean;
  /** Per-invocation budget caps. */
  maxTokens?: number;
}

export interface BotEvent {
  type:
    | "start"
    | "text"
    | "tool_use"
    | "tool_result"
    | "thinking"
    | "subagent_start"
    | "subagent_end"
    | "error"
    | "end";
  data: Record<string, unknown>;
}

export interface BotResult {
  /** Final text output. */
  content: string;
  /** Total wall-clock duration in ms. */
  durationMs: number;
  /** Approximate input token count, if known. */
  tokensIn?: number;
  /** Approximate output token count, if known. */
  tokensOut?: number;
  /** Total tool invocations observed. */
  toolCalls: number;
  /** Estimated USD cost, if known. */
  costUsd?: number;
}

export interface BotAdapter {
  /** Backend identifier for trace and logs (e.g. "claude-code"). */
  readonly id: string;
  /** Verify the backend is installed and reachable. Throws on failure. */
  health(): Promise<void>;
  /** Execute a non-streaming invocation. */
  run(invocation: BotInvocation): Promise<BotResult>;
  /** Execute a streaming invocation; yields events as they arrive. */
  runStream(
    invocation: BotInvocation,
    onEvent: (event: BotEvent) => void
  ): Promise<BotResult>;
}
