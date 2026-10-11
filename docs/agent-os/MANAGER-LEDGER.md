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
| 2026-10-11-audit-tails-platform | 2026-10-11 | Audit tails: StateNour heal aging, corrected memories out of /memory and /ask, forget search-copy warning, portable violet gate; platform owns .devcontainer, .cursor, .vscode and the turbo canary runs on Windows | statenour + platform | BUILT | this PR | merge after green. NOT in this PR: T2 errored turn keeps tool receipts (needs a streaming accumulator decision: A build it, B "receipts unavailable" marker). Still open: item 2 daily-reel 18:00 ET pulse | statenour lane returned BLOCKED on T2 and was not guessed at. Platform was blocked on the turbo canary: on Windows an extensionless bin spawns ENOENT (status null, so "exited null" hid the cause). A shell-suffixed execSync passes only where git's true.exe is on PATH: reproduce gates in PowerShell. check-lane-paths prints OK on an empty diff (silent zero, follow-up). FAILED is the settled heal state but can re-enter EXECUTING. |
