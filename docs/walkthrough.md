# Walkthrough: end-to-end with the `feature` line

This document walks through a complete, copy-paste-able session that exercises
every piece of the factory: **intake → clarify → implement → review → gate →
insights**. It also doubles as a smoke test for verifying a fresh install.

By the end, you will have:

- Indexed a spec document into a searchable snapshot
- Generated a TypeScript module inside an isolated git worktree
- Seen an automated reviewer negotiate with the implementer
- Approved the merge through the human gate
- Inspected the trace and accumulated telemetry

The example deliberately mentions "payment" so that the bundled
[`security-auditor`](../src/templates/skills/security-auditor.md) skill
auto-triggers, demonstrating dynamic skill injection.

---

## 0. Prerequisites

```bash
factory --version          # 0.1.0+
claude --version           # Claude Code CLI on PATH and authenticated
git --version              # 2.30+
node --version             # 20+
```

If `factory` is not on PATH yet, run `npm link` once inside the `ai-factory`
clone (see [README](../README.md)).

---

> 💡 The shell snippets below use POSIX syntax (bash / zsh / Git Bash on
> Windows). PowerShell users: every command works as-is *except* the
> heredoc in step 2 — see the PowerShell-friendly alternative there. For
> step 6, also see the PowerShell cleanup variant.

## 1. Bootstrap a target project

```bash
mkdir scratch-payment && cd scratch-payment
git init
git commit --allow-empty -m "chore: init"

factory init
```

You should see:

```
✓ Created .factory/config.yaml
✓ Created .factory/lines/feature.yaml
✓ Created .factory/lines/bugfix.yaml
... (plus refactor, intake-only, three skills, .gitignore)
✓ Initialized factory in <abs path>
```

What just happened:

- `.factory/` was created with templates (config, lines, skills)
- A `.factory/.gitignore` was added that excludes `runs/`, `sandbox/`,
  `intake/`, `memory.jsonl` — so only the *definitions* are committed, not the
  ephemeral execution data

---

## 2. Drop in a tiny spec and ingest it

Create `docs/payment-spec.md` (use your editor of choice) with this content:

```markdown
# Card Payment Validator — Spec

## Goal
A pure TypeScript module that validates a credit card payload before it is
sent to the upstream payment gateway. No I/O, no globals.

## Inputs
- `cardNumber` (string, digits only after stripping spaces/dashes)
- `expiryMonth` (1–12)
- `expiryYear` (4-digit, current year or later)
- `cvv` (3–4 digits)
- `amount` (positive number, max 2 decimal places)
- `currency` (ISO 4217 — "USD", "KRW", "EUR", ...)

## Rules
- `cardNumber` must pass the Luhn checksum.
- Card brand is detected from the prefix (Visa, Mastercard, Amex, JCB).
- Expired cards (year/month already past) → reject.
- `amount` must be > 0 and not exceed 9_999_999 (sanity cap).

## Output
- `Result` discriminated union: `{ ok: true, brand } | { ok: false, code, message }`.
- `code` is one of: "INVALID_NUMBER" | "INVALID_EXPIRY" | "EXPIRED" |
  "INVALID_CVV" | "INVALID_AMOUNT" | "UNSUPPORTED_CURRENCY".

## Constraints
- No runtime dependencies. Plain TypeScript.
- Each rule has at least one unit test (use `node:test` and `node --test`).
```

Or, write it from the shell directly:

**bash / zsh / Git Bash**
```bash
mkdir -p docs
cat > docs/payment-spec.md <<'SPEC'
# Card Payment Validator — Spec

## Goal
A pure TypeScript module that validates a credit card payload before it is
sent to the upstream payment gateway. No I/O, no globals.
... (paste the rest of the spec above)
SPEC
```

**PowerShell** (use a single-quoted here-string `@'...'@`; the closing `'@`
must start at column 0):
```powershell
New-Item -ItemType Directory -Force -Path docs | Out-Null
@'
# Card Payment Validator — Spec

## Goal
A pure TypeScript module that validates a credit card payload before it is
sent to the upstream payment gateway. No I/O, no globals.
... (paste the rest of the spec above)
'@ | Set-Content -Encoding utf8 docs/payment-spec.md
```

Now ingest it:

```bash
factory intake docs/payment-spec.md
```

Expected: `factory` extracts the markdown, chunks it, builds a BM25 index,
and writes a manifest to `.factory/intake/<id>/`. The id (a date+hash) is
printed at the end. From here on, any `factory run` automatically binds to the
**latest** intake snapshot unless you pass `--intake <id>` explicitly.

> 💡 The `intake` step is optional. If your input is short, you can skip it
> and pass the requirement as a positional argument instead. But for anything
> beyond a one-liner, ingesting first lets every station search the spec
> through the BM25 index without bloating each prompt.

---

## 3. Run the `feature` line

```bash
factory run feature "Implement the card payment validator described in docs/payment-spec.md. Place code under src/payment/ and tests under src/payment/__tests__/."
```

What you will see, in order:

### 3.1 `clarify` station
- Reads the spec via the auto-bound intake snapshot
- Produces a one-page distilled spec (Goal / Scope / Assumptions / Acceptance
  Criteria / File Plan)
- No worktree — runs in the project root, output is text only
- Persona forbids asking the user questions: ambiguities are recorded as
  *Assumptions* and the line moves on

### 3.2 `implement` station
- A fresh git worktree is created at
  `.factory/sandbox/factory__feature__<runId>__implement/`
  on a new branch `factory/feature/<runId>/implement`
- The implementer's `cwd` is that worktree; it edits files there, never in
  your real working tree
- Because the prompt mentions "payment", the
  [security-auditor](../src/templates/skills/security-auditor.md) skill is
  auto-injected into the system prompt — the implementer is asked to mind
  OWASP-class issues (input validation, sensitive data handling)
- Because the produced files are TypeScript, the
  [coding-style](../src/templates/skills/coding-style.md) skill auto-triggers
  too
- The implementer uses Edit / Write / Bash tools to create the module and
  tests, runs the tests if possible, then ends its output with a `## Changes`
  block listing every file it touched
- Everything in the worktree is auto-committed to the worktree's branch so
  it is recoverable even if the next stations fail

### 3.3 `review` station
- A separate reviewer bot reads the implement station's output and the
  worktree's contents
- Produces a JSON verdict block: `{verdict, score, feedback}`
- If `score < 80` (the default `passThreshold`), it negotiates with the
  implementer for up to 2 rounds (`maxNegotiations`):
  - implementer ACCEPTs (reworks with the feedback) → loop continues
  - implementer DISPUTEs (defends) → loop ends with WARN
- The final verdict is recorded as the station's outcome

### 3.4 `gate` station — human review
- Prints a digest of every prior station's verdict
- Prints a preview of the last station's output
- Prompts you (interactive `inquirer` menu):
  1. Approve and merge into current branch
  2. Reject (keep worktree, stop run)
  3. Reject and discard worktree
- On approve → `git merge --ff-only` from the worktree branch into your
  project's current branch → your `src/payment/` and tests are now in your
  real working tree
- On reject → the worktree branch stays around so you can inspect/cherry-pick

> 💡 To bypass the prompt for non-interactive runs, use `factory run feature
> ... -y`. Even with `-y`, if any station was marked FAIL, the gate refuses
> to auto-merge — you must approve manually.

---

## 4. Inspect what just happened

### Status
```bash
factory status
```
Shows the latest run's per-station outcome and budget consumed.

### Trace
```bash
ls .factory/runs/
cat .factory/runs/<runId>/trace.jsonl | head    # raw event stream
cat .factory/runs/<runId>/summary.json          # final summary
ls  .factory/runs/<runId>/stations/             # per-station prompt + output
```

Open `.factory/runs/<runId>/stations/implement/output.md` to see exactly
what the implementer wrote. Open `prompt.md` next to it to see the exact
prompt it received (with intake hits, prior station outputs, working-dir
notice, etc.).

### Telemetry
```bash
factory insights
```
Aggregates `.factory/memory.jsonl` across all runs so far: total cost,
average score per station, pass rate, defects.

---

## 5. Optional: resume after a budget halt

If a long run hits the budget cap, the conductor halts and writes
`summary.json` with `status: "awaiting_human"`. To pick up where you left
off after raising the budget in `.factory/lines/feature.yaml`:

```bash
factory resume <runId>
```

Already-completed stations are skipped; only pending ones re-execute.

---

## 6. Cleanup

**bash / zsh / Git Bash**
```bash
git checkout main                  # or whatever your default branch is
git branch | grep factory/         # list remaining factory branches
git branch -D factory/feature/...  # delete branches you don't want to keep
rm -rf .factory/sandbox            # ephemeral worktrees (also cleaned by `git worktree prune`)
rm -rf .factory/runs               # trace + per-station outputs (kept by default)
```

**PowerShell**
```powershell
git checkout main
git branch | Select-String "factory/"
git branch -D factory/feature/...
Remove-Item -Recurse -Force .factory/sandbox
Remove-Item -Recurse -Force .factory/runs
```

`config.yaml`, `lines/`, and `skills/` are intended to be committed so the
team shares the same factory definition. Everything else under `.factory/`
is ignored by the bundled `.gitignore`.

---

## 7. What this exercises

| Capability | Triggered by | Where to verify |
|---|---|---|
| Worktree isolation | `worktree: true` on the implement station | `.factory/sandbox/...` exists during the run; user's main tree untouched |
| Negotiation review | review station with `passThreshold: 80` | `trace.jsonl` shows multiple `review_round` events when the first verdict is below threshold |
| Skill auto-trigger | "payment" / TypeScript in the input | `bot_start` event lists `skills: [security-auditor.md, coding-style.md]` |
| Intake binding | `factory intake` before the run | `_meta` log event with `message: "intake_bound"` and per-station `intake_hits` |
| Budget cap | tokens / cost / duration / tool calls | `[budget] ... (80% threshold)` warnings in stdout; `budget_warn`/`budget_exhaust` in trace |
| Trace-based learning | every run | `.factory/memory.jsonl` grows by one line per station; `factory insights` aggregates |
| Human gate | gate station | inquirer menu, optional fast-forward merge |

If all seven appear in a single run, the install is healthy.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Claude Code binary not found` | `claude` CLI missing or not authenticated | Install + `claude login`; verify `claude --version` works |
| Implementer outputs only "I would create..." with no actual files | Old build before `--permission-mode bypassPermissions` was added | `npm run build` in the ai-factory clone, then `npm link` again |
| `Not a git repository` | Ran factory outside a git project | `git init && git commit --allow-empty -m init` |
| Run halts at gate every time even with `-y` | One of the prior stations was marked FAIL | Inspect `summary.json`; the gate refuses to auto-merge failures by design |
| `git worktree add` fails | Stale worktree from a crash | `git worktree prune` then re-run; the conductor also does this on next acquire |
