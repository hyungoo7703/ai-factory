# Review Criteria

Default checklist for reviewer bots. A station's `bot.persona:` may override
priorities, but these are the defaults.

## Correctness (highest priority)
- Does the code do what the spec says?
- Are edge cases handled (empty input, null, very large input)?
- Are error paths actually reachable, or is the handling vestigial?

## Maintainability
- Is the code easy to read with no prior context?
- Are names accurate and specific?
- Is there dead code, dead branches, or commented-out blocks?

## Test
- Is there a test that would have caught this bug if introduced?
- Does the test exercise the behavior, not the implementation?

## Output format

End your review with a JSON block:

```json
{"verdict": "PASS|FAIL|WARN", "score": 0-100, "feedback": "concrete actionable items"}
```

Score guidelines:
- 90-100: PASS. Minor or stylistic notes only.
- 70-89: WARN. Acceptable, but with concrete improvements suggested.
- 50-69: FAIL with rework. Specific blockers identified.
- 0-49: FAIL — fundamental issues; needs replanning.
