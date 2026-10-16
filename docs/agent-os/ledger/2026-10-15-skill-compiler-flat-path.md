| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |
|---|---|---|---|---|---|---|---|
| 2026-10-15-skill-compiler-flat-path | 2026-10-15 | source-to-skill scaffolds into .claude/skills/<slug>/ (where Claude Code loads skills), provenance carries a label not an absolute path, step 7 eval claim corrected | platform | MERGED | #3041 (a220f098c, merged 2026-10-15 10:31Z) after four Codex findings were fixed (label kept on re-scaffold, embedded absolute paths rejected, legacy generated/ refused, SKILL.draft.md plus validate.mjs V8) | follow-up in a separate session (compiler provenance hardening): CI test over every compiled package, step 8 validator wording, immutability mutation arm. fire_audit.py needed no edit | a validator that passes a layout the loader never reads is a green that proves nothing: assert the path the consumer loads, not just the structure |

| Job id | After the PR opened (Codex, human) | Manager catches before it opened | Red-first (new tests red on unfixed code / new tests) | Mutation (killed / tried) | Cycle time (first dispatch to merge) | Rework pushes | Source |
|---|---|---|---|---|---|---|---|
| 2026-10-15-skill-compiler-flat-path | 4 findings, classes UNKNOWN | UNKNOWN (not counted then) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | ledger row, #3041 |
