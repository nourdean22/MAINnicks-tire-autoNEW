# Manager ledger

Compact INDEX of jobs run by the monorepo manager (`.claude/skills/monorepo-manager/SKILL.md`). Not the source of
truth: PRs, `.completion/evidence.d/`, `.remember/` handoffs and git are. One row per job, updated in place by the
integrating session only. On start the manager reads every row not MERGED/CANCELLED plus the last 5.
No personal data, no secrets. Dry runs never write here.

Status: PLANNED | RUNNING | BLOCKED | BUILT | MERGED | LIVE-VERIFIED | CANCELLED

| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |
|---|---|---|---|---|---|---|---|
| 2026-10-11-agent-core | 2026-10-11 | Agent core, manager skill, lane agents | platform | MERGED | #2990 | heartbeat scheduled 2026-10-11 (am/pm tasks enabled, first run 13:37Z) | lanes were implicit until `.claude/agents/` existed |
| 2026-10-11-manager-proof | 2026-10-11 | Prove the manager: lane path check + canary, resume test | platform + statenour | RUNNING | - | integrate both lanes in one PR; record resume test | |
