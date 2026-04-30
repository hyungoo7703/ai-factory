# Line Spec

Reference for `.factory/lines/<name>.yaml`.

## Minimal example

```yaml
name: hello
description: minimal line for sanity check.

stations:
  - name: greet
    kind: llm
    bot:
      name: greeter
      persona: "Reply with a one-sentence greeting."
```

Run it:

```bash
factory run hello "Project kickoff"
```

## Full schema

```yaml
name: <string>                  # line identifier (should match the filename)
description: <string>           # display description

# Line-level budget — falls back to config.yaml or built-in defaults
budget:
  tokens: <number>
  costUsd: <number>
  durationMin: <number>
  toolCalls: <number>
  subAgentMaxDepth: <number>    # recursive sub-agent depth limit (reserved for v2)
  subAgentMaxCount: <number>    # max sub-agents a single main bot may spawn

stations:                       # one or more required
  - name: <string>              # unique within the line
    kind: ingest|llm|review|gate
    instructions: <path>        # optional: extra instructions.md
    optional: <bool>            # optional: skippable (display-only for now)
    worktree: <bool>            # llm only — run inside an isolated worktree
    canSearchIntake: <bool>     # llm/review — inject top BM25 intake hits
    inputs:                     # optional: prerequisite paths (relative to project root)
      - <path>
    outputs:                    # optional: files this station MUST produce
      - <path>
    bot:                        # used by llm/review
      name: <string>
      model: <string>           # Claude Code model id
      persona: <multiline>
      skills:                   # explicit skills (always injected)
        - <skill-name-or-path>
    reviewOf: <string>          # review only — name of the station being reviewed
    passThreshold: <0-100>      # review only — passing score (default 80)
    maxNegotiations: <number>   # review only — negotiation rounds (default 2)
    budget:                     # optional: per-station budget override
      tokens: <number>
      ...
```

## Behavior by `kind`

### `ingest`

- Collects paths from the user input (line-by-line) and `station.inputs`
- Runs each through the ingest pipeline → snapshot
- Binds `ctx.intakeId` so subsequent stations can search the snapshot

### `llm`

- Optionally creates a worktree
- Builds the prompt from:
  1. `instructions.md` (if set)
  2. The user input
  3. Outputs of prior stations (chained context)
  4. Top-5 BM25 hits from intake (when `canSearchIntake`)
  5. Working-directory notice + required-output reminder
- Appends explicit + auto-matched skills to the system prompt
- Calls the bot, traces every event
- Auto-commits worktree changes

### `review`

- Reads the output of the station named in `reviewOf`
- Runs the Negotiation Loop (up to `maxNegotiations` rounds)
- Parses a JSON verdict block (heuristic fallback if parsing fails)
- PASS when score ≥ threshold

### `gate`

- Carries forward the worktree of the most recent worktree-bearing station
- Prompts the user for approve / reject / discard (`--yes` auto-approves)
- approve → fast-forward merge → branch retained
- reject → stop, branch retained
- discard → remove worktree, delete branch

## How `bot.skills` resolves

`bot.skills:` accepts any of three forms:

```yaml
bot:
  skills:
    - coding-style                                   # bare name (.md auto-appended)
    - skills/payment.md                              # path relative to project root
    - /absolute/path/to/skill.md                     # absolute path
```

## Persona authoring tips

- **Be precise about purpose AND constraints** — *"don't do X"* matters as
  much as *"do X"*
- **Force the output format** — review stations require a JSON verdict
- **Cap output size** — e.g. *"no more than 3 pages of output"*
- **Keep persona short, detailed instructions in `instructions:`** — don't
  cram long task descriptions into `persona`

## Example: explicit multi-stage sub-agents (v1)

The MVP doesn't let you declare sub-agents in YAML directly. Instead, force
the main bot's persona to delegate via Claude Code's Task tool:

```yaml
- name: implement
  kind: llm
  worktree: true
  bot:
    name: coordinator
    persona: |
      You orchestrate three sub-agents using your Task tool:
        1. api-designer: produce api/<name>.openapi.yaml
        2. db-modeler: produce db/<name>.schema.sql
        3. ui-spec: produce ui/<name>.tsx skeleton
      After all three complete, merge into a single implementation report.
      Do not write code yourself — delegate via Task.
```

Claude Code's Task tool handles sub-agent isolation and parallelism on its
own. v2 will let you declare this more directly in YAML.

## Line validation

Line YAML is validated on load. Common errors:

- `line.name is required` — the top-level `name:` field is missing
- `Duplicate station name` — station names must be unique within a line
- `Review station 'X' must specify 'reviewOf'`
- `Station 'X' references unknown station 'Y'` — `reviewOf` target missing
- `passThreshold must be 0-100`
