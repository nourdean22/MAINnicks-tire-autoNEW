# Reels Engine v2 — index (2026-10-08)

Synthesis of the "Reels Engine v2" mission, the "Generation and Production Audit" and the repo as
it is. The audit's correction governs the order: **3 finished Reels → 8-Reel pilot → 14–21-day
rendered buffer → 30 validated briefs → 90-day inventory.** Every mechanism is marked by reality
state; a gap is a design item, not a promise. Nothing here spends money or publishes.

| File | What it is | State |
|---|---|---|
| `01-RECONCILIATION.md` | The collision matrix: what PR #2923 shipped vs `main` vs other branches; the two workflows and the one publish door; the job-2040001 diagnosis | reference |
| `02-PRODUCTION-DOCTRINE.md` | Real-evidence-first hybrid production by layer, the seven-step shot router, model routing, editorial contract, QA classes, manifest fields, code slices | doctrine; slices 1–3 BUILT + WIRED on this branch |
| `03-FAMILIES-AND-STANDARD.md` | Locked standard vs flexible structure; eight families (A–D entry set); Cleveland Mechanical Noir; hook intelligence gap | reference |
| `04-RESEARCH.md` | Platform facts (Meta safe zones, originality), independent findings, creator leads, 12 ranked methods, prices, hypotheses; the 30-example corpus honestly not met | reference |
| `05-CAPTURE-CHECKLIST.md` | Six shots per usable job; the shots the proof Reels still need; grades; natural sound | shop-floor contract |
| `06-EXPERIMENTS.md` | The five experiments on the sequential-look framework; which treatment is wired today | reference |
| `07-PRODUCTION-METRICS.md` | Twelve production numbers mapped to their instrument; MISSING named | reference |
| `08-PILOT.md` | The 8-Reel pilot: required real asset, synthetic allowance, route, gates, exit criteria | plan |
| `09-90-DAY-MODEL.md` | Three layers with their reality state; the status surface in the existing admin; the operator handoff | plan + handoff |
| `10-FLAGSHIP-PRODUCTION.md` | The three flagship Reels (C, B, A in that order), the 90-minute capture day, memory devices, review sheet, staged 120-credit envelope; synthesized 2026-10-09 from 01-09, two operator reports and production reads | plan; blocked on capture day |
| `angle-bank.json` | 100 feasibility-graded angles over the committed packs (every named pack passes the production builder); rank = production order; A001–A008 = pilot | BUILT + TESTED + WIRED (read-only line) |

Code on this branch, all tested. The first six rows add warnings, a read-only line and docs; the last
two change the live rendered-QA path, on purpose:

| Module | Role | Consumer |
|---|---|---|
| `shared/editorialContract.ts` | frame-one subject, one idea per card, one CTA last, end card ≤ 2 s | `runReelPreflight` (structural WARN) |
| `shared/shotRouter.ts` | `declaredBeatSource` + `shotRouteProblems` (declared source vs what the beat claims); `routeShot` decision table | `runReelPreflight` (production WARN); `routeShot` has no runtime consumer yet (§8 design item, stated in the knip baseline) |
| `StoryboardBeat.source` | per-shot origin on the brief type | preflight; the provider pick does not read it yet |
| `shared/angleBank.ts` + `packBuildsForLane` | inventory validation + status line; usable = the production builder accepts the pack | Creative Assistant `angleBank` reader |
| capture card (`creativeAssistant.ts`) | asks for the six-shot set, stills first (the pool is image-only) | Today tab |
| `docs/reel-packs/2026-10-08-proof-0{1,2,3}-*` | the three proof packs (brief, README, captions) | `08-PILOT.md`; held out of the rotation in `ROTATION_EXCLUDED` with the reason |
| `InvokeParams.reasoningEffort` + `callVisionCritic` | the critic asks Gemini for `medium` thinking (8,192) with 16,384 tokens, so its verdict is no longer cut off (job 2040001, 15:31Z: `finish_reason=length` at 573 chars) | every rendered-QA run and specialist lens |
| `shared/reelJobPayload.renderedQaRunsSoFar` | one run-counting rule for the critic runner and the publish gate | `runRenderedQaOnJob`, `evaluateReelPublishGate` |
