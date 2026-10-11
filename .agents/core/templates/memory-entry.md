# Agent memory entry (one fact per file in ~/.claude/projects/<slug>/memory/, then one index line in MEMORY.md)

Write one only when the fact is not already in code, a test, AGENTS.md, a skill or git history.

```markdown
---
name: <short-kebab-case-slug>
description: <one line; used to decide relevance at recall time>
metadata:
  type: user | feedback | project | reference
---

<the fact, with absolute dates>

**Why:** <the reason or the incident behind it>
**How to apply:** <the concrete action a future session takes>
Related: [[other-memory-slug]]
```

Index line: `- [Title](file.md) - hook`. Keep the INDEX-END sentinel last (`check-memory-index.mjs`).
