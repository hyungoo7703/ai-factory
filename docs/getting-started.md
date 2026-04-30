# Getting Started

This guide is designed so a first-time user can run their first line within
30 minutes.

## 1. Prerequisites

You need three things.

### 1.1 Node.js 20+

```bash
node --version
# v20.x.x or higher
```

### 1.2 Claude Code CLI

Install + authenticate:

```bash
npm install -g @anthropic-ai/claude-code   # or follow https://docs.claude.com/claude-code
claude login
claude --version
```

The `claude` command must resolve on PATH. (On Windows verify both cmd and
PowerShell.)

### 1.3 A git repository

The target project must be a git repository. For a fresh project:

```bash
mkdir my-project && cd my-project
git init
git commit --allow-empty -m "init"
```

## 2. Install AI Factory

Source build (currently recommended):

```bash
git clone <this-repo> ~/tools/ai-factory
cd ~/tools/ai-factory
npm install
npm run build
npm link
```

Verify:

```bash
factory --version
factory --help
```

## 3. Initialize a project

```bash
cd /path/to/my-project
factory init
```

This creates:

```
.factory/
├── config.yaml           # models, budgets, default policies
├── lines/                # pipelines (feature, bugfix, refactor, intake-only)
├── skills/               # domain knowledge (coding-style, review-criteria, security-auditor)
└── .gitignore            # excludes runs/, sandbox/, intake/, memory.jsonl
```

It also creates (or augments) the **project root's** `.gitignore` so that
`node_modules/`, `dist/`, `.env*`, and a few editor/OS patterns are
excluded. This is required: without it, the implement station's auto-commit
captures dependency directories into the worktree branch and the gate's
fast-forward merge will fail. If `.gitignore` already exists, only
`node_modules/` is appended idempotently.

Open `config.yaml` to confirm the models you want to use:

```yaml
defaultModel: claude-sonnet-4-6
reviewerModel: claude-haiku-4-5
```

## 4. Run your first line

### 4.1 Simplest scenario: the `bugfix` line

```bash
factory run bugfix "FormatDate ignores timezone"
```

What happens:

1. The `reproduce` station spins up a worktree and adds a failing test
2. The `fix` station edits code in the same worktree until the test passes
3. The `review` station evaluates the diff (using a separate reviewer LLM)
4. The `gate` station asks you to approve or reject the merge

On approval, the worktree's changes are fast-forward merged into your
current branch.

### 4.2 Inspect logs / results

```bash
factory status              # latest run
factory status <runId>      # specific run
factory insights            # cumulative stats
```

Inside `.factory/runs/<runId>/`:

- `trace.jsonl` — every LLM event (replay / debug)
- `summary.json` — final outcome
- `stations/<name>/output.md` — what the station produced
- `stations/<name>/prompt.md` — the exact prompt that was sent

## 5. Start from a document

To toss in a requirements PDF, a planning DOCX, or an API spec:

```bash
factory intake docs/spec.pdf docs/api.docx
# Snapshot: intake-2026-04-28T01-12-33
```

Lines whose stations declare `canSearchIntake: true` will automatically
search this snapshot. The bundled `feature.yaml` enables this option.

```bash
factory run feature "Implement the membership tier backend"
```

The `clarify` and `implement` station prompts will include the *top 5 BM25
hits from intake* automatically.

## 6. Adapt a line to your project

Open `.factory/lines/feature.yaml` and add stations or change personas. A new
station takes about five YAML lines:

```yaml
  - name: typecheck
    kind: llm
    bot:
      name: typecheck-runner
      persona: |
        Run `npm run typecheck` in the worktree. If it fails, summarize errors.
```

## 7. Add your own domain knowledge as a skill

```bash
cat > .factory/skills/payment.md <<'EOF'
---
triggers: ["payment", "card", "checkout"]
---
# Payment Module Conventions

- All amounts are integer minor units (USD $1 = 100, KRW 100원 = 100)
- Card brand codes live in `lib/payment/codes.ts` as an enum
EOF
```

From now on, any input mentioning "payment" auto-injects this skill into
every station's system prompt.

## 8. Stuck? Resume

If a human gate rejected, or you hit Ctrl+C, or the budget halted the run:

```bash
factory status              # find the runId
factory resume <runId>      # resume from the first incomplete station
```

## 9. Next steps

- [docs/walkthrough.md](walkthrough.md) — A complete end-to-end example you can run
- [docs/concepts.md](concepts.md) — Line / Station / Worktree definitions
- [docs/line-spec.md](line-spec.md) — YAML reference
- [docs/architecture.md](architecture.md) — Internals
- [docs/faq.md](faq.md) — Troubleshooting
