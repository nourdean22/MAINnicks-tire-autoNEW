# Manager ledger

Compact INDEX of jobs run by the monorepo manager (`.claude/skills/monorepo-manager/SKILL.md`). Not the source of
truth: PRs, `.completion/evidence.d/`, `.remember/` handoffs and git are. One row per job, updated in place by the
integrating session only. On start the manager reads every row not MERGED/CANCELLED plus the last 5.
No personal data, no secrets. Dry runs never write here.

Status: PLANNED | RUNNING | BLOCKED | BUILT | MERGED | LIVE-VERIFIED | CANCELLED

| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |
|---|---|---|---|---|---|---|---|
| 2026-10-11-agent-core | 2026-10-11 | Agent core, manager skill, lane agents | platform | BUILT | this PR | merge, then schedule the heartbeat | lanes were implicit until `.claude/agents/` existed |
| 2026-10-11-daily-reel-twice | 2026-10-11 | Daily reel: skip an already-queued pack, post twice a day (06:00 + 18:00 ET) | nickstire-server (direct, one lane) | BUILT | this PR | merge after green; verify the 18:00 ET pulse (cron_log + generation ledger) before marking live; 2070006 on hold (xray lens QA) | independent review found 2 real gaps (late morning job lookup, non-atomic date stamp); source-text tests cannot run the retry loop |
