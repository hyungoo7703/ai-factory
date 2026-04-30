# Concepts

Definitions of the core terms used throughout AI Factory.

## Project Root

The folder that contains a `.git` directory. AI Factory always treats the
nearest ancestor git repository as the project root. All factory state lives
in `<projectRoot>/.factory/`.

## Line

A declarative workflow defined in `.factory/lines/<name>.yaml`. A line is a
sequential list of stations that takes one input and produces one outcome
(usually a git branch).

Bundled lines:

- `feature` — clarify → implement → review → gate
- `bugfix` — reproduce → fix → review → gate
- `refactor` — plan → refactor → review → gate
- `intake-only` — ingest only

Lines are pure YAML, so adding or modifying them is straightforward. See
[line-spec.md](line-spec.md) for the full schema.

## Station

A single step inside a line. There are four kinds:

| Kind | Role |
|------|------|
| `ingest` | Index user-supplied documents into a searchable form |
| `llm` | Delegate work to an LLM (typically code authoring or analysis) |
| `review` | Have a different LLM evaluate the result (Negotiation Loop) |
| `gate` | Human approves / rejects → merge or discard |

## Worktree

When a station is declared with `worktree: true`, that station runs inside
an isolated git worktree.

- Location: `.factory/sandbox/<sanitized-branch>/`
- Branch: `factory/<line>/<runId>/<station>`
- The LLM can only edit files inside that directory
- Only the most-recent worktree-bearing station carries forward to the gate
  (earlier worktrees are auto-released)
- On gate approval the worktree branch is fast-forward merged; on rejection
  the worktree is cleaned up

## Bot

The combination of an LLM instance, a persona, a model, and skills.

```yaml
bot:
  name: coder              # display name
  model: claude-sonnet-4-6 # model id passed to Claude Code
  persona: |               # appended to the system prompt
    You are a senior implementer...
  skills:                  # explicit skills (always injected, regardless of triggers)
    - coding-style
```

## Skill

Domain knowledge stored as a `.md` file under `.factory/skills/`.

- **frontmatter `triggers`**: keywords that auto-inject the skill when found
  in the input
- **frontmatter `agent.name`**: (reserved for v2) register the skill as a
  separate sub-agent
- **body**: free-form markdown — appended to the LLM's system prompt

Skills are the primary mechanism for extending domain knowledge without
touching code.

## Run

A single execution of a line. Each run gets a unique `runId` (e.g.
`2026-04-28-feature-abc123`) and stores all artifacts under
`.factory/runs/<runId>/`.

```
runs/<runId>/
├── summary.json    # outcome metadata
├── trace.jsonl     # every LLM event
└── stations/<name>/
    ├── output.md   # station's produced text
    └── prompt.md   # the exact prompt sent
```

## Trace

`trace.jsonl` — append-only event stream, one JSON event per line. The raw
data source for replay, debugging, and memory analysis.

Event types: `run_start`, `station_start`, `bot_start`, `tool_use`,
`tool_result`, `subagent_start`, `subagent_end`, `review_round`, `bot_end`,
`station_end`, `budget_warn`, `budget_exhaust`, `error`, `run_end`.

## Memory

`.factory/memory.jsonl` — cumulative station outcomes across every run. One
line per station execution: line, station, bot, model, status, verdict,
score, cost, tokens, duration, defects.

`factory insights` aggregates this file.

## Intake Snapshot

The output of `factory intake <files...>`, stored at
`.factory/intake/<snapshot-id>/`:

- `manifest.json` — metadata
- `raw/<source>.txt` — extracted plain text
- `index.jsonl` — chunks with tokens (used by BM25)
- `summary.md` — LLM digest (≈1 page)
- `decisions.md` — Decided / Ambiguous classification

Stations declared with `canSearchIntake: true` automatically search the
latest snapshot.

## Budget

A hard cap on tokens / cost / duration / tool calls. Configurable per line.
At 80% the run warns; at 100% it halts as `awaiting_human`. A resume starts
the budget fresh.

## Negotiation

When a review verdict is not PASS, the conductor asks the main bot to
ACCEPT or DISPUTE.

- ACCEPT → main produces a new draft; the next round re-reviews it
- DISPUTE → one-paragraph rebuttal; the loop ends with verdict downgraded
  to WARN

Repeats up to `maxNegotiations` (default 2).

## Verdict

`PASS` / `WARN` / `FAIL`. The reviewer's conclusion, paired with a 0–100
score.

| Verdict | Meaning |
|---------|------|
| PASS | Score ≥ threshold; proceed unchanged |
| WARN | Could be improved but proceeds; the human gate decides |
| FAIL | Block; rework required |
