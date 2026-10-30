# Baseline: monorepo-manager v4

recorded: 2026-10-30

Question: what went wrong on 2026-10-25 to 2026-10-30 while managers ran the v3 skill (PR 3236, merged 2026-10-22), and
which of those failures did no v3 line cover? Recorded before this branch touches `SKILL.md`; `forge.mjs check --existing
--git` verifies that order. The v3 baseline (the 2026-10-22 relay day) is kept unchanged in `baseline-2026-10-22.md`.
Sources: the agent-memory entries Nour's corrections produced (named per row) and the Shop OS planning manager's takeover
file `shop-os-planning-manager-2026-10-30.md`. Each row is one witnessed case, an existence proof, not a rate.

## Tasks run without the skill

| task | what happened | evidence |
|---|---|---|
| T1: start parallel docs sessions for the Shop OS plan (2026-10-30, 14:15Z to 15:25Z) | Sessions were started while sibling managers already ran about 11 others. Free RAM fell to 615 MB at 14:03Z and to 160 MB with 15 sessions; the laptop crashed before 15:25Z and the first launch of this very job never started. v3 limits writer lanes (2) and heavy runs (1) but says nothing about how many sessions may run or what free RAM gates a new one. | memory `shop-os-planning-manager-2026-10-30.md` (QUEUED line, "15:25Z after the laptop CRASH"); `heavy.mjs status` prints free RAM |
| T2: keep started sessions moving between manager sweeps (2026-10-30, 10:21 EDT) | Sessions waited on a notification or a held prompt and lost work to restarts (brief template v3 history: 40 to 76 minutes of uncommitted edits). Nour: "everything needs to be on a loop too any and all sessions ur working on so they dont get fucked up". Docs 12 and 13 had to be messaged the rule after they started. v3 has no loop or checkpoint line for briefs. | memory `feedback-every-session-on-a-loop.md`; `.agents/core/templates/subagent-brief.md` header |
| T3: keep parallel sessions of one job in sync (2026-10-30, 10:51 EDT) | Rulings and finished docs reached one session, not the others, so sibling docs went stale or duplicated work. Nour: "keep all sessions up to date with each other so everything gets upgraded euqually". v3's messaging rules cover one question per message, not broadcasting a ruling or a digest. | memory `feedback-sessions-share-findings.md`; v3 `references/sessions-and-plans.md` "Messaging other sessions" |
| T4: close out finished sessions (2026-10-30, 10:46 EDT) | Finished sessions stayed open, held RAM and cluttered the sidebar (one cause of T1), and Nour had to ask what finished. Nour: "every session needs finished n then archivesd n then just tell me what finished simply". v3 step 16 reports; no step archives a session or writes the takeover memory first. | memory `feedback-finish-archive-report-simply.md` |
| T5: hold the quality bar on every session (2026-10-30, 10:16 EDT) | Session PRs reached review with gaps an outside reader found: PR 3382 was blocked by 6 Codex P2 threads, PR 3383 drew 19 Codex comments. Nour: "no lazy or sloppy work is done in any all sessions your managing". v3's send-back hook (`subagent-receipt-check.mjs`) fires on lane agents only; sessions get no standard block and no send-back limit. | memory `feedback-manager-max-effort-no-sloppy.md`, `shop-os-planning-manager-2026-10-30.md` (15:03Z line) |
| T6: keep Nour's deferred decisions (2026-10-30, 10:30 EDT, and earlier) | Nour: "leave these for laster remind me" on six owed decisions (counter lead, PartsTech signup, crew count and roles, QuickBooks, ALG map night). Owed decisions from other jobs sit scattered across memory files ("Nour owes ..." in at least 6 index lines). v3 has no register and no point at which they are shown again. | memory `shop-os-planning-manager-2026-10-30.md` ruling 1; `MEMORY.md` index lines |
| T7: dispatch work when the lane agents are missing (2026-10-30) | The harness listed the `lane-*` agents as no longer available in the manager session, so the Agent-tool path in v3's Workers table did not exist; sessions via `start_session` were the working path and v3 names them only in one sentence. | the job brief's KNOWN line; v3 SKILL.md Workers section |

## Failure shape

v3 was built for a manager that dispatches a few lane agents and relays their claims. On 2026-10-30 the manager ran 4 to
6 SESSIONS beside another manager's 11, on a 16 GB laptop, for a docs-heavy planning job. Every failure sat in session
lifecycle, where no v3 step applied: no RAM gate or session cap before a start (T1), no loop or checkpoint rule in the
brief (T2), no broadcast of rulings and finished docs (T3), no finish, memory, archive, one-line-report order (T4), no
standard block or send-back limit for sessions (T5), no register for decisions Nour deferred (T6), and no fallback when
lane agents are missing (T7). v4 must add a session pipeline (brief, start, loop, sweep, digest, check, merge, memory,
archive, report), a RAM gate with numbers, a parked-decisions register and a job-start step that loads who Nour is, how
the shop works and the money frame; each new rule needs an eval case that the v3 text answers wrong.
