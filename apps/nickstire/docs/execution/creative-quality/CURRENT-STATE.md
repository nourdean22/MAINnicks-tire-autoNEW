# Creative-quality long haul — current state

Updated: 2026-07-17T16:20Z · main `aaf8ebbf5` (#833) · PR #834 open (repair P1 + Gemini failure logging + VO fixture)

## FINAL-COMMAND scoreboard (honest)

| # | Item | State |
|---|---|---|
| 1 | Baseline + benchmarks | **done** (measured; QUALITY-BASELINE.json) |
| 2 | Media registry | **live** — 0088 APPLIED to prod (32/5 cols); 20 rows; ORGANIC producer-seam row captured (ma_5453daac from job 660002); dupes surfaced |
| 3 | Drive vault | **live** — consent granted (drive.file, nourdean22); root `17SCNTPnvjEgwz3ii9o2YNbWdT0SfaOJC`; 19 backfilled + 660002 master archived (fileId `1wjuYbzxURcrfFrfdNSr2o0mnwustqFnQ`); reconcile 20/20. Remaining: auto-archival wiring (no production caller of archiveRegisteredAsset yet), full folder taxonomy, scheduled reconciliation |
| 4 | Real trajectory | **~70%** — 660002 ASSEMBLED (24s stereo, **0 silence events** vs 68% baseline dead air; per-line captions verified in frames; real vision QA verdict approve/8 frames after #833's fixes). Remaining: repair leg (parked on #834's P1 deploy) → reassembly → 2nd verdict → campaign manifest → forensic doc |
| 5-17 | Visual Bible → acceptance campaigns | partial substrates only (gated-assessment percentages accepted as fair) |

## Standing corrections (supersede anything older elsewhere)
- 0088 is APPLIED (no tap pending). Vault is LIVE (not unit_verified). #828–#833 all MERGED. Active trajectory = **660002** (660001 failed on Higgsfield 502 outage; its orphaned governor slot was released by hand — failed jobs never release creation reservations: open defect).
- LLM: **AI_FORCE_GEMINI=true live on prod** — free Gemini carries tournament/brief-gen/QA critic (OpenRouter dry; reversible by unsetting the flag).
- QA hook had NEVER run on prod (data/ path-prefix bug since #819) — fixed in #833. Critic calibration gap: approved frames with visible text artifacts (beats 1-2) — §62 calibration owed, first calibration asset in hand.
- First prod creative_genomes rows exist (4; tournament auto-persist + saveGenome dupe noted).

## Fix queue (verified-or-pending, priority order)
1. ~~P1 repair inventory demotion~~ → PR #834
2. P1 scheduling can outlive approval expiry (verify then fix)
3. P2 repair-claim race (affected-rows unchecked)
4. P2 review gate: COMMENTED overwrites CHANGES_REQUESTED
5. P2 evidenceRecords stripped by ROUTER zod schema (service stringify keeps them; wizard path drops)
6. P2 evidence snapshots serialized (8×6s worst case)
7. Auto-archival wiring for new renders (vault's real remaining leg)
8. Critic calibration (§62) with 660002's missed artifacts
9. Failed jobs must release creation reservations
