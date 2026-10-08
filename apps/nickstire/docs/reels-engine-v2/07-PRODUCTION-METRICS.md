# Reels Engine v2 — Production metrics first

Audience metrics decide creative direction only after publication is stable. Before that, these
twelve production numbers say whether the machine works. Each is mapped to the instrument that
can read it today; MISSING names the cheapest instrument. UNKNOWN is never rendered as green.

| Metric | Source today | State | Cheapest instrument if missing |
|---|---|---|---|
| Brief-to-first-cut time | `reel_jobs.createdAt` → first `assembled` transition (`updatedAt` at status change; `content_run` stages) | READABLE (query) | — |
| First-cut acceptance rate | exact-asset approval rows (`reelApproval`, `verifyApprovalRecord`) vs assembled jobs | READABLE | — |
| Revisions per accepted Reel | `payload.repairQueue.length` + `renderedQaAttempts` per job | READABLE (after this branch) | operator revision notes = MISSING (free-text log on the approval) |
| Real-footage usability rate | `mediaAssets` with `rightsStatus = real_shop` by `lifecycleState`; `realAssetFirst` outcomes (`pool_empty` / `pool_unenriched` / matched) | PARTIAL | an asset **grade** field (usable / salvageable / missing_context / privacy_blocked / unusable) — until then, the enrichment note |
| Generated-shot acceptance rate by model and shot class | generation ledger rows (provider, model, cost) + `clipProbes` (provider per beat) + rendered-QA findings per beat | PARTIAL | accepted/rejected per shot (one boolean on the ledger row when a repair replaces the clip) |
| Cost per accepted generated shot | ledger `costUsd` (estimates flagged `isEstimate`) ÷ accepted shots | PARTIAL (needs the boolean above) | same |
| Total cost per accepted Reel | ledger sum per job ÷ approved jobs | READABLE (estimate-flagged) | — |
| % of runtime supported by real Nick's evidence | `payload.realAsset` (one per Reel); `StoryboardBeat.source` exists on the brief type (this branch) and the proof packs declare it per beat | PARTIAL | the pipeline persisting `source` per beat → seconds of `real` beats / total |
| Mechanical defect rate | rendered-QA findings with `MECHANICAL_MISREPRESENTATION`, `BEAT_SEMANTIC_MISMATCH`, identity drift per evaluated Reel; `mechanicalTruth` refusals at the door | READABLE | — |
| Visual defect rate | all other block/warn findings + pixel flags per evaluated Reel | READABLE | — |
| % intelligible when muted | `validateMutedFirstClarity` + readability gate (every beat has readable text) — a proxy | PROXY only | a muted phone review recorded on the approval (one tap: "followed it muted") |
| Successful render and upload rate | `reel_jobs` status transitions (`failed` / `needs_regen` vs `assembled`) + publish attempt ledger + delivered-copy QA | READABLE | — |

Where these are read: nowhere yet as one view. The honest home is the existing Pipeline health
view (`?igview=pipeline`), one card, numbers with their states (HEALTHY / DEGRADED / UNKNOWN), not
a new dashboard. Until that card exists, the numbers are a query the operator can ask for.

Reporting rule: a metric with no rows is UNKNOWN, not 0%; a proxy says "proxy".
