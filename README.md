# AI Factory

> **A locally-run, self-improving AI development factory.**
> A workflow engine on top of Claude Code. Git-native, worktree-isolated.

AI Factory uses your *per-project git repositories* as factory floors. Whenever
the AI writes code it works inside an isolated git worktree, every artifact is
verified through multi-perspective review before merge, and every execution is
recorded as a trace for later analysis.

```
my-project/                  ← your project (each folder has its own .git)
├── .git/
├── .factory/                ← directory created by AI Factory
│   ├── config.yaml
│   ├── lines/               ← pipeline definitions (yaml)
│   ├── skills/              ← domain knowledge (md)
│   ├── intake/              ← indexed document snapshots
│   ├── runs/                ← execution traces + artifacts
│   ├── sandbox/             ← isolated worktrees
│   └── memory.jsonl         ← cumulative telemetry
└── src/
```

## Core Guarantees

| Mechanism | Protects |
|--------|---------|
| **Worktree isolation** | The AI can never touch your real working tree |
| **Negotiation review** | Prevents single-LLM echo chambers |
| **Dynamic skill injection** | Inject domain knowledge as `.md` — extend without code changes |
| **Trace-based learning** | Every call is logged → the system gets smarter over time |
| **Hard budget caps** | Tokens / cost / time can never blow up |
| **Git-native state** | No separate database. Work output is branches and commits |

## Requirements

- **Node.js 20+**
- **git 2.30+** (worktree support)
- **[Claude Code](https://docs.claude.com/claude-code) CLI** — installed on PATH and authenticated
- The target project must be a git repository (`git init`)

## Install

```bash
git clone <this-repo> ai-factory
cd ai-factory
npm install
npm run build
npm link        # exposes the `factory` command globally
```

Or, once published to npm:

```bash
npm install -g ai-factory
```

## Quick Start

```bash
# 1. Move into your target project
cd ../my-project

# 2. Initialize .factory/
factory init

# 3. (optional) Ingest requirements documents
factory intake docs/spec.pdf docs/api.docx

# 4. List available lines
factory list

# 5. Run a line
factory run feature "Add a checkout page — supports card and bank transfer"

# 6. Inspect progress / results
factory status
factory insights
```

## Command Summary

| Command | Description |
|------|------|
| `factory init` | Initialize `.factory/` (config, lines, skills seed) and ensure project root `.gitignore` excludes `node_modules/`, `dist/`, `.env*` |
| `factory intake [paths...]` | Ingest documents → searchable snapshot |
| `factory run <line> [input]` | Execute a line |
| `factory resume <runId>` | Resume a paused run |
| `factory status [runId]` | Show run summary |
| `factory list` | List available lines / skills |
| `factory insights` | Aggregate stats (cost, pass rate, defects) |

## Bundled Lines

- **`feature`** — Single feature implementation (clarify → implement → review → gate)
- **`bugfix`** — Reproduce → fix → verify → gate
- **`refactor`** — Behavior-preserving refactor
- **`intake-only`** — Document ingest only

## Bundled Skills

- **`coding-style`** — TypeScript/JS coding style (auto-triggers on ts/js)
- **`review-criteria`** — Review rubric + JSON verdict format
- **`security-auditor`** — OWASP Top 10 (auto-triggers on payment/auth, etc.)

## Documentation

- [docs/getting-started.md](docs/getting-started.md) — First-run guide
- [docs/walkthrough.md](docs/walkthrough.md) — End-to-end example exercising every station, also usable as a smoke test
- [docs/architecture.md](docs/architecture.md) — System architecture and runtime
- [docs/concepts.md](docs/concepts.md) — Glossary: Line, Station, Worktree, Skill, ...
- [docs/line-spec.md](docs/line-spec.md) — `.factory/lines/*.yaml` specification
- [docs/skills.md](docs/skills.md) — How to author skills
- [docs/faq.md](docs/faq.md) — Frequently asked questions

## License

MIT — see [LICENSE](LICENSE)
