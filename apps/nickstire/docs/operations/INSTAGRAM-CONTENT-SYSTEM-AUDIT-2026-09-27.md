# Instagram + Content System Audit — 2026-09-27

Status: execution audit + truth repair.
Scope: Nick's Tire & Auto Instagram admin, content generation, Reel pipeline, publishing, analytics/learning, and public-profile presentation.

## Evidence / authority order

This audit did not treat docs or old session claims as truth. Evidence was reconciled in this order:

1. public Instagram profile and live media
2. production Railway configuration/logs
3. production database read-only probes
4. current `origin/main`
5. current service/router/schema wiring
6. tests/build
7. historical docs

Concurrent-work guard: implementation was isolated to a dedicated clone/branch and did not reset, stash, merge, or edit the NicksMax/NattyNour shared working copies.

## Public Instagram truth snapshot

Observed from Instagram's rendered public profile / SSR on 2026-09-27:

- account: `@nicks_tire_euclid`
- public follower count: 3,261
- public post count: 675
- verified profile
- primary link: `nickstire.org`
- additional financing links: Synchrony + Acima
- Highlights exposed publicly: `Testimonials`, `COUPONS!!!!`

The recent public grid is visually coherent around Nick's black/yellow identity, but the recent educational Reel cohort repeats a narrow production grammar: dark macro automotive imagery, shallow depth of field, yellow condensed captions, slow cinematic movement, and similar explanatory beats/CTAs.

## Recent live Reel outcomes

Production metric snapshots prove the Reel/Instagram metric ledger is collecting real outcomes. Selected September examples:

| Topic | Reach | Views | Skip rate | Notes |
| --- | ---: | ---: | ---: | --- |
| road-trip checklist | 328 | 397 | 36.8% | current-day snapshot |
| brake lines / salt | 298 | 340 | 53.8% | low interaction snapshot |
| serpentine squeal | 564 | 659 | 43.9% | saves/shares present |
| tread: legal vs safe | 1,766 | 1,910 | 32.7% | strongest sampled reach |
| plug vs patch | 356 | — | 70.5% | weak early retention |
| transmission fluid | 817 | — | 33.8% | strong relative retention |
| pothole damage | 287 | — | 57.1% | weak reach |
| struts | 352 | — | 82.9% | very high skip |

These are descriptive snapshots, not causal proof. Age, distribution, audience mix, and creative treatment differ.

## Content-quality finding: idea diversity != production diversity

A programmatic census of the 32 approved Reel packs added on 2026-09-25 found:

- 31 / 32 unique hooks
- 32 / 32 source briefs at 20 seconds
- 32 / 32 with five beats
- 32 / 32 with a visit-oriented ask
- 160 beat visuals but only 10 unique visual descriptions
- 7 unique motion descriptions
- 3 unique audio cues
- only 2 distinct loop descriptions
- 23 / 32 reuse the same four-hashtag set

The existing variety test verifies high-level motion-lens/archetype distribution; it did not measure raw beat grammar. That allowed varied labels to sit on highly repeated visual structure.

## Approved backlog truth

Approved Reel rotation currently contains 133 packs.

The old failure mode was "reviewed packs never become reachable." That was correctly repaired. The next bottleneck is editorial selection: "approved" must not mean "equally deserving of the next publication slot."

Target distinction:

- **Approved library** — safe, truthful, usable
- **Active slate** — strongest current candidates given timeliness, fatigue, available first-party footage, local demand, format balance, and measured prior outcomes

## Production correctness defect: Reel publication split-brain

### Before repair

The dedicated Reel publishing authority correctly stored:

`reel_jobs.status = posted/published` + durable `igPostId`

But the linked `social_content_inventory` row could remain:

`status = review_ready` + `publishedAt = null`

The universal metric sync intentionally reads only inventory rows marked `published`. Production therefore had real Reel metrics in the Instagram ledger while the universal content/learning layer still described the same content as unpublished.

This was the root cause of a live loop that could match inventory candidates yet update zero universal-inventory metric rows.

### Repair

The repair keeps Meta / `reel_jobs` authoritative and mirrors only **confirmed live** truth:

- ordinary Reel publish -> inventory mirror
- ambiguous publish reconciled as live -> inventory mirror
- recurring metric sync -> idempotent historical self-heal
- repair predicate requires terminal live Reel status **and** durable Instagram media ID
- mirror-write failure never converts a successful Meta publish into a retry, avoiding duplicate-post risk

Reel metric lookup now prefers exact identity:

`social_content_inventory.id = reel_jobs.briefId -> reel_jobs.igPostId -> instagram_analytics.postId`

Caption matching remains only as a legacy/static fallback.

## Content-run lineage

The schema describes `content_runs` as the durable parent of a "make something" request, but production had only one September content run and it remained in an unproven generating state while many Reels were created/published outside that lineage.

This branch wires Reel creation/deduplication and later Reel stages into the existing content-run model instead of inventing a second lineage model.

Target:

`content_run -> creative artifact -> inventory -> reel job -> approval -> publish -> IG media ID -> metrics`

## Static Instagram autopost resilience

Production logs/ledger showed multiple recent static-autopost generation failures, including incomplete/truncated JSON and "no caption" outputs.

The repair moves the vulnerable generation boundary toward schema-constrained structured output and retries malformed/truncated model output **before any external side effect**.

No extra publish retry is introduced.

## Creative QA

Rendered QA now recognizes two explicit blocking defect families that the sampled public output made important:

- `BEAT_SEMANTIC_MISMATCH`
- `MECHANICAL_MISREPRESENTATION`

Both route to generated-beat regeneration rather than being silently categorized as generic defects.

A deterministic production-grammar fingerprint was added for approved Reel briefs so structure repetition can be measured directly rather than inferred from archetype labels.

Fingerprint dimensions include:

- duration bucket
- beat count
- beat-purpose sequence
- visual families
- motion families
- audio families
- CTA family
- loop family

## Real-shop media

Instagram Studio evidence upload now registers usable first-party shop imagery in the existing media registry with `rightsStatus = real_shop`.

Usable uploads are registered in the existing media registry with `rightsStatus = real_shop`, so the evidence is durably identifiable and reusable.

The consolidation branch now closes the retrieval half inside Create: the picker exposes only **current + reuse-allowed + image MIME + direct runtime URL** first-party assets. It deliberately does not substitute a Google Drive viewer page for a fetchable image URL, and the Strategy count uses the same eligibility predicate as the picker so the operator does not see a larger "reusable" count than Create can actually use.

This supports a content strategy of real repair/shop evidence first, with AI used where it adds explanatory/creative value rather than pretending synthetic imagery is customer evidence.

## Operator UI / public bridge

Primary Instagram admin labels now express operator jobs:

- Today
- Create
- Queue
- Community
- Learn

Underlying route keys/state machines remain unchanged in this slice.

The homepage adds a native Nick's Instagram proof section using the existing Graph-synced public router instead of loading Instagram's third-party `embed.js`. It renders up to three recent posts, links to the canonical profile, and fails down to a direct profile link if the cache is unavailable.

## Shadow-judge calibration warning

The current shadow judge is useful but is **not calibrated enough to become a hard publishing gate**.

Production evidence includes Reels that the shadow judge rejected yet later produced comparatively strong measured reach/retention, and other rejected Reels that were weak. Treat the judge as a critic/hypothesis generator until enough outcome-linked calibration exists.

## Verification receipts

Changed-path verification completed in the isolated branch:

- focused Instagram/Reel correctness tests: 5 files / 42 tests passed
- adjacent integration slice: 18 files / 224 tests passed
- Nick's TypeScript typecheck: passed
- full Nick's Vitest suite: process exit 0
- production build: passed
  - Vite client: 3,334 modules transformed
  - server bundle: built
- `git diff --check`: clean

The full suite emitted expected test-path degradation/warning logs for unrelated mocked/unconfigured integrations; the process itself completed successfully.

## 2026-09-27 consolidation closure — built in branch

The seven operator-control gaps above were reconciled against current code rather than implemented as parallel systems:

1. **Active slate** — a Strategy surface ranks approved packs transparently and can persist an ordered production overlay. The overlay has its **own durable cursor**; activating, advancing, exhausting, or clearing it does not reset or consume the canonical full-library cursor. Saving rejects unknown/duplicate/over-limit pack IDs instead of silently normalizing them.
2. **Creative entropy** — approved-pack production-grammar fingerprints and novelty collisions are visible in Strategy, Create, and Queue. They are diagnostic signals only; normal generation/QA/approval/publish gates remain authoritative.
3. **Outcome-linked structure hypotheses** — measured attention-microstructure comparisons become explicitly non-causal, testable priors with a controlled handoff back to Create.
4. **Profile merchandising** — Strategy provides measured pin-candidate roles, recent Reel cover review, a BUSINESS-SSOT-derived suggested bio, and upload-ready black/yellow Highlight covers. Bio edits, pinning, Highlight ordering, and cover uploads remain explicit Instagram-side operator actions; no unsupported Graph control is claimed.
5. **Real-media retrieval** — Create can reuse eligible `real_shop` images from the existing media registry rather than forcing another upload.
6. **Judge calibration** — shadow verdicts are joined to downstream append-only reach/save/share/skip snapshots. Both terminal live status spellings (`posted` and reconciled `published`) count as published. The UI hard-codes no promotion verdict: `hardGateSupported` remains false and observational alignment is labelled descriptive, not causal.
7. **Admin visual QA** — deterministic authenticated-client fixtures were exercised in system Chrome at 1440x900 and 390x844. Strategy rendered with 5 primary tabs, all expected controls, and **0 horizontal overflow** at both widths; Create rendered the real-shop media picker with **0 horizontal overflow**. The only fixture 404 was `/api/admin/events`, expected because Vite-only QA had no backend SSE server.

### What is still genuinely open

- **Merge / deploy receipt** for this consolidation branch.
- **Authenticated production browser pass after deployment** against real live data/session. The deterministic fixture proves client layout/runtime behavior, not production auth, database values, or live Meta mutations.
- **Instagram-side profile changes** (pins, bio, Highlights) remain human/operator actions by design.
- **Judge hard-gate promotion** remains intentionally unapproved until controlled validation supports it.

## Truth labels after the consolidation branch

- Meta/IG publishing plumbing: **LIVE + VERIFIED**
- Reel metric collection: **LIVE + VERIFIED**
- universal Reel inventory metric loop: **BROKEN in production snapshot; REPAIRED + TESTED in branch, pending deployment verification**
- Reel content-run lineage: **PARTIAL in production; WIRED + TESTED for new Reel flow in branch**
- static IG autopost: **LIVE BUT RECENTLY UNRELIABLE; resilience repair TESTED, pending deployment verification**
- content truth/claim QA: **BUILT + WIRED**
- active-slate production overlay: **BUILT + WIRED + BEHAVIOR-TESTED in branch; pending merge/deploy**
- production-grammar fatigue visibility: **BUILT + WIRED + TESTED in branch; diagnostic, not a gate**
- outcome-linked structure priors: **BUILT + WIRED + TESTED in branch; correlation-only**
- real-shop media retrieval in Create: **BUILT + WIRED + CLIENT-QA'D in branch; pending merge/deploy**
- profile merchandising operator surface: **BUILT + CLIENT-QA'D in branch; Instagram-side mutations remain manual**
- Reel shadow-judge outcome calibration: **BUILT + TESTED in branch; hard gate remains unsupported**
- public Instagram homepage bridge: **BUILT + TESTED in prior branch, pending live receipt if not already deployed**
- authenticated production pixel-level QA: **STILL UNVERIFIED until post-deploy logged-in pass**

## 2026-09-28 production closeout

The implementation audit above now has live receipts beyond merge/deploy status:

- **Runtime:** Nick production is exact #2737 (`e68f4ed4f0bd61d84968a1d6b1aa3845727213e2`), Railway deployment `46e62cbf-7983-45a3-9387-3a74c183b6ad` SUCCESS. Repository `main` is newer at #2739, but that camera-only commit correctly SKIPPED the Nick service.
- **Authenticated Admin:** a real signed-in production session exercised the backing procedures for Today, Create, Queue, Community, Learn and Strategy. Pipeline health, creation brief, Studio diagnostics/board, evidence options, real-shop media, active slate, live feed, analytics, performance reporting, profile merchandising, judge calibration and structure hypotheses all executed against live data.
- **Pattern Lab:** end-to-end production lineage is now proven. After the empty table bootstrapped four unmeasured house hypotheses, the first successful cohort selected `rp_house_myth_reality`, persisted it on Reel job `1980001`, passed rendered QA (6 frames, 0 findings, `publishGate=proceed`), received exact-asset/exact-caption approval, and published as Instagram media `18634414420000924` (`Dd10eTKkUtO`). A forced analytics sync then persisted `ig_metric_snapshots.id=1530001` for that exact media id at 18:24:42Z and `instagram_analytics` marked it `REELS`. Initial performance values were zero because capture occurred seconds after publish; the lineage receipt, not the performance conclusion, is what this closes.
- **Trial Reel:** an expired approval was first refused; a later eligible approval published `autopost-2026-09-29` as Trial Instagram media `18448893436192927`. Production persisted `postedAsTrial=true`, `graduationStrategy=MANUAL`, the same post id, and experiment attachment for Reel job `1920015`.
- **Static caption repair:** a guarded manual one-off generated three complete candidates that all reached the independent judge without reproducing the old 4096-token truncation / empty-caption signature. Scores were 0.58, 0.60 and 0.41; the run correctly aborted for quality/compliance defects and published nothing. This verifies the repaired generation boundary under live conditions, not a successful natural scheduled-slot publish.
- **Production defect found during walkthrough:** Queue quality scoring can encounter legacy/incomplete `brief_json`; the old scorer dereferenced a missing array and logged `undefined.map`. The closeout branch adds an explicit runtime `ReelBrief` shape guard and fails those rows closed to score 0 without throwing. NattyNour verification: 76/76 focused tests, TypeScript exit 0, production build exit 0.

Remaining evidence is narrow and explicit: a natural scheduled static-slot success; Trial 24h metric entry; and Instagram-side bio/pin/Highlight mutations remain operator-gated.

## 2026-09-28 post-#2741 deployment receipt

This receipt supersedes older runtime-baseline lines above where they conflict.

- **Repository + Nick runtime:** the pre-Pattern-cohort repository baseline is #2744 (`5334a51b403435ed1cdd202e4f454ca50a0ab116`), whose docs-only change correctly SKIPPED Nick. This Pattern Lab receipt update is likewise docs/memory/capability-only; the live Nick runtime remains exact #2741 squash merge `45a5c02690e7193f05ce0da822fb59d2ebc899ca`.
- **Railway:** deployment `c7b4b57c-799a-4042-9539-42d6571674d6` reached **SUCCESS** at 15:54:52Z. Startup reached `server:ready`; schema guard reported all critical tables present; the tiered scheduler started with 123 jobs.
- **Queue scoring repair:** deployed. #2741's final guard accepts the canonical `contentAdmin.enqueueReelJob` persisted shape and fails genuinely incomplete legacy briefs closed without dereferencing missing arrays. Codex's canonical-shape P2 was fixed before merge; 76/76 focused Reel tests and all final GitHub gates passed.
- **Post-deploy Queue receipt:** LIVE VERIFIED with positive `getAllDrafts` response evidence. At 2026-09-28 16:48:08Z a real signed-in NattyNour session opened Publish -> Reels on #2741. Windows UI Automation observed draft-card UI that is rendered only from `getAllDrafts`, including the exact affected legacy titles `Reading a tire sidewall: the three markings that decide which tire fits` and `ALIGNMENT: You just hit a pothole on Euclid Ave and heard a clunk that made you wince.` together with their `Review 9:16` controls. A read-only DB probe of the handler's latest-50 cohort independently found 49 Reel rows and confirmed those same two rows are non-empty legacy/unscorable briefs missing current scorer fields. This proves the repaired handler completed over affected legacy shapes, independently of the separate `reelPublishQueue` response; the historical `failed to calculate reel score in getAllDrafts` / `undefined.map` warning did not recur.
- **Still genuinely pending:** a natural scheduled static-autopost success; Trial 24h metric entry; Instagram-side bio/pin/Highlight mutations; and any future judge hard-gate promotion, which remains unsupported until calibration warrants it.
