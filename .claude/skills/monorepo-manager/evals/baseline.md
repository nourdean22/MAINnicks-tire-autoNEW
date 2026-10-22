# Baseline: monorepo-manager

recorded: 2026-10-22

Question: what went wrong when the manager ran a full day of parallel sessions with the 2026-10-15 version of this
skill (15 steps, all about lane subagents), and which of those failures did no step catch? Recorded before the rewrite
touched `SKILL.md`; `forge.mjs check --existing --git` verifies that order on the branch. Source: the manager session's
own transcript (session 0900c49a, 2026-10-21 20:00Z to 2026-10-22 12:50Z) and the agent-memory entries Nour's
corrections produced that day. Counts are one session's, an existence proof per row, not a rate across sessions.

## Tasks run without the skill

| task | what happened | evidence |
|---|---|---|
| T1: relay a scout session's finding to Nour (10-22, morning) | The manager passed on the upgrade scout's "0 declines ever captured" as fact. An estimate with no invoice is the decline in this shop's data, so the claim was false. Nour: "where is your context in history why aren't you remembering invoices are closed job". No step of the old skill covered relaying a SESSION's claim; step 6 checks a lane's diff, not a session's words. | memory `feedback-verify-before-relaying.md`, `shop-data-meanings.md`; prompt 11:47:47Z in the transcript |
| T2: brief new sessions that read shop data (10-22) | The scout's brief carried no shop data meanings, so a fresh context had no way to know invoice = closed job and estimate without invoice = walked. The v3 brief template has no SHOP DATA field and nothing checks a brief's content. | `.agents/core/templates/subagent-brief.md` (no such field); memory `shop-data-meanings.md` |
| T3: end each reply with a `Skills:` line (10-22, 00:00Z to 12:50Z) | 86 of 98 turns ended with a `Skills:` line. A rough count found 33 of them naming skills with NO Skill call in that turn (e.g. `stranded-branch-rescue, nickstire-ios-pwa-primitives` named while only `monorepo-manager` was called). Nour had caught it at least 5 times. `skills-check.mjs` only blocks a turn with zero Skill calls, so all 33 passed. | scratchpad script over the transcript: `turns=98 withSkillsLine=86 mismatched=33` (the count includes some prose words; the hook built from this baseline counts only real skill names) |
| T4: act on the SessionStart health line (10-21/22) | The manager's first SessionStart printed `graphify DOWN`, `task NOURCITY-Local-MCP FAILED` and `FIX FIRST: (1) ...local-mcp-servers.ps1 -Start (2) ...register-local-mcp-task.ps1`. Nothing ran either command; a second `FIX FIRST` at 02:30Z was also ignored; the graph came back only when restarted around 11:55Z on 10-22, roughly a day later. The rule existed as memory text only. | transcript line 7 (`hookEvent SessionStart`); memory `feedback-proactive-setup-fixes.md`, `feedback-verify-before-relaying.md` item 3 |
| T5: an overnight "finish before I wake" order (10-22, 02:58Z) | A deploy-config change (#3223, the bdnick.info build heap fix) turned up at about 06:00Z, after Nour went to sleep. The session correctly held it for his specific go, so everything statenour stayed not live until he woke: "merge 3223 n it looks like u didnt listen n arent finished". The skill had no step that lists protected steps BEFORE an unattended run. | memory `feedback-collect-goes-before-sleep.md`; prompts 02:58:28Z and 10:41:50Z |
| T6: report status before the proof existed (10-21/22) | Status replies said things were "checked" and PRs were moving while CI had not finished or no read of it happened in that turn; Nour asked "green yet?" and "Literally still nothing?". `answer-first` already says a CI state is the tally read THIS turn, and nothing enforced it. | mined prompts `tx:1bc20c83`, `tx:349902d8`; `answer-first` SKILL.md "A PR's CI state" |

## Failure shape

The old skill was built for one shape of job: the manager dispatches lane subagents, reads their diffs and merges. On
2026-10-22 the manager mostly ran SESSIONS and talked to Nour, and every failure sat in that relay layer, where no step
applied: it repeated a session's claim without checking it against the shop's own data meanings (T1), sent briefs that
lacked those meanings (T2), named skills it had not invoked (T3), ignored a broken-tool line the harness printed at
session start (T4), found a protected step only after Nour was asleep (T5), and called things checked before the
receipt existed (T6). The rewrite must add a relay checklist and a pre-clearance step, and make T2, T3, T4 and T6
mechanical: a brief check at dispatch, a Stop hook that compares the `Skills:` line and CI claims with the turn's
tool calls, and a first-Stop block on an unhandled `FIX FIRST`.
