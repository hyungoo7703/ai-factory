# Architecture

AI Factory uses Claude Code as its execution engine and lays a **workflow
layer** on top. It does **not** reimplement LLM calls, file editing, or shell
execution — Claude Code owns that surface. Factory acts as the *operating
system of the factory floor*.

## Big Picture

```
┌──────────────────────────────────────────────────┐
│  Conductor (factory CLI)                          │
│  - parses line yaml                               │
│  - sequential station queue                       │
│  - budget tracking, cancellation, resume          │
│  - trace recording, memory accumulation           │
└──────────────────────────────────────────────────┘
                       │
       ┌───────────────┼─────────────────┐
       ▼               ▼                 ▼
   ┌────────┐    ┌────────────┐    ┌──────────┐
   │ ingest │    │    llm     │    │  review  │ ─→ gate
   │station │    │  station   │    │  station │
   └───┬────┘    └─────┬──────┘    └─────┬────┘
       │               │                  │
       │      ┌────────▼─────────┐        │
       │      │  Worktree (git)  │        │
       │      │  isolated branch │        │
       │      └────────┬─────────┘        │
       │               │                  │
       └───────────────▼──────────────────┘
                       │
                ┌──────▼───────┐
                │  BotAdapter  │
                │ (interface)  │
                └──────┬───────┘
                       │
              ┌────────▼─────────┐
              │ ClaudeCodeAdapter│
              │  spawn `claude`  │
              │  stream-json IO  │
              └──────────────────┘
```

## Layer Responsibilities

### Conductor — line executor

[src/core/conductor.ts](../src/core/conductor.ts)

- `RunOptions` (line, input, projectRoot) → `RunSummary`
- Creates `runDir` (`.factory/runs/<id>/`) and starts the trace
- Tracks tokens / cost / duration / tool calls via `BudgetTracker`
- Dispatches stations in declaration order
- Four termination branches: failed / cancelled / budget-exhausted /
  awaiting-human

### Station Handler — single-stage executor

| Kind | File | Role |
|------|------|------|
| `ingest` | [src/stations/ingest.ts](../src/stations/ingest.ts) | Documents → chunking → indexing → summary |
| `llm` | [src/stations/llm.ts](../src/stations/llm.ts) | Prompt assembly → bot call → output verification |
| `review` | [src/stations/review.ts](../src/stations/review.ts) | Negotiation Loop |
| `gate` | [src/stations/gate.ts](../src/stations/gate.ts) | Human approve / reject |

### BotAdapter — backend abstraction

[src/adapters/bot.ts](../src/adapters/bot.ts), [src/adapters/claude-code.ts](../src/adapters/claude-code.ts)

```ts
interface BotAdapter {
  health(): Promise<void>;
  run(invocation: BotInvocation): Promise<BotResult>;
  runStream(invocation, onEvent): Promise<BotResult>;
}
```

The MVP ships a single `ClaudeCodeAdapter`. Adding Codex/Gemini/Ollama means
adding a new adapter class — the engine itself stays untouched.

### How Claude Code is invoked

`claude -p` (print mode) + `--output-format stream-json` +
`--input-format stream-json`.

- Prompt is delivered as a stream-json user message via stdin (avoids
  Windows arg-length limits and shell quoting issues)
- Every `tool_use`, `tool_result`, `thinking`, and `text` block streams back
  as JSON lines
- Each block is recorded into `trace.jsonl`
- Final cost and tokens are extracted from the `result` event
- `--permission-mode bypassPermissions` is set by default — without it, `-p`
  mode silently denies tool calls that would normally prompt, so code-producing
  stations would emit narration only. The worktree isolation + the human gate
  are what make this safe.

### Worktree Manager

[src/core/worktree.ts](../src/core/worktree.ts)

- `git worktree add -b factory/<line>/<run>/<station> <sandbox>/...`
- The LLM is spawned with `cwd` pinned to that worktree
- Merges happen only in the gate station, after human approval, and only via
  fast-forward
- On failure / cancel the worktree directory and branch are removed

### Trace + Memory

[src/core/trace.ts](../src/core/trace.ts) — append-only JSONL per run.
Event types: `run_start`, `station_start`, `bot_start`, `tool_use`,
`tool_result`, `subagent_start`, `review_round`, `budget_warn`,
`budget_exhaust`, `error`, `run_end`.

[src/core/memory.ts](../src/core/memory.ts) — `memory.jsonl` (cumulative
across runs). One line per station execution: line, station, bot, model,
status, verdict, score, cost, tokens, duration. `factory insights` aggregates
this.

## Isolation Model

```
                user's project
                 ┌─────────┐
                 │  .git   │
                 │   src/  │   ← user's working tree (LLM never touches it)
                 └─────────┘
                      │
                      │ worktree add
                      ▼
              .factory/sandbox/
              ┌──────────────────┐
              │ feature__implement│ ← LLM's cwd
              │   .git → shared   │
              │   src/             │
              └──────────────────┘
                      │
                      │ gate approves
                      ▼
              fast-forward merge into user's current branch
```

- The LLM's `cwd` is always inside a worktree
- The worktree carries its own branch — the user's commit history stays
  isolated
- On failure, cleanup only removes the worktree directory → zero impact on
  the user
- Successful merges are fast-forward only; non-FF is rejected

## Negotiation Loop

[src/stations/review.ts](../src/stations/review.ts)

```
round 1:
  reviewer evaluates the target output → JSON {verdict, score, feedback}
  if PASS && score >= threshold: end
  else:
    ask the main bot to ACCEPT or DISPUTE
    ACCEPT → main produces a new draft, target output is replaced
    DISPUTE → one-paragraph rebuttal, loop ends with verdict downgraded to WARN
round 2: repeat
... up to maxNegotiations
```

The key is to **use a different model for the reviewer**. Same-model
reviewers create echo chambers. The bundled `feature.yaml` runs main on
sonnet and reviewer on haiku.

## Skill Injection Mechanism

[src/skills/loader.ts](../src/skills/loader.ts)

A skill is just a `.md` file. Optional frontmatter can declare trigger
keywords.

At every LLM station start:

1. Skills listed in `bot.skills:` (explicit) — always included
2. Skills whose `triggers:` match the input text (auto) — included dynamically
3. Both sets are concatenated and passed via Claude Code's
   `--append-system-prompt`

Extension = drop a `.md` into `.factory/skills/`. No code change needed.

## Budget System

[src/core/budget.ts](../src/core/budget.ts)

Four metrics: `tokens`, `costUsd`, `durationMin`, `toolCalls`.

- 80% reached: warn event emitted, run continues
- 100% reached: `BudgetExhausted` is thrown → conductor terminates as
  `awaiting_human`
- `factory resume` re-enters the run (counters reset; the budget is fresh)

Defaults live in [src/templates/config.yaml](../src/templates/config.yaml).
Per-line overrides go under `line.budget:`.

## Data Layout

```
<projectRoot>/.factory/
├── config.yaml             # project-level settings
├── .gitignore              # excludes runs/, sandbox/, intake/, memory.jsonl
├── lines/<name>.yaml       # line definitions
├── skills/<name>.md        # skills
├── intake/<id>/            # ingest snapshot
│   ├── manifest.json
│   ├── raw/<source>.txt
│   ├── index.jsonl
│   ├── summary.md
│   └── decisions.md
├── runs/<runId>/
│   ├── summary.json
│   ├── trace.jsonl
│   └── stations/<name>/
│       ├── output.md
│       ├── prompt.md
│       └── review.md       # review stations only
├── sandbox/                # active worktrees (only present during a run)
└── memory.jsonl            # accumulated station outcomes across all runs
```

`runs/`, `sandbox/`, `intake/`, and `memory.jsonl` are excluded by the
default `.gitignore`. `config.yaml`, `lines/`, and `skills/` are meant to be
committed and shared with the team.

## Extension Points (v2 candidates)

- Additional LLM adapters (Codex, Gemini, Ollama)
- Embedding-based semantic search (Ollama nomic-embed-text)
- Automatic A/B measurement of skill combinations
- MCP server mode (callable from other AI tools)
- Web / image extraction
- VS Code extension (CLI wrapper)
