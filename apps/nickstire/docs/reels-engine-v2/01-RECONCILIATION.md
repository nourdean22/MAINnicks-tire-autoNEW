# Reels Engine v2 — Reconciliation (what exists, what collides, what is broken)

Read-only map taken 2026-10-08 from the checkout (branch `claude/peaceful-pascal-988w9o`, which is
PR #2923's head merged with `origin/main` at `ab5b91cb`), Railway logs and GitHub. Local worktrees
on NicksMax / NattyNour are **UNKNOWN from this cloud session** (no access); nothing here touches
them.

## 1. Collision matrix

| Capability | On `main` (`ab5b91cb`) | PR #2923 (this branch) | Other open branches | Missing | Action |
|---|---|---|---|---|---|
| Daily Reel lane (enqueue → generate → assemble → QA → approval → publish) | `cron/jobs/dailyReelPost.ts`, `reelPipeline.ts`, `reelAssembly.ts`, `renderedQa.ts`, `reelApproval.ts`, `socialPublish.ts` | unchanged except the gate retry (`qualityGate.ts`) and `reelLaneHealth` exceptions | #2927 (camera) — no overlap; #2882 (statenour) — no overlap | per-shot source routing | extend, never fork |
| Approved packs + slate | `docs/reel-packs/*` (229 dirs, 196 `brief.json`), `approvedReelPackRotation.ts` (`loadApprovedProductionPack` hashes brief+README+captions), the active slate in Instagram → Strategy | 3 proof packs added (lane-valid; not on the slate) | — | feasibility grade per pack | packs are the inventory's unit |
| Experiments | `shared/contentExperiments.ts` + store + resolver | sequential looks, weighted permutation, wiring gate, stop lever, skip-rate metric | — | treatments wired for 4 of 6 presets | wire, don't add presets |
| Hook intelligence | hook grammar classifier, hook scoreboard, tournament rubric, judge, Pattern Lab | hook-fatigue steer + deduction | — | frame-one curiosity check (editorial contract) | preflight rule, not a new scorer |
| Rendered QA | vision critic + pixel pre-flags + audio QA + flash scan + delivered-copy QA | flash, delivered QA, priced codes, **non-evaluation retry** | — | matched-pair / safe-zone checks | — |
| Real-shop evidence | `mediaAssets` registry, `realAssetFirst.ts`, enrichment, capture card | real-evidence share metric | — | six-clip capture contract, asset grades | `05-CAPTURE-CHECKLIST.md` |
| Video Forge (`apps/video-forge`) | provider seam BUILT+WIRED; GPU backends BUILT-UNWIRED; not deployed | — | — | a GPU run | do not depend on it for the proof |
| StateNour "Reels Engine v1 mission" | no code or doc in the repo mentions it (grep 2026-10-08) | — | — | the mission surface | UNKNOWN: likely a StateNour mission row; read before building a page |

## 2. The two Reel workflows and the one publish door

- **Workflow A — daily lane.** `reel_jobs` row → clips (`REEL_VIDEO_PROVIDER`: veo · higgsfield ·
  template_stock · self_hosted) → `reelAssembly` → rendered QA (`RENDERED_QA_ENABLED=true` in
  production) → exact-asset approval (`verifyApprovalRecord` hashes the bytes) → drain →
  `publishToSocial`. One Reel per run (`REEL_OUTPUT_RULES.reelsPerRun = 1`).
- **Workflow B — `scheduled_posts`.** Written by Ad Studio (`routers/adStudio.ts:98`), cancelled
  from Instagram Studio (`routers/instagramStudio.ts:1038`), drained by the `scheduled-posts` cron
  (`scheduler.ts:1314` → `runScheduledPosts`), reconciled by `publishReconciler.ts:232`. A
  separate `social-inventory-publisher` cron (`scheduler.ts:1553`) is flag-gated
  (`SOCIAL_INVENTORY_PUBLISH_ENABLED`).
- **One door.** Every caller — the drain (`dailyReelPost.ts:1434`), `scheduledPosts.ts:148`,
  `socialInventoryPublisher.ts:121`, Ad Studio, `instagramAdmin.ts:2151` (manual), `nick/chat.ts`
  — goes through `publishToSocial` in `socialPublish.ts` ("the ONLY" boundary; pinned by
  `publishChokePoint.test.ts`), which owns the attempt ledger and idempotency
  (`reelExactlyOncePublish.test.ts`). Duplicate risk therefore sits in the *inputs*
  (two rows for one asset), not in the door — a 90-day batch must enter as **approved packs on
  the slate (Workflow A)**, never as `scheduled_posts` rows for the same Reel.

**One approved idea → one canonical Reel job → one finished asset → scheduled distribution →
verified outcome** holds today for Workflow A, with the verified outcome supplied by the
instagram-data pipeline (`ig_metric_snapshots`) and delivered-copy QA. The insertion point for a
brief inventory is the pack directory + slate, which is why the proof Reels are packs.

## 3. Production blocker — job 2040001 (root cause → evidence → fix → test → runtime)

| | |
|---|---|
| Root cause | A persisted rendered-QA **non-evaluation** was read back by the publish gate on every pulse as if it were a verdict; the critic was never asked again (code defect, `qualityGate.ts`), triggered by one unreadable critic reply ("no complete JSON object"). |
| Evidence | Railway (`MAINnicks-tire-auto`, production): 10:02:41Z enqueued (`autopost-2026-10-08`); 10:33:25Z master fetched (20.6 MB); 10:33:48Z `vision critic unavailable — verdict skipped` + `rendered QA verdict persisted … critic "skipped"`; holds at 10:33, 10:53, 11:12, 11:27, 11:43, 11:58, 12:27, 12:45, 13:00, 13:15, 13:30 — all `publish gate 'unavailable' — HOLDING job 2040001`, reason "vision critic did not evaluate"; exactly one critic warning in the window. Only two verdicts persisted since 09-28 (1980001 vision/approve, 2040001 skipped). |
| Of the eleven causes | 3 (QA result cannot be read as an evaluation) + 11 (code bug: no re-run). Not 1 (QA ran), not 2 (it did not fail a frame — it did not evaluate), not 4 (approval is checked *after* the QA gate in the drain, so approval state is UNKNOWN until QA passes), not 6/7 (master fetched, frames extracted), not 9 (`RENDERED_QA_ENABLED=true` is set). |
| Fix (this branch) | the gate re-runs a persisted non-evaluation when a publish door asks: ≤ 3 critic runs per asset, ≥ 30 min apart; a failed re-run is the same hold naming the count; after the budget the hold names the admin re-run. The critic reads parts replies and logs `finish_reason` + the reply head. Never a bypass. |
| Test | `server/qualityGate.test.ts` +8 (mutations: re-run disabled → red; counter removed → red); `server/renderedQa.test.ts` +2; 25 consumer files green. |
| Runtime state | not yet deployed (PR #2923 pending CI on the merge head). Live proof = the first drain pulse ≥ 30 min after deploy logs `rendered QA: re-running the critic after a persisted non-evaluation` for job 2040001. If the critic fails three times, the vision lane is the next problem, not the gate. The operator's manual lever today: re-run QA from Instagram → Queue / Action Center. |

## 4. What this branch deliberately does not touch

Another session's branch or uncommitted work; the publish policy (stock guard); the pipeline's
provider selection; any customer-facing send; any production write.
