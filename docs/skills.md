# Skills

A skill is a `.md` file under `.factory/skills/<name>.md` that captures
domain knowledge. The body is injected into the LLM's system prompt as
*extra context* so the model knows your project's conventions, rules, and
risk areas.

## Format

```markdown
---
triggers: ["payment", "card", "checkout"]
agent:
  name: payment-domain
  outputs: ["payment-design.md"]
---

# Payment Module Conventions

- All amounts are integer minor units (USD $1 = 100, KRW 100원 = 100)
- Card brand codes live in the enum at `lib/payment/codes.ts`
- Refunds go through `payments.refund` only — never UPDATE the table
- User-facing error strings come from `i18n/payment-errors.ts`
```

## Frontmatter (optional)

| Key | Type | Meaning |
|----|------|------|
| `triggers` | string[] | Auto-inject when any keyword appears in the input (case-insensitive substring) |
| `agent.name` | string | (v2) Register the skill as a separate sub-agent |
| `agent.triggers` | string[] | (v2) Triggers for auto-invoking the agent |
| `agent.inputs` | string[] | (v2) Input files the agent depends on |
| `agent.outputs` | string[] | (v2) Files the agent must produce |

Frontmatter is optional — a body-only file works.

## When skills are injected

At the start of every LLM station:

1. Skills listed in `bot.skills:` → **always included** (explicit)
2. Every skill with `triggers:` → matched against the input → **auto-included**
   if any trigger hits

Both sets are concatenated and forwarded via Claude Code's
`--append-system-prompt`.

## Explicit vs. auto

```yaml
# Explicit, declared in the line yaml
bot:
  skills:
    - coding-style    # always included
```

```markdown
---
triggers: ["payment", "checkout"]
---
# Auto-included whenever the input mentions "payment" or "checkout"
```

- **Conventions that always apply** (style, lint rules) → explicit
- **Knowledge meaningful only in specific domains** (payments, auth,
  security) → auto

## Anatomy of a good skill

### 1. Small and single-purpose

```markdown
---
triggers: ["i18n", "translation"]
---
# i18n Conventions

- All user-facing strings live as keys in `i18n/<lang>.json`
- Key naming: `<scope>.<screen>.<element>` (e.g. `auth.login.submit_button`)
- When adding a new locale, update `SUPPORTED_LOCALES` in `lib/i18n/index.ts`
```

5–15 lines is ideal. A 100-line skill is likely to be ignored by the LLM.

### 2. Include short *why*s

```markdown
- Refunds always go through `payments.refund` — never raw DB UPDATE
  (Reason: the audit_log table must capture every refund automatically;
  required for compliance.)
```

A reason lets the LLM apply the principle to new situations the rule
didn't explicitly cover.

### 3. Spell out anti-patterns

```markdown
## Never do

- Reference `process.env.DATABASE_URL` directly — use `config/database.ts`
- Sequence work with `setTimeout` — use `await` / `Promise`
- Add a new dependency without discussion — PR description must justify it
```

## Skill priority

If the same skill name exists in two places, the user directory
(`.factory/skills/`) wins over any bundled default. This lets users
override `coding-style.md` etc. to fit their project.

## Debugging

To see exactly which skills were injected for a given run:

```bash
cat .factory/runs/<runId>/stations/<station>/prompt.md
```

`prompt.md` is the user message sent to the LLM. Skills go into the system
prompt — to inspect them, look for the `bot_start` event in the trace:

```bash
grep '"type":"bot_start"' .factory/runs/<runId>/trace.jsonl | head -1 | jq .
```

## Future (v2): Skill marketplace

The frontmatter `agent` key is reserved for v2. Planned features:

- Register a skill as a *sub-agent definition* — the main bot can discover
  and delegate automatically
- Trigger-driven dynamic line composition
- A/B measurement of which skill combinations contribute to output quality
