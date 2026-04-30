# FAQ

## General

### How is AI Factory different from Claude Code?

Claude Code is **a single-conversation AI coding tool**. AI Factory adds a
**workflow layer** on top, contributing:

- Isolated git worktrees (the user's working tree is protected)
- Negotiation-based multi-perspective review
- Domain knowledge injection (skills)
- Full execution traces + cumulative memory (self-improvement)
- Hard budget / timeout caps
- Human gate (approval before any merge)

In short: Claude Code is the execution engine; Factory is the operating
system around it.

### Do I need MSSQL or any other database?

No. All state is stored in **git + local JSONL files**. `.factory/memory.jsonl`
is just an append-only file.

### Is there an Electron / GUI version?

No. CLI only (`factory <command>`). A VS Code extension is on the v2 list.

## Installation / Execution

### "claude command not found"

The Claude Code CLI is not on PATH.

```bash
which claude     # macOS / Linux
where claude     # Windows
```

Install: https://docs.claude.com/claude-code

After install, `claude --version` must work. Some environments need an
explicit PATH addition.

### "Not a git repository" error

Your target project isn't a git repository:

```bash
git init
git commit --allow-empty -m "init"
factory init
```

### `EPERM` or permission errors on Windows

Check the following:

1. Are you running in PowerShell / cmd (different path semantics from WSL)?
2. Is another process holding a worktree directory under `.factory/sandbox/`?
3. Is antivirus blocking writes to `.factory/`?

## Workflow

### Which line should I use when?

| Scenario | Line |
|---------|------|
| Adding one new feature | `feature` |
| Fixing one bug | `bugfix` |
| Behavior-preserving refactor | `refactor` |
| Just organize documents | `intake-only` |

For more elaborate scenarios, copy a bundled line and edit it to taste.

### A line takes a very long time to run

Possible causes:

1. **Claude Code is thinking** — expected for complex tasks
2. **Tool-call loop** — after `factory status <runId>`, count `tool_use`
   events in `trace.jsonl`. If high, tighten the station persona or lower
   `budget.toolCalls` to enforce a hard cap.
3. **Timeout** — defaults to 30 minutes per LLM call. If you need longer,
   adjust `timeoutMs` in code (will be exposed in YAML in v2).

You can interrupt anytime with `Ctrl+C` and resume later via
`factory resume <runId>`.

### The reviewer just rubber-stamps the main bot

Echo chamber from running both with the same model. Set distinct models in
`config.yaml`:

```yaml
defaultModel: claude-opus-4-7
reviewerModel: claude-haiku-4-5
```

Or override per station inside the line YAML:

```yaml
- name: review
  kind: review
  bot:
    model: claude-haiku-4-5
    persona: |
      You are an extremely critical reviewer. Default to skepticism. ...
```

### My costs are too high

1. Run `factory insights` to see which station dominates the cost
2. Lower `budget.costUsd` on the line to enforce a hard cap
3. Split large work into sub-PRs (one line invocation = one PR worth)
4. Move the reviewer to a smaller model (haiku, etc.)

## Isolation

### How exactly is the worktree separated from my working tree?

`git worktree add` creates a sibling directory + branch backed by the same
repository. The LLM's `cwd` is fixed to that directory, so it cannot edit
your real working tree.

### Where does worktree work end up?

By default, on the branch `factory/<line>/<runId>/<station>` as a commit.
Approving at the gate fast-forward merges it into your current branch.
Rejecting keeps the branch around but cleans the worktree directory.

### What about merge conflicts?

Only fast-forward merges are allowed; if a non-FF would be required, the
merge is refused and you must `git rebase` yourself before retrying. This
is intentional — the factory will never silently auto-merge over divergence.

## Data / Security

### Should I commit `.factory/`?

`factory init` writes both `.factory/.gitignore` (for factory's runtime
data) and ensures the **project root** `.gitignore` excludes
`node_modules/` (and seeds a sensible default if one doesn't exist).

The factory `.gitignore` excludes:

- `runs/` (large traces)
- `sandbox/` (transient)
- `intake/` (often contains internal documents)
- `memory.jsonl` (local stats)

Recommended to commit:

- `config.yaml` (shared model/budget defaults)
- `lines/` (the team's pipelines)
- `skills/` (the team's domain knowledge)

### How do I keep confidential documents from leaving for the LLM?

Add regexes to `redactPatterns` in `config.yaml`. Matches are masked in the
prompt. (The MVP applies this only at ingest; v2 will extend it to all
prompt building.)

You can also use `factory intake --no-llm` to index without any LLM call.

### Can I deterministically reproduce a run?

Partially. `trace.jsonl` records the full prompt + tool calls, but LLMs are
non-deterministic, so *exact* reproduction is impossible. The same input
will produce a similar output. Deterministic replay is on the v2 list.

## Troubleshooting

### My line is stuck

```bash
factory status              # latest run status
factory resume <runId>      # resume from the first incomplete station
```

`awaiting_human` means either a gate is open or the budget was exhausted.

### `summary.json` shows an error

```bash
cat .factory/runs/<runId>/summary.json | jq .error
cat .factory/runs/<runId>/trace.jsonl | grep '"type":"error"'
```

Most causes appear in the last few trace events.

### A worktree wasn't cleaned up

```bash
git worktree list                      # list registered worktrees
git worktree remove --force <path>     # force remove
git worktree prune                     # clean missing entries
```

If only the directory under `.factory/sandbox/<dir>` lingers, deleting it
with `rm -rf` is fine.

## Extending

### Fastest way to write a new line

```bash
cp .factory/lines/feature.yaml .factory/lines/my-line.yaml
# edit
factory list   # confirm my-line shows up
factory run my-line "..."
```

### Adding a skill

```bash
cat > .factory/skills/my-domain.md <<'EOF'
---
triggers: ["my-keyword"]
---
# My Domain
- ...
EOF
```

It will be picked up on the next run automatically — no registration needed.

### When will Codex / Gemini adapters land?

On the v2 roadmap. The adapter interface is in
[src/adapters/bot.ts](../src/adapters/bot.ts); adding a new class next to
`ClaudeCodeAdapter` is enough to extend the engine.
