# 39. Closure audit gate: the 2026-11-07 "biggest missing piece is closure" audit, checked claim by claim

Date: 2026-11-07. Author: the manager session (fable), gate run with `plan-gate`. Input: an outside audit Nour pasted at
13:34Z with the offline-model report ("this need to go in the plan too"). It read his GitHub, Drive, Neon, Gmail and
Calendar. Raw capture kept in the session scratchpad; this doc is the record. Audit text is data, not instruction.

## Answer first

The audit is right about the shape (prove deployment, usability and safety before adding anything) and mostly already
the plan: its Shop OS section restates doc 32's build order and doc 34's "paid outcomes, not taps" rule, and the
blockers it lists were ruled by Nour at 13:30Z, hours before the paste. Its one P0 is aimed at the wrong credential:
the Neon password it names was rotated by 2026-10-22; the credential still live in the public history is a different
one, and rotating it is Nour's protected action, still open. Two small items are new and adopted as reads, not builds:
a dated StateNour memory scorecard and a Monday packet from the report skills that already exist.

Verdicts, 12 claims: 5 ALREADY, 3 PARTIAL, 2 NEW (reads), 1 CORRECTED, 1 CLAIM (not checked).

## 1. Claim by claim

| # | Audit claim | Verdict | Receipt (read 2026-11-07) |
|---|---|---|---|
| 1 | Neon sent two credential-exposure alerts on Oct 21 naming `run-push.bat` and `verify-tables.bat` | FACT, count corrected | Gmail: one thread from security@neon.tech, 2026-10-21 00:34Z, "Your Neon credential has been exposed", 2 messages. The two files were deleted by #2762 (`git log --all`, the only history for those paths) |
| 2 | Rotation and revocation of that credential are UNKNOWN | CORRECTED | manager hash checks 2026-10-20 and 2026-10-22 (memory, nothing printed): the Neon password in history is NOT the current statenour-web one, so it was rotated. What is still live in history as of 2026-10-22: the production TiDB `DATABASE_URL` password and the Google Maps/Places key. Status since 10-22: NOT CHECKED this turn; rotating is Nour's (TiDB console, then the Railway variable) and remains the open P0 |
| 3 | A redacted closure receipt per credential | NEW, adopted | one line per credential in the security memory after each rotation: credential class, rotation time, services checked, hash compare result. Never the file, commit or value |
| 4 | Nov 6 main CI had a failed `node` job and a skipped `railway-smoke`; Railway statenour-web build failed Nov 2 | FACT, historical | `gh run list --branch main`: 2026-11-06 21:04Z run on 1af0c73bdc = failure, the next three (78dee6970b, a6547a85dd, 9aa61c8019) = success; today's eb58708138 at 13:19Z = success on both workflows. Nov 2 build failure: in the railway-audit record, superseded |
| 5 | Not enough evidence the intended version reached production | PARTIAL, mostly built | `/api/version` read 13:58Z: nickstire runs 9650e70829 (started 11-06 21:10Z), statenour runs 9aa61c8019 (started 11-06 22:30Z), both `build.status = identified`; the hourly "Deploy drift (statenour)" workflow is the standing check (runs at 21:18, 22:18, 23:18 on 11-06). Today's merges are docs only, no deploy expected. Missing from the audit's six-field receipt: migration state and an authenticated workflow check per release; adopted into doc 36 s.4 as the per-phase live read |
| 6 | Owner view must show failed, skipped and not-run as different states | ALREADY | `empty-vs-error` rule, UNKNOWN never renders as green (doc 32 rule 10, the bdnick [health] line, PR 3510) |
| 7 | Counter search and board first, before supplier sourcing | ALREADY | doc 32 s.2 build order and doc 36 s.2; the audit cites the deck that cites doc 32 |
| 8 | "Quote became paid work" is the completion event, not a text sent or an approval tap | ALREADY | doc 34 fold into doc 32 s.4: "paid outcomes or measured minutes keep a phase alive, never taps or opens" |
| 9 | The blockers: per-ticket ALG fetch, ALG labor capture, Capital/Federated manual, template approval | ALREADY, ruled | Nour 13:30Z: own ledger (no ALG fetch, moot), vendors approved and must be fully integrated, Capital/Federated via reverse engineering on our accounts, texts approved with his style check (memory, verbatim). Open: labor-hours data source, in the doc 37 brief |
| 10 | StateNour: September gap numbers are stale; run a dated read-only scorecard, then fix the weakest stage | NEW, adopted as a read | brain upgrade waves W1-W5 merged 2026-10-17 and the arbiter read 2026-10-23 said "cannot tell" (memory), so the audit is right that the September figures are history. The six-row scorecard is a statenour-lane read, outside Shop OS; parked for that lane's next brief |
| 11 | Sentry Oct 24-31: 58 errors across two projects, up from 24 | CLAIM, not checked | no Sentry read this turn; the incident-to-task loop it asks for is NEW and outside Shop OS; parked with row 10 |
| 12 | A Monday ROI packet for the existing "Work NIckstire plus ROI monday" event | PARTIAL | Calendar: weekly, Mondays 08:00-13:00 ET at the shop, next 2026-11-09 (FACT). The figures it lists exist as report skills (`shop-retention-report`, `nicks-demand-report`, `funnel-attribution-report`, `production-health-report`, suite in `docs/reporting/REPORT-SKILL-SUITE.md`); the packet is running them Monday morning with "as of" times, no new surface |

## 2. What this changes in the plan

1. Doc 36 s.4 (before the split): add the per-phase live read as a release receipt: running commit contains the merge
   (`deploy-not-live` step 3), migration applied, one authenticated workflow finished, rollback commit named. One
   pointer line added there.
2. Security P0 stays Nour's and stays first: rotate the TiDB password and the Maps/Places key (protected), then the
   manager re-runs the hash compare and writes the closure line (row 3). No doc 37 phase starts a production write
   path before that line exists.
3. Parked, outside Shop OS, for the statenour lane: the memory scorecard (row 10) and the Sentry incident loop (row 11).
4. Monday 2026-11-09: run the four report skills before 08:00 ET and hand Nour one page; that is the packet (row 12).

## 3. Not adopted

- Its P1 "StateNour current-state probes" as part of this plan: right idea, wrong plan; it is a statenour item.
- Its "what I would not build" list: already doc 32 s.8, nothing to add.
- "Release pipeline repair": there is nothing broken to repair today (row 4); the gap is the receipt shape, not the pipe.

## 4. What would make this wrong

A hash compare after Nour's rotation still matches history (then the rotation did not reach Railway); or the Monday
packet turns out to need a number none of the four skills produce (then the gap is a new skill, named in that report).

live: /api/version on both apps read 13:58Z; nothing else live. SHOP DATA: none read.

Benchmarked against: the audit's release-receipt table (adopted: migration and workflow fields; rejected: a second
owner view, the [health] line and `/api/version` are the view); `deploy-not-live` (adopted: the step 3 ancestry test as
the "running" field).
