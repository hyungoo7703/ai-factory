/**
 * Core type definitions for the AI Factory.
 *
 * The factory operates on a target git repository (the "project root") and
 * stores all state inside a `.factory/` directory at that root.
 */

export type StationKind = "ingest" | "llm" | "review" | "gate";

export type Verdict = "PASS" | "FAIL" | "WARN";

export interface BotRef {
  /** Display name shown in trace and UI. */
  name: string;
  /** Optional system-prompt persona snippet (e.g. "critical senior reviewer"). */
  persona?: string;
  /** Optional Claude Code model id (e.g. "claude-opus-4-7", "claude-haiku-4-5"). */
  model?: string;
  /** Skills to inject as context. Path relative to the project root. */
  skills?: string[];
  /** Sub-agent pool — main may delegate to these via Claude Code's Task tool. */
  subAgents?: SubAgentDef[];
}

export interface SubAgentDef {
  name: string;
  description: string;
  /** Optional skill files to inject into the sub-agent's prompt. */
  skills?: string[];
}

export interface StationDef {
  name: string;
  kind: StationKind;
  /** Markdown file with stage-specific instructions, relative to project root. */
  instructions?: string;
  bot?: BotRef;
  /** For "review" stations — what station's outputs to review. */
  reviewOf?: string;
  /** For "review" stations — minimum score (0-100) to pass. */
  passThreshold?: number;
  /** For "review" stations — max negotiation rounds. */
  maxNegotiations?: number;
  /** Run inside an isolated git worktree (recommended for code-producing stations). */
  worktree?: boolean;
  /** Required output files (relative to worktree root) that this station must produce. */
  outputs?: string[];
  /** Input artifacts from prior stations (relative to factory artifacts dir). */
  inputs?: string[];
  /** Allow LLM to search ingest data via the search_intake tool. */
  canSearchIntake?: boolean;
  /** Optional per-station budget overrides. */
  budget?: Partial<Budget>;
  /** Mark this station as optional (skippable if input is sufficient). */
  optional?: boolean;
}

export interface LineDef {
  /** Line identifier — referenced as `factory run <name>`. */
  name: string;
  description?: string;
  stations: StationDef[];
  /** Default budgets applied to the whole run. */
  budget?: Budget;
}

export interface Budget {
  tokens: number;
  costUsd: number;
  durationMin: number;
  toolCalls: number;
  /** Per-agent depth limit for sub-agent recursion. */
  subAgentMaxDepth?: number;
  /** Max number of sub-agents a main bot may spawn per station. */
  subAgentMaxCount?: number;
}

export interface RunContext {
  /** Unique id, e.g. `2026-04-28-feature-abc123`. */
  runId: string;
  /** Absolute path to the project root (the target repo). */
  projectRoot: string;
  /** Absolute path to `<projectRoot>/.factory`. */
  factoryDir: string;
  /** Absolute path to `<factoryDir>/runs/<runId>`. */
  runDir: string;
  /** The line being executed. */
  line: LineDef;
  /** Free-form input text from the user. */
  input: string;
  /** Currently registered AbortSignal for the run. */
  signal: AbortSignal;
  /** Optional intake snapshot id this run is bound to. */
  intakeId?: string;
  /** Resume mode — skip stations that already have a verdict. */
  resume: boolean;
}

export interface StationResult {
  station: string;
  status: "completed" | "failed" | "skipped" | "awaiting_human";
  verdict?: Verdict;
  score?: number;
  output?: string;
  artifacts?: string[];
  startedAt: string;
  completedAt: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  toolCalls?: number;
  /** Intake snapshot id this station referenced (if any). */
  intakeId?: string;
  /** Number of BM25 hits injected into this station's prompt. */
  intakeHits?: number;
  /** Number of times the LLM read a file under .factory/intake/ during this station. */
  intakeReadsObserved?: number;
  error?: string;
}

export interface TraceEvent {
  /** ISO timestamp. */
  ts: string;
  /** Run id. */
  runId: string;
  /** Station name (or "_meta" for run-level events). */
  station: string;
  /** Event type. */
  type:
    | "run_start"
    | "run_end"
    | "station_start"
    | "station_end"
    | "bot_start"
    | "bot_end"
    | "tool_use"
    | "tool_result"
    | "subagent_start"
    | "subagent_end"
    | "review_round"
    | "human_gate"
    | "budget_warn"
    | "budget_exhaust"
    | "error"
    | "log";
  data: Record<string, unknown>;
}

export interface IntakeSnapshot {
  id: string;
  createdAt: string;
  sources: IntakeSource[];
  summaryPath: string;
  decisionsPath: string;
  rawDir: string;
  indexPath: string;
}

export interface IntakeSource {
  path: string;
  type: "pdf" | "docx" | "md" | "txt" | "url" | "image" | "other";
  hash: string;
  chunks: number;
  bytes: number;
}

export interface IntakeChunk {
  id: string;
  source: string;
  /** e.g. "page=3" or "slide=12" or "row=8". */
  locator?: string;
  text: string;
  /** Lowercased token list — used by BM25. */
  tokens?: string[];
}

export interface SkillFile {
  name: string;
  path: string;
  content: string;
  /** Optional triggers — when input/context contains any of these, auto-include. */
  triggers?: string[];
  /** Optional agent definition embedded in frontmatter. */
  agent?: {
    name: string;
    triggers?: string[];
    inputs?: string[];
    outputs?: string[];
  };
}

export interface FactoryConfig {
  /** Default model for main bots. */
  defaultModel?: string;
  /** Default model for reviewer bots. */
  reviewerModel?: string;
  /** Force claude binary path override. */
  claudeBin?: string;
  /** Default budgets if a line does not specify. */
  budget?: Budget;
  /** Whether intake station auto-runs when input mentions docs. */
  autoIntake?: boolean;
  /** Mask patterns to redact before sending to LLM. */
  redactPatterns?: string[];
}
