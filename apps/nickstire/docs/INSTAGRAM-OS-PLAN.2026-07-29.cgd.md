---
clarity-gate-version: 2.1
processed-date: 2026-07-29
processed-by: Claude Fable 5 (repo-verified gate) — HITL rounds pending Nour
clarity-status: CLEAR
hitl-status: PENDING
hitl-pending-count: 5
points-passed: 1-9
document-sha256: e1b807008a3ab1f807c6d27c3388abfcec95ef73192619359ca48739974c18ff
hitl-claims:
  - id: claim-feed-audit
    text: "Current public @nicks_tire_euclid feed quality is unaudited; a 20-post/20-reel authenticated sample audit is a launch prerequisite"
    value: "unaudited"
    source: "Run the sample audit with owner access (the source plan itself refused to fabricate this)"
    location: "pending-hitl/1"
    round: B
  - id: claim-insight-coverage
    text: "Prod instagram_analytics row count and insight-column coverage (reach/saved/views/shares non-null share) are unknown"
    value: "unknown"
    source: "Probe prod TiDB: SELECT COUNT(*), COUNT(reach) FROM instagram_analytics (07-16 probe predates the live-Graph wave and showed 0 rows)"
    location: "pending-hitl/2"
    round: B
  - id: claim-draftboard-use
    text: "Whether the operator still uses the gear→Planning campaign-package lane decides route-into-inventory vs retire"
    value: "operator decision"
    source: "Ask Nour; the lane's PublishDrawer still marks posted into the Google-Sheet CRM only"
    location: "pending-hitl/3"
    round: B
  - id: claim-aac-canary
    text: "Meta accepts the pipeline's AAC 192kbps stereo audio (Meta's API collection lists 128kbps); classify required vs accepted vs recommended"
    value: "192k in code, publishes have succeeded historically"
    source: "Owner-gated reel canary + inspect the resulting transcode (reelAssembly.ts:430 confirmed -b:a 192k)"
    location: "pending-hitl/4"
    round: B
  - id: claim-storage-envs
    text: "Whether prod Railway has S3_BUCKET + CLOUDFRONT_DOMAIN set is unknown from the repo; the code path is built and fail-closed either way"
    value: "unknown"
    source: "Open Instagram → Today after deploy — the new Delivery row reports it live; or railway variables --service MAINnicks-tire-auto"
    location: "addendum/1"
    round: B
---

# Instagram OS Plan — Clarity-Gated Verdict Register (2026-07-29)

> **What this is.** The operator delivered a ~1,500-line "Nickstire Instagram
> Operating System" audit/strategy (chat-delivered, 2026-07-29, anchored on main
> `0ad000b79`) and asked for an accuracy gate plus a build-on-what-exists pass.
> This file is the gate's output: every load-bearing claim verified against the
> repo at that same anchor, verdicts recorded, and the roadmap corrected to
> exclude what already shipped. **The source plan is NOT committed** — it
> contains pre-gate framings; cite THIS file, not the chat text.
>
> House rule this file exists to enforce: this repo has now received **six**
> externally-generated mega-plans that were majority-already-shipped or partly
> refuted. Gate before building. Always.

## How verification was done

Direct reads/greps of the cited files at `0ad000b79` (all 12 commit SHAs the
plan cites resolve — this plan was written from real repo access, unlike the
2026-07-16 pair that cited nonexistent paths), cross-checked against the memory
registers for the 07-16 / 07-19 / 07-24 / 07-25 / 07-27 Instagram arcs, with
the standing refuted-framings lists applied.

---

## Verdict register

Legend: **CONFIRMED** real at anchor · **SHIPPED-HERE** fixed in this PR ·
**ALREADY-SHIPPED** existed before the plan was written · **REFUTED** wrong ·
**NARROWED** true but smaller than framed.

| # | Plan claim | Verdict | Evidence |
|---|---|---|---|
| P0-1 | Manual Publish Drawer is a live divergent publish path | **CONFIRMED** | `PublishDrawer.tsx:99` "Publishing is manual", copy-Higgsfield/copy-caption steps, "Mark as Posted" writes the **Google-Sheet CRM** — a second definition of "posted" outside the attempt ledger. Reachable: `InstagramAdmin.tsx:131` gear→Planning → `DraftBoardPanel.tsx:412`. Nuance: Planning is a deliberately-demoted secondary surface (Wave 4), not a competing primary. |
| P0-2 | No single content identity across formats | **NARROWED** | `social_content_item` exists nowhere — but reels↔inventory already share the keystone (`inventoryId`, migration 0096; healer `reelInventoryLink`). The REAL orphan is the campaign-package carousel lane: `contentAdmin.allCarouselDrafts`/`saveCarouselDraft` is a separate draft model outside `social_content_inventory`. Scope the fix to that lane, not a new parent table for everything. |
| P0-3 | Reel approval preview crops 9:16 into an `h-40` landscape card | **SHIPPED-HERE** | Was exactly as claimed (`ReelQueue.tsx` `h-40` + `object-cover`). This PR: card preview is `object-contain`, and a **9:16 review room** dialog adds full-frame playback with sound, UI-overlap safe-zone overlay, the server-authoritative publish caption, blocking findings, re-run-QA, and in-room approve. Publishing stays on the card's two-tap exact-payload panel. |
| P0-4 | Canonical Create is not real-media-first | **CONFIRMED (open)** | StudioV2's only evidence input is a text field ("Context or evidence", line ~406). No capture/upload/vault picker. Server-side ingredients exist: `mediaRegistry.ts` + `creativeVault.ts` (Drive-archived, checksummed) + renderers accept subject images. This is the highest-value OPEN build. |
| P1-5 | Static families (3) and advanced carousel territories (13) are two accidental products | **CONFIRMED, count verified** | `visualFamily.ts` = exactly `mechanic_evidence` / `seasonal_offer` / `road_hazard`; `client/src/lib/igCarouselStudio.ts:77-90` = exactly 13 territories. Hazard the plan missed: `server/services/socialIntelligence.ts:12` exports a DIFFERENT 8-item `CREATIVE_TERRITORIES` (GBP/caption engine) under the same name — rename on next touch. |
| P1-6 | "A high aggregate can hide a blocker" | **REFUTED** | `instagramStudio.ts:231` — `gate = blockers.length ? "block" : …`; blockers zero out claim-safety and force `block` regardless of aggregate; `:503` throws on publish. The reel path's overrides are ADVISORY-only ("A hard BLOCK finding can never be overridden" — ReelQueue UI). Only the *naming* suggestion survives: label the score "Preflight" in the UI (small ticket). |
| P1-7 | Insights stores reach/saves/views/shares but the UI throws them away | **SHIPPED-HERE (display)** | Schema `instagram_analytics.reach/saved/views/shares` (nullable = unknown, never zero) were stored by the sync and dropped by `getTopPosts()`'s mapper. This PR: reader returns them, Learn renders them null-guarded per post + a **saves/1k-reached** badge on winners, and the source line states "absent means unknown, never zero." Windows/snapshots (24h/7d/30d) remain OPEN — they need a new table. |
| P1-8 | No experiment registry for content | **CONFIRMED (open)** | Experiments exist only in the SMS/recovery domain (`declinedWorkRecovery.experiment`). Nothing for IG content. Sequenced AFTER metric snapshots — an experiment registry without windowed metrics can't conclude anything. |
| P1-9 | Story support technically present, operationally thin | **CONFIRMED, narrower than framed** | API path is DONE: `metaSocial.ts:610` `postInstagramStory` (media_type STORIES + container polling + shared publish). Geometry is DONE: `visualFamily.ts` STORY_W/H + STORY_SAFE_TOP/BOTTOM. Missing: the operator-facing Story recipe + capability display. |
| P1-10 | Touch targets miss "the repo's current 48px standard" | **REFUTED standard, real instance fixed** | The 48px "repo standard" was already refuted at the 07-25 gate — the floor is **44px** (Apple HIG, `min-h-11`). The `h-7` Inbox control was real but is the reply-composer OPENER (the live "Post Live" action was already `min-h-11`). This PR: opener → `min-h-11`. |
| P1-11 | Historical reel failures (63 jobs / 59 failed) prove telemetry must be visible | **CONFIRMED as history; partially built** | The counts match the dated 07-16 production audit (Veo key-leak era). Since then: attention badge (`reelJobsNeedingAttention`) + ActionCenter + rendered-QA + repair loop shipped. OPEN: a 30-day stage-rate reliability panel. |
| P2-12 | Internal audio targets lack source metadata | **CONFIRMED (open)** | `audioQa.ts` AUDIO_DELIVERY has numeric targets + date, no source record. Platform-spec registry (doc with source URL / retrieved date / required-vs-recommended / canary date) remains the right cheap fix. AAC **192k** confirmed at `reelAssembly.ts:430` vs Meta's listed 128k → logged as PENDING canary, per the plan's own (correct) advice not to blind-downgrade. |
| IG-006 | One publication authority | **ALREADY-SHIPPED + gap fixed here** | `publishToSocial` + shared `killSwitchBlockedPlatforms` (#1127) + governor counting all four doors (#1129) + Ad Studio routed (#1055). Gap found by THIS gate: `scheduledPosts.ts` omitted `actor:"automated"` → the scheduled executor failed **OPEN** on unreadable kill-switch state. Fixed here + a source-scan pin over every unattended caller. Known-open by choice: CommandQueue's IG lane (07-24 register). |
| IG-007 | Hash approval over exact payload | **ALREADY-SHIPPED** | `contentApprovals.ts`: briefHash = sha256(verbatim brief) + ordered media digest; publish recomputes and refuses `brief_mismatch`; router surfaces "Integrity breach… Re-review and re-approve." |
| IG-034 | Ambiguous/manual publication reconciliation | **ALREADY-SHIPPED** | `publishReconciler.ts` resolves by ASKING META — confident match auto-resolves, anything less goes to the operator with candidates + reasoning; ambiguity parks the WHOLE row (`scheduledPosts`), canary parks `publish_ambiguous`. The plan's §16 incident flow largely exists. |
| IG-036 | Comment webhooks primary, polling reconciliatory | **CONFIRMED (open, size it)** | Zero IG/Meta webhooks in `server/routes/webhooks/` (SMS/Twilio/VAPI only); comments arrive via Sync Feed polling. Before building: measured inbound IG volume is TINY — webhooks are correctness/rate-limit hygiene, not a revenue lever. Low priority. |
| IG-037 | Persist `media_product_type` | **CONFIRMED (open)** | Zero occurrences repo-wide. Needs one nullable column (TiDB: ONE schema change per ALTER, hand-applied) + capture on publish/sync. Small, real. |
| IG-028 | Account capability health | **PARTIAL before, still open** | Tri-state Meta liveness chip in the shell header + live Graph check in `getPipelineHealth` exist. Full permission/scope inventory + expiry calendar remain open. |
| §11 | Container polling lifecycle | **ALREADY-SHIPPED** | `pollContainerReady` shared across image/story/reel (`metaSocial.ts:314` note: "existed as three inline copies"), plus attempt ledger + CAS claims at every door. |
| §12.3 | Reject AutoTrain/Axolotl/Unsloth/Camoufox/etc. as dependencies | **AGREED** | Concurs with repo policy; anti-detection browsing additionally violates the no-evasion rule. Nothing to build. |
| §20 | All cited commits/paths | **VERIFIED** | All 12 SHAs resolve; all cited files exist at anchor. |

### Also stale in the plan (minor)

- "Five clear views" → five **primary** views + gear-demoted secondaries
  (planning / actions / control / settings) — deliberate IA, not drift.
- "Open Drafts tab" stale-instruction complaint — already the shape of things;
  the drawer's instructions themselves are the stale artifact to retire.
- The plan grades Publication safety A- without knowing about
  `publishReconciler`, the ambiguity parking, or the scheduledPosts fail-open
  it should have subtracted for. Net grade unchanged; ledger differs.

---

## Shipped in this PR (every item justified by a verdict above or in the addendum)

1. **Fail-closed scheduled publishing** — `scheduledPosts.ts` passes
   `actor:"automated"`; `killSwitchSharing.test.ts` gains an anti-vacuity
   source scan pinning EVERY unattended `publishToSocial` caller (reel cron,
   inventory drain, scheduled executor), comments stripped before counting.
2. **9:16 Reel review room** — `ReelQueue.tsx`: card preview un-cropped
   (`object-contain`), "Review 9:16" opens full-fidelity dialog: sound-on
   playback, toggleable UI-overlap zones (advisory fractions, pending the
   platform-spec registry), server-authoritative caption, blocking findings,
   re-run QA, in-room approve, and the **ten-question approval standard**
   panel. First-frame-as-cover judgment is instructed in-room (cover cannot
   be edited after upload, per Instagram Help).
3. **Learn shows what the pipeline stores** — per-post reach/saves/shares/views
   (null-guarded; unknown never renders as zero) + saves/1k-reached +
   coverage-honest Distribution badge on winners.
4. **44px floor on the Inbox reply opener** (repo standard is 44, not 48).
5. **Delivery-issue engine** — `server/services/socialDeliveryIssues.ts`
   (pure deriver + gatherer + `instagramAdmin.getDeliveryIssues`), 10 pins in
   `server/socialDeliveryIssues.test.ts`; Today renders blockers/warnings as
   decision rows with the smallest safe next action. Contract: unknown is
   never zero; deliberate stops (kill switches, disarmed gates) are INFO.
6. **Reel Distribution Score** — `shared/reelScore.ts` (weights
   30/25/20/10/10/5): coverage-renormalized, refuses below 50% measured
   weight, refuses per-reach math without reach; ceilings are labeled
   ESTIMATES pending our own snapshot data. 9 pins in `server/reelScore.test.ts`.

---

## Corrected build queue (what is GENUINELY open, in order)

**Wave A — unify + truth (no schema changes except A2):**
1. Campaign-package handoff: render → stage into `social_content_inventory`
   (assetPaths + provenance + territory tag) so advanced carousels flow through
   the SAME approval-hash → Publish → ledger path; demote PublishDrawer to an
   explicitly-labeled export fallback whose "posted" claim requires
   reconciliation (permalink or media id), not a sheet write. *Blocked on
   claim-draftboard-use (keep vs retire the lane).* 
2. `media_product_type` column + capture (one ALTER, hand-applied) (IG-037).
3. Reel reliability panel: 30-day per-stage failure/ambiguity rates from
   `reel_jobs` — read-only query + Today card (closes P1-11).
4. Platform-spec registry doc: photo/reel format contracts, safe-zone
   fractions, AAC 192k-vs-128k discrepancy, each with source URL + retrieval
   date + required/recommended + canary date (closes P2-12; unblocks
   claim-aac-canary).

**Wave B — evidence-first Create (the big one, P0-4):**
5. Evidence step in StudioV2: phone capture/upload → media registry
   (checksummed, Drive-vaulted — the services exist) → subject images into the
   render path; provenance + consent fields; blur/orientation warnings.
   Recipes (Photo Proof / Teach-in-5 / Reel-from-Clips / Story Today) come
   AFTER the evidence step exists — they are entry points into it.

**Wave C — measurement (schema work, sequenced):**
6. Metric snapshot table (24h/7d/30d/lifetime immutable rows) + sync capture;
   then windowed views + reach-normalized cohorts in Learn (rest of IG-020/021).
7. Experiment registry (IG-022) — only after 6; needs windows to conclude.
8. Preflight rename + per-dimension display (the surviving sliver of P1-6).

**Explicitly NOT queued:** new parent table spanning every format (P0-2 as
framed — the inventory IS the parent; extend it), comment webhooks before
volume justifies (IG-036), any external repo from §12.3, any 48px sweep.

---

## Addendum — gate of the two same-day follow-up plans

Two more plans arrived mid-flight: **"elite short-form mechanics"** (hooks,
18-second structure, loop engineering, six content lanes, Pattern Lab, Trial
Reels, pattern memory) and **"Ads-Manager operating model"** (campaign
hierarchy, paused-by-default, payload confirmation, delivery issues, service
feed, change history). Same discipline, same anchor. Verdicts:

| Proposal | Verdict | Ground |
|---|---|---|
| "Hard blocker: wire the storage bucket first" | **ALREADY BUILT — operator CONFIG task, not engineering** | `storage.ts` fail-closes paid generation without `S3_BUCKET` (`assertDurableStorageForGeneration`); health already reports `!!S3_BUCKET && !!CLOUDFRONT_DOMAIN`. Setting the env vars IS the task — now a standing Delivery blocker with exactly that next action. |
| Visual-world lock; make mandatory before clips | **PARTIAL — exists, mandatory-gate queued** | `visualWorld.ts` wired into reelPipeline / renderedQa / reelDraftPrep / contentManufacturing; image conditioning behind `REEL_IMAGE_CONDITIONING` (default OFF — paid implication). Forcing it ON is a spend decision, not a silent flag flip. |
| Paused-by-default status ladder | **ALREADY SHIPPED** | draft → needs_review → ready → scheduled → published, CAS-guarded, approval-invalidating. "Generated ≠ ready" is already the law here. |
| Full-payload confirmation before live writes | **ALREADY SHIPPED + extended here** | Two-tap exact-payload panel (reel absorption wave) + this PR's review room. |
| Idempotency, duplicate protection, reconcile-before-retry | **ALREADY SHIPPED** | CAS claims at every door, durable attempt ledger, whole-row ambiguity parking, `publishReconciler` asks Meta before any retry. |
| Change history | **LARGELY SHIPPED** | Operator action log, admin audit, attempt ledger, approval records, score rule-versions. A unified viewer is queued, not the record-keeping. |
| Delivery-issue engine + "smallest safe next action" | **SHIPPED-HERE** | See "Shipped in this PR" #5. |
| Distribution score (30/25/20/10/10/5) | **SHIPPED-HERE, honestly partial** | See #6 — full coverage requires watch-time/follows, which arrive with the snapshot wave. |
| Ten-question approval standard | **SHIPPED-HERE** | Review-room panel. |
| Objective-first setup | **ALREADY SHIPPED** | `INSTAGRAM_OBJECTIVES` + StudioV2's source → format → objective order. |
| "real shop photo" as a source | **ALREADY SHIPPED (enum) — upload UI is Wave B unchanged** | `real_shop_photo` sits in `INSTAGRAM_SOURCE_TYPES` today. |
| Trial Reels workflow | **NEW — queued (no DDL needed)** | Zero code today. Trial state + manually-entered 24h metrics can ride `briefJson`; UI joins the review room. |
| Pattern Lab + pattern-memory tables | **NEW — queued; design accepted with constraints** | Transformer must feed the EXISTING concept tournament (never a second generator); `social_reel_patterns` / `_experiments` / `_performance_snapshots` join the snapshot migration batch; "extract the pattern, not the content" + no-scraping adopted as written. |
| Campaign hierarchy (Brand → Campaign → Set → Variant → Asset) | **NEW — queued, mapped onto existing substrate** | `contentRun` + campaign keywords + inventory are the substrate. A campaign grouping field joins the migration batch. Do NOT build a parallel content model. |
| Service feed catalog | **NEW — queued with a truth constraint** | Schema accepted; `mechanicTruths`/`approvedClaims` may only be populated from verified evidence records — an invented claims list would violate the truth kernel this repo enforces in five other places. |
| Six content lanes, five seed concepts, weekly cadence | **ADOPTED as operator playbook (not code)** | Creative direction; all within existing claim-safety bans and the governor's cadence caps (policy v8: 20/day). Start at 3 Reels/week per the plan's own advice. |
| Replace IG admin with a 9-section layout | **REJECTED as replacement; absorbed as content** | The five-primary + gear IA is the audited shape (#1037-#1043). Delivery lives in Today now (a standalone panel only if row volume ever demands it); Campaigns/Insights arrive inside existing views. |
| Meta/Instagram platform statistics quoted (3B MAU, 4.5B reshares, 8.5s watch time, Trial-Reel 40%/80%) | **UNVERIFIED HERE — treat as vendor-reported** | Third-party/report numbers not re-verified this session; nothing in the build depends on them. |

**Queue updates from the addendum:** new **Wave A0** = operator env task
(`S3_BUCKET` + `CLOUDFRONT_DOMAIN` on Railway — claim-storage-envs) and
**Wave C′** (post-snapshots) = Trial Reels workflow → Pattern Lab +
pattern memory → campaign grouping → service feed.

## Standing refuted list (do not re-plan — additions from this gate)

- Aggregate score can mask a blocker → blockers force `block` (see P1-6).
- 48px repo standard → 44px HIG floor (second refutation).
- "No approval-payload binding / no reconciliation" → `contentApprovals` +
  `publishReconciler` shipped long before the plan.
- The h-7 control was the live reply action → it was the composer opener.

---

## HITL Verification Record

### Round A: Derived Data Confirmation (evidence witnessed this session)
- All file:line citations in the register — read directly at `0ad000b79` ✓
- 12/12 plan-cited commit SHAs resolve in git ✓
- AAC 192k in assembly (`reelAssembly.ts:430`) ✓
- 13 client territories / 8 server (different systems, same constant name) ✓
- Historical 63/59 reel-failure counts match the dated 07-16 prod probe ✓

### Round B: True HITL Verification (PENDING — operator)
| # | Claim | Why HITL needed | Confirms |
|---|-------|-----------------|----------|
| 1 | claim-feed-audit | Needs authenticated owner access to the live feed | [ ] |
| 2 | claim-insight-coverage | Needs a prod TiDB probe (read-only) | [ ] |
| 3 | claim-draftboard-use | Operator workflow fact, not derivable from code | [ ] |
| 4 | claim-aac-canary | Needs an owner-gated live canary + transcode inspect | [ ] |
| 5 | claim-storage-envs | Railway env state is not readable from the repo; the new Delivery row answers it live | [ ] |

<!-- CLARITY_GATE_END -->
Clarity Gate: CLEAR | PENDING
