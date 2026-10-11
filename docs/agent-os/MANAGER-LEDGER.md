# Manager ledger

Compact INDEX of jobs run by the monorepo manager (`.claude/skills/monorepo-manager/SKILL.md`). Not the source of
truth: PRs, `.completion/evidence.d/`, `.remember/` handoffs and git are. One row per job, updated in place by the
integrating session only. On start the manager reads every row not MERGED/CANCELLED plus the last 5.
No personal data, no secrets. Dry runs never write here.

Status: PLANNED | RUNNING | BLOCKED | BUILT | MERGED | LIVE-VERIFIED | CANCELLED

| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |
|---|---|---|---|---|---|---|---|
| 2026-10-11-agent-core | 2026-10-11 | Agent core, manager skill, lane agents | platform | MERGED | #2990 | heartbeat scheduled 2026-10-11 (am/pm tasks enabled, first run 13:37Z) | lanes were implicit until `.claude/agents/` existed |
| 2026-10-11-manager-proof | 2026-10-11 | Prove the manager: lane path check + canary, resume test | platform + statenour | MERGED | #2993 (d0a4b3ae8) | next multi-lane job runs through the manager; watch the first live heartbeat | 2 lanes in parallel, 0 path overlap; platform lane stopped mid-task and resumed: its 7 pre-stop files byte-identical after, no redo; check-lane-paths passed both lane commits and flagged all 4 statenour files when judged as platform; combined tree tsc 0, 105 files / 790 passed. Gap: .completion/evidence.d is owned by no lane (integrating session writes it). |
| 2026-10-11-daily-reel-twice | 2026-10-11 | Daily reel: skip an already-queued pack, post twice a day (06:00 + 18:00 ET) | nickstire-server (direct, one lane) | BUILT | this PR | merge after green; verify the 18:00 ET pulse (cron_log + generation ledger) before marking live; 2070006 on hold (xray lens QA) | independent review found 2 real gaps (late morning job lookup, non-atomic date stamp); source-text tests cannot run the retry loop |
