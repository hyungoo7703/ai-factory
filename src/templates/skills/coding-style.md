---
triggers: ["typescript", "javascript", "tsx", "node"]
---

# Coding Style

Apply these rules when producing or reviewing code:

- Prefer terse, readable code over clever abstractions.
- Do not introduce a new abstraction until a pattern repeats three times.
- Handle errors only at system boundaries (user input, network, filesystem).
- Delete unused code. Do not comment it out.
- TODO comments must follow `// TODO(reason): description`.
- For TypeScript: never use `any`; use `unknown` and narrow with type guards.
- For TypeScript: prefer `interface` for object shapes, `type` for unions.
- Avoid backward-compatibility shims unless explicitly required.
