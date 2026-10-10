# Nick's Tire & Auto — Current Truth

**Status:** active operating contract  
**Repository + runtime truth (2026-10-09, 12:48Z):** Nick production is `8175758a353044c340383b0502e1aebc03ce2e61`, #2940 (Reel lane unjam), via Railway deployment `0ab3d0e5-a848-4952-b427-63575c79b3b7` (container up since about 12:25Z; `/api/health` `healthy` on `8175758a3` at 12:48:01Z). Before it: #2941 `89eba69d` deployed 11:59Z; overnight production was the prerender refresh `fac599f5` on top of #2938 `a2e2f772` (deployment `15ddc015`, container 03:45:46Z); #2939 (StateNour deploy Dockerfiles only) correctly SKIPPED Nick. Overnight camera rows (PR C section): the sign camera stayed HEALTHY through the night apart from one-heartbeat dips; its dusk EXPECTED_SOLAR_OFFLINE (23:33:10Z, 27 s) was written by the heartbeat ingest, so the 5-minute pass's own derived writer is still unexercised. Before them, `d679d066a725311d649edaefb5bb273586637fa8`, #2934 (dead bridge queries, sign-edge restart continuity, Eufy bridge node identity), via Railway deployment `e56a8726-c50b-4764-b68e-e1b259f0b6f0` (container started 2026-10-08 22:56:26Z; `/api/health` `healthy` with the database up and `/api/version` on `d679d066` at 00:10:16Z). Before it, `b3a61b5d62f71b4f519402a088251312720ebe31`, the prerender refresh on top of #2931 `9d316523` (camera N-series C), served via `547b9ed1-ee15-4527-a073-b33b88187cab` **SUCCESS** (19:23:38Z; container started 19:23:32Z; `/api/health` 200 at 20:12:53Z). Before that, #2932 `9e6f955d0b0a4d50bdbc06dcac4278b689e98359` (the #2930 follow-up: Codex fixes and the truth corrections) deployed as `c6a0fde9-680c-45ba-85fb-3f4798df3a3b` **SUCCESS** (container started 18:24:58Z; 26 schema column checks passed, no error lines at startup) and its refresh `55e8ea54` as `248e65f5` (18:39:02Z). Earlier, at 17:25Z, Nick production was `108843ce4674c02340dfaa4574258829ddb1b587`, the prerender refresh on top of #2930 `328daf0f7b656b503e07594cc05b0ef9aecf45a0` (Reels Engine v2 follow-up + critic thinking budget), via Railway deployment `15d3c230-5d63-4d2c-b3dc-025931cfadea` **SUCCESS** (16:58:03Z; container started 16:57:53Z). #2930 deployed first as `7c5de257-d61d-47b7-a555-0067163abbac` **SUCCESS** (16:45:46Z; `/api/health` healthy and `/api/version` on `328daf0f` at 16:46:26Z, uptime 50 s); the refresh replaced it at 16:58Z and differs from it only under `prerendered/`. A docs-only merge after this line redeploys the same code and claims no new runtime. Before it: #2929 `ed9a45d0` (camera N-series B) via `3ce638b1` **SUCCESS** (16:15:16Z; `server:ready` 16:15:11Z, the instant `TIMELINE_COMPLETE_FROM_MS` names; schema guard 6/6, 26 column checks passed, office heartbeat seq 468 accepted on the new container), then the refresh `4058c4bb` via `0b43b9b0` **SUCCESS** (16:36:21Z; sign HEALTHY seq 363-384 and office seq 497-514 accepted 16:32-16:43Z). No derived camera-health row had been written by 16:45Z: the sign camera stayed HEALTHY and the 5-minute pass writes only on a change, so the first natural proof of the N6 writer is the sign camera's dusk EXPECTED_SOLAR_OFFLINE. Before those, #2923 `0f9453df0c0662faa6676990b6799abcdd3ed3cb` (main after the camera N-series PR A #2927 `ab5b91cb` and the creative control gates #2923) ran via Railway deployment `2eb8c519-bf3c-490c-b74d-7340e8dbb910` **SUCCESS** (15:16:24Z; `server:ready` 15:16:19Z, schema guard 6/6, sign heartbeats HEALTHY seq 211-213 and office UNVERIFIED_CAPABILITIES seq 371-372 accepted on the new container); `/api/health` 15:17:42Z healthy (uptime 83 s, database up). **Migrations 0144 and 0145 are applied and recorded**, each by a push-triggered deployment's one-off pre-deploy command: 0144 on the #2927 deployment `24073610-838a-40bd-ae7f-d2f6377e2cc9` at 14:20:47Z (`8 columns added, 0 already present — all 8 verified; __drizzle_migrations recorded created_at=1791400000000 (hash f37355b126c0)`), 0145 on the #2923 deployment `2eb8c519` at 15:15:44Z (`0145_vehicle_visit_marks: table created, 6 columns verified; __drizzle_migrations recorded created_at=1791464400000 (hash 852a36eeb71b)`; the sibling merge took the deployment slot PR B was going to use, with the same effect). The pre-deploy command was cleared from the service right after that receipt was read. Earlier lineage: #2925 `7c6724587673f23a88e6fbe3aab971ddf858dc92` via Railway deployment `faff2669-eff2-4fc7-885e-db9d0fe34d56` **SUCCESS** (12:30:26Z, a redeploy of `641b1507` with the same commit; `server:ready` 12:30:17Z, schema guard 6/6, 127-job scheduler); its first heartbeat logged the eight 0144 `camera_runtime` columns missing, which is how the "a redeploy does not run a pre-deploy command" fact was measured. Lineage: #2865 `54a366629ba89867dcd5dbc916e37bee88f8e645` via Railway deployment `015c1e73-b1f7-486d-b887-d6c876b9f41f` **SUCCESS** (17:48:57Z; `server:ready`, schema guard 6/6, 126-job scheduler, `/api/health` healthy). Previous runtime was #2857 `10edbbbd` (deployment `07eadc02`, 11:01Z); intervening StateNour-only merges correctly SKIPPED Nick. Earlier note kept for lineage: the pre-Pattern-cohort repository baseline is #2744 `5334a51b403435ed1cdd202e4f454ca50a0ab116` on 2026-09-28. This Pattern Lab receipt update is docs/memory/capability-only and therefore may advance repository history without claiming a new Nick runtime. Nick production remains exact #2741 `45a5c02690e7193f05ce0da822fb59d2ebc899ca` via Railway deployment `c7b4b57c-799a-4042-9539-42d6571674d6` **SUCCESS** (15:54:52Z). The #2741 container reached `server:ready`, schema guard passed, and the 123-job scheduler started. #2742 and earlier camera-only #2739/#2740 correctly SKIPPED Nick under watch paths.
**Owner:** Nick's Tire & Auto operator  
**Operator runbook for the SMS side:** [`operations/SMS-REVENUE-AGENT-OS.md`](operations/SMS-REVENUE-AGENT-OS.md)

Live code and production evidence override this document when they disagree. Update this file in the same change that alters a listed contract.

## One ask per reel is enforced before the spend (2026-10-10, PR after #2969) -- BUILT + TESTED; PR open

The Seedance 2.5 test reel #2 (reel_jobs 2070005, brief ai-1791631412867) was refused by assembly's ask-consistency gate after five clips were rendered and paid for: the generator declared `ask.kind = profile` (end card "MORE IN OUR BIO") while its caption read "Send this to someone whose tires look smooth." -- two different asks on two surfaces (`shared/reelAsk.ts`). Enqueue preflight did not look at the caption, the refusal recurred three times inside one pulse (the pulse re-picks the same oldest `assets_ready` row), and the attempts ladder parked the job `failed` with the clips intact. The operator repaired it by hand.

- **Enqueue refuses the mismatch.** `captionAskMismatch` (the cross-surface rule split out of `askLeakageProblem`) runs in `enqueueReelJob` before the reservation and the spend boundary, as the typed `REEL_ASK_INCONSISTENT` refusal; `briefEnqueueRefusals` mirrors it, so the miner regenerates and a pack variant with the defect never joins. Only the cross-surface rule moved: `runReelPreflight` still treats beat/voiceover leaks as a warn, and a caption carrying several asks with no declared end card is unchanged (the canonical sample briefs have that shape).
- **The generator agrees with itself.** The prompt no longer demands a "send this to" sentence in the caption (that instruction contradicted the declared default ask); `stripCaptionAsks` removes any caption sentence asking for something other than the declared end card, and returns the caption untouched if nothing would remain (enqueue then refuses it loudly). Operator-supplied captions are not stripped.
- **A content verdict does not burn the retry budget.** The assembly ask gate now runs before any clip download or voiceover call and throws `ReelAssemblyRefusedError`; `assemblyFailureOutcome` parks such a job `failed` on first contact with the attempt given back, so a repaired payload set back to `assets_ready` has its full budget. Provider and ffmpeg failures keep the `MAX_ATTEMPTS` ladder exactly as before.
- Proof owed after deploy: the next generated brief carries no caption ask; a repaired 2070005 assembles on one pulse.

## Reel lane cannot jam on a missing verdict (2026-10-10, PR after #2965) -- BUILT + TESTED; PR open

Found in the logs while the Seedance 2.5 test waited: every 15-minute pulse from 06:00Z to 11:00Z selected job 2070001 (Reel #1, a Higgsfield-UI export) and held it on "no audio QA verdict", returning before production ever ran. Audio QA only ever ran inside `reelAssembly`, so a master that arrived any other way could never get a verdict, and `unavailable` was deliberately not a parked gate.

- **Gate produces the evidence.** `measureJobAudioQa` fetches the exact bytes at `mp4Url`, runs the repo's audio QA and persists `payload.audioQa` by compare-and-set; `evaluateReelPublishGate` calls it when the verdict is missing and the door may produce evidence (`runIfMissing`); the read-only pre-filter still says "not evaluated"; a failed measurement keeps the hold.
- **Drain parks a stale 'unavailable'.** `staleUnavailable`: a job still 'unavailable' three hours after it was ready (12 pulses) is skipped with `qa_parked:unavailable_stale`, in both the selection loop and the today's-job branch, so the READY count drops and the production hour refills. No timestamp never parks.
- Proof owed after deploy: the next pulse either attaches 2070001's audio verdict and lets its rendered-QA gate decide (5 findings; the operator chose not to publish it) or parks it, and 09:00 ET enqueues.

## Reel quality upgrade (2026-10-10, PR after #2956) -- BUILT + TESTED; PR open; one paid test reel approved, not yet rendered

The operator's verdict on the first masters: "plastic", and "where's the background music?". PR #2952 had upgraded the judge, not the generator; this PR changes what gets rendered and how a Higgsfield-UI export is finished.

- **Model is a flag.** `REEL_CLIP_MODEL` (allowlist `seedance1_5` default, `seedance_2_5`, `kling3_0`, `kling3_0_turbo`; anything else logs and renders the default). The reservation prices the chosen model (`reelClipCostUsd`). Operator approved one Seedance 2.5 test reel (~130 credits): set the variable on Railway after deploy, then `scripts/enqueue-quality-test-reel.mts --execute`.
- **Realism pass.** `REALISM_DIRECTIVE` on every beat prompt (photographed material, contact shadows, one continuous take); "8K / ultra-detailed / studio-grade" removed from the lens grammars; "3D render look, uniform plastic sheen" in the DO-NOT list.
- **Real hero still.** A pack's `heroAssetId` names a registered `real_shop` photo of the bay; enqueue verifies it and makes it the visual world, so with `REEL_IMAGE_CONDITIONING=true` every generated clip is image-to-video from Nick's actual shop. Register the photo with `register-real-shop-clip.mts --kind still`. Zero real_shop rows exist yet.
- **Finish pass for exports.** `externalMasterFinish.ts`: music bed under the native track, -14 LUFS, grain, Rec.709, exact duration. `publish-pilot-01.mts` finishes by default (`--raw` = the old as-is publish). Reels #2/#3 went out raw and cannot be re-finished in place.
- **Music.** Four Mixkit beds (free license, no attribution) replace five synthesised or unsourced pads; `assets/reel-music/LICENSE.md` carries ids, titles and terms.

## Real-shop clip registration + quiet captions (2026-10-10, PR #2955) -- MERGED (main `05c0c06fc`, 01:14Z); Railway deploy building at 01:14Z

- **Registry writes duration now.** `RegisterAssetInput.durationMs` -> `media_assets.duration_ms` (rounded; null for absent/zero/negative/non-finite). The column existed since the registry shipped and nothing wrote it, so `realShotBinding` refused every registered clip with `no_duration` -- the real-beat lane could never bind. `server/mediaRegistry.test.ts` (7 passed).
- **`scripts/register-real-shop-clip.mts`** turns a captured clip into a `real_shop` VIDEO row: ffprobe (bundled remotion binary) -> refuse non-video / non-vertical / under 2 s -> dry run by default -> `--execute` dedupes by sha256, asserts durable storage, uploads to `reels/real-shop/`, registers, prints `"realAssetId"`. Dry-run receipts: the Reel #2 master probes 1080x1920 15.00 s; a source file is refused cleanly.
- **Quiet captions.** `scripts/publish-pilot-01.mts` now closes the caption with one clause ("Illustrated, not filmed.") instead of the manifest's disclosure paragraph; `is_ai_generated=true` and the burned-in badge are unchanged (`--loud` restores the long wording). "Not a customer's tire" was refused by the claim gate's customer-possessive regex, so the clause is neutral by construction. Reels #2/#3 already published keep the long paragraph: the Graph API cannot edit a published caption; the operator edits in-app.
- **Capture day card:** `docs/reels-engine-v2/14-CAPTURE-DAY-CARD.md` -- 90-minute shot list for all three flagships + the register command.

## Rendered-QA critic for external masters: declared text surfaces, caption-timing notes, voted blocks (2026-10-09, PR #2952) -- MERGED (main `12e21bb16`, 2026-10-10 00:52Z); Railway deploy building at 00:52Z; `RENDERED_QA_VOTES=3` set on the service (skipDeploys), live from this deploy

First campaign Reel went live 2026-10-09 21:52Z (job 2070002, IG `18393636853204607`, https://www.instagram.com/reel/DeShDz6jvLv/) under an explicit operator override of the rendered-QA gate, recorded as `payload.operatorOverride`: three single-run critic verdicts on identical frames returned 5, 2 and 10 blocks, reported the required disclosure badge as `GENERATED_TEXT_ARTIFACT`, and claimed a hook card at 6 s and 10 s where the frames show none. The gate update (`server/services/renderedQa.ts`):

- **`externalMaster.textSurfaces` on the job payload** declares every burned-in line of a master produced outside the pipeline (header bar, captions, disclosure badge, end cards). The critic prompt names them as legitimate and reserves `BEAT_SEMANTIC_MISMATCH` for a different object, action or damage; a `GENERATED_TEXT_ARTIFACT` finding that quotes a declared surface is exempted (positive match, `describesDeclaredText`), undeclared lettering stays a block.
- **Caption-timing mismatches on an external master are notes, not blocks** (`isCaptionTimingMismatch`): the plan is written from the frames after the fact, nothing can be regenerated per beat; a mismatch naming a different subject still blocks. Pipeline-rendered jobs are unchanged.
- **Voted blocks** (`voteVerdicts`, `RENDERED_QA_VOTES` 1..5, default 1 = today's behaviour): a block survives only with a majority of independent runs on the same frames; warns are the union; craft score and escalation recomputed; tally on `verdict.voting`. Setting `RENDERED_QA_VOTES=3` on Railway turns it on (three vision calls per QA pass).
- Exemptions stay visible on the verdict (`presenceExemptions`), never silent.
- **Not done:** the Studio has no field for `textSurfaces` (the pilot publish script declares them); Reel #1 (job 2070001) remains unpublished on a substantive block (a held clean-tire shot promises a reveal that never comes).

## Reels source-aware route: real beats bind registry footage, deterministic beats draw cards, hands-only profile, sentence captions, per-shot lineage (2026-10-09, PR #2946) -- MERGED (main `d4102efad`, 21:04Z)

Doctrine 02 section 8 items 4-6 are built (`docs/reels-engine-v2/13-SOURCE-AWARE-ROUTE.md` is the map). Contracts:

- **A beat declared REAL binds the registry row its `realAssetId` names, or holds** (`shared/shotRouter.beatsToResolveLocally`, `services/realShotBinding.ts`, `services/localBeatResolution.ts` in `processNextReelJob`): the row must be `rights_status = real_shop`, `reuse_allowed`, current, VIDEO, with a 64-hex checksum and `duration_ms`; the exact URL + sha256 + probed duration bind to the beat, and assembly re-hashes the downloaded bytes (`reelAssembly.expectedClipSha256`). Enqueue verifies the id read-only with the same typed refusal, so a mistyped id advances the rotation instead of jamming the lane. A real beat with no id still holds (`needs_real_footage`); the three proof packs name no id yet, so they still hold.
- **A beat declared DETERMINISTIC is drawn, never generated** (`services/deterministicCard.ts`): explicit `cardLines` (else the capitalised labels after "labels" in the visual) on an SVG, rasterised by sharp, moved through the template_stock ffmpeg lane, re-hosted under `reels/deterministic-card/`, bound with its sha256. Durable storage is asserted before the render.
- **Per-beat duration follows the source** (`reelAssembly.segmentCapSeconds`): a bound real clip holds up to `min(12 s, probed)`, a card up to 8 s, a generated or undeclared beat the unchanged 4 s.
- **Presence profile** (`shared/reelSourceProfile.ts`): `presenceProfile: "hands_only_real"` admits hands/gloves/tools only on beats declared real, in the brief check (`runSafetyChecks`) and at the critic (`renderedQa.applyPresenceExemptions`, recorded as `presenceExemptions` on the verdict); faces and figures block everywhere; absent = the legacy object-only rule. The critic is also told which beats are drawn cards (their lettering is ours) and when captions are sentence case.
- **Caption style** `captionStyle: "sentence"` keeps case, `%`, `/` and units and is drawn with drawtext `expansion=none`; the legacy uppercase filter string is byte-identical.
- **Lineage drives the AI label** (`reelDisclosure.allShotsNonGenerative`): every clip slot covered by a registry/card row whose bound URL is the clip in that slot means `is_ai_generated` is not sent; a provider URL, a provider row or a partial lineage keeps it. The veto and the transmitted flag use the same call (`dailyReelPost`, `instagramAdmin`).
- **Ledger**: enqueue reserves only beats the provider will render; settlement counts lineage-backed clips as free-lane.
- **Not built**: Studio controls for the new fields (pack-file fields today), video duration probing on the Studio upload, lineage lines in the approval Queue. `expansion=none` is asserted on the filter string, not yet proven on the production ffmpeg (first sentence-style render is the proof).

Docs: `11-SLATE-62-PROVISIONAL.md` (62 slots + 6 substitutes, every slot brief-ready or footage-needed, 0 credits spent), `12-FLAGSHIP-HOOKS.md` (nine openings, three per flagship).

## Reel lane unjam: READY count agrees with the drain; paid repair only when it can clear the verdict (2026-10-09, PR #2940) -- MERGED (main `8175758a`), DEPLOYED (`0ab3d0e5`, healthy 12:48Z); live proof owed at the 2026-10-10 ET 06:00 pulse

Production read on 2026-10-09: no Reel posted since 2026-10-04 04:08Z, and none was produced either. At the ET 06:00 production hour `daily-reel-post` logged `production held: usable READY buffer 2 (hold_above_low_watermark)` while the drain skipped both of those jobs on every pulse (2040001 `qa_parked:needs_paid_repair`, 1770004 `repost:caption`).

- **The READY count reuses the drain's refusals** (`server/cron/jobs/dailyReelPost.ts`, `shared/reelQueue.readyCandidateIsUsable`). The drain runs first each pulse and records the assembled jobs it scanned (`drainEvaluatedIds`) and refused (`drainSkippedIds`); `countUsableReadyEpisodes` passes both, so a refused job, or an assembled job outside the drain's bounded scan window, is not inventory. Before, the count re-derived three of the drain's six checks and missed inventory hold, condemned script, repost and parked rendered QA. The operator's manual re-approval of 2040001 (01:24Z) is what made it count.
- **An autonomous paid beat repair runs only when one repair can clear the verdict** (`server/services/repairRouter.paidRepairCanClearVerdict`, checked by the cron before `requestBeatRepair` on the `needs_paid_repair` gate): exactly one blocked regenerable beat, repairable by the executor (`selectiveRepair.beatRepairRefusal`, now shared), no blocking finding without a beat, and an attempt left of `maxRepairAttemptsPerAsset`. A multi-beat verdict goes to a human because the re-verdict after one repair parks the job. Otherwise the job is held with `held: paid repair cannot clear job N's verdict (...); rebuild or retire it`. 2040001's 12-credit beat-2 repair (2026-10-08 17:27Z) faced blocks on beats 1, 2, 4, 5 plus three asset-level blocks and scored worse.
- **Repairs start at the lowest blocked beat the executor will accept** (`pickRepairTarget`). The critic judges continuity against the establishing beat; repairing beat 2 toward a broken beat 1 copies the defect. A beat declared real or deterministic, a placeholder visual or a beat without a prompt is skipped.
- **Unchanged:** the free `auto_repair` lane, the drain's six checks, every publish gate, the one-Reel-per-day cap. Job 2040001 still needs the operator's disposition (recommended: retire).
- **Live proof owed:** the first ET 06:00 pulse after deploy (2026-10-10, 10:00Z) logs an enqueue, not `production held`.
- **Operator, not code:** retire 2040001 and 1770004 in Instagram > Queue. The restored lane spends about 60 credits per Reel; `REEL_AUTOPOST_ENABLED=false` on Railway holds it if the credits should go to the flagship Reels (`docs/reels-engine-v2/10-FLAGSHIP-PRODUCTION.md`).

## Camera pages wait for a state to hold (2026-10-09, branch `claude/dreamy-newton-0iob20`, after #2939) -- BUILT + TESTED; PR open

- **Symptom, 2026-10-09 04:15 ET.** The sign camera paged UNVERIFIED_CAPABILITIES ("camera health alert fired", 08:15:22Z, episode 1791533718) and then a recovery at 04:45 ET (08:45:22Z). The state had lasted one heartbeat: the ingest logged HEALTHY -> UNVERIFIED_CAPABILITIES at 08:15:19Z (seq 1123) and back to HEALTHY at 08:15:52Z (seq 1124). The 5-minute pass sampled it 4 s in; the 30-minute cooldown then held the recovery page. The same night had three more one-heartbeat dips (CALIBRATION_INVALID at 00:42Z, 03:18Z and 09:00Z) that no pass happened to sample.
- **Fix** (`server/services/cameraHealthAlertPolicy.ts` `cameraAlertAwaitsPersistence`, `server/services/cameraHealthAlerts.ts`): a state the PRODUCER reported pages once it has held 120 s (`HEALTH_THRESHOLDS.offlineAfterSeconds`, the SLO the liveness states already wait out, read as `UNIX_TIMESTAMP() - UNIX_TIMESTAMP(stateSince)` in SQL), or on the third entry into a paging state for that camera in 30 minutes (`camera_health_events`, so a camera that keeps flickering still pages). A state still standing at the next pass pages then, on the same episode. Liveness states (STALE, PRODUCER_OFFLINE, EXPECTED_SOLAR_OFFLINE) keep their heartbeat-age clock; NEVER_INGESTED is never held. An unknown state age or an unreadable flicker count pages as before. The timeline row is still written on the pass that holds the page; the run summary says `N state(s) under 120 s not paged yet`.
- **Not changed:** why the edge's heartbeat dips (a source/pose facet unreported or failed for one heartbeat at night) is not diagnosed here; the gate stops it paging, not happening.
- **Receipts:** `server/cameraHealthAlertsFlicker.test.ts` (8; the 08:15:22Z replay through the real `runCameraHealthAlerts`): 4 failed against the unfixed service (the replay claimed the page production sent), 8 passed after; four mutations (gate removed, flicker override dropped, unknown count read as 0, liveness gated) each turn their own test red.

## Flagged-items wave (2026-10-09, after #2935; PR #2938) -- MERGED (main `a2e2f772`), DEPLOYED (nickstire `129b2620`, then `15ddc015` on the prerender refresh `fac599f5`; StateNour web `7cd81d0a` and worker `84a76e23` only after #2939, 10:44-10:47Z); NicksMax pulled to `69bb331b` (sign edge restarted onto it 10:55:19Z), host scripts installed 11:09:56Z

The items flagged at the end of #2934/#2935, plus what fixing them surfaced.

- **Live receipts (2026-10-09).**
  - **StateNour deploys were blocked, not slow.** Every statenour-web build from #2936 (01:43Z) and the statenour-worker build for #2938 failed at `turbo prune` (the pruner stage's global `turbo@2.9.14` cannot parse #2936's `turbo.json` `agentGuidance` key), so bdnick.info served #2935 until #2939 pinned the lockfile's turbo (2.11.6): web `7cd81d0a` SUCCESS 10:46:57Z, worker `84a76e23` SUCCESS 10:44:41Z, `/api/version` on `69bb331b`. StateNour's half of #2938 (dashboard redaction, revenue-rule windows) has been live since then, not since 03:25Z.
  - **NicksMax:** the box repo was pulled to `69bb331b`; the supervisor restarted the sign edge for the code change at 06:55:19 ET (10:55:19Z) and the new edge's visitd ledger has `visits.episode_id` (migration on open; `open_visits=0` at that restart). The host tests on the box under Windows PowerShell 5.1: `129 passed in 181.14s` (supervisor, host scripts, episode ledger, restart continuity). `install-nicksmax-supervisor-host.ps1` installed all five host scripts at 07:09:56 ET (`5 updated, 0 refused`, each previous copy kept as `.bak-20261009-070956`); a re-run of `-Check` reads `0 would change`. The five drift WARNs the first tick on the new code logged (06:55:03-04 ET) were for exactly those copies. The running loop keeps its old code until `NicksMaxCameraSupervisorSystem` next starts (boot). The fallback copy refreshed at 06:55:22 ET.
  - **Crop hold:** the first crop restart on the new code (07:01:23 ET) logged `no decodable frame on 8555/sign while the relay's stack has frames`, the healthy-relay branch. The dark-camera branch (no restart, a NOTE once an hour) has not run yet; tonight's dusk is its proof (2026-10-08 18:01-18:14 ET: nine crop restarts and an ESCALATE).

- **Bridge reads count the whole shop day** (`server/routes/nour-os-query.ts`, contract rows in both `NICKSTIRE-QUERY-CONTRACT.md` copies).
  - `revenue_range` ran `invoiceDate BETWEEN from AND to`: a date string against a DATETIME means midnight, so the end day's timed tickets were dropped (month-to-date revenue omitted today's). Now `invoiceDate >= from AND < to + 1 day`, `from`/`to` both inclusive shop-local days, defaults from the New York day (was the UTC day).
  - `marketing_attribution` had the same cut on `leads.createdAt`, which is a UTC instant: the day bounds are now converted from New York to UTC, so a lead counts on its New York day.
  - A malformed date or a reversed range returns `{ error }` before any query (it used to reach SQL and come back as a confident total). A `to`-only call reads the default window ending on `to`; `marketing_attribution`'s default is the 30 shop days ending today.
  - **`invoiceDate` is the stored shop-local day, everywhere.** `revenue_today`, both `cars_today` invoice reads, the scheduler's invoice weekday-volume check and `kpi-snapshot`'s weekly revenue window converted it FROM UTC (or compared it with UTC-converted bounds), which moved every date-only ALG ticket (stored at that day's midnight) onto the day before: today's revenue counted only timed tickets, and the volume check saw a near-empty today. All five now read the stored day, the reading `revenue_range`, `lot_brief`, `shopSales` and `customerStatsRead` already used; `server/__tests__/invoiceDateShopLocal.test.ts` fails on either shape coming back. A review found two more: the missed-call reconciler (`opportunityQueue.ts`) read paid invoices through its UTC-to-ET helper, so Friday's date-only ticket fell on a Thursday call's own shop day and the paid customer's card closed as `duplicate` instead of `won` (the guard now also flags a same-file helper that wraps `CONVERT_TZ` and is called with `"invoiceDate"`); the customer value ranking (`customerValueRanking.ts`) re-derived the day from the driver's Date in New York time, splitting a date-only and a timed ticket of one day into two purchase periods (the day now comes from SQL). Exception, named in the contract rows: the `new Date()` writers (gatewayTire online orders, booking, a manual invoice) store the UTC wall clock, so such a row written after 20:00 ET lands on the next day.
- **One `categorizeService`** (`server/services/engines/shared.ts`). Two of the "four copies" were the same multi-label classifier; `intelligenceEngines.ts` now imports it. The other two are different taxonomies that only shared the name: `reportIngestion.ts` (`reportServiceCategory`) and `pricingIntelligence.ts` (`paymentAlertCategory`, the pricing Telegram labels); folding them in would change 62 and 25 of 153 recorded outputs, so they keep their tables, renamed. `serviceCategorizers.golden.test.ts` pins all three over 153 descriptions, and two wiring tests fail if a private copy comes back. The report taxonomy's `ac_heat: /a.*c/` (it filed "Diagnostic Service", "STATE INSPECTION", "maintenance" and "LABOR CHARGE" as A/C) is now a word-bounded A/C, and the live report script `scripts/ingest-reports.mjs`, which had drifted, carries the same table byte for byte (a test holds them identical; it feeds the bridge memory's `topCategories`). Other known misclassifications stay pinned, not fixed (the canonical one has no A/C category).
- **A failed read is unknown, never zero** (the `unavailable: true` marker `masterIntelligence` `readFailed()` consumes):
  - `analyzeCustomers` (plus `atRiskUnavailable` / `bookingPatternsUnavailable` for its two sub-reads) and `analyzeNewCustomerVelocity`; the brief, the action plan, the proactive alerts, the evening debrief, `/api/bridge/intelligence` and the StateNour sync (`customerIntelligence: { available: false, reason }`) all say so instead of "0 customers, 0% retention, Churn risk: LOW".
  - Six growth engines (chat funnel, review sentiment, website journeys, call patterns, referral network, portfolio LTV); four feed the master report, which now names them in `failures`. `intelligence.chatFunnel` errors on a failed read.
  - The churn-detection cron and the pricing (payment-status) cron fail their run instead of recording "0 at-risk, 0% retention" / "No invoice data to analyze"; churn-detection also fails when only its at-risk read failed (the at-risk list is the job's whole output).
  - The 2-hourly proactive check says "At-risk customer check did not run" once a shop day (again after a measured read in between), not on every run with an LLM insight attached.
  - The AI Ideas page shows "(not read)" on its "From Intelligence" card when the chat-funnel read fails, instead of replacing the page with "Couldn't load intelligence data".
- **The master report reads the keys its engines send.** The "Chat funnel" score read `conversionRate`/`totalSessions` (the engine sends `opened`...`booked`), so it said "0% chat→booking conversion (0 sessions)" on every run; the referral opportunity read `totalReferrals` (the engine sends `networkSize`) and could never fire.
- **Measured-empty and clock fixes:** a shop with no bookings / no paid invoices / nobody active no longer prints "Busiest day: Sun | Peak hour: 0:00", "Retention rate: 0%", "Churn risk: LOW" or "RETENTION: Only 0%"; busiest day and peak hour are bucketed on the shop's clock, in SQL (they were UTC; a JS conversion of the driver's Date is right only while the process runs in UTC, per Codex on #2938); new-customer velocity counts the shop's month (the UTC month turned over at 20:00 ET on the last day and scored "0 new customers this month" that evening).
- **camera-bridge (no nickstire code):**
  - The NicksMax loop, shim and three launchers are in the repo (`scripts/nicksmax/`) with an installer, a once-a-day drift WARN and a self-refreshing fallback copy (host doc, "Host scripts"). The launchers keep the previous run's logs as `.prev`.
  - The sign crop is no longer restarted while the solar sign camera is dark: the supervisor probes the relay's stack first and logs a NOTE once an hour (ESCALATE 08:00-17:59).
  - visitd's ledger stores each visit's episode id (`visits.episode_id`, additive), and a restart restores it, so a car continued across an edge restart whose track later dies and is re-acquired counts once on the Lot. Visits open at the deploy's own restart have no stored episode and fall back once.
  - **A second car no longer takes the first car's episode.** `VisionPipeline._emit` stamped the calling track's episode onto every emission visitd returned for that event, including another visit's timer-driven CONFIRMED_ARRIVAL, so two cars whose arrivals overlapped counted as ONE on the Lot (pre-existing; found by the review of the episode change, which would also have made it durable). Only the track's own sighting's emissions are stamped now.

- **Flagged, not fixed:** `funnel_overview` reads keys the master report has never sent (`operations.pipeline`, `customers.velocity.totalLeads`, `customers.retention`), so every stage is 0 or an estimate of 0 (no in-repo caller but the generic LLM query tool; retire or rebuild); the `new Date()` invoice writers store the UTC wall clock (named in the contract rows); NicksMax supervisor ticks killed at the 45 s loop timeout (422 since 09-28; per-phase timing and the one-read fixes landed in #2937).

## Queue approval verdict, subject-free packs out of the rotation, typed enqueue refusals, truth packets for the pilot, call-us case, worker review guard (2026-10-08, branch `claude/peaceful-pascal-988w9o` after #2934) -- BUILT + TESTED; PR open, merge pending

- **The Reel Queue shows an approval as the publish door sees it** (`services/reelApproval.listReelPublishQueue`). It built its permit check without the asset digest, so every approval bound to one (every row since 0118) listed as `asset_digest_unverifiable`: approved Reels looked unapproved and offered Approve again, and auto-approval logged that code on every pass. The publish door always loaded the digest, so nothing published wrongly. Both now read the same digest: a matching one lists as approved, repaired bytes as `asset_bytes_changed_since_approval` ("re-approve the current asset"), and no digest on file as unverifiable.
- **34 packs left the daily rotation: every beat named no object** (`services/approvedReelPackRotation.ts`, `shared/shotRouter.isSubjectFreeVisual`). The two 2026-09-25 imports wrote the same placeholder shots into every beat ("Extreme macro of the physical subject…", "…the relevant physical components…"), and the generator sent them verbatim, so a Reel about XL load ratings or a TPMS light could not show a tire or a light. They were the tail of the rotation (indices 99–132) and the production cursor read 32 (Railway, 10:02Z), so nothing near today's pick moved. The rotation is **99 packs**, all preflight-clean. 22 of the 34 say in their own notes they need real shop footage; 11 name only their batch's generic route and one a deterministic cutaway, so those 12 need shot descriptions written and approved. The generator also refuses such a beat at enqueue, at generation and at single-beat repair. The Creative Assistant's Sources line now says "held out of the rotation" for packs outside it (it said "awaiting rotation approval", which invited approving one as it stands); five production-ready angles (A004, A009, A012, A014, A015) are among them.
- **An approved pack refused at enqueue no longer jams the daily lane** (`services/reelPipeline.enqueueReelJob`). The condemned-script check, the declared-source hold (#2933), the episode-contract block and the over-long caption threw a bare Error; `dailyReelPost` advances the rotation only on `ReelPreflightBlockedError` and rethrows anything else, so a pack refused by one of them would have failed the cron at every production hour. Not reached in production (no rotation pack trips one); all four are typed now and a test fails any new bare-Error content refusal.
- **Pack Reels no longer name rust as their hero** (`services/approvedReelPackRotation.ts`, `client/src/lib/facelessReelStudio.ts`). Every pack brief carried `objectCharacter: "rust_creeping_villain"`, so every pack Reel's provider prompt said "Character energy: Rust, Creeping Villain", a penny test included. Now `plain_part`: no Character line, "Hero subject: <beat 1's visual>" in the continuity block and the visual-world frame, and the vision critic is told the hero is the part beat 1 shows (it was told "rust_creeping_villain"). Studio briefs keep their personas and are never offered `plain_part` (operator-approved).
- **The pack lane can run its first experiment: documentary vs cinematic camera** (`shared/contentExperiments.visual_direction_v1`, `services/contentExperimentStore.visualDirectionForEpisode`, `cron/jobs/dailyReelPost.ts`). The arm picks the lens family when a pack is built (documentary: macro push-in, forensic scan; cinematic: film look, product-ad lighting), on the same episode key enqueue records it with; only pack Reels are recorded. Presets now declare which Reels they reach, and the store derives its skip rules from that. A pack-build arm is recorded only when the brief carries the arm it was built with (`appliedPackArms`) and it is the arm the job's key draws, so a regenerated or seeded pack Reel is never filed under an arm its content did not get. Not started; nothing changes until the operator starts it.
- **Pack-variant experiments are built and inert** (`approvedReelPackRotation.APPROVED_PACK_VARIANTS` / `approvedVariantSnapshot`, `shared/contentExperiments.opening_mechanism_v1`). An arm is an approved variant of a pack (`docs/reel-packs/<slug>/variants/<armId>/`); a pack joins only when every arm is approved, builds and clears what enqueue would refuse (all arms or none, so the drawn arm cannot decide which packs air), and its arm is drawn with a bit-mixed hash so it does not split Reels the way the camera arm does (58 of 120 keys agree; the plain hash gave 120 of 120). The approval list is empty and `startContentExperiment` refuses a variant preset with no eligible rotation pack. A regenerated pack Reel is recorded only when its new key draws the arm it was built with (about half the time), so some are not measured; none is mis-measured.
- **A shorter Reel tier was researched and not built** (`docs/reels-engine-v2/09-90-DAY-MODEL.md`): no source measured reach or sends for sub-15 s educational Reels, the large studies rank their shortest bucket worst, and the account's skip rate varied 32.7–82.9% at constant length, which points at the opening, not the length.
- **Caption contrast is measured** (`server/captionContrast.test.ts`): gold on its black stroke, and in the word-timed captions' opaque box, 12.1:1; on the 60% drawtext box over white footage 3.3:1 (bars 7:1 and 3:1, large text).
- **Completion Authority no longer prints another PR's evidence on a diff pass** (`scripts/dod-compiler.mjs`): `capability-ledger-updated` passes when the ledger is in the diff, and it printed the legacy manifest's unrelated ref beside the pass; it now prints "(satisfied by diff)" unless this branch wrote the entry. Pass/fail unchanged (`scripts/agent-os/dodCompiler.test.mjs` +3, one red on the old compiler).
- **Three more truth packets** (`shared/mechanicalTruth.ts`: brake wear, E-Check readiness, no-start; eight in all, sixteen prohibited claims). Sources: the Car Care Council; Ohio EPA's readiness fact sheet and ohioecheck.info; no-start has no citation and states only multi-cause facts. Pilot A004, A006 and A007 and four related angles name their packet (`docs/reels-engine-v2/angle-bank.json`). No committed pack, blog post or guide trips a new claim. A myth-busting denial ("not always the starter", "that doesn't mean your brakes are fine") passes, and a softener ("perfectly normal", "probably fine") does not get a claim past (adversarial review 2026-10-08). The puncture packet no longer refuses its own reason ("A plug alone is not a complete repair"), which the generator is told verbatim; a test now runs every packet's facts and reasons through every pattern.
- **"Call us" counts as an ask in any case** (`shared/reelAsk.ts`, the call-us pattern is now case-insensitive). Before, only lowercase "call us" matched, so "Call us" and an on-card "CALL US" passed assembly's leaked-ask stop. No committed pack says "call us" in any case, so no verdict changed.
- **Seedance pricing, measured** (`services/generationLedger.ts` comment, `docs/UPSTREAMS.md`): 12 credits per 4 s 1080p clip (the account's transactions). Higgsfield's no-submit cost preflight quoted audio off at the same 12 at 1080p, and 4.8 at 720p with audio on or off, so silencing clips saves nothing; that change was built, priced and reverted. 720p is 60% cheaper per clip and is a quality decision.
- **Outside nickstire:** the worker renders a customer-review video only from a declared review (`apps/worker/src/renderPlan.ts`); it used to render any non-alert reel draft as a five-star "Verified Customer" review of the draft's own text. StateNour's queue has never held a reel draft (77 rows, all posts, read 2026-10-08), so nothing was rendered that way.

Receipts in the PR body.

## NicksMax supervisor log writer (2026-10-08, after #2934; PR #2935) -- MERGED (main `365842a2`), LIVE-VERIFIED on NicksMax: `2026-10-08 20:27:49 NOTE restored 44 line(s) written 2026-10-08 08:20:14 .. 2026-10-08 19:32:51` (log line 15510; the overflow file is gone, with Desktop Commander's pid 9580 still holding its read handle)

camera-bridge only; no nickstire code change.
- **Symptom.** The supervisor's log (`camera-bridge\logs\nicksmax-camera-supervisor.log`) had no line since 07:34 ET. Every line from 08:20 on went to `<log>.overflow`; the lines between 07:34 and 08:20 are gone.
- **Cause, probed on the box.** Desktop Commander's 07:34 tail left a read handle open in its node process (Restart Manager: pid 9580). That handle shares read, write and delete. Windows PowerShell 5.1's `Add-Content` and `Set-Content` open a file without read sharing, so they fail beside any reader. Beside that same kind of reader, `Out-File -Append`, `AppendAllText` and a FileStream sharing ReadWrite+Delete all wrote. The morning's runbook entry called the handle exclusive; that was wrong.
- **Fix.**
  - `Write-SharedFile` is now the one writer for the log, its overflow, the restart-ledger state (`Save-State`) and the production start marker. It is a FileStream that shares all three.
  - The restart ledger had the same weakness. Beside a reader, `Set-Content` saved nothing, so that tick's restart rate limits were lost. Its failure is terminating, so the existing WARN did fire, unlike `Add-Content`'s silent one.
  - `Restore-Overflow` runs at the start of each tick and moves stranded overflow lines back into the log under a `NOTE restored N line(s)` header. It renames the batch before appending it, so a reader holding the batch makes it wait instead of landing twice. If a reader keeps refusing the restore, the supervisor logs `WARN stranded log lines were not restored`, once an hour.
  - A reader with read-only sharing (.NET's `File.OpenRead`) can still block the writer, and its lines then go to the overflow.
- **Not covered at merge.** The box-local `data` loop and shim still wrote their own lines with `Add-Content`; they are in the repo since the section above (2026-10-09) and reach the box through its installer (installed 2026-10-09 07:09:56 ET; the loop's new code runs from the next boot).
- **Overnight, 2026-10-08 20:27 ET to 2026-10-09 07:16 ET (read with a FileStream sharing ReadWrite+Delete).** 19 lines in the main log after the restore NOTE: 14 ACTION (crop restarts at 03:44 and 03:48 ET, the 06:55 code-change edge restart, the fallback refresh, the 07:01 crop restart), 5 WARN (the 06:55 drift WARNs for the five host scripts, cleared by the 07:09 install), no `.overflow` or `.overflow.restoring.*` file, and no `WARN stranded log lines were not restored`. The writer held through a night with no reader-induced loss.

## Dead bridge queries, sign-edge restart continuity, Eufy bridge node identity (2026-10-08, after PR C; PR #2934) -- MERGED (main `d679d066`), DEPLOYED (nickstire `e56a8726`, StateNour web `1ede6fef`, worker `f3385162`); NicksMax pulled 22:50:37Z; `customer_stats` LIVE-VERIFIED; restart continuity's live proof still owed

- **Live receipts.**
  - **`customer_stats`:** answered 200 on the production bridge at 22:58:04Z: `total` 2334, `newThisMonth` 10, `monthStart` 2026-10-01.
  - **Deploys:** nickstire deployment `e56a8726` has served `d679d066` since 22:56:26Z; StateNour web's build was ancestry-checked via bdnick.info/api/version.
  - **NicksMax pull:** pulled to `d679d066` at 22:50:37Z. The supervisor runs the pulled script through its `data` shim, and its node needle matches only the bridge's node (pid 29724, with its go2rtc child 27792). The Eufy bridge's restart ledger is unchanged (21 restarts, the last at 11:01:45Z), with 0 port misses.
  - **Sign edge:** ended for the code change at 22:51:04-05Z and back at 22:51:13Z. Heartbeats under owner `b1660f14fba214cc` were HEALTHY from seq 2 (seq 1 UNVERIFIED at 22:51:19Z).
  - **Restart continuity:** that restart had 0 open visits, so it proved nothing. The proof is the first edge restart with a parked car: the line `restart continuity: track ... continues visit ...` and that visit's `departedAt` staying NULL.
  - **Still unproven, 2026-10-09 07:16 ET.** The only sign-edge restarts since are 22:51:04Z (above) and 10:55:19Z (06:55 ET, the code-change restart after the #2938 pull), and the second also restored `open_visits=0` (edge stderr `visitd ledger restored open_visits=0`). The 22:51Z run's own log is gone: the launcher overwrote it at the next start, before the `.prev` logs of #2938 were installed (07:09:56 ET). The next restart's log survives it.

- **`customer_stats` is a bridge action** (`server/services/customerStatsRead.ts`, registered in `QUERY_HANDLERS`, row in `docs/NICKSTIRE-QUERY-CONTRACT.md` v11.12): `{ total, newThisMonth, monthStart, newThisMonthMeans }`, the customers on file and the customers whose first invoice (`customers.firstVisitDate`, maintained by `services/dataPipelines.ts`) falls in the current America/New_York calendar month, compared as the stored shop-local day; not `createdAt`, which an import sets in bulk. Counts only, no names or phones. An unreadable database THROWS, so the route answers 500 and StateNour reports the section as unknown, never as zero customers. StateNour's dashboard summary had called it since v10.0.51 and got a 400 every time. `revenue_top_services`, the other query StateNour called that nickstire never registered, is retired on the StateNour side rather than built: invoice service descriptions have mostly stopped arriving (1 of 30 in August 2026), so a ranking would describe a sliver of the tickets.
- **A car parked through a sign-edge restart keeps its visit** (camera-bridge `edge_main.reconcile_restart`, `vision/pipeline.py`, `visitd/state_machine.py`; no nickstire code change). Before, a restart ended every open sighting, and the census treats cars present at startup as pre-existing and never reports them as arrivals, so each parked car's visit departed after the 20 s leave grace and the car stayed off the Lot until it left and came back (2026-10-07 camera audit section 5): a false departure for every parked car at every edge restart. Now the restored visits are held from departing for a bounded window (20 s from the first decoded frame), and a car the census sees still parked in the same place (IoU >= 0.5 with its last box, in the same zone, unmoved, its last sighting <= 120 s before) continues its visit under the same visit id: no departure row, no new arrival, `arrivedAt` and the stored episode id kept (the mirror sends no new episode id for it; the upsert keeps a stored value over a null). Anything ambiguous refuses (two restored visits near one car, two cars near one visit, a car that moved, a gap over 120 s) and that visit departs as before. A crash inside the window degrades to the old behaviour; the hold is not persisted. The edge logs `edge_restart_continuations_total` and `edge_restart_departures_total`. Known seam at merge, closed 2026-10-09 (flagged-items wave above): the episode id lived only on emitted events, never in the visitd ledger, so if a continued car's track later died and was re-acquired, the re-acquired visit got a new episode id and the Lot could count that car twice.
- **The Eufy bridge's node child has an identity** (camera-bridge `scripts/nicksmax/nicksmax-camera-supervisor.ps1`; no nickstire contract change). NicksMax's box-local launcher `start-bridge-nicksmax.ps1` passes `server.mjs` by its absolute path under `StateNour\Eufy`, and the supervisor's node needle requires that path. It used to be any `node ... server.mjs`, so any other Node project's `server.mjs` on the box would have been ended at every bridge restart and swept as a duplicate on every healthy tick (none runs there today: the live probe found only Desktop Commander's node processes beside the bridge). The launcher changed on the box first (backup `start-bridge-nicksmax.ps1.pre-node-identity`) because the new needle would not recognise a bridge started the old way.

## Camera N-series, PR C (2026-10-08, after PR B; PR #2931) -- MERGED (main `9d316523`), DEPLOYED (nickstire Railway `547b9ed1` on `b3a61b5d`, the prerender refresh on top of it; StateNour `7cf38ba4` on `9d316523`); NicksMax pulled to `b3a61b5d`, sign edge restarted on the new code 19:27:09Z

N4 of the 2026-10-07 camera audit (the owner brief), and the Codex findings on #2920, #2925 and #2927 that live in camera-bridge, StateNour and the office lane. Contracts this PR changes:

- **The lot camera's view of yesterday reaches the owner's morning brief (N4).** New bridge action `lot_brief` (`server/services/lotBriefRead.ts` reads, `server/lib/lotBrief.ts` decides; registered in `QUERY_HANDLERS`, catalogued in `docs/NICKSTIRE-QUERY-CONTRACT.md`): one shop day (default yesterday in New York; `filters.date` YYYY-MM-DD before today, within 120 days) in at most three material lines, most material first. (1) The camera watched under 80 % of business hours: the count is a floor and nothing is compared. (2) Traffic against the same weekday of the prior four weeks, compared only when that day AND at least two of those days were watched >= 80 % (`LOT_CONFIDENCE_RULES`, the Lot page's own gate, now exported) and only when off by >= 3 cars and >= 30 %. (3) Lot traffic with few tickets: >= 8 arrivals and tickets dated that day under half of them; a ticket's day is the stored shop-local `DATE(invoiceDate)`, as every other invoice reader keeps it (a UTC conversion moved date-only ALG tickets onto the day before; Codex on #2931); tickets are withheld unless the ALG mirror synced after that day's close. (4) Cars that stayed 3h+ of business time with no service recorded. A car is an episode (a stitched re-arrival is the same car), measured from its first arrival, clamped to opening, to its last departure or close; it is explained by a bay entry or a SERVICE_STARTED / SERVICE_DONE in force on ANY of its visits (`deriveVisitMarkState` per visit), and NOT_A_JOB on any visit excludes it (both Codex on #2931); a stay the camera missed > 30 min of is `uncertain` and not counted. A quiet day is one summary line; a failed read is `{ ok: false, error }`. Arrivals are the Lot's episodes, so the two cannot disagree on a count. **Coverage is unmeasured for any day that opened before 2026-10-08 16:15:11Z** (`TIMELINE_COMPLETE_FROM_MS`: before the #2929 deploy `camera_health_events` read HEALTHY through every outage), so the line says how many earlier weeks were measured until enough exist; the first same-weekday comparison can appear in the brief of 2026-10-24 (Friday 2026-10-23 against Fridays 10-09 and 10-16), only if those days were watched >= 80 %. The few-tickets and long-stay thresholds are uncalibrated (staff cars count as arrivals); the lines state their numbers. StateNour renders the lines in its morning brief's shop slice (`readLotBriefLines`); its `/system/camera` page is demoted (not featured on the hub; a notice names the Lot section of Nick's Admin as the lot view).
- **The N5 receipt only claims a call that fired.** `analyzeOfficeFrames` returns `prompted` (true on every path that reached a provider, false with no frames or no vision key); the conversation route stores `calibrationFrom` only when `prompted`, and never stores the flag (Codex on #2927).
- **The camera bay clock is unproduced until Phase 2, and now says so.** Production runs `bayZones: []` on the sign camera, so `camera-bridge/visitd/shop_mirror.py` never writes `bayEnteredAt` / `bayExitedAt`; every service clock today comes from operator marks. The mirror also keeps the FIRST entry and exit only, so the "bay entry after a done mark reopens the job" rule would not fire even with bay zones; `shop_mirror.py` names sending the latest entry and exit as a prerequisite for commissioning bay zones (Codex on #2927). No migration for a field nothing would set.
- **camera-bridge and StateNour, no nickstire contract change.** The portal straddle check (`vision/geometry.py`) is decided by edge crossings, a lot vertex held inside the portal, and samples strictly on each side: a long band crossing the lot with every sample outside (Codex on #2925) and a portal drawn around the whole lot are accepted, and **the 2026-09-16 shop calibration, a portal wholly inside the lot with two corners snapped onto lot corners, is now refused; the edge loader had accepted it because a boundary sample read as outside.** The dev runner (`vision/run_live.py`) applies the same check instead of its own grid. Supervisor: a port owner is ended only when its command line matches the task's child; code fingerprints are recorded only after a verified restart. Office worker: a `whisper-model.override` saved as UTF-16 (Windows PowerShell 5.1) is read instead of crashing startup, and a changed override drains the transcription backlog with new wakes refused before the worker exits for its restart (waiting for an empty backlog while still accepting wakes never converged under a steady wake rate). StateNour: a pending vehicle-alert page is claimed with a lease and a compare-and-swap, so two retries cannot both page (Codex P1 on #2920).

Receipts in the PR body.

- **N4 LIVE-VERIFIED in the 2026-10-09 morning brief.** StateNour composed it at 10:00:44Z (`brain_memories` `morning_brief` / `2026-10-09`, created 10:00:44.517Z, source `inngest/morning-brief`; StateNour was still on #2935 then, which carries PR C) after nickstire answered `POST /api/nour-os/query` 200 at 10:00:44.237Z (42 ms). Its shop slice: `Lot · Thursday: 6 cars came in; coverage not measured (the camera's outage record starts 2026-10-08), so nothing was compared.` The count is a floor (the day is unmeasured) and has not been compared with Thursday's tickets.
- **Overnight camera rows, 2026-10-08 22:48Z to 2026-10-09 11:15Z (nickstire deploy logs, four deployments).**
  - The sign camera did not go dark: HEALTHY at a ~30 s cadence all night. Its only state changes were one-heartbeat dips: EXPECTED_SOLAR_OFFLINE 23:33:10-37Z (dusk, written by the heartbeat ingest with the solar context), CALIBRATION_INVALID at 00:42:29Z, 03:18:49Z and 09:00:05Z, UNVERIFIED_CAPABILITIES at 08:15:19Z, and the edge restart's seq 1 at 10:55:31Z; plus one heartbeat gap that both cameras resumed from at 00:16Z (below).
  - **One page:** `camera health alert fired` sign UNVERIFIED_CAPABILITIES at 08:15:22Z (04:15 ET) and `camera health recovery fired` at 08:45:22Z, both delivered. The expected count was zero; the section at the top of this file stops a one-heartbeat dip from paging. No PRODUCER_OFFLINE page at dusk and no recovery page at dawn.
  - **The 5-minute pass's derived writer never fired** (no `camera health timeline: derived transition recorded` line): no producer was silent when a pass ran. The ingest's resumption path did run: the sign's `EXPECTED_SOLAR_OFFLINE->HEALTHY` at 00:16:22Z and the office's `STALE->UNVERIFIED_CAPABILITIES` at 00:16:58Z are logged against a latest row the ingest itself must have written for the gap (`retroOutageTransition`; inferred from the logs, the table was not read).

## Autonomy edits, tier cadence, the declared-source gate, caption safe zone (2026-10-08, #2933) -- MERGED (main `7fb150ca`), DEPLOYED (Railway `453c8d90` SUCCESS, container 22:09:28Z); tier due check LIVE-VERIFIED 22:13:49Z

- **Autonomy control edits change one setting on the server** (`services/autonomyControl.ts` `editPolicy`; `routers/content.ts` `setAutonomyLimit`, `setAutonomyPaidRepair`). Before, Save on a limit published the command center's partial copy of the policy (version, mode, kill switches, limits) and the router's shape check refused it: the Generation budget, and every limit, could not be changed from the phone, and an emptied field would have saved as 0. Now each edit reads the stored policy fresh, changes one field and writes exactly the next version; the UNIQUE version index is the compare-and-swap, so two phones editing at once both land. Kill switches use the same path (they built their edit from the 30 s cache). A version collision is recognised from the driver code on `.cause`; the old `/duplicate/i` test on drizzle's message never matched one. New **Paid repairs** row on Autonomy control: Automatic (behind a confirm; spends within the budget and the repairs-per-Reel limit) or Ask me first (one tap). `dailyReelPost` spends only on `auto`; production's value is unchanged (`auto`).
- **The 2-hour tier keeps its cadence across redeploys** (`cron/tierStartup.firstTickDelayMs`, `cron/scheduler.ts`). A tier not due at boot gets one claimed check at the moment it falls due, and its interval starts there. Before, the interval started at boot, so on 2026-10-08 the 2-hour tier (missed-call recovery, callback escalation, stale-lead follow-up, confirmation calls, review requests) ran at 10:17, 12:28, 15:17 and 18:26Z. A replay of that day's boots reproduces those runs under the old rule and runs every 120 min 15 s under the new one. Log lines: `<tier> tier falls due in N min` at boot, then `<tier> tier due check: FIRING|skipping — …`.
- **A beat declared real or deterministic is never generated** (`shared/shotRouter.beatsTheGeneratorMustNotRender` in `enqueueReelJob`, `processNextReelJob` and `requestBeatRepair`). Refused at enqueue (nothing reserved), at generation for rows already queued (before the paid provider anchor; the job fails with `BEAT_SOURCE_NOT_GENERATABLE …` and releases its reservation), and at the single-beat repair entry. A tag counts only as written in capitals (`REAL:`, `DETERMINISTIC card:`); prose such as "Real-world…" is not a declaration. No rotation pack carries one (tested over every pack); the three proof packs are refused. Routing those beats to a publishable lane waits on the real-evidence decision: the stock guard refuses every locally hosted clip.
- **Captions clear Instagram's bottom 35%** (`reelAssembly.CAPTION_BEAT_Y_FRAC` 0.62 → 0.55; `reelVoice.ASS_CAPTION_MARGIN_V` 500 → 720). Measured with Anton, every beat caption at 0.62 ended inside that zone (one line by 18-26 px, two lines by up to 103 px) and the word-timed ASS captions sat wholly inside it (69.5-74.2% of the height). Now the worst case ends at 63.4% (31 px clear) and the ASS box spans 58.0-62.8%. `server/captionSafeZone.test.ts` renders both with the production font (skipped where ffmpeg lacks drawtext or libass). Production assembles with drawtext: Google TTS returns no word timing (`usedAss: false` on job 2040001).
- **Experiments record only Reels their arm can reach** (`contentExperimentStore.assignEpisodeToActiveExperiment`). The daily lane builds every Reel from an approved pack verbatim, and the hook and duration arms apply only while a brief is written, so recording pack Reels put identical Reels in both arms. Pack Reels are no longer recorded in `hook_style` / `length_band` experiments, and their assignments' content origin reads `approved_pack`. A hook or duration experiment collects only AI-written briefs (Studio). The five mission experiments need approved pack variants: `docs/reels-engine-v2/06-EXPERIMENTS.md`.
- **Preflight's CTA rule matches the one-ask doctrine** (`shared/editorialContract.ts`). "One CTA, and it comes last" told an editor to put the ask on the last beat, where assembly's leaked-ask stop refuses it. Now a CTA in any beat warns, in imperative form only ("one visit" is not an ask), and beats `askSignals` already flags are left to `askLeakageProblem`. `askSignals`' call-us pattern was case-sensitive here; fixed in the next wave (section above).
- **The angle-bank reader is tested against a faked database** (`services/creativeAssistant.angleBankReader.test.ts`): both live statuses asked for; slate active, used up and unreadable; no database reads `error:`.

Receipts in the PR body.

## Reels Engine v2 follow-up + critic thinking budget (2026-10-08, PR #2930) -- MERGED (main `328daf0f`), DEPLOYED (Railway `7c5de257` SUCCESS 16:45:46Z; serving as `15d3c230` after the prerender refresh `108843ce`); critic fix LIVE-VERIFIED 17:17:51Z

- **The rendered-QA critic gets a bounded thinking budget** (`server/_core/llm.ts`, `services/renderedQa.ts`): production, 15:31:26Z — the gate's first re-run of job 2040001 reached `gemini-2.5-flash` and came back `finish_reason=length` after 573 characters on `max_tokens` 4096; Gemini 2.5 spends its thinking out of that budget, so the verdict JSON was cut off mid-finding (it began `"decision": "repair"`, `MALFORMED_GEOMETRY`). `InvokeParams.reasoningEffort` (`low` / `medium` / `high`) is sent as `reasoning_effort` only in a body fetched from Google's endpoint (the vision reroute, a direct gemini-* URL, the 403-quota fallback) — never to Ollama or OpenAI, and absent unless asked. `callVisionCritic` (also the specialist lenses) asks for `medium` (8,192 thinking tokens on 2.5) with `maxTokens` 16,384. **Live 17:17:51Z, the first critic run on this code:** job 2040001's verdict completed with `critic: vision`, decision `repair`, 17 findings, craft total 61.1, escalation `automotive`, one vision call. The two runs before it, on 4,096 tokens, were cut at 573 characters (15:31:26Z) and 1,655 characters (16:30:16Z). **Correction:** a `repair` verdict whose fix costs credits follows the autonomy policy, not a fixed hold. Production's active policy sets `autonomousRepair.paidBeatRegeneration` to `auto`, so at 17:17:51Z the daily-reel drain queued the paid regeneration of beat 2 itself (`SUBJECT_CONTINUITY`, repair `rep_56b1e18f-420`) through `requestBeatRepair`, priced at the active provider and capped by `maxGenerationCostPerDayUsd` and `maxRepairAttemptsPerAsset` (`dailyReelPost.ts`). Under the default `approval_required` it holds for the operator. This bullet used to say a paid repair is never automatic; that was wrong.
- **One run-counting rule** (`shared/reelJobPayload.renderedQaRunsSoFar`): the gate and the runner now count critic runs the same way. Before, a verdict older than the counter counted as one run at the gate but not in the runner, so 2040001's log said "critic run 2 of 3" and the next pulse "1 critic run(s)".
- **Preflight reads the storyboard against the editorial contract and the declared shot sources** (`shared/editorialContract.ts`, `shared/shotRouter.ts`, in `runReelPreflight`, WARN only): logo or generic footage on frame one, two ideas on one card, a CTA before the last beat, two CTAs, an end card past 2 s; a beat declared `ai_illustrative` that describes real work, or `real` asking for a generated shot. `StoryboardBeat.source` exists; since the follow-up above, the generator refuses a beat declared real or deterministic. The Video Forge benchmark corpus builder (`apps/video-forge/bench/build_corpus.py`) honours the same declared source and skips real or deterministic beats, so the committed `corpus.v1.jsonl` is unchanged by the proof packs.
- **Angle bank** (`docs/reels-engine-v2/angle-bank.json`, `shared/angleBank.ts`): 100 angles over the committed packs, the first 20 production-ready, A001–A008 the pilot; every named pack must pass the production builder (`approvedReelPackRotation.packBuildsForLane`). The Creative Assistant shows it as the `angleBank` Sources line (`error:` when unreadable). The three proof packs sit in `ROTATION_EXCLUDED` with the reason — their evidence beats are declared REAL and the shots do not exist yet. The capture card asks for the six-shot set (stills first; the pool is image-only).
- **Docs**: `docs/reels-engine-v2/README.md` indexes the reconciliation, doctrine, families, research, capture checklist, experiments, production metrics, the 8-Reel pilot and the 90-day model with the operator handoff.

## Camera N-series, PR B (2026-10-08, after PR A; PR #2929) -- MERGED 2026-10-08 (main `ed9a45d0`), DEPLOYED (Railway `3ce638b1` SUCCESS 16:15:16Z); the ingest's resumption rows ran overnight 2026-10-09 (inferred from logs, PR C section); the 5-minute pass's derived writer awaits a producer silent at a pass

Follow-ups N2 and N6 of the 2026-10-07 camera audit, the four nickstire Codex findings on #2920, and the review round on #2929 (an independent hostile review of the pushed head; the Codex bot was out of quota). Contracts this PR changes in nickstire:

- **The health timeline has every state, as time (N6).** `camera_health_events` had one writer, the heartbeat ingest, which logs the producer's own state changes; STALE / PRODUCER_OFFLINE / EXPECTED_SOLAR_OFFLINE are derived at read time and no heartbeat arrives to log them, so the table read HEALTHY straight through every outage and "steady today" on the Lot counted rows. Three writers now close that gap: the 5-minute `camera-health-alerts` pass records the state it derives whenever it differs from the last row (`recordDerivedHealthTransition`, before the page; a missing table is skipped once, any other failure is thrown after every camera is judged), **stamped where the state began on the heartbeat clock** (last heartbeat + the stale / offline threshold, `derivedStateBeganAtMs`; never before the row it follows, never in the future), not at the tick that noticed it; the ingest writes the producer's recovery at the resuming heartbeat when the gap exceeded the stale threshold (`resumptionTransition`), and, for a gap the pass never saw because it fell between two ticks, first writes the outage itself (`retroOutageTransition`: STALE or PRODUCER_OFFLINE by the gap's length, EXPECTED_SOLAR_OFFLINE for a solar camera dark inside its window, stamped where it began). `lot.health` returns per camera `timeline` (contiguous segments from local midnight to now, `current` state with its real start, `anchorKnown`; UNKNOWN for the stretch no row covers) **reconciled with the state that read derives** (`reconcileWithLive`: the rows lag the pass by up to a tick, so the open segment is cut where the live state began). The anchor is the last row before the day whose state actually changed (a same-state "producer restarted" row no longer makes "healthy for 2 h" of a camera healthy for days); a row stamped a second ahead of the app clock is clamped to now, not dropped; STALE is no longer counted as a drop. The Lot card draws the day as a strip over the business window; the changes/drops count stays beneath it.
- **Observation coverage per business hour (N2).** `lot.health.coverage`: the vehicle-truth camera's HEALTHY share of the shop's configured hours so far (`shared/shopState` `shopDayWindow`, DST-safe), per hour and for the day; UNKNOWN time is reported apart and never counted as watched; minutes the camera was **expected dark** (EXPECTED_SOLAR_OFFLINE, the solar morning) are reported apart (`solarMinutes`) and excluded from `pctExpected`, the share of the time the camera was expected to watch. `shared/lotDataConfidence` **withholds the baseline comparison under 80 % of expected watch time** (UNKNOWN, in words, with the minutes and the dark minutes; percentages floored so 79.6 % never reads "80 %") and above it scales the baseline **per hour** to each hour's expected-watch share, so an unexpected outage at 10 discounts the 10 o'clock baseline and nothing else, and the dark morning the baseline days also had discounts nothing. The Lot trust strip's "Watched today" chip says the honest share of all business time, tones on the expected share, and colours each hour cell: grey for no record, sky for expected dark, emerald / amber / red otherwise.
- **Codex findings on #2920, each confirmed before fixing.** `lot.activity` counts episodes the way the headline counter does (`COUNT(DISTINCT ... COALESCE(episodeId, visitId))`); the open-only floor-board read orders oldest first with a 7-day floor (nothing server-side closes an open visit, so without the floor orphaned open rows would fill the cap and push today's cars off the board); a restarted edge reads `warming` rather than blind until `heartbeatSeq x heartbeatSeconds` covers the blind-inference window; a recovery after a frozen-capture page is reported even while the camera is quiet because the claim payload records the vision **and frames** facets at page time (a frozen capture on a quiet lot reads vision=blind too; only `frames` tells them apart), and a warming detector is held like a quiet one.
- **The alert pass survives one camera's undeliverable page.** Delivery is per camera inside the loop; a refused page releases its claim as before, is logged with the camera, and the run fails after every camera has been judged, recorded and paged (it used to end the loop at the first refusal, so a notification outage became a monitoring outage for every camera after the first).
- Every new read orders by time first (`ORDER BY at DESC, id DESC`): TiDB ids are allocated in per-node ranges and are not time-ordered (`latestByIdOrdering` gate). `lot.health` is now executed end to end in a test with rows in `camera_health_events` (`server/routers/lotHealth.test.ts`): the pushed head threw `Cannot access 'str' before initialization` the first time a camera had an anchor row, which `tsc` cannot see across closures and no pure-helper test could reach.
- **Codex findings on #2927 (PR A), read after that merge; five fixed here, two routed to PR C.** The heartbeat ingest derives the state it stores and logs **with the solar context** (`deriveStateAtIngest` takes the read side's `DeriveContext`), so a solar camera whose edge is up with no stream at night is EXPECTED_SOLAR_OFFLINE in the row and in `camera_health_events`, not a CAMERA_OFFLINE drop every evening that the readers then relabel; `lot.health` reports "state for" as the heartbeat age only when the heartbeats actually stopped, so that camera shows the producer's own clock, not "dark for 20 s" all night; `lot.now`'s mark counters count only the marks **in force** (a mark counts unless a CLEARED for the same visit follows it in `(markedAt, id)` order, the boundary `deriveVisitMarkState` applies; a CLEARED row is never a mark); `lot.markVisit` puts the open-visit check inside the write (`INSERT ... SELECT ... WHERE departedAt IS NULL`) and reports a committed mark whose timestamp read-back failed as recorded with the server clock, never as a failure that invites a duplicate tap. Routed to PR C (section above): the producer (`camera-bridge/visitd/shop_mirror.py`) assigns `bayEnteredAt` once, so **the "bay entry after a done mark reopens the job" path is unreachable end to end** (PR C documents it: production writes no bay times at all until Phase 2); and `calibrationFrom` was stored even when no vision provider was called (fixed in PR C).

Receipts on the merged tree (main `0f9453df` merged in): `server/lib/cameraTimeline.test.ts` 30, `shared/lotDataConfidence.test.ts` 22, `server/cameraHealthAlerts.test.ts` 45, `server/cameraHealthAlertsRun.test.ts` 3, `server/routes/cameraVisitsRoutes.test.ts` 40, `server/routers/lotHealth.test.ts` 3 (143 in those six); every new or changed test was first run against the pushed head `2eee1c18` and failed for the reason it names (38 reds in 7 files); `pnpm run check` 0 errors; the full-suite count is in the PR body. Live proof after deploy: the first `derived on the 5-minute pass` row stamped before the tick that wrote it, a `(recorded at resumption)` row after a short outage, and "Watched today" reading its solar morning as expected dark rather than withholding the comparison.

## Creative control gates (2026-10-08, PR #2923) -- MERGED + DEPLOYED (`0f9453df`, deployment `2eb8c519`, 15:16Z)

Production facts this wave was written against (Railway logs, read 2026-10-08): the nightly Reel published every day 09-28 → 10-04 and then not at all 10-05 → 10-08 — each 04:00 UTC drain scanned 3 approved jobs, skipped all 3 (1740002 `inventory_published`, 1740003 and 1770004 `repost:caption`) and selected none; the next job was enqueued 10-08 10:02Z. `content-auto-gen` failed on all three observed runs (09-30, 10-03, 10-07: "LLM returned empty or non-string content"). Contracts changed:

- **Morning brief EXCEPTIONS gains a Reel-lane line** (`services/reelLaneHealth.ts`): silent while a Reel posted in the last 36 h; otherwise "No Reel posted in N day(s)" plus how many finished Reels wait for approval (or that none do, so production is the suspect); an unreadable lane renders UNKNOWN. Publication itself is unchanged and still needs the exact per-reel human approval.
- **Article drafts** (`content-generator.ts generateArticle`): `maxTokens: 12288` (was the 4096 default, shared with any reasoning the lane does first), text-part replies accepted, and an empty reply now throws with `model`, `finish_reason` and `completion_tokens` so the next failure names its cause. That the budget was the cause is a hypothesis until the next Wed/Sat run.
- **Content experiment verdicts arrive only at planned looks** (`shared/contentExperiments.ts`): the resolver re-evaluates daily, so a rule valid at one look was being applied at every look (optional stopping — an A/A experiment concluded in 83% of simulated runs). Now a verdict is possible only at `DECISION_LOOKS` = 12 / 24 / 48 / 96 reported posts per arm (then every 48), the 5% budget is split across looks (0.0125 per look), the top two arms must lead by ≥ 10% AND differ at two-sided permutation p ≤ 0.0125 (× runners-up with more than two arms), a `tie` (< 10% lead, 'retire this variable') is called only from the 48-per-arm look, and every other day is `insufficient_data` naming the next look. For reach-weighted metrics (`avg_watch_time`) the permutation statistic is the reach-weighted gap armRates ranks on. Seeded simulation walked daily the way the cron runs (400 runs per condition): identical arms end as a false winner in 3.8% of experiments (69.5% tie); a doubled share rate is found 99.8% of the time (mean first verdict 27.5 posts/arm), a 1.5x rate 85.0% — never on the wrong arm. The old rule crowned a winner between identical arms 85.8% of the time at its first look.
- **Mechanical truth packets** (`shared/mechanicalTruth.ts`): five topics (puncture repair, tread depth, uneven wear, vibration, pothole damage), sources NHTSA / USTMA on puncture repair, tread depth and uneven wear (vibration and pothole damage ship with `sources: []` until a citation is added), ten prohibited affirmative claims. The Reel publish door (`reelClaimAudit.condemnedContentProblem`) refuses a script that makes one, whatever was approved; the brief generator receives the allowed statements and reasons up front. No packet is technician-approved yet (`technicianApproval: null`). Zero matches across the 568 repo content files the test scans (reel packs, blog, guides, SEO pages, tire-size content, the reel manifest).
- **Rendered QA measures flashing** (`services/flashRisk.ts`): one extra ffmpeg pass at 15 fps; more than three general flashes in any second (WCAG 2.2 SC 2.3.1, whole-frame average luminance — conservative toward passing) adds a `PHOTOSENSITIVE_FLASH` block finding, routed to a free re-assembly. A scan that cannot run is recorded as `flash.unmeasured`, never as a pass. The vision critic is never offered this code.
- **Receptionist prompt evolution** (see "The weekly optimizer" below, which also carries the 2026-10-09 follow-ups, not yet merged): paired permutation gate, 30 seeds, structured `[evolve] result` log.
- **Evaluator paths** now include `ghostReplay.ts`, `promptEvolutionGate.ts`, `contentExperiments.ts`, `contentExperimentResolve.ts`, `mechanicalTruth.ts`, `renderedQaOutcomes.ts` and `pairwiseReview.ts`, mirrored in the Night Shift judge-edit rules.
- **Delivered-copy QA** (`services/deliveredReelQa.ts`): inside the 8-hourly Instagram analytics pipeline, at most two posted Reels per pass (posted 30 min–7 d ago, unchecked): Graph `media_url` (read-only) → ffprobe master and delivered copy → flash scan on the delivered copy → `payload.deliveredQa` (`below_720p`, `resolution_dropped`, `aspect_changed`, `duration_changed`, `audio_lost`, `low_frame_rate`, `flash_on_delivered_copy`). The write keeps `updatedAt = updatedAt` so the stall timer never reads a QA write as a post. `unmeasured` is retried up to 3 passes; the morning brief names failing jobs. Needs a live `META_PAGE_ACCESS_TOKEN` to measure anything — not verified against Instagram yet.
- **Skip rate reaches the experiment evaluator**: `ig_metric_snapshots.skip_rate` is DECIMAL (mysql2 returns `"83.6000"`); the gatherer read only numbers, so every skip rate was "not reported". `skip_rate` / `reels_skip_rate` / `skipRate` now resolve; `opening_asset_v1` decides on it (lower wins).
- **Experiment presets must be wired to run**: `audio_v1`, `carousel_cover_v1`, `fb_format_v1`, `opening_asset_v1` change nothing in generation, so starting one ran an A/A test under a treatment's name. `startContentExperiment` refuses them (`PRECONDITION_FAILED`), the resolver reports a running one as "not wired, not judged", and enqueue records a Reel in the oldest running experiment of EACH variable (it recorded only the single oldest, so a second running experiment could never conclude).
- **Previs readability gate** (`facelessReelStudio.validateOnScreenReadability`, in `runReelPreflight`): a beat whose on-screen text exceeds 4 words/s blocks, more than 3 words/s after a 0.3 s eye-landing warns. Scan of the 68 of 196 committed packs that carry storyboard beats: 346 beats, 0 blocked, 2 warned (one pack). A beat without `onScreenText` is no finding, never a throw.
- **Uploads are typed by their bytes** (`server/lib/imageSignature.ts`): `booking.uploadPhoto` (public), `services.uploadPhoto` and `instagramStudio.uploadEvidencePhoto` sniff JPEG / PNG / WebP / HEIC / HEIF, store under the sniffed type and refuse anything else with `BAD_REQUEST`; the Higgsfield start-image sniffer shares the function.
- **Hook fatigue** (`shared/reelHookGrammar.ts`): the beat-1 grammar the ledger has recorded since 2026-10-01 is now read — one point off "Distinct from recent reels" when a brief opens like ≥ 50% of the last 8+ Reels, and the daily lane's generator is told which shape to avoid (`reelDraftPrep` → `reelBriefGen`, a soft steer after the measured hook scoreboard; the reel director and manufacturing lanes do not pass it yet).
- **Critic findings priced by the audience** (`shared/renderedQaOutcomes.ts`): posted Reels' completed critic findings joined to their latest skip rate; a code whose posts skip significantly more (two-sample permutation, Bonferroni over codes tested, ≥ 4 posts per side) becomes a `quality` card on the Creative Assistant (now up to six cards; it opens Pipeline health). Only posts whose latest snapshot carries a skip rate are a side. Too few posts or a failed read renders nothing.
- **Real-evidence share**: `inputs.realEvidence` on the Creative Assistant ("2/14 published pieces in 30d carried real shop evidence"), also on the capture card. Reels count via `payload.realAsset`; photo posts via the `image.note` igAutopost writes for an operator-captured asset.
- **Provider drift probes** (`shared/clipDrift.ts`): assembly ffprobes every clip it already downloaded (`clipProbes` on the payload, provider from the beat's last succeeded providerOp); the morning brief reports a provider whose clips (≥ 2 in 7 d) differ from its own modal shape or length. Self-calibrating: fewer than 5 clips is no baseline.
- **Blind pairwise review** (`services/pairwiseReview.ts`, Today tab): two judged photo posts, no scores, one tap; picks go to `audit_log` as `content.pairwise_pick` with both judge totals snapshotted; the card shows operator-vs-judge agreement. No new table. A pair already picked returns the existing pick and writes nothing (a double tap cannot count twice; the buttons stay disabled until the next pair is fetched); a failed audit insert is an error to the operator, never a silent success; candidates are posted or dryrun rows only.
- **ig-autopost spends on pixels last**: caption eval → independent judge → image. Railway 2026-10-07: three runs of 332–342 s each generated an image for a 0.53–0.54 caption, and four of five runs were judge-rejected with a finished image; both verdicts never read the image. Same gates, same verdicts. A live judge rejection now REGENERATES inside the run (the judge sees up to 3 concepts per run instead of the run ending and waiting for the next tick); only a run whose every attempt is rejected aborts on the judge's reason, with no image generated for the rejected concept; the eval log counts `judgeCalls` per run.
- **Pre-merge audit additions (2026-10-08)**: `contentAdmin.stopContentExperiment({ experimentId, reason })` is the operator lever for an exposed preset found running (marks it `stopped` with the reason; `NOT_FOUND` when nothing is running under that id). The morning brief says out loud when a delivered-copy check stayed UNMEASURED after 3 attempts (never reads it as healthy) and reports a provider week with no majority clip shape as a provider change rather than drift from a norm. `pipelines-auto-run` carries an explicit 12-minute `timeoutMs` (the delivered-copy pass adds up to ~8.5 min worst case; at the 4-minute default a slow pass logged `failed: timeout` while the handler kept running). The experiment card counts the thinnest arm to the first decision look (12), not to the 4-post floor.
- **Publish gate re-runs a persisted non-evaluation** (`services/qualityGate.ts`): production, 2026-10-08 — job 2040001 was enqueued 10:02Z; at 10:33Z the vision critic returned no JSON object and the skipped verdict was persisted; every 15-minute drain pulse from 10:33 to 13:30 (eleven holds) read that same verdict back as THE verdict and never asked the critic again. A publish door now re-runs rendered QA on a skipped/unavailable persisted verdict: at most 3 critic runs per asset (`payload.renderedQaAttempts`, incremented by `runRenderedQaOnJob`), never inside 30 min of the last; a failed re-run is the same hold naming the count, and after the budget the hold names the admin re-run (Instagram → Queue / Action Center). Read-only checks never re-run. The critic now reads an array-of-parts reply and logs `finish_reason` plus the reply head when it fails. **`RENDERED_QA_ENABLED` is ON in production** (the hold branch is unreachable otherwise) — the wave-2 note that it 'defaults OFF in production' was wrong; only two verdicts have been persisted since 09-28. **Live 15:31:26Z (first pulse after deploy):** the drain re-ran the critic for 2040001 and held it again with the count; the 15:46Z and 16:01Z pulses held it naming the next due time. The re-run works; the critic failed on its token budget (finish_reason=length) — fixed in the section above.

## Camera N-series, PR A (2026-10-08, branch `claude/dreamy-newton-0iob20`, PR #2927) -- MERGED 2026-10-08 (main `ab5b91cb`), DEPLOYED (Railway `24073610` SUCCESS 14:21:40Z, since superseded by #2923's `2eb8c519`); 0144 applied on that deployment, 0145 applied 15:15:44Z (receipts in the header)

Follow-ups N1, N3 and N5 of the 2026-10-07 camera audit. Contracts this PR changes in nickstire:

- **Operator visit marks (N1).** Each open visit on the Lot floor board gets four two-tap buttons: Customer waiting / Service started / Service done / Not a job (`shared/visitMarks.ts`; stored in `vehicle_visit_marks`, migration **0145**, one row per tap with the admin's openId). `server/lib/visitMarks.ts` derives the clocks: service starts at the earlier of the camera's bay entry and the first Service started mark, ends at the last Service done unless a later Service started reopens it, Not a job clears the clocks while the car stays an occupancy fact. A camera-started service with no tap about it ends when the camera sees the car leave the bay, and a bay entry after a done mark reopens the job; `CLEARED` is the undo (rows are append-only; only marks after the last CLEARED count, the history keeps the mistake). `lot.visits` returns `marks` + `markHistory` per row, `lot.now.marks` counts the marked share, `lot.markVisit` writes (read back by insert id; a driver error reaches the browser as a safe message, never with the admin's openId in it). **Until 0145 is applied** every reader degrades by name: `marks` is null, the board says "Marks need migration 0145 (vehicle_visit_marks) before the buttons appear.", `markVisit` refuses with that name. Apply: the idempotent `scripts/migrations/apply-vehicle-visit-marks.ts` as a one-off Railway pre-deploy on a push-triggered deployment, or Admin -> Run migrations (the mirror statement is in `handleRunMigrations`).
- **Solar-aware camera state (N3).** The sign camera is solar (`shared/cameras.ts` `power: "solar"`). `server/lib/solar.ts` computes the shop's sunrise / sunset / civil twilight (NOAA equations, America/New_York) and names the window from civil dusk to sunrise + 150 min (the two measured recoveries were 09:15 and 09:23 ET, sunrise + 106 and + 116 min; the extra margin is for cloudy mornings, to be re-measured from the health timeline after a week). Inside that window an offline, stale, disconnected or frame-stale solar camera reads **`EXPECTED_SOLAR_OFFLINE`** (the loss is still named in the reason) in `lot.health` and in the alert cron; the state never pages, the HEALTHY morning after it is not a recovery page, and a daytime outage that ran into dusk keeps its paged key so the real recovery still pages once. A mains camera and the PTZ office camera never get the state. For the read-derived states (STALE / PRODUCER_OFFLINE / EXPECTED_SOLAR_OFFLINE) `lot.health` reports "state for" as the time since the last heartbeat, not since the producer's stale `stateSince`. Settings > Status rates the solar state a warning, the Lot header reads "Not watching · sign dark (solar night)" (amber only while the shop is open on it). Before this PR every dusk paged PRODUCER_OFFLINE and every dawn paged a recovery. **Operator-facing finding:** on the battery the sign camera covers roughly 09:30 to 19:25 in October, so the first 1.5 h of business are unwatched every day; a mains feed or a larger battery is the fix, not software.
- **Right/Wrong consumption receipt (N5).** A described office episode now stores `visual.calibrationFrom` (the reviewed episodeIds whose notes shaped its prompt, corrections first) and the "office visual stored" log line carries `calibrationFrom`, so the first framed episode after deploy either names the five 2026-10-02 reviews or proves the loader returned none.

Not in PR A: N2 observation coverage per business hour and N6 the per-camera health timeline (PR B, section above), N4 the StateNour owner brief over qualified events (PR C). Receipts this diff: `server/lib/visitMarks.test.ts` 10, `server/lib/solar.test.ts` 7, `server/lib/cameraHealth.test.ts` 45, `server/cameraHealthAlerts.test.ts` 33, `conversationRoutes.test.ts` + `officeVisual.test.ts` 44, `pnpm run check` 0 errors, `pnpm run build` exit 0.

## Camera intelligence audit wave (2026-10-07, PR #2920) -- MERGED 2026-10-08 (main `7c672458` after follow-up #2925), DEPLOYED (Railway `faff2669` SUCCESS 12:30:26Z); 0144 NOT yet applied

Audit with live NicksMax, Railway and Neon receipts: [`../../../docs/agent-audit/CAMERA-INTELLIGENCE-AUDIT-2026-10-07.md`](../../../docs/agent-audit/CAMERA-INTELLIGENCE-AUDIT-2026-10-07.md). As-built decisions, superseding ADR-0017 where production diverged from it: [`../../../docs/adr/0022-camera-vision-as-built.md`](../../../docs/adr/0022-camera-vision-as-built.md). Contracts this PR changes in nickstire:

- **`camera_runtime` gains eight rolling-window counters** (migration 0144: `detectionsLast10m`, `portalCrossingsLast60m`, `listeningCoverage60m`, `captureSecondsLast60m`, `capturesLast60m`, `captureFailuresLast60m`, `wakeTriggersLast60m`, `transcribeBacklog`). Hand-applied by the operator via Admin -> Run migrations, or as the one-off Railway pre-deploy `pnpm --filter nicks-tire-auto exec tsx scripts/migrations/apply-camera-runtime-window-counters.ts` (configured 2026-10-08; **a redeploy does not run a pre-deploy command**, measured on deployment `faff2669`, only a push-triggered deployment does, so it runs on the N-series PR A merge and is removed once its logs print `all 8 verified`). **Not applied as of 2026-10-08 12:30Z**: the `7c672458` container's first heartbeat logged the eight columns missing. Until then every reader (heartbeat ingest, `lot.health`, the alert cron) checks INFORMATION_SCHEMA and selects the pre-0144 column set, so nothing 500s and the new facets read `unknown`.
- **The health lattice has a `vision` facet** (`seeing` / `blind` / `quiet` / `unknown` / `not_required`). `DEGRADED_VISION` fires only when the detector ran within 600 s, saw no vehicle for 10 min and no portal crossing for 60 min during shop hours (`shopOpenAt()` reads `BUSINESS.hours`). `unknown` never blocks HEALTHY, so a pre-0144 edge cannot be paged for a column it does not send.
- **Camera-health owner alerts are keyed per episode** (`camera_health:<camera>:e<epoch>:<STATE>`, `fired_for` = the episode's shop day) with a 30-minute cooldown that holds instead of dropping, and recovery keyed on the degraded episode. This ends the midnight-ET "Office PTZ degraded" + "Shop sign recovered" double page that the day-key reset produced, and a camera that fails twice in one day now pages twice.
- **Lot states what its numbers rest on:** drive-bys (`PASS_THROUGH`) are counted apart from arrivals, departures and abandonments; a "What these numbers rest on" strip shows office / sign / data-confidence / event chips; the header reads "Not watching · sign <state>" whenever the vehicle-truth camera is not HEALTHY; the floor board has its own open-only query (limit 200, then "N more"); bay status reads unknown while the sign is not watching; `shared/lotDataConfidence.ts` grades today's arrivals against the prior-days baseline as UNKNOWN / LOW / OK.
- **Conversation worker freshness:** the fleet verdict reads the office worker STALE after 120 s without a report (`shared/cameraFleetHealth.ts`).

Corrections to older sections of this file, found by the audit (those sections stay as dated receipts):

- **The Lot producer is live, not missing.** The 2026-09-09 paragraph "What is still missing is a PRODUCER" is historical: since 2026-09-28 visitd runs on NicksMax in Session 0 and its `ShopMirror` posts visits to `POST /api/camera/visits` and heartbeats to `/api/camera/heartbeat` (Railway accepted `sign seq=1 ... HEALTHY` that day); the owner lane posts the same visits to StateNour `/api/devices/{id}/events`. `vehicle_visits` row counts were not re-read on 2026-10-07 (TiDB was not reachable from the audit session), which is exactly the gap the trust strip now reports instead of assuming.
- **Cold boot is observed twice, not proven.** Session-0 supervisor startup after a Windows start was observed on 2026-10-02 09:15 ET and 2026-10-03 13:56:58 ET (production chain back by 13:58:52 under SYSTEM). The receipt the 2026-09-28 notes asked for, fresh Railway camera heartbeats after a boot with nobody logged in, is still unrecorded.
- **The live supervisor task is `NicksMaxCameraSupervisorSystem`** (SYSTEM, at startup); its loop script calls `nicksmax-camera-supervisor.ps1` about every 30 s. The one-minute `NicksMaxCameraSupervisor` registered by `register-camera-system-task.ps1` is the 2026-09-28 receipt, not the running configuration.
- **The office camera watches as well as listens, and the decoder changed.** Migrations 0140 and 0141 are applied (0141 at 2026-10-03 01:24Z; `gist true` is stored on most Oct 5-6 episodes). The decoder is `ggml-large-v3-turbo-q5_0` since 2026-10-03 10:12 ET, which costs 226-600 s per 120 s capture, so the lane hears about 8 % of the day. PR #2920 decouples capture from transcription; the decoder choice stays the operator's.

Post-merge state (2026-10-08, operator-approved follow-up in the same session, PR #2925): NicksMax is pulled to `7c672458` and the hardened supervisor ticks on it (the office worker restarted on the new code at 07:45 ET with the decoder `small.en-q5_1` from the operator-writable `whisper-model.override`; the sign edge restarts on the new code when the solar camera returns); disk went 34 MB -> 4.28 GB free (the desktop AI apps and the V380 client are stopped; they are not infrastructure); the StateNour identity-index migration is applied and recorded. Still pending: **0144** (above), the Lot walkthrough, and the login-free cold-boot receipt (an operator action; the non-elevated bridge cannot issue a reboot).

## Admin closure wave (2026-10-02) — BUILT + TESTED; not yet deployed

Full corrections ledger and gated items: [`operations/ADMIN-TRUTH-PASS-2026-10-02.md`](operations/ADMIN-TRUTH-PASS-2026-10-02.md).
Changed contracts:

- **Human-review SMS drafts have a lifecycle.** `drafted` + `requires_human_approval` rows close as `cancelled·obligation_closed` (their `sms_response_jobs` obligation ended, or a thread reply / "No reply needed" closed it), `cancelled·superseded_by_newer_activity` (the customer texted again; outbound never counts) or `expired·stale_draft_expired` (>7 days), by the existing `orchestration-status-reconcile` pulse job. Never sends. A >7-day draft cannot be sent verbatim; the send is CAS-claimed before `sendSms`.
- **A missed call is one opportunity per phone**, closed by the customer being served: invoice on/after the call -> `won` (`recordOutcome`); later callback / lead / booking / captured call -> `duplicate` with a receipt. `lost` from a missed call now means aged out or a worked row, read the receipt.
- **Nick's draft proposals are capture-aware**: no draft for a call that persisted a lead/callback/booking; no callback draft when a callback row names the call; no booking draft when `bookSlot` recorded a walk-in. `scheduleCallback` now writes `vapi_call_logs.callbackId` via the trail.
- **`convertedToLead` = "reached a tool"** (unchanged behaviour, comment corrected). It is never a lead conversion.
- **Parents cannot be green over broken cameras**: Settings -> Status has 9 checks (camera health added); the Lot header reads the fleet verdict (`shared/cameraFleetHealth.ts`).
- **GSC**: the Market card names its source (official property total vs partial stored rows); the Traffic Funnel reads web rows only, impression-weighted.
- **Open callbacks show served evidence on Today**: an invoice dated the same day or later, or a later booking, for the same phone appends "likely served, close if handled" to the card (`callbackServed` bundle slice, cached 5 min). Nothing is auto-closed: the callback enum has no honest "served elsewhere".
- **Missed-call recovery texts reach tool-reaching callers**: a `convertedToLead=1` call is eligible only when a successful capture-evidence read proves it saved nothing (no lead, callback, callback request, expected arrival); a failed read skips it. Flags read live 2026-10-02: `missed_call_recovery` on, `MISSED_CALL_RECOVERY_SEND=1`.
- **SMS drafts receipt**: first `orchestration-status-reconcile` run on the new code (16:04:17Z) closed 366 drafts (52 obligation closed, 7 superseded, 307 expired, 0 left open).
- **Review requests**: migration 0139 is applied, so paid ALG invoices create one `review_requests` row each (cron `review-requests`, which runs only while the `sms_review_requests` flag is on); `post-invoice-followup` skips phones already on review cooldown. `review_requests.invoiceId` (UNIQUE) is declared in `drizzle/schema.ts`. The work-order path (which never succeeded) is removed.
- **Migrations 0127-0130, 0132, 0133, 0136-0139 are APPLIED and RECORDED in production (2026-10-02)**: the d5838402 container's one-tap runner reported 176 steps, none failed; `record-migrations.mjs` recorded all ten as exact schema matches; `reconcile-migrations --strict` exits 0 with no blocking drift. Receipts: `operations/ADMIN-TRUTH-PASS-2026-10-02.md`. `heldout` is now in all three status enums. `contact_holdouts_enabled` + `contact_holdout_retention|winback|weather|review_requests|campaigns` were ARMED 2026-10-02 17:25:10Z on operator instruction (read back `true`); `review_reminder_drafts` stays off.

## Creative Intelligence OS (2026-10-01, PR #2865 → `54a36662`) — merged; runtime receipt below

Railway deployment `015c1e73-b1f7-486d-b887-d6c876b9f41f` for `54a366629ba89867dcd5dbc916e37bee88f8e645` — status at the time this file was written: ****SUCCESS** at 17:48:57Z — container logged `[server:ready]` 17:48:52Z, `Schema guard: all critical tables present` (6 checked), `Tiered scheduler started: 5 tiers, 126 jobs`; `/api/health` at 17:50:31Z reported `status: healthy`, `deploy.commit 54a366629ba89867dcd5dbc916e37bee88f8e645`, `deploymentId 015c1e73…`, database up (6 ms), AI gateway up, self-healing score 100**. The narrative, the four live defects and the evidence are in `truth_os.md` §2026-10-01 and `docs/creative-intelligence-os/README.md` (§A2 per-slice states, §V post-deploy receipts). Contracts that changed:

- **Visual-QA publish gate (autonomous static lane).** For generative pixels, no rendered verdict means UNKNOWN and UNKNOWN never publishes unattended: Telegram `HELD BY VISUAL QA (unknown|scored_weak)` + `ig_autopost_log` reason `visual-qa-unknown`. Branded posters and operator-captured `real_shop` assets are exempt and the log reason names the asset. Critic ladder: Replicate → Gemini vision; a scoreless reply is UNKNOWN. Kill switch `IG_VISUAL_QA_GATE=false` (default on).
- **Image-provider circuit breaker.** `not_enough_credits`/402 opens a provider for 6 h, a retired model (410) for 24 h, transient errors never; in-memory, restart clears it. HF FLUX route removed from the ladder.
- **Brand truth in creative prompts.** `server/services/brandTruth.ts` is the single compiled fact object for the Meta Ads Architect and the article generator (warranty: 1-year parts / 90-day labor, no mileage; payment programs is the SSOT term; languages English/Arabic). A drift canary fails on any retired literal in 10 creative sources.
- **Article cron persists.** Wed/Sat auto-generated articles are saved as `status='draft'`; nothing on this path publishes.
- **Facebook reels as video.** `publishToSocial` Facebook branch: a video with no image and not a story runs Reels Publishing (start → rupload `file_url` → finish) behind `REEL_PUBLISH_ENABLED` and the claim check on `fbCaption ?? buildFacebookCaption(caption)`; `finish` timeout returns `ambiguous:true`. Nightly cron: `platforms = ["instagram","facebook"]` iff `REEL_FB_CROSSPOST_ENABLED === "true"` (set in prod 2026-10-01). Instagram is the status authority; FB failure only logs; FB live **or ambiguous** + IG refused parks `publish_ambiguous`. A reel flagged `isAiGenerated` is never sent to the Page (no AI-disclosure field in Facebook's Reels API). `reconcileAmbiguousPublishes` never auto-releases an attempt whose platforms include facebook: it records OPERATOR_REQUIRED (`facebook_unverifiable`). FB post insights sync after the IG loop into `ig_metric_snapshots` with `fb:`-prefixed post ids; both IG aggregate readers filter them. **LIVE+UNPROVEN** until the first `Facebook reel cross-post published` line and an `fb:` snapshot row.
- **Rendered QA cascade.** `renderedQa` now records `pixelStats` ($0, sharp), `craftScore`, `escalate`, `visionCalls` on every verdict; one specialist lens runs only with `RENDERED_QA_SPECIALIST=true` (default off, ≤2 vision calls per reel).
- **Experiments.** Arm key is the brief id end to end (`experimentEpisodeKey`); six presets, two generator-wired (`hook_style_v1`, `duration_v1` — lanes above 35 s collapse under `REEL_OUTPUT_RULES`, logged `capped`), four exposed-only.
- **Topic signals.** `customerQuestions` (calls/SMS/reviews/lead notes, PII scrubbed, fixed phrase bank) and `gscRising` boost the topic miner below declined-work. `shared/topicGraph.ts` 78 nodes / 161 edges.
- **Public site links.** `RelatedServices`, `BlogPost` chips and `InternalLinks` follow `shared/internalLinks.ts` / `linkGraph.ts`; `/general-repair` (a 301) replaced by `/auto-repair-near-me`. Prerendered tree refreshes via the workflow on `main`.
- **New admin surfaces, read-only or generation-only:** Creative Assistant cards (Today), `seoTools.linkRecommendations`, `creativeOs.{organicEvidence,atomizePlan,atomize,minePattern,trends}`, `instagramAdmin.getCaptureOpportunities`. None publishes.
- **Env contract additions (all optional):** `IG_VISUAL_QA_GATE` (default on), `RENDERED_QA_SPECIALIST` (default off), `REEL_FB_CROSSPOST_ENABLED` (default off; prod `true`). All three are registered in the Social Pipeline panel's env gates where they publish.

## Original-plan infrastructure reconciliation (2026-09-28)

- Durable 24-slice ledger: `../../../docs/research/2026-09-28-original-plan-reconciliation.md`.
- Live Nick/worker watch-path negations are applied; docs-only changes should no longer trigger broad Nick/worker deploys.
- Redis public TCP 6379 exposure is removed. Redis itself remains private/internal until the Railway dashboard 2FA deletion of service + volume + StateNour `REDIS_URL`.
- Worker is east4/private-only and StateNour observability no longer depends on a public worker URL.
- `pg_stat_statements` v1.11 is enabled on Neon and has already produced actionable StateNour performance evidence.
- Remaining §15 items are explicitly operator/dashboard/vendor/decision gates; do not relabel them as unfinished Nick code.

## Instagram Admin consolidation (2026-09-27/28) — merged and in live Nick ancestry

The recovered Instagram Audit workstream was reconciled past the Higgsfield closeout into the operator/admin layer and merged as #2723 (`785a43b8564cd30ad377da294039dbb4c6cd3341`). Nick production now serves #2741 (`45a5c02690e7193f05ce0da822fb59d2ebc899ca`), whose ancestry includes #2723, the #2727 static-caption budget repair, #2731 publish reconciliation, #2732 Pattern Lab outcome learning, #2733 content-run lineage, #2734/#2735 Trial Reel publishing/hardening, #2737 empty-lab bootstrap, and #2741's production-closeout Queue scoring repair. The implementation extends the existing system rather than building a parallel content stack.

- **Active Reel slate:** an ordered production overlay over the 133 approved packs with an independent durable cursor. Enabling, consuming, exhausting, clearing, or re-saving the slate does not move the canonical full-library cursor. Jobs persist source-pool provenance plus the active-slate definition revision so a mid-render enable/clear/reorder cannot advance the wrong queue. Legacy jobs remain full-library jobs.
- **Creative-fatigue + demand evidence:** existing production-grammar fingerprints, novelty collisions, and the existing live topic miner are surfaced as transparent ranking inputs. No fake virality score or automatic publish promotion was added.
- **Measured learning:** attention-microstructure comparisons become explicitly correlation-only structure hypotheses; shadow-judge verdicts are joined to append-only reach/save/share/skip snapshots. Both `posted` and reconciled `published` count as live. The UI always reports `hardGateSupported: false`; controlled validation is still required before any judge promotion.
- **Profile merchandising:** measured pin candidates, recent Reel cover review, a BUSINESS-source-of-truth bio suggestion, and upload-ready black/yellow Highlight cover assets are exposed. Actual bio edits, pinning, Highlight ordering, and cover uploads remain explicit Instagram-side operator actions.
- **Real-shop media:** Create can reuse only current, reuse-allowed, image-MIME, direct-runtime-URL `real_shop` assets. Drive viewer pages and non-image assets are not misrepresented as usable generation inputs; Strategy's reusable-media count uses the same predicate as Create.
- **Visual QA:** deterministic authenticated-client fixtures were exercised in system Chrome at 1440x900 and 390x844. Strategy and Create rendered without horizontal overflow; primary tabs, slate controls, profile links/bio-copy, Highlight controls, and the real-shop picker were present. This proves client/runtime layout behavior, not a live production-login or Meta mutation receipt.

**Local verification on the final code tree before PR:** full Vitest suite passed after the TiDB latest-row ordering fix and procedure-census regeneration; TypeScript, production build, source/SQL/hooks/brand/PII/cron lints, orphan gate (0 NEW), CURDATE, route registry, prerender and semantic-prerender checks passed. The live read-only migration reconciliation still reports six pre-existing blocking migration states (0127-0130, 0132, 0133); this branch changes no schema/migration files and does not claim that unrelated production drift is repaired.

**Post-deploy production receipt:**
- Meta configuration and live Graph probe are healthy: Facebook ready, Instagram ready, live probe `ok=true`.
- Active-slate service is live/readable: no operator slate is currently configured, canonical full-library cursor = **32**, approved candidates = **133**, Strategy recommendations = **12**, current demand candidates = **23**.
- Structure learning is live: **42** measured samples → **12** correlation-only hypotheses.
- Shadow-judge calibration is live: **27** judged, **10** would-block, downstream coverage **92.59%**, current outcome status `not_supported_by_current_outcomes`, and `hardGateSupported=false`. The system correctly did **not** promote the judge automatically.
- Profile merchandising service executes successfully with **4** measured pin candidates, **12** cover-review items and **5** Highlight plans. Current account-profile cache was empty on the fresh container while the Meta Graph probe itself was live; this is an ephemeral cache/data state, not a Strategy crash.
- Strict reusable `real_shop` media count is currently **0**. The picker is live but production has no first-party asset satisfying `real_shop + current + reuseAllowed + image MIME + direct runtime URL`. No unrelated asset was relabeled merely to populate the UI.
- The daily Reel lane is armed and has a real Sep 27 publish receipt: Reel job `1950017`, `igPostId=18435703312179867`, status `posted`.
- **Pattern Lab learning is live end-to-end.** The empty lab seeded exactly four unmeasured house hypotheses, and on 2026-09-28 the first successful post-bootstrap cohort completed the full production lineage. `rp_house_myth_reality` was persisted on Reel job `1980001`, the job assembled cleanly, rendered QA returned `approve` across 6 frames with 0 findings and `publishGate=proceed`, byte-exact approval was recorded, and the Reel published as Instagram media `18634414420000924` (`Dd10eTKkUtO`). The analytics pipeline then wrote `ig_metric_snapshots.id=1530001` for that same post at 18:24:42Z and `instagram_analytics.mediaProductType=REELS`. Initial reach/views/saves/shares/watch/skip values were zero because the snapshot was captured seconds after publish; the durable join itself is proven: `structurePatternId -> reel_jobs -> igPostId -> ig_metric_snapshots`.
- **Trial Reel publishing is live-proven.** An expired approval was first refused, then an eligible approved Reel published through the normal Admin choke point as Trial media `18448893436192927` at 2026-09-28 14:41:54Z. Inventory `autopost-2026-09-29` persisted `trial.postedAsTrial=true`, `graduationStrategy=MANUAL`, and the same post id; the published media also attached to the controlled-experiment loop for Reel job `1920015`. Trial-specific 24h metrics remain manual-entry and automatic SS_PERFORMANCE graduation is intentionally not implemented.
- **Authenticated production Admin walkthrough is now receipted.** A real signed-in session exercised the Today/Create/Queue/Community/Learn/Strategy backing procedures, including pipeline health, creation brief, Studio list/diagnostics/board, real-shop media, active slate, live feed, analytics, structure hypotheses, profile merchandising, judge calibration, and performance reporting. The surfaces returned live data; one legacy-draft scoring warning discovered during the walkthrough is handled by the closeout fix in this change.
- **#2727 static-caption recurrence boundary is live-proven, but not by a successful post.** A guarded manual one-off on 2026-09-28 reached the independent judge on all three generation attempts (scores 0.58, 0.60 and 0.41) without reproducing the old 4096-token truncation / empty-caption failure. The judge then correctly aborted the run for price-compliance, novelty and fabricated-stat defects; no IG/FB media id was created. A natural scheduled-slot successful post remains a separate future receipt.
- **Admin Queue legacy-brief scoring repair is LIVE VERIFIED on #2741.** The guard rejects genuinely incomplete historical `brief_json` without throwing while accepting the canonical queued-Reel shape persisted by `contentAdmin.enqueueReelJob`; that exact shape was added as a regression after Codex raised a P2. Final #2741 GitHub gates were green and Railway deployment `c7b4b57c-799a-4042-9539-42d6571674d6` is SUCCESS. At 2026-09-28 16:48:08Z a real signed-in NattyNour session opened Publish -> Reels. Windows UI Automation observed `getAllDrafts`-only draft cards for the two affected legacy rows themselves: `Reading a tire sidewall: the three markings that decide which tire fits` and `ALIGNMENT: You just hit a pothole on Euclid Ave and heard a clunk that made you wince.`, with `Review 9:16` controls. A read-only DB probe of the same latest-50 cohort independently found 49 Reel rows and confirmed both are non-empty legacy/unscorable briefs missing current scorer fields. Therefore `getAllDrafts` completed over affected legacy shapes with the guard in place—not merely the separate `reelPublishQueue` query—and the historical `failed to calculate reel score in getAllDrafts` / `undefined.map` warning did not recur.
- No active finite slate was silently enabled; production intentionally continues on the canonical 133-pack library. Bio/pin/Highlight mutations remain explicit Instagram-side operator actions.

**Evidence boundary:** Instagram Admin is **MERGED + DEPLOYED + POST-DEPLOY QUEUE LIVE-VERIFIED** through the #2741 runtime; later repository receipts through #2744 are docs-only. Trial Reel publish/provenance and Pattern Lab bootstrap/selection also have production receipts. The static generator live one-off did not reproduce the old truncation failure but was quality-aborted, so a natural scheduled successful static post remains pending. Trial 24h metrics and bio/pin/Highlight mutations remain explicit operator actions.

## NicksMax camera production authority (2026-09-28) — LIVE VERIFIED

NicksMax now owns the lightweight production `sign` camera-processing lane. This supersedes the earlier sibling-session/V380-GUI guard.

- **Direct production path:** native V380 cloud relay on `:8554` -> FFmpeg SHOPSIGN middle-lens crop -> MediaMTX `rtsp://127.0.0.1:8555/sign` -> production OpenVINO `edge_main.py` using `calib-nicksmax-sign-rtsp.json` (SHA256 `67F719CC875DEE8B0EFF9B246428CE9840530FB0921FA9BCC1FFB8803D502258`).
- **No GUI dependency:** the V380 desktop executable was absent during final verification. Legacy WGC/V380-watchdog and shadow-candidate tasks remain disabled.
- **SYSTEM authority:** `NicksMaxCameraSupervisorUser` is disabled. The active supervisor and production camera process tree run in Windows Session 0.
- **Self-heal receipt:** with the user supervisor disabled, the old Session-1 production edge tree was killed. Session 0 recreated the production wrapper at 18:27:11 ET and Python/OpenVINO edge processes at 18:27:12 ET; the local status log recorded `START authoritative RTSP sign producer` at 18:27:12 ET.
- **Cloud/admin-backend receipt:** Railway `MAINnicks-tire-auto` accepted the restarted producer at 22:27:38Z as `sign seq=1 accepted state=HEALTHY`, followed by seq=2 and seq=3 HEALTHY. After Windows was locked, HEARTBEAT acceptance continued through at least seq=8 at 22:31:08Z.
- **Evidence boundary:** GUI-free, Session-0, self-heal, and locked-screen operation are proven. A full Windows reboot after the SYSTEM-supervisor cutover is not yet live-proven because the remote-control layer blocked restart/shutdown. Do not promote `AtStartup` configuration into a cold-boot receipt until a later controlled reboot produces fresh Session-0 and Railway evidence. **Updated 2026-10-07:** Session-0 startup after a Windows start was observed on 2026-10-02 09:15 ET and 2026-10-03 13:56:58 ET (chain back by 13:58:52 under SYSTEM); the login-free Railway heartbeat receipt is still unrecorded, so cold-boot persistence is observed-twice, not proven. The live task is `NicksMaxCameraSupervisorSystem` (at startup; its loop calls the supervisor tick about every 30 s).
- **Storage warning:** C: had about 2.53 GB free (6.3%) at closeout. Camera logs/DBs were small; active worktrees were deliberately preserved rather than deleted.

Durable local-node receipt: [`../../../docs/operations/NICKSMAX-WORKSTATION-2026-09-27.md`](../../../docs/operations/NICKSMAX-WORKSTATION-2026-09-27.md).

## NicksMax Office Eufy production authority (2026-09-28) - LIVE VERIFIED

The canonical production Office device is **NICKS EUCLID** (`T8410P5225154105`, T8410C). `Moes Euclid Office` (`T8410P522517180B`) is the old/legacy shared camera and must not be used as the production target.

- **Producer contract:** `office` is commissioned and emits `mode=PRODUCTION`; the Eufy agent/bridge/installer/wake defaults target `T8410P5225154105`.
- **NicksMax runtime:** bridge, agent and watchdog run on NicksMax; NattyNour's old OfficeHealth producer remains disabled.
- **Port isolation:** Eufy bridge `3000`, go2rtc API `1984`, Eufy RTSP `8654`, Eufy WebRTC `8655`; V380 sign retains `8554/8555`.
- **Live device proof:** the authenticated bridge enumerates NICKS EUCLID as T8410C with video/RTSP/PTZ/audio plus motion/person capabilities.
- **Live media proof:** direct NicksMax probe succeeded with `mediaPlaneOk=true` and `lastMediaProofAt=2026-09-29T00:20:11.894521+00:00`.
- **Backend receipt:** after correcting the target, `office seq=1` at 00:19:11Z transitioned `MEDIA_DEGRADED -> UNVERIFIED_CAPABILITIES`; continuous corrected heartbeats reached at least `seq=16` at 00:28:15Z.
- **Current health truth:** media is no longer degraded. `UNVERIFIED_CAPABILITIES` remains until the current producer observes fresh semantic-event, control/PTZ and calibrated-home receipts.
- **Legacy boundary:** old Moes P2P failures and any Moes home/calibration/PTZ evidence are camera-specific historical evidence and must not be transferred to NICKS EUCLID.

## NicksMax Office Intelligence runtime (2026-09-28/29) - LIVE PRODUCTION LOOP VERIFIED

This extends the commissioned NICKS EUCLID Office lane; it does not create a second camera authority. PR #2759 deployed the production ingest/Admin surface and #2786 added the fail-closed local audio fallback plus durable FFmpeg handling. On 2026-09-29 the operator explicitly cleared the recording-policy gate and enabled capture on NicksMax.

- **Headless audio source is live-proven:** the reviewed Eufy bridge exposes `http://127.0.0.1:3000/record/T8410P5225154105`; Chrome/Eufy web UI and the Windows microphone are not production dependencies.
- **Port isolation remains intact:** Eufy uses bridge `3000`, go2rtc API `1984`, RTSP `8654`, WebRTC `8655`; V380 sign remains on `8554/8555`.
- **Single worker authority:** `StateNour-OfficeIntelligence-NicksMax` is the sole Office interaction worker. It was recreated from the hardened #2786 installer and runs as the NicksMax Office capture/STT authority.
- **Activation state:** machine flags were verified `OFFICE_INTERACTION_CAPTURE_ENABLED=1`, `OFFICE_AUDIO_POLICY_ACK=1`, `OFFICE_AUDIO_FALLBACK_ENABLED=1`.
- **Fallback trigger:** short non-retained audio-energy probes are the secondary wake path when Eufy semantic pushes are absent. A wake requires both sustained mean and peak thresholds; the dedicated fallback cooldown starts after a fallback-triggered capture finishes.
- **First real automatic production receipt:** at 2026-09-29 17:35:54Z the live worker woke on `audioActivity` from NICKS EUCLID (probe mean -48.2 dBFS, peak -27.1 dBFS), completed a bounded capture, segmented the audio, ran local Whisper, and finished successfully at 17:39:57Z.
- **Production result:** `segments_found=5`, `episodes_prepared=5`, `episodes_transcribed=5`, `episodes_posted=5`, `episodes_failed=0`, coverages `[1.000, 0.911, 0.919, 0.742, 0.167]`, `summaries_stored=1`, `facts_stored=1`, STT latency 25,086 ms.
- **Post-capture worker state:** worker returned to `READY`, fallback entered `COOLDOWN`, failures today remained 0, and the live status receipt recorded fresh post/STT/summary timestamps.
- **Admin read path:** `trpc.lot.conversations` reads the same `conversation_episodes` table, hides self-tests by default, recomputes coverage, returns `summary` + `factCount`, and Admin renders them under **Lot -> Office intelligence -> Counter conversations**. Raw audio/full transcripts are intentionally not shown there.
- **Resource controls:** raw episode audio remains local with 6-hour age retention, 256 MB quota, and a 768 MB disk floor. Fallback probe audio is not retained.
- **Evidence boundary:** the full automatic path is now proven: local wake -> bounded capture -> segmentation -> local Whisper -> evidence/coverage handling -> production episode posts -> summary/fact storage. No new code change was required after #2786.
## Connection hardening closeout (2026-09-27/28)

**Final merge receipt:** #2721 squash-merged as `1ab0063f523e0761d5e9e2c4f02ed12d8966b41d` after affected CI, authenticated StateNour E2E, Completion Authority, Adoption, Agent Policy, Admin, Secret Scanning, and security all passed. Its four earlier review findings were fixed and resolved. #2721 changed documentation/memory only; it does **not** claim a newer Nick production deployment than #2720.

Durable receipt: [`../../../docs/00-current-truth/connection-hardening-2026-09-27.md`](../../../docs/00-current-truth/connection-hardening-2026-09-27.md).

- Nick production's source-code deployment is `a3b3555e43e755f0a90b12fc6962be2340e21503` (#2720); later repository commits at this checkpoint are documentation-only and must not be mistaken for the deployed app SHA.
- TiDB/database/schema/self-healing are healthy and no longer the incident blocker.
- Tailscale shop connectivity works; initial DERP fallback followed by a direct peer path is normal NAT traversal, not an outage.
- Camera-health detection, durable claim/retry behavior, and persisted sign degradation/recovery state transitions are proven. Provider-accepted **real production degradation plus recovery owner delivery is not yet proven** and remains open.
- Office is commissioned and emits `PRODUCTION` heartbeats from NicksMax against NICKS EUCLID (`T8410P5225154105`). Media is live-proven; the current state is `UNVERIFIED_CAPABILITIES` because fresh semantic-event, control/PTZ and calibrated-home receipts remain unknown. The old Moes camera (`T8410P522517180B`) is legacy and is not the production target.
- NicksMax camera authority is now live on the direct Session-0 RTSP/OpenVINO path with the V380 GUI absent and locked-screen heartbeats proven. The earlier camera-session reboot guard is superseded; only the post-cutover cold-boot persistence receipt and separate consumer ESU enrollment remain open (2026-10-07: Session-0 startup after a boot was observed on Oct 2 and Oct 3, but the login-free Railway heartbeat receipt is still unrecorded).
- Resend domain verification is failed until the required records are added at the authoritative Global Domain Group DNS provider.

## Higgsfield runtime recovery + live canary (2026-09-27)

PR #2717 (`4d6488623e08f682ccdf5a283d501b9c9c24525c`) moved the CLI/runtime from the obsolete 0.2.3 contract to 1.1.26, version-scoped its native cache, and wired the current workspace contract. Production then changed from `Session expired` / `higgsfield session dead` to successful keepalive and Reel-pipeline pulses.

The recovery is now proven across a process boundary, not just inside one dyno. A read-only mysql2 probe showed the durable `app_secret_kv` Higgsfield credential row already existed before a later Railway process startup (reported row `updated_at` 22:44:08Z; process registration logged 23:39:20Z). A subsequent keepalive from the fresh process completed with `session refreshed, 13.5 credits`, proving the restarted service recovered usable persisted credentials. Full refresh-token revocation still cannot be bootstrapped by cron and requires an operator browser login.

Live canary Reel job `1950002` then generated five Higgsfield clips. The pipeline recorded both generation and repair as `assets_ready`, then failed closed at render QA because the caption ask (`send this`) disagreed with the end-card ask (`profile`). **No social publish is claimed.** The canary was paid work: the observed Higgsfield balance fell from 98.5 credits to 13.5 credits during the generation/repair sequence, so do not repeat this canary merely to re-prove liveness.

## Portfolio reconciliation (2026-09-26/27) — stale branches are not backlog

A run-to-empty reconciliation was performed against current `main`, PR history, tests, and concrete tree equivalence — not branch names.

- **Dependency refresh is merged as #2696**: reviewed head `301392c325c0c0b34e7ef68c6d4bef9ccdd37ea0`, squash `6704ca49b63dbaa0997c57efb689e4b618e4f19a`. The merge changed exactly the intended 10 dependency/lock files and has the same stable patch-id as the reviewed branch (`8001fef75e4a6176a37a47ea5f1a088dbd54788b`). The reviewed head passed real pre-push affected build 12/12, StateNour 9,748/9,748 tests, Linux affected CI, authenticated StateNour E2E, Docker/adoption/completion/admin/secret gates, and a fresh Agent Policy run after adding the required source/date citation. Stale Dependabot #2662 is closed as superseded. Repo dependency truth includes Next 16.3.6, Turbo manifest `^2.11.3` (lock resolved 2.11.4), Lefthook 2.1.14, tsx 4.23.15, Drizzle Kit 0.31.11, and aligned Next tooling. **No production deploy claim is made here.**
- **Q43 consent ledger is merged as #2694** (`1bb19803c4d6107a61d3e39d135ef35d82a0631a`) and **Q45 spoken opt-out truth is merged as #2683** (`78fcd528adcffb4ca32191636794e5b720aab4ad`).
- **Q49 VIN consolidation is merged as #2684** (`4e75f1750523bee658eec08f1a6a9a7ba51c5ac4`). The old dirty Q49 worktree is a rejected predecessor: it reintroduces an unconsumed vPIC batch API and removes the historical 11–17-character admin partial-VIN lookup #2684 deliberately preserved. Do not resurrect it.
- **Q37 review work is already on `main`.** The surviving dirty review worktree would restore the obsolete `OPENWEATHER_API_KEY` scheduler gate and contains only stale/garbled ShopDriver edits around matcher logic already present on `main`. Do not merge it.
- **Q35 Sentry/noise work is already on `main` byte-for-byte** across every file touched by its two old commits, including deploy-skew recovery, social-assets font tracing, duplicate lead-audit retirement, and the import-graph cron/tRPC guard. Its apparent branch uniqueness is squash-history noise.
- **Nour runtime commit `8f0de2f4d` is patch-equivalent to `main`** and its five files match current `main`; it is not unfinished work.
- **Q51 weather review is superseded by current keyless-NWS truth.** Its dirty worktree would delete newer scheduler dependency ordering, corrupt text encoding, and throttle operator alerts before delivery instead of after successful delivery. Do not merge it.

**Concurrency boundary:** camera/Eufy, Q12 receiver, migration-0134, office-wake, conversation-cockpit and other newly-created worktrees belong to separate active workstreams unless their owning session explicitly hands them off. Do not infer backlog status from `git branch --no-merged`; squash merges and dirty historical worktrees make that signal unsafe.

**Closeout receipt (2026-09-27):** after the reconciliation entry above, GitHub was rechecked with **0 open PRs**. The clean redundant worktrees `deps-dev-minor-current`, `nour-intelligence-runtime-20260926`, and `portfolio-truth-20260927` were removed locally and their obsolete local branches deleted. Dirty Q35/Q37/Q49/Q51 predecessor worktrees were deliberately preserved rather than force-deleted because they contain uncommitted or divergent historical evidence. Camera/Eufy/Q12 worktrees remain owned by separate active sessions. **The reconciled code backlog is exhausted; issue #2628 remains the source of operator/vendor/infrastructure actions and must not be misreported as unfinished code.**

## Midday Reel reconciliation (2026-09-25, PR #2656 merged): 133 approved packs

The recent midday Reel batches were reconciled against **current** `main` after #2655's evening import, rather than merging the stale 121-pack branch. The census is **27 source concepts = 11 distinct additions + 16 semantic duplicates already covered**. The machine-readable map is `docs/reel-packs/MIDDAY-IMPORT-2026-09-25.json`; the narrative audit is `docs/reel-packs/2026-09-25-midday-idea-rotation-audit.md`.

The 11 distinct slugs are appended after the 122-pack rotation; no earlier entry is reordered because `reel_approved_pack_rotation_index` is a persisted array index. Two pre-existing reviewed packs (nitrogen-vs-air and foggy-windshield A/C) are normalized and made reachable rather than duplicated. `server/reelPackRotationCoverage.test.ts` raises the ratchet to `PREFLIGHT_PASSING_FLOOR = 133`.

The deterministic production builder + `runReelPreflight` sweep returned **133 checked / 0 failures** locally. PR #2656 then passed **CI · turbo-affected verify, Completion Authority, Secret Scanning, Adoption gates, Agent policy, and Admin completion diagnostic** before squash merge at `55d5d5fa21fb912c49b450e665c00f74df9c8b83` (Evaluator separation skipped by design). During reconciliation the UTQG draft correctly tripped existing safety rules because its social copy used “warranty” / “guarantee”; the mechanic truth was preserved while the wording became manufacturer tread-life coverage / mileage promise. The gate was not weakened.

**Evidence boundary:** 133/133 preflight-clean proves repository reachability and pre-spend enqueueability only. It does **not** prove a live Higgsfield render, Instagram/Facebook publish, production DB/env mutation, ad action, or Railway deployment receipt.

## Reel rotation expansion (2026-09-25, PR #2655): 122 approved packs

The approved Reel-pack queue on `main` now contains **122** append-only entries. The 2026-09-25 operator batch reconciled **33** candidate lessons against the live rotation before adding anything: **23 distinct packs were added; 10 semantic duplicates were mapped to packs already rotating**. The machine-readable reconciliation is `docs/reel-packs/EVENING-IMPORT-2026-09-25.json`.

The cursor contract did not change: `reel_approved_pack_rotation_index` is an array index, so the 23 additions were appended after the previous 99 and no existing slug was reordered. `server/reelPackRotationCoverage.test.ts` now sets `PREFLIGHT_PASSING_FLOOR = 122`; CI requires every rotating pack to remain builder-loadable and clear `runReelPreflight` before paid generation.

The gate caught a real defect before merge. All 23 imported packs initially used one shared visual phrase containing `generated readout`, so the `no-in-frame-text` hard gate rejected them and CI measured **99/122**. The briefs were fixed to describe the physical distinction through shape/position/surface/motion, the ratchet stayed at 122, and the final #2655 affected pipeline passed (**7/7 Turbo tasks**) along with Completion Authority, Agent policy, Adoption gates, Admin diagnostic/typecheck, and Secret Scanning.

**Evidence boundary:** this is merged repository truth at `f5f6213799d167b40c1285cfc20c45215e082163`. It proves rotation reachability + pre-spend preflight for the 122 packs. It does **not** prove a live render, social publish, production DB/env mutation, paid-ad action, or post-merge deployment for this batch.

## Customer-corpus wave (2026-09-23): what changed in live behaviour

Deployed: production served `958b89ef7` from 13:08Z (deployment `df4dcfe7`), which carries every PR
below. The operator tapped **Push Latest Config** and **Push Follow-Up Assistant** at 13:12Z; the
Railway log shows `Updated Vapi assistant` (receptionist `150fe622…`) and `Updated Vapi follow-up
assistant` (`0daaf7dc…`), twice each, and no refusal. Grounded in the first production census
(#2576, `docs/operations/CUSTOMER-CORPUS-RESEARCH-2026-09-23.md` Part M).

| Contract | Where | PR |
|---|---|---|
| Every callback the receptionist promises goes through `escalate` (callback row + Promise Ledger); Push Latest Config refuses to push when it cannot read the live assistant | `services/vapi.ts`, `routers/voiceAgent.ts` | #2559 |
| The stale-callback cron leaves an unworked callback `new`: no fake `no-answer`, no `calledAt`, one alert per row | `cron/jobs/crudAutomation.ts` | #2569 |
| PUSH FOLLOW-UP ASSISTANT button; both pushes log their result | `routers/vapi.ts`, `VapiPanel.tsx` | #2571, #2575 |
| The no-show sweep uses the Eastern date | `services/expectedArrivals.ts` | #2575 |
| The after-hours web-form text gives the real opening time (`{nextOpen}`) and promises no callback | `services/smsMessageCatalog.ts` | #2579 |
| The assistant no longer promises "we'll text when it's ready" on a drop-off | `services/vapi.ts` | #2580 |
| Vapi `transfer-update` is recorded (state `transfer_attempted`, destination kind only); the end-of-call `transferArtifact` carries `transferUpdateSeen`. Proves an attempt, never an answer | `routes/webhooks/vapi.ts`, `lib/transferArtifact.ts` | #2581 |
| Today's action queue lists customers waiting on a HUMAN text reply: the ROS-058 obligation (`sms_response_jobs` human_pending), one per conversation, internal lines excluded, Urgent past the 30-min SLA; the Outreach badge and morning brief count the same rows. A human reply or "No reply needed" clears it, an automated text does not; an unreadable queue vetoes "All clear" | `services/smsResponseJobs.ts` (`listWaitingConversations`), `OverviewSection.tsx` | #2582, audit I |
| Today -> Arrival load shows the tire sizes phone callers asked about today (size + new/used, never name or phone), one caller per call, counted from the #2584 deploy on | `lib/tireDemand.ts`, `dispatch.phoneTireDemandToday` | #2584, audit J |
| The live unsubscribe rule no longer fires on "stop by/in/over/at/off" or "end of/up"; every other reply opening with an opt-out keyword still unsubscribes | `services/smsResponseParser.ts` | #2587 |
| Campaign recent/lapsed audiences and the capacity estimate's "today's bookings" use the Eastern date (curdate baseline 105 sites / 30 files) | `routers/campaigns.ts`, `routers/conversion.ts` | #2587 |

Operator decisions recorded the same day: `convertedToLead` means "reached a tool" (option C, behaviour
kept); the AI voice-recovery lane stays on, and STOP stops both texts and calls.

**Not yet observed in production:** a `transfer_attempted` row on a transferred call; the Texts filter
against the SMS inbox; the "Asked by phone today" line after a tire call; the new drop-off wording on
a live call.

## Careers job pages, and the cloaking incident that produced them (2026-09-10)

**`/careers/<slug>` leaf pages are LIVE and correct.** Three of them - automotive-technician,
service-advisor, tire-technician - serve a full `JobPosting` to crawlers and the real page to
people. Verified in a browser, not inferred: both a Googlebot and a Chrome user-agent return **200**
on the same URL, and `validThrough` is in the future.

**How they got there matters more than that they exist.** `prerender-refresh.yml` named the literal
`main` in every git command of its commit step, so a `workflow_dispatch --ref <branch>` chose the
CODE and had no say over the DESTINATION. It rendered a feature branch's routes and pushed the
artifacts to `main`, which had neither the routes nor `JobPage.tsx`.
`server/prerender-middleware.ts:147,150` resolves prerendered HTML by **file existence alone**, with
no routes-manifest check - so the pages were served. For a period on 2026-09-10 the same URL
returned **200 with a JobPosting to Googlebot and 404 to a browser**: cloaking by Google's own
definition, on a job posting.

Three standing facts from it:

1. **A green "Prerender refresh" reads identically whether it wrote where you asked or to `main`.**
   Read the push refspec in the log, not the job conclusion.
2. **`[skip ci]` skips the workflows, NOT the Railway deploy.** A wrong artifact still goes live.
3. **Routes and their prerendered artifacts must land in the SAME merge.** Shipping routes without
   artifacts turns `prerender:check` red on `main` and serves crawlers an empty shell - the exact
   inverse of the cloaking above, and this branch nearly did it.

## A read that could not run must not render as a confident zero (2026-09-10)

Measured across `server/`: **188** dead-handle returns fabricate a value; **7** report
`available: false`. Most are not defects - a cron returning `[]` on a dead handle simply does
nothing that tick. The rule that separates them is whether the read **renders or scores**.

Fixed and deployed, all guarded at the ROUTER (the ROS-083 shape, because the `[]` is frequently
load-bearing at the helper - `adminBundle.ts` consumes `getCallbackRequests` inside a
`Promise.allSettled`):

| Surface | Fabricated | Now |
|---|---|---|
| SMS unread badge | `0` - rendered **nothing at all** | throws; "unknown, not zero" |
| Reminder stats | all-zero counters | throws; "unknown, not zero" |
| Admin bookings list | `[]` - read as a **quiet day** | throws; "unknown, not empty" |
| **Public** statusByRef / statusByPhone | `null` - told a customer their booking **did not exist** | throws; "does not mean your booking is missing" |

The public pair is the sharpest: "not found" and "could not look up" are opposite messages to
someone holding an appointment, and one of them is false. The wording is asserted by test, not just
written.

**30 pairs remain, and they are RATCHETED, not forgotten.**
`config/fabricated-admin-read-baseline.json` records them by (procedure, helper);
`server/fabricatedAdminReadGate.test.ts` fails on any NEW pair; and
`scripts/update-fabricated-read-baseline.mjs` **refuses to raise** the count, exiting 1. The unit is
deliberately the PAIR and not the helper: this repo fixes at the router, so a helper-based count
could never move. It went 35 -> 33 -> 30 as fixes landed, which is the evidence the unit is right.

## Lot / vehicle visits — schema APPLIED to production (2026-09-09)

**`vehicle_visits` EXISTS in production TiDB. Migration `0119_vehicle_visits` is APPLIED. Do not
re-apply it, and do not record it as pending.** This entry exists because the state was previously
tracked only in `apps/nickstire/.remember/now.md`, which the source-of-truth hierarchy ranks at 8 —
*below* this document at 4 — so a session following the hierarchy would have read "pending" here.

Applied on the operator's explicit instruction (a production schema write is a protected operation
and is never taken on agent initiative). Read-back receipt at apply time:

| check | value |
|---|---|
| existed before | `false` |
| columns after | **25** |
| rows | 0 |
| recorded in `__drizzle_migrations` | yes — sha256 `8c5e16b9a94d9454…`, `created_at` = journal `when` `1789300000000` |
| `reconcile-migrations.mjs --strict` | **no blocking drift** |
| target host | `gateway01.us-east-1.prod.aws.tidbcloud.com:4000` |

**What is live, and what is not.** The `/admin` **Lot** section is deployed and reachable (owner and
manager only; `lot.*` resolves to `settings.manage`). With the table present and empty it correctly
renders **"Awaiting first event"** — NOT the failed-read banner, which is what it showed while the
table was missing. That distinction is the point: an empty lot and an unreadable one are different
facts and the screen says which.

**Historical (2026-09-09), superseded 2026-09-28 -- see the camera intelligence audit wave section at
the top of this file.** At the time, what was missing was a PRODUCER, not the schema. Two existed in the
tree — `camera-bridge/visitd/shop_mirror.py` and `camera-bridge/vision/run_live.py`'s `VisitSink`, both
posting `{visits:[…]}` with `x-sync-key` to `POST /api/camera/visits` — but neither ran against a live
camera, because the cameras were not reachable from the operator's laptop, so the table stayed empty and
every Lot counter stayed blank by design. Since 2026-09-28 visitd's `ShopMirror` runs on NicksMax in
Session 0 (Railway accepted its heartbeats that day), so the producer gap is closed; whether the table
has rows on a given day is what the Lot trust strip now states instead of assuming.

## Public-site serving contract (2026-09-07, PR #2173 → `f2bcf949d`)

What a request for an extensionless public path gets, decided in ONE place — `server/_core/spaFallback.ts` —
used by both the Vite dev catch-all and the production catch-all in `server/_core/vite.ts`:

- **Known path** (route registry `shared/routes.ts`, or one segment under a `DYNAMIC_ROUTE_PREFIXES` entry, or
  `/admin*`, or `NON_REGISTRY_PUBLIC_PATHS`) → 200, registry meta injected, `Cache-Control: public, max-age=300,
  s-maxage=300, must-revalidate`. This now includes `/` (express.static serves with `index: false`; before, the
  home page alone carried a 24 h cache).
- **Unknown path** → **404** with `noindex, nofollow` in the HTML and `X-Robots-Tag`, canonical `/`, `no-cache`.
  Before: 200 with the home title (a soft 404, measured live).
- **Case twin of a known path** (`/Tires`) → 301 to the lowercase path, query string kept.
- `/admin*` → 200 + `X-Robots-Tag: noindex, nofollow` (auth-gated shell).
- Gate: `scripts/validate-route-registry.mjs` Rule 5 pins App.tsx `:param` routes ↔ `DYNAMIC_ROUTE_PREFIXES`
  both ways and Rule 0 fails closed if a parser finds nothing; canary `server/routeRegistryValidator.test.ts`.
  Wiring is tested over real HTTP through an `app.use("*")` mount (`server/spaFallback.test.ts`) — inside a
  wildcard mount `req.path` is always `/`; only `originalUrl` survives.

Adjacent contracts that changed in the same PR:

- **robots.txt** is built by `server/_core/robots.ts`: `*` allows everything except the private paths; Bytespider
  and cohere-ai are blocked; `ROBOTS_BLOCK_AI_TRAINING_CRAWLERS=true` additionally blocks GPTBot, ClaudeBot, CCBot,
  Applebot-Extended, MistralAI-Training (default off). No Crawl-delay, no `?utm_` disallows (canonicals do that).
- **Sitemaps** carry `<lastmod>` only for DB-published articles (real `updatedAt`); static routes omit it.
- **`/llms.txt`** is the only machine-readable facts file; `/ai.txt` and `/llms-full.txt` 301 to it (the static
  copies and the four `*-schema.json` / `business-data.json` files were deleted — they contradicted canon).
- **Structured data**: one `WebSite` node (index.html); one `LocalBusiness` entity by `@id` — city pages reference
  it and emit no rating; `aggregateRating` only where reviews are rendered (Home, Reviews).
- **Share image**: `/og-image.jpg` (1200×630) from both index.html and `SEOHead`'s default.
- **CSP** `connect-src` includes `*.google-analytics.com`, `*.analytics.google.com`, `*.googletagmanager.com`,
  `*.g.doubleclick.net`; Permissions-Policy also denies usb, midi, display-capture, browsing-topics.
- **CSP `script-src` is hash-based in production (2026-09-08):** at boot `server/_core/index.ts` hashes the
  executable inline scripts of the built `index.html` next to the server bundle and `securityHeaders.ts` emits
  `'sha256-…'` instead of `'unsafe-inline'` (`style-src` keeps it). There is exactly one such script — the
  analytics loader — and all 336 prerendered snapshots carry the same bytes (`server/securityHeaders.test.ts`
  checks every file). Dev (`NODE_ENV=development`) keeps `'unsafe-inline'` for Vite HMR;
  `CSP_ALLOW_UNSAFE_INLINE_SCRIPTS=true` restores it in production without a deploy. A new inline script must be
  added to `client/index.html` (then it is hashed automatically) — never injected at serve time.
- **Rate-limit client identity (2026-09-08):** `cf-connecting-ip` is honoured only when
  `TRUST_CLOUDFLARE_HEADERS=true` (Cloudflare is NOT in front today: `server: railway`, no `cf-ray`); otherwise
  the key is `x-real-ip` → `req.ip` as before. What Railway actually sets (`x-forwarded-for` / `x-real-ip`) is
  unverified — confirm with one logged request before changing `TRUST_PROXY`.
- **`/.well-known/security.txt`** (RFC 9116) is served by `server/_core/securityTxt.ts`: contact page + public
  phone, `Expires` = boot time + 180 days, `Canonical`; `/security.txt` 301s to it.

## Page-top contract (2026-09-08, mobile shop strip)

What every `PageLayout` page shows at scroll-top, and why it changed:

- **`SiteNavbar` is the only fixed cluster** (`top-0`, z-50): desktop = membership band (44px, `hidden lg:block`)
  + nav row (60px) + `ShopStrip` (36px); phone = nav row (60px) + `ShopStrip` (~64px, two rows). Band and strip
  collapse on scroll and while the mobile menu is open, so the persistent chrome is the 60px row. Hero top
  margins that clear it: Home `mt-36 sm:mt-48 lg:mt-48`; `FocusedServicePage` hero `pt-32 lg:pt-36`.
- **`ShopStrip`** (`client/src/components/ShopStrip.tsx`) = open/closed + "Closes 6 PM" / "Opens tomorrow 8 AM",
  address (→ Google Maps directions), phone (`tel:`, tracked as `shop_strip`), rating with the live Google count
  (canon fallback). Closed state adds an **Emergency** button that dispatches `nickstire:emergency-request` on
  `window`; `EmergencyMode` listens and opens its existing form. Every value is canon or live.
- **Deleted:** `StickyTrustBar` (static at y=0 under the fixed cluster — measured with `elementFromPoint`, it was
  never visible in either shop state) and `EmergencyMode`'s fixed red top banner (37px at z-60 that covered the
  trust bar and pushed the nav down 56px). The floating emergency button and the form are unchanged.
- **Clock:** `client/src/lib/shopHours.ts` is America/New_York and derives the schedule from
  `BUSINESS.hours.structured` (it used to be the visitor's local clock with a second hard-coded schedule).
  `useBusinessHours` still exists for `EmergencyMode`; both read the same canon.
- **Service pages:** `FocusedServicePage` renders a **written-estimate ticket** after the pricing tiers (the page's
  own tiers, verbatim; "You approve it. Then we start."; Ohio repair-rule line). The AEO default keeps the canonical Repair Haiku
  "you don't pay until you say yes" (prescribed by the brand-voice kernel in `shared/voice.ts`, repeated in SMS,
  voice and 100+ pages); a same-day pass paraphrased it and was reverted — the $59.99 diagnostic is itself on the
  written quote before it is charged, so the promise holds.
- **`NotificationBar` on a phone waits for the first screen** (2026-09-08): fixed 84px above the mobile CTA bar it
  covered the hero's "Talk to a human" card from the first frame; it now renders only after a scroll past 60% of
  the viewport on `(max-width: 1023px)`. Desktop and the prerender pass (desktop viewport) are unchanged. The two
  floating buttons (emergency, chat) still sit on the cards' right edge when the shop is closed — known.
- **Prerendered snapshots**: crawlers read the snapshot, so a schema/meta change is not live for them until a
  regen commit lands AND deploys. The in-PR regen (`8c0be63d5`) predated the share-image fix in the tree and the
  FAQ removal came in #2179, so the snapshots at `f2bcf949d` / `cfdcad9be` still carried one `FAQPage` node and
  the WebP `og:image`. The first snapshot set with the fixes is `2336d313d` (2026-09-08 00:49 UTC; the first
  post-merge regen failed at `git push`). A skip-ci-tagged regen commit still deploys on Railway — only GitHub Actions
  honour the token; `2336d313d` reached `/api/health` about 30 minutes after its push, so poll health rather than
  concluding from one early probe (and never spell the token out in a commit message: GitHub honours it anywhere). Verify with a bot-UA **GET** (HEAD bypasses the middleware); bot responses are cached 1 h.
- **The regen is read-only by code, not yet by credential (2026-09-08).** `prerender-refresh.yml` boots this
  server with `PRERENDER_MODE=true` against `DATABASE_URL_PRERENDER_RO || DATABASE_URL` — the read-only secret is
  optional and, until the owner creates it, the run holds the read-write credential. `index.ts` skips crons and
  queues in that mode, and the three DB-writing public sinks — `/api/analytics/conversion`, `/api/track-abandoned`,
  `/api/uber-code` — now return 204 without writing (the conversion sink inserted a `customer_events` row per
  rendered page before; control/canary pairs in `server/analyticsPrerenderGuard.test.ts`). Any new public write
  path must use the same `isPrerenderPass()` guard in `server/routes/analyticsRoutes.ts`.
- **Billed-sales windows are definition v2 (2026-09-08):** `last_7d` / `last_30d` are exactly 7 / 30 completed
  Eastern days ending yesterday; v1 ran to tomorrow and spanned 8 / 31 dates. `docs/METRICS-CONTRACT.md` has the
  rule; `server/shopSales.test.ts` counts the dates.

## Admin audit wave (2026-09-01/02, PR #2063) — receipts, doors, loud crons

Four audit artifacts (`docs/ADMIN-*-2026-09-01.md`) and the code they justified. Contracts that changed:

- **A text is "sent" only when the gateway accepted it now.** `server/lib/smsOutcome.ts` is the single sent / queued / uncertain / failed classification; every counter, status row and audit line derives from it. A text parked for the 8 AM window is **queued**, never sent. Claims that block re-sends are kept for queued texts (they will go out).
- **RUN FOLLOW-UPS never consumes a customer it did not text.** `follow-ups.ts` checks `sms_review_requests` BEFORE claiming a booking; with the flag off, nothing is touched and the toast says so. The `estimate-followup` cron was RETIRED on 2026-09-02 (correction #18): it queried an `estimates` table that never existed in production; `alg_estimates` declined-work recovery is the one estimate follow-up path.
- **Cron handlers fail loudly.** Every scheduled handler rethrows instead of returning `Failed: …` as a completed run (`__tests__/cronNoSwallowedFailure.test.ts` derives the scan set from the scheduler). A missing column/table named by a migration is a loud failure, not a permanent skip.
- **The scheduler builds its tier table without starting** (`ensureTiersBuilt`), so `getJobCadences()` and the cron-status surface are correct before boot. `docs/operations/CRON-INVENTORY.md` is generated (`scripts/gen-cron-inventory.mts`) and pinned by `cronInventoryParity.test.ts`.
- **`kpi_snapshots` has a writer** (`kpi-snapshot`, daily, idempotent, shop-TZ weeks). `kpi.history` was `[]` for the life of the table before.
- **The GPT bridge never sends a campaign.** `POST /api/bridge/sms-campaign` creates a DRAFT for Outreach → Campaigns (Tier 0). The winback template renders `customMessage` verbatim when present.
- **Authorization:** `gatewayTire.refundOrder` → `money.manage`; `smsConversations.*` → `customers.manage`; a mutation whose admin-security read THREW is refused (reads and the no-row case keep the 2026-07-16 fail-open).
- **Dispatch has no bays.** The Bay Grid is gone; `dispatch.assign` no longer requires a `bayId`. `dispatch.sendMessage` actually sends (as a transactional confirmation) and records the outcome.
- **The StateNour revenue push says `available:false`** on a failed read instead of `$0, behind`. The push lands at StateNour's `/api/sync/business` (stored as an `AuditEvent`); StateNour's Command Surface consumer honours it since #2068 (2026-09-02): `deriveShopRevenue` renders a failed read as unknown, never $0. Owner escalations go through `services/ownerEscalation.ts` → StateNour `open_loop` (obligation + links, never rows).
- **Nexus SMS audit queue retired** (producer removed; `0115` applied 2026-09-02, table dropped after a 258-row backup). **LLM call ledger** is LIVE: `0116` applied and `LLM_LEDGER_ENABLED=true` set on Railway 2026-09-02.
- Migrations: `0113` recorded; `0114`/`0115`/`0116`/`0117` APPLIED to production 2026-09-02 (`0114` rewritten first: production has NO `estimates` table, correction #18, so it adds only `customers.lastEmailCampaignAt`; the phantom-table `estimate-followup` cron is retired, `alg_estimates` declined-work recovery is the one estimate follow-up path). Every `_bak_` table from this wave and the earlier one-off repairs was dropped on operator instruction the same day; only `_bak_reel_jobs_caption_20260901` is kept.
- **The LLM call ledger is LIVE** (`0116` applied, `LLM_LEDGER_ENABLED=true` on Railway): rows record. #2072 makes the lane the calling function's name when no `[lane:x]` label is present, and the DEPLOYED bundle preserves those names: the 15:45 UTC read-back showed `generateweeklyinsight`, `generateinstagramstudiodraft`, `maybeproposecallactions` from the container (esbuild does not minify). Read it back any time with `pnpm diag:llm-calls` (read-only, `scripts/diagnostics/llm-calls-readback.cjs`). Known weak spot: a generic inner helper (`attempt`, `call`) names itself, not the feature; the ledger skips those names. Nothing reads `llm_calls` in the admin yet; the first reader is the next slice.

## Reel pipeline contract update (2026-08-31)

The approved Reel rotation is now an exact production-pack queue. The daily
producer loads the selected pack's reviewed files, embeds their hash and raw
content in a versioned Episode Contract, and holds rather than generating a
replacement brief when the pack input is absent or malformed. `reel_jobs` now
has additive durable episode identity, idempotency, queue-state, and
morning/midday/evening production-slot fields from migration 0113. Production
TiDB received that hand-applied migration on 2026-08-31 after deploy
`699e54900`: all seven nullable fields and all three required indexes were
read back from `information_schema`. Enqueue still fails closed if that schema
contract cannot be read.

The queue projection distinguishes production readiness from publication
scheduling. A READY buffer of three is maintained only while inventory is at
or below the low-watermark of one. An assembled job still cannot publish
without the existing exact-asset + exact-caption human approval and
`publishToSocial` choke point. Higgsfield API request IDs are persisted and
reconciled by polling the same remote request after an ambiguous response;
unknown remote state never triggers a blind duplicate paid submission.

The unmaterialized 2026-08-31 rotation slugs from `27e993fb2` are not in the
approved queue until their exact tracked pack directories and reviewed files
exist. This prevents the cursor from pinning on a missing production input;
adding a future pack requires its complete snapshot before adding its slug.

PySceneDetect remains deferred. The current ffprobe/render-integrity and
frame-sampling checks are compatible and lower-risk; the concrete future hook
is a pinned Python runtime plus a fixture-tested `detectSceneCuts(mp4Path)`
adapter compared with storyboard boundaries before enabling it.

## Two things you will notice before you notice anything else (2026-08-09)

**`[tRPC first-call]` lines in Railway logs are deliberate, and they are an
instrument — do not silence them.** Every tRPC procedure emits exactly one such
line the first time this process serves it, then never again. It exists because
a static census found 163 of 684 procedures with no caller anywhere in the repo,
and that number could not be trusted: every procedure is reachable over HTTP by
callers OUTSIDE this repository, and the middleware previously logged only SLOW
(>2s) and ERROR calls, so production could not answer "is this ever served?".

To use it: after a normal business cycle, collect the distinct
`[tRPC first-call]` paths from Railway and subtract them from the registered
procedure list. What remains is the genuinely dead set. The counter is
in-memory, so it resets on deploy — that is correct, because silence only means
something across a window you can name, and the deploy time is in the logs
beside it. Deleting procedures on repo-grep evidence alone is what this replaces.

**The admin's red / amber / green now read at one brightness per tier.** Tailwind
is perceptually uniform WITHIN a hue and not ACROSS hues: at the shades this
console uses, its own OKLCH lightness was red 70.4% / emerald 76.5% / amber
82.8% — a 12.4-point spread running BACKWARDS, so on an andon board the colour
meaning "stop, money at risk" rendered dimmest and "caution" pulled the eye
first. Nine tokens are re-tinted on `.admin-shell` to one lightness per tier
(0.80 / 0.72 / 0.66); because Tailwind v4 compiles utilities to `var()` and
custom properties inherit, this re-tints all ~1,881 existing call sites with no
component edits, and deleting the block restores stock Tailwind exactly. The
customer site is untouched. Chroma per hue is computed against each hue's sRGB
gamut ceiling, because an out-of-gamut colour gets clamped and clamping shifts
lightness — which would silently restore the drift. Pinned by
`client/src/__tests__/andon-ramp.test.ts`.

## Live application

- Application: `apps/nickstire`
- Public site and admin: `https://nickstire.org`
- Deployment: GitHub `main` to Railway service `MAINnicks-tire-auto`, region `us-east4-eqdc4a`
  (Virginia) since 2026-09-23 13:20Z, next to TiDB (`us-east-1`): a query round trip is ~5 ms,
  was ~65-72 ms from `us-west2`. Receipts: `operations/REGION-LATENCY-2026-09-23.md` §8.
- Client: React 19 and Vite
- Server: Express 4 and tRPC 11
- Canonical operational database: TiDB Cloud / MySQL through Drizzle
- Package manager: pnpm workspace
- Master application gate: `pnpm run verify` from `apps/nickstire`

## Canonical business records

- Leads: `leads`
- Booking requests and job-stage records: `bookings`
- Customers: `customers`
- Repair revenue: `invoices`
- Shop work: `work_orders` and imported ShopDriver records
- AI receptionist calls: `vapi_call_logs`
- Callback requests: `callback_requests`
- Search detail: `search_performance`

A transcript classification, tool invocation, direction instruction, transfer attempt, estimated value, or modeled close rate is not a paid invoice.

## Weekly revenue digest (2026-08-07)

- `server/cron/jobs/weeklyRevenueDigest.ts` pushes a Monday Telegram digest: paid-invoice revenue for the trailing 7 days, week-over-week delta, parts/labor mix, repeat-revenue share (last-10-digit phone match against any earlier paid invoice), top services, and the count of `expected_arrivals` rows reconciled to invoices that week.
- It reads the ALG **mirror** (`invoices`, `paymentStatus='paid'` — the same filter as `getDailyRevenueTruth`) and never touches ShopDriver/ALG itself.
- Scheduling: hourly (2h) tier + `oncePerShopDay` claim (ROS-081 pattern), self-gated to shop-timezone Mondays. On query failure it sends nothing and logs why — a zeros digest produced by a thrown query would be a false report.
- It also carries the weekly demand line (leads · bookings · callbacks, with unworked callbacks called out). Lead counting goes through the SHARED `countActionableLeads` (`shared/leadSource.ts`), which excludes a web-callback lead that duplicates its own `callback_requests` row — re-expressing that rule in SQL would let this report disagree with the daily one.
- **ALG invoice cost detail stopped arriving on 2026-04-09 — margin is UNCOMPUTABLE for anything after that date.** Probed live 2026-08-08: of 2,899 lifetime paid invoices, 1,886 carry `partsCost` and 1,871 carry `laborCost`; **0 of the last 30 do**. Monthly `withParts`: Mar 77/134 → Apr 24/143 → May 0/104 → Jun 0/123 → Jul 0/106 → Aug 0/30. `serviceDescription` is degrading on the same curve (Jun 31/123 → Jul 12/106 → Aug 1/30). Consequence: **any `revenue - partsCost` margin computed over a recent window returns 100%** — a fabrication, not a measurement. The weekly digest suppresses margin when `costDetailCount = 0` and says so; `getDailyRevenueTruth` and the parts-percent outlier scan in `services/engines/operations.ts` have NOT been reviewed against this and may be publishing the same artifact. **Root cause identified 2026-08-08 (diagnosed from our own mirror + logs; ALG was never contacted).** `partsCost`, `laborCost` **and `taxAmount` all died together** — 2026-03: 77/110/67 populated of 134; 2026-04: 24/24/25 of 143; 2026-05 onward: 0/0/0 — while `algTicketId` and `vehicleInfo` stayed **100% populated** throughout. That rules out a parts-specific bug: the whole line-item money block vanished at once and the identity block did not. Those three dead fields are exactly the ones `mapRawInvoice` reads as flat `raw.partsCost` / `raw.laborCost` / `raw.taxAmount` (`shopDriverMirror.ts:559-561`), and the two survivors are exactly what the code's own Wave-99 comment says `listRecentTickets` returns (year/make/model + ticketId). The importer tries `/api/ticket/listRecentTickets` **first** and *"First one that returns data wins; we don't fall through to the others mid-probe"* (`shopDriverMirror.ts:373-379`) — so the mirror is fed by the **summary** endpoint, which carries identity and total but no line-item split, and the mapper's `!= null ? … : 0` writes 0 silently. Wave-99's own diagnostic (`scripts/_archive/diagnose-line-items.ts`) identified **`/api/ticket/listTicketSessions` as the line-item endpoint** — a different one the importer never reaches.
**Still unfixed, and deliberately so:** restoring the split means fetching per-ticket detail, i.e. one extra ALG call per ticket per import. That collides directly with SHOP-PROTECT (`cron/scheduler.ts:517-528` — probes kick the shop's browser login out of ALG). Trading shop-floor stability for a margin number is an operator decision, not an agent one. The decision now has a price tag instead of an unknown.
- **`revenue-reconciliation` was reporting "$0, 0 jobs" on 7 of the last 8 days** (fixed 2026-08-08). It called `getDailyRevenueTruth()` with no argument — *today so far* — while sitting in the 24h tier whose phase follows pod boot, so it fired at 11:59/14:03/16:01/19:08 UTC (08:00–15:00 ET), before the day's invoices existed. Compounding it, `nickMemory.remember()` dedupes by content hash, so every $0 day collapsed onto one row: `nick_memory_insight_e8bb1cbd7719` reached **813 uses at confidence 1.0**, making "the shop made $0" the most-reinforced revenue memory Nick holds (real days sat at 1–6 uses). The job now reads the **previous complete shop day** (ET, not container UTC), stamps the date into the memory content so days cannot pile up, and writes nothing when a day has no jobs. **The poisoned memory row still exists — deleting it is a prod write and an operator decision.** The structural cause is fixed (date-stamped content can no longer pile up onto one hash), but the existing row keeps its 813 uses until removed. One statement, exact and idempotent:
```sql
DELETE FROM shop_settings WHERE `key` = 'nick_memory_insight_e8bb1cbd7719';
```
Verify first with `SELECT` on the same key — the row's value should contain `"Daily revenue truth: $0. Jobs: 0."`. No other memory row shares that hash; real revenue days each have their own key.
- **There is exactly one weekly report.** The `weeklyReport` tRPC router and `notifyWeeklyReport` were removed 2026-08-08: both had zero callers (registered but never invoked — no client, no cron), and their bookings/leads/callbacks content now rides the digest. The separate `weekly-strategic-insight` cron (Sundays, AI brief via Telegram) is unrelated and still live.

## Weekly Search Console digest (2026-10-08)

- `server/cron/jobs/weeklyGscDigest.ts` (`weekly-gsc-digest`: hourly tier + `oncePerShopDay`, shop-TZ Mondays, `requiresEnv: GOOGLE_SEARCH_CONSOLE_KEY`) pushes one Telegram message: the OFFICIAL 28-day Search Console totals (the window ends 3 days back for GSC's finalisation lag) vs the prior 28 days, top 8 queries / top 5 pages, then CTR opportunities and 7-day ranking moves from the `search_performance` mirror. GSC numbers previously reached the operator only by pull (admin Market card, `pnpm gsc:report`, the StateNour bridge); the daily `gsc-pipeline` alert fires only on a 5-position drop.
- Two sources, kept distinct: the headline is the API's no-dimension total (the same number the Market card and the bridge use); the insights are mirror-derived. The mirror's `MAX(date)` is read first, so an EMPTY or BEHIND mirror is named in the message instead of an empty list reading as "no opportunities". The query lists carry the anonymisation caveat (~93% of query-dimension impressions are anonymised); no rate is computed from them.
- Fails closed: no official total, a schema error on the mirror query, or a failed Telegram send all reject the run (cron_log `failed`, observer-visible). Non-Mondays return a named skip without touching Google or the database.
- First live run: Monday 2026-10-12, first hourly tick after 07:00 ET. Until a cron_log row and the Telegram message exist, the capability is unit-verified only (18 tests in `weeklyGscDigest.test.ts`, all driven through the job's single export).

## GSC data flow

1. `server/pipelines/gsc-data.ts` authenticates with the Google service account.
2. A dimensional request stores query, page, date, device and country rows in `search_performance`.
3. Those rows support query, page, device, country and trend analysis.
4. A separate no-dimension Search Analytics request is the authoritative source for headline clicks, impressions, CTR and average position.
5. Dimensional rows may be incomplete because Search Analytics returns bounded top rows. Their sums must be labeled detailed-row totals, not official totals.
6. GSC jobs are automated through the pipeline scheduler when production credentials are configured.
7. The `device` dimension applies to web only. Google's Discover reporting rejects it, so the Discover request omits it and `search_performance` holds no `searchType='discover'` rows — nickstire.org has no Discover traffic (ROS-029). Do not treat an empty Discover slice as a pipeline failure.

## VAPI data flow

1. VAPI sends signed webhook events to `/api/webhooks/vapi`.
2. Tool calls invoke the internal voice-agent router.
3. End-of-call events create or reconcile `vapi_call_logs`.
4. The daily VAPI evaluator classifies operational outcomes and records quality evidence. It also extracts per-call signals (`metadata.callSignals`: objection type · competitor mentions · price-sensitivity, deterministic regex — 2026-07-22) that enrich the Missed Revenue Queue with the *why* behind a stalled call. Signals are observed evidence, not confirmed facts.
5. Leads, callbacks, bookings and invoices remain separate operational records.
6. Tool engagement is an observed call fact. It is not automatically a lead, booking, arrival or paid job.
7. Any classifier-derived outcome must carry a definition version and evidence level before it is used in executive reporting.

## Lead and booking creation

- Website lead forms write `leads`.
- Website booking flows write `bookings`.
- **Voice tools do not create leads for ordinary inquiries.** Per operator directive 2026-06-05, `tireInquiry` acknowledges the caller and returns **before** any insert; the call recording and `vapi_call_logs` row are treated as the record. Only `escalate` (callback, when closed) still persists an operational row from voice.
- **`checkTireStock` persists nothing at all** (2026-07-20). It previously wrote an urgency-5 rack-check lead, fired a Telegram and promised a callback that no code tracked to completion; it now hands the caller to a person.
- The `bookSlot` tool provides first-come-first-served walk-in guidance and does not persist an appointment.
- Measured 2026-07-20 against production: 494 `tireInquiry` dispatches over 90 days, **0** voice-attributed leads, `leads` table holding 2 rows total. That is the directive working as intended — not a defect. Do not "fix" it without re-confirming the directive.
- A booking is verified only when a booking row exists.
- An arrival is verified only from an operational arrival/check-in or repair-order signal.
- Paid conversion is verified only from a paid invoice linked by a defensible matching rule.

## Crawler HTML

- Normal visitors receive the React SPA.
- Recognized crawlers receive committed files from `apps/nickstire/prerendered/` through `server/prerender-middleware.ts`.
- Railway normally does not regenerate prerendered HTML during deploys.
- `.github/workflows/prerender-refresh.yml` performs the scheduled refresh.
- `pnpm run prerender:check` verifies route-tree presence.
- Semantic parity checks must verify identity, metadata, H1, canonical URL and structured data for key routes.

## Automated systems

The historical Reel bullet below records earlier runtime observations. Its
claims about topic-only handoff and unapproved cron publishing are superseded
by the 2026-08-31 contract update above; the current implementation loads
reviewed pack content, separates production from publication, and requires the
existing exact-asset + exact-caption approval choke point.

- GSC dimensional ingestion and SEO analysis
- VAPI end-of-call ingestion and daily evaluation
- Scheduled prerender refresh
- Lead, callback and booking persistence
- ShopDriver invoice/customer synchronization where configured
- Selected internal alerts and recovery workflows
- Reel manufacturing: cron-pulsed clip generation (provider is a pin, NOT fixed: prod read `REEL_VIDEO_PROVIDER=template_stock` on 2026-08-11, the free local ffmpeg lane -- not Higgsfield Seedance 1.5 as this line claimed since the cutover. **STALE as of 2026-08-29:** the lane is generative again -- `isGenerativeProvider(REEL_VIDEO_PROVIDER)` evaluated `true` in prod that day, and all ten queued `assembled` reels carry Higgsfield `hf_*` clip paths. The value itself is deliberately not restated here, because a provider name in prose is a cache with no invalidation and this line has now gone stale twice; evaluate the predicate instead. Disclosure no longer depends on this variable at all -- `shouldDiscloseAi()` derives `is_ai_generated` from each job's clip storage paths, so a lane flip cannot under-disclose a queued reel) and ffmpeg assembly with a blocking render-integrity gate (duration contract, video-stream length, frame count, sampled-frame motion proof) — operational contract in [`docs/operations/REEL-PIPELINE.md`](operations/REEL-PIPELINE.md); publish is operator-gated ONLY on the admin surface. `cron/jobs/dailyReelPost.ts` sees an `assembled` job and calls `publishToSocial` itself with no approval step, and prod read `REEL_AUTOPOST_ENABLED=true` + `REEL_PUBLISH_ENABLED=true` + `IG_AUTOPOST_DRYRUN=false` on 2026-08-11. The independent judge (`IG_SHADOW_JUDGE`) gates `runIgAutopost` (the image lane); on the reel lane it runs **shadow/log-only since 2026-08-13** (one durable verdict per job, never blocking — see the judge section below). To hold reels for review set `REEL_PUBLISH_ENABLED=false` (assembles and waits); `REEL_AUTOPOST_ENABLED=false` stops generation entirely, because that cron both enqueues and publishes. Reel brief generation's performance feedback is **REELS-first since 2026-08-13** (`getReelGenerationSignal` filters `mediaProductType='REELS'`, floor 4 rows, disclosed `signalSource` fallback) — before that, 5/8 of the "reel" training signal was carousels/images. Three Run-2 contracts on this same lane (2026-08-13, #1558/#1561; receipts in [`NICKSTIRE-SCAN-LEDGER.md`](NICKSTIRE-SCAN-LEDGER.md)): **(1) anti-repetition memory** — `prepareCleanReelBrief` reads the last 21 days of `reel_jobs` (`services/reelRepetitionHistory.ts`, any status: a failed brief still consumed its topic) and treats a repeated topic like an M10 preflight block — regenerate, with the rejected topic joining `avoidTopics` for the remaining attempts; a `PreflightExhaustedError` message now says whether the exhaustion was repetition-only (thin topic pool, generator healthy) vs a real preflight defect. The draft-manufacturing lane gets the same history as a soft steer only (a human reviews those). DB-down degrades to "no memory," never a blocked pipeline. **(2) Job-level free-lane fallback** — Veo previously had NO fallback of any kind (only Higgsfield's inline per-beat degrade existed, and only for `PAUSE_PROVIDER`-class verdicts): now, when `nextStatusFor` rules a job terminal AND `REEL_FALLBACK_TO_TEMPLATE_STOCK=true` AND the failing lane wasn't already `template_stock`, the job re-queues ONE forced free-lane attempt (`ReelJobBrief.forceProvider`, stale `veoOperationName` handles stripped so a free-lane timeout can't masquerade as a resumable Veo op) with a same-day Telegram alert — settlement still bills resumed paid clips at the paid provider's rate (`videoProvider` is the pricing anchor and is never overridden by `forceProvider`; only `activeProvider` moves). **(3) Originality/QC checklist** — a second shadow block beside the judge (`shared/originalityQcChecklist.ts`, KV `reel_qc_checklist_<jobId>`, log-only): claim entailment, caption AND voiceover claim-safety (VO was never checked before), disclosure contract, 15-22s duration target, muted-first (reuses `validateMutedFirstClarity`), with honest `structural`/`unknown` statuses where no per-job signal exists (copied-footage/audio provenance, before-after honesty, 9:16 — the last is enforced at render by reelAssembly's 1080x1920 throw). Gate-flip = operator decision, same NT-001 path. **Payload-reader rule (audit round 2):** anything reading `reel_jobs.payload` uses `shared/reelJobPayload.ts` `parseReelJobPayload()` (real `StoryboardBeat`/`EpisodeContract` types) — two ad-hoc inline types in one day each produced a field that doesn't exist on any real row

Automation success is valid only when the final system of record confirms the action.

### Instagram deferred publishing — operating contract (2026-07-24, IG quality waves)

- `scheduled_posts.inventoryId` (migration 0096, applied to prod and verified via information_schema) links every Studio-scheduled fire back to its inventory row. Consequences that hold by construction now: **reject cancels the pending fire first** and CONFLICTs if the cron already claimed it; `runScheduledPosts` writes the fire-time outcome (published / failed / ambiguous) back onto the inventory row, so "scheduled" can no longer be a forever-state; cancel/reschedule exist and discriminate fired-vs-stalled.
- `instagramStudio.schedule` claims `ready → scheduled` at-most-once BEFORE inserting the fire row; a double-tap gets a CONFLICT, not a duplicate post.
- A `media_publish` request that was **dispatched and got no answer** parks the item as `ambiguous` ("may be LIVE") everywhere — image/story/carousel/reel, both routers, and the cron — never as retryable `failed`. The operator resolves it from Publish (It IS live → published / It never posted → ready) after checking the real account.
- `instagramAdmin.schedulePost/listScheduled/cancelScheduled` were DELETED (zero callers + integrity holes); Studio's schedule → scheduled_posts → cron is the only deferred-publish path. adStudio writes its own unlinked scheduled_posts rows (no inventory linkage) — since #1055 its post routes through `publishToSocial` (kill-switches + cadence governor apply) and claim-safety/permanent-URL checks are enforced server-side at post AND schedule time.

### The IG comment responder is push-triggered, not just cron-pulsed (2026-08-11, PR #1504)

- **What changed is latency, not capability.** `services/commentResponder.ts` already replied autonomously and was already armed in prod (`REEL_COMMENT_RESPONDER_ENABLED=true`, `REEL_COMMENT_RESPONDER_LIVE=true` read 2026-08-11) — it just discovered a comment only on the next cron pulse. `routes/webhooks/meta.ts` adds `GET/POST /api/webhooks/instagram` so Meta can push it.
- **It is not a second reply engine.** The handler's whole job is "run the responder now": it calls the SAME `runReelCommentResponder()` the cron calls, so the arming gate, the `REEL_COMMENT_RESPONDER_LIVE` dry-run gate, the `@shared/reviewReplyQa` claim-safety detector, the watermark dedup and the per-run velocity cap still govern every reply. A webhook that drafted its own replies would fork that policy and the copies would drift.
- **Fail-closed by construction.** This is the only public unauthenticated surface that can drive an engine which posts publicly to the shop's Instagram. A missing `FB_APP_SECRET` returns 500 rather than accepting unsigned input; `X-Hub-Signature-256` is verified with a constant-time compare over `req.rawBody` (re-serializing `req.body` changes the bytes and breaks every signature); hex length is checked BEFORE `timingSafeEqual` because `Buffer.from(hex)` silently truncates invalid input. The arming gate is re-checked in the handler so subscribing the field in the Meta dashboard cannot silently arm replies while the flag reads off.
- **Acks before working**, because Meta retries and eventually disables a subscription that times out while the responder does a Graph fetch plus an LLM pass. Bursts are debounced (15s, `IG_WEBHOOK_DEBOUNCE_MS`) behind an in-flight guard.
- **SUBSCRIBED AND CHALLENGE-VERIFIED (operator-fired 2026-08-11 ~14:15Z; this line previously said "inert until subscribed").** The one-tap script registered the app-level `instagram`/`comments` subscription and the page-level `feed` subscription; state was read back FROM Meta (`/{app}/subscriptions` shows the callback active), and Meta's synchronous challenge GET during registration was the first observed Meta→endpoint delivery. `FB_VERIFY_TOKEN` and `FB_APP_SECRET` were already set in Railway; no new secrets. **A real comment POST has still not been observed as of 2026-08-13** (recent posts have ~0 comments), so delivery-shape assumptions beyond the challenge remain asserted-by-test; first live one shows `[meta-webhook]` in Railway logs. The cron pulse remains the backstop.
- **Campaign-keyword comments get a real next step (2026-08-13, NT-003).** Published creative burns `DM "KEYWORD"` into pixels while the stack has **no Instagram DM path** — the webhook subscribes to `comments` only. `matchCampaignKeyword` (exact-token: "POTHOLE!" matches, "potholes" does not; longest keyword wins) now detects a keyword comment — keywords collected from the posted reels' own briefs plus published inventory `interactiveDmKeyword` rows — and the reply prompt is steered to hand off to channels that exist (call/text the shop line, link in bio) and to never promise a DM. Same draft path, same claim-safety detector, same live/dry-run gates and velocity caps as every other reply.

### Every path to Meta goes through the emergency stop (2026-07-27)

- **The kill switch reaches the autonomous poster.** `runIgAutopost` posted directly to Meta, so the operator's global / publishing / per-platform switches did not stop the one publisher that runs with no human watching (measured: 116 lifetime `posted` rows). It now shares the same check via `killSwitchBlockedPlatforms`. **Automated callers fail CLOSED** when switch state is unreadable — an unattended cron must not treat "we could not check" as "publish" — while operator callers still proceed loud. `dailyReelPost` and `socialInventoryPublisher` opt in the same way.
- **The cadence governor counts all four doors**, including `ig_autopost_log`, which alone accounts for ~84% of lifetime publishing and was previously invisible to the cap. Each door is counted independently, so one unreadable source no longer zeroes the others. The autoposter now also ASSERTS the cadence itself — with a preflight before generation, so a capped day buys no LLM/image spend — and a cap hold is terminal for that slot.
- **Autonomy policy v8** (operator-authorized 2026-07-27): `maxFeedPostsPerDay` 20, `minimumFeedSpacingHours` 0. v7 was leftover `cc2-verify` "temp" state from 2026-07-18, never a business decision (ROS-067). At 20 the cap never binds on ordinary operation — the autoposter does 3/day and the busiest normal day across all doors is 5 — so it is a runaway brake, not a content dial. The busiest day on record is 32.
- **Not runtime-verified.** All of the above is asserted by code and pinned by tests; no cron tick or live publish has been observed since the change. Recorded as deferred scope on the `content-governor` capability rather than left implied.

### The independent judge gates live IG publishing (2026-08-07, operator flip)

- **The self-eval blind spot was measured before it was closed.** A 25-post
  retro-tournament found **5/25 (20%)** of historical posts passed self-eval
  `>= 0.7` while the independent tournament judge scored them `< 60` or hard-
  rejected — a unanimous "generic mechanic imagery any shop could run unchanged"
  signature. Captions scored fine; the image self-eval (`proLook`) rubric is all
  craft (lighting, sharpness, composition, artifact-freeness) and carries **no
  differentiation criterion**, so a technically flawless generic image cleared
  the gate every time (ROS-088).
- `server/services/igJudgeGate.ts` → `shadowJudgeGate()` now blocks the **LIVE**
  branch of `runIgAutopost` on the *exact* measured disagreement predicate
  (`rejected || total < 60`), so `content.shadowJudgeReadout` keeps measuring the
  gate's own behavior. The threshold equality is pinned by test — do not drift
  the gate and the readout apart.
- **Dryrun previews are unaffected** (that lane has a human). The judge verdict
  already existed inline *before* the publish decision — it ran in shadow from
  2026-08-05 — so the flip is decision logic over a verdict already paid for.
- **Fail-CLOSED** on judge error or a missing verdict, by the same "automated"
  reasoning as the kill switch above. Escape hatch: `IG_SHADOW_JUDGE=false`
  disables judge AND gate together (pre-flip, self-eval-only behavior). **A dead
  judge lane therefore pauses live IG posting loudly rather than publishing
  blind** — that is intended, and it is the first thing to check if autoposting
  goes quiet.
- A judge-blocked run logs `status='aborted'` with a `judge-blocked:` prefix,
  Telegram-notifies, and stays **retryable** — a later tick regenerates fresh
  content rather than resurrecting the rejected draft (a rejection is
  content-specific, not slot-specific). The live-mode judge call is **P0** in the
  Ollama scheduler; dryrun stays P1.
- **Scope note, verified 2026-08-13: this gate covers the IMAGE lane only**
  (`runIgAutopost`). The autonomous **reel** lane (`dailyReelPost`) now runs the
  same judge in **SHADOW — log-only, never blocking** (NT-001, #1552/#1553):
  one durable verdict per job (`shop_settings` KV `reel_shadow_judge_<jobId>`),
  fail-OPEN on judge error because rendered-QA already gates reels for pixel
  defects and nothing may hold a QA-passed reel on a judge outage while the
  lane is unproven. Promotion to a blocking gate is an **operator decision**
  after the disagreement readout accumulates — the same shadow→gate path the
  image lane took 08-05→08-07. Verdicts appear as `daily reel shadow judge`
  in Railway logs.
- **That readout had no reader until 2026-08-16, so it could not have
  "accumulated" into anything.** The KV verdict was written once per job and read
  only as a boolean dedupe marker (two references repo-wide, both in the writer).
  The image lane could justify its flip because it persists verdicts to
  `ig_autopost_log`, a queryable table, and ships
  `scripts/ig-dual-judge-readout.ts`; the reel lane used the settings KV and
  shipped no reader. Now: `server/services/reelShadowReadout.ts` (pure,
  28 behavioural tests) + `scripts/reel-shadow-judge-readout.ts` (READ-ONLY;
  **the operator runs it** — the only `DATABASE_URL` here is production). The
  judge KV row carries `briefId`/`topic`/`note` from 2026-08-16 so a verdict is
  identifiable. Three things the readout must keep saying, because each is a way
  to misread it: the corpus is **conditioned** (every row already cleared
  rendered-QA, so it is a blind-spot rate and never a quality base rate); an
  **unusable verdict is neither a block nor a pass** (reusing `shadowJudgeGate`,
  which fails CLOSED, would score an Ollama timeout as a quality defect); and a
  **judge that throws writes nothing**, so its failures shrink the corpus instead
  of appearing in it — hence the `coverage` line. No new LLM spend: the judge call
  was already being paid for.
- **Coverage counts only reels that COULD have been judged**, and says which it
  excluded. Eligible = `briefId` of the form `autopost-<YYYY-MM-DD>` (the only
  jobs `dailyReelPost` selects — `where(eq(reelJobs.briefId, "autopost-" + date))`
  — and the judge sits inside that function) with that date on/after the
  **2026-08-13** rollout. A P1 review caught the first version counting every
  historically posted row, which would have reported pre-rollout reels and
  operator/`contentManufacturing` publishes as judge failures — fabricating the
  gap coverage exists to expose. **`source` is NOT the signal**:
  `contentManufacturing` also enqueues with `source: "cron"` but publishes
  elsewhere. The date comes from the briefId, not `updatedAt` (`onUpdateNow`,
  drifts) or `createdAt` (enqueue, not publish).
- **The 2026-08-17 four-day CLI-session outage is historical; the session lane is live again as of 2026-09-27.** The old incident measured **332 completed** keepalives followed by **372 consecutive `Session expired` failures**, which is why `higgsfieldSessionHealth()` became a real blocker instead of a presence check. PR #2717 later updated the runtime to CLI 1.1.26. The current proof is stronger than one successful call: a fresh Railway process started after the durable credential row had been written, and its later keepalive still completed with `session refreshed`. Live canary job `1950002` then generated five Higgsfield clips and failed later at render QA on a CTA mismatch, with no publish. Full token revocation still needs an operator browser login.
- **The separate key-based API lane remains a distinct fallback and is not the proof for the 2026-09-27 recovery.** `server/services/higgsfieldApiClient.ts` talks to Higgsfield's official
  REST API directly (no new npm dependency - `pnpm install` is policy-blocked in
  harness worktrees): `Authorization: Key <HIGGSFIELD_API_KEY_ID>:<HIGGSFIELD_API_KEY_SECRET>`
  against `https://platform.higgsfield.ai`, submit to the DoP image-to-video
  endpoint, poll `/requests/{id}/status` to a terminal state. No session, no
  device flow, nothing to revoke. `generateReelClipVideo` prefers this lane
  automatically whenever both env vars are set, falling back to the CLI session
  lane on any API-side error (except a first-call 401/403, which is reported
  immediately rather than masked). `probeHiggsfieldApiCredentials()` verifies a
  key for FREE - no generation, no credit spend - by reading the response to a
  status lookup on an id that cannot exist. **UNVERIFIED against a live
  Higgsfield account** - built from the official docs and the official Node SDK,
  tested against a mocked `fetch`, never exercised against Higgsfield's real
  servers (that is a credit spend and an operator decision). Do not trust
  apidog.com's Higgsfield write-up - it contradicts the official docs on base
  URL and auth header shape and was rejected as a source. Runbook:
  `docs/runbooks/higgsfield-session.md` section 6.

### The AI receptionist improves from its own failed calls (2026-08-06/07; follow-ups 2026-10-09)

The voice prompt is no longer only hand-edited. A closed measurement loop reads
real failed calls and proposes bounded edits; **Push Config remains the one
serving gate** — nothing here ever writes the live assistant.

**Status of the 2026-10-09 follow-ups (items 2-4): BUILT + WIRED on branch
`claude/karpathy-autoresearch-apps-c6f34c`, not merged or deployed as of
2026-10-09.** Until that branch deploys, production runs the #2923 loop: the
repository prompt as the baseline, the holdout gate only. Nothing below has
run in production yet.

1. **The Call Ossuary** — `vapi_call_archives` (migration 0109) vaults full
   transcripts before VAPI's **14-day** retention purge. Without it every
   evaluation corpus older than two weeks is unrecoverable.
2. **Ghost replay** (`server/services/ghostReplay.ts`) replays **real vaulted
   caller turns verbatim** against any candidate prompt. The caller side is
   fixed and real, so only the receptionist's replies vary. Violations are
   graded deterministically and cannot be talked past: a `$NN` figure (the
   three permitted prices count only for the product they belong to, so the
   prompt's own "Used tires start at $60 installed" no longer fails it), the
   word "guarantee", an empty turn, and since 2026-10-09 `claimViolations`: the
   live voice claim guard's labels (`voiceClaimGuard.voiceClaimViolations`)
   plus replay-only classes such as a hedged or unit-less price and a promised
   outcome (`replayPolicy.replyClaimViolations`). Any one fails the call.
   **The replay is a proxy lane:** `GHOST_AGENT_MODEL` (default
   `deepseek-v4-pro`), temperature 0, 700 tokens, no tools, while the code
   pushes `gpt-4o`, temperature 0.4, 250 tokens, with tools (`vapi.ts`
   `buildAssistantConfig`). Every run records the differences
   (`receptionistBaseline.describeLaneParity`); nothing closes them yet.
3. **The semantic resolution judge** (`server/services/resolutionJudge.ts`)
   rules on resolution from a **different model family**. Since 2026-10-09 it
   reads regex HITS as well as misses (`gradeRepliesWithJudge` `verifyHits`,
   default on; only train scoring turns it off): the regex rewards any stated
   next step, so a generic "come on by" to a caller who asked whether the shop
   does motorcycle tires scored as resolved and could never be overturned.
   Verdicts: `resolved` (a next step that fits the request), `deflected` (a
   generic one that ignored it; fails, even on a regex hit), `unresolved`, and
   `unresolvable` (wrong number, or the caller gone before asking). On a regex
   MISS, `unresolvable` **excludes the seed from the pass-rate denominator** and
   hides it from the optimizer (ROS-087); on a HIT the regex verdict stands and
   the seed stays counted. The judge can **never** overturn a price leak, a
   guarantee, an empty turn or a claim violation. A judge that was needed and
   is unreachable or unparseable leaves the regex verdict standing and marks
   the grade `judgeUnavailable`; every gate in item 4 reads those replays at
   their worst for the candidate. Each turn is rendered on one line with role
   labels defused, so a reply cannot write a "Caller:" line into its own
   evidence.
4. **The weekly optimizer** (`services/promptEvolution.ts`, run by the
   `promptEvolutionWeekly` cron on Mondays) proposes bounded edits. **On demand
   since 2026-10-09** (`services/promptEvolutionManualRun.ts`): the admin VAPI
   panel's "Run experiment now" (`vapi.runPromptEvolutionNow`, two-tap in-DOM
   confirm) and `POST /api/admin/run-prompt-evolution` (admin API key) start the
   SAME cycle with `trigger: "manual"`, the only thing that bypasses the Monday
   gate - same cross-dyno lock, same 50-minute budget, same `cron_log` row, same
   ledger receipt. The door answers as soon as the run is started (a cycle takes
   up to 45 minutes: the runner stops itself there, two seeds replayed at a time); `vapi.promptEvolutionStatus` / `GET
   /api/admin/prompt-evolution-status` read the in-process state and the latest
   row's hashes and counts. One run per process at a time; a scheduled run that
   holds the lock makes the door skip. The Telegram header, the
   `prompt_evolution_latest` row and the cron_log details all say `manual`.
   Still propose-only. First live run 2026-10-09 20:33Z (deploy 88fba68c):
   319 s, `rejected-train`, live baseline `06e0dbbd` parity identical, 30
   seeds, success cohort 0, receipt `prompt-evolution:a46f96a6a93ad384`
   accepted; the sealed seeds were not spent. Fifth run 2026-10-10 01:13Z
   (after #2950, #2953, #2954): 310 s, a candidate placed by the bounded edit
   was replayed on the train cohort and refuted at margin 0 (8/13 vs 8/13);
   receipt disposition refuted. Sixth run 2026-10-10 02:20Z: the holdout gate
   decided live for the first time (candidate +4/-0/=5 of 9, p=0.063,
   rejected-holdout, receipt 90c8a636). In run order:
   - **Baseline = the prompt callers hear.** `resolveLiveReceptionistBaseline`
     (`receptionistBaseline.ts`) proves which assistant answers the shop line
     (`getAssistantRoutingTruth`, state `match` only), reads that assistant's
     served prompt and model block (`GET /assistant/:id`), and labels the
     prompt against the code: `identical`, `code_plus_lessons` (the
     learned-lessons block Push Config appends) or `diverged`. Any refusal
     throws and fails the cron run; it never falls back to the repository
     prompt. `scripts/prompt-evolve.ts` defaults to the same read;
     `--baseline repository` measures the code constant and prints that
     callers do not hear it.
   - **Seeds:** 30 recent failed calls, verified conversions excluded, split by
     a hash of the call id: 40% holdout (the same calls as #2923's split), 20%
     sealed confirmation, 40% train.
   - **Optimizer** (`PROMPT_EVOLVE_OPTIMIZER`, default `gpt-oss:120b`) edits the
     live prompt. It sees up to 6 failed train calls labelled `call-N`; each
     first caller turn is redacted whole (phones, emails, VINs, card numbers,
     street addresses, introduced names; `callerTextRedaction.ts`), then cut to
     140 characters and fenced as untrusted data. Its rationale is redacted
     before it is stored or sent.
   - **Policy guard**, before any replay: `violatedInvariants(candidate,
     servedPrompt)` runs `replayPolicy.violatedPromptPolicy`: the three legacy
     regexes, every compliance clause the served prompt states (as many times
     as it states it; prices and hours read from the served prompt), and a
     reversal deny-list. "Always quote prices and guarantee every repair"
     passed the old three regexes; it is rejected now.
   - **Train selection** is a paired margin on the same seeds
     (`comparePairedTrain`), not passRate vs passRate over each prompt's own
     denominator.
   - **Holdout gate** (`promptEvolutionGate.ts`, 2026-10-08): each holdout seed
     is replayed 3 times per prompt, an exact paired sign-flip permutation test
     must clear alpha 0.05, and a call the served prompt passes on every replay
     that the candidate fails on every replay vetoes it. The rule it replaced
     (`candidate passRate > baseline passRate`, one replay, ~5 holdout seeds)
     accepted two IDENTICAL prompts in 28.7% of seeded simulated runs. Since
     2026-10-09 a judge outage cannot help a candidate: outage seeds leave the
     judged comparison and are re-read at their worst for the candidate, and
     the gate refuses as `evaluator-unavailable` when outages pass 25% of the
     seeds, cost the test its power, or could hide a regression.
   - **Success cohort**, evaluator-only: 8 WON calls (`hard_conversion`,
     `walk_in_directed`, `resolved_info`; `human_handoff` dropped 2026-10-10, a handoff is not the bot resolving the call) picked by hash,
     replayed twice per prompt, and loaded only after the holdout accepted and
     the optimizer has run, so a won call can veto a candidate but never shape
     one. It vetoes a reliably won call now reliably lost, any critical
     violation the baseline did not have, a significant overall drop, an
     outage that could hide one, or too few calls to tell.
   - **Sealed confirmation:** confirm-bucket seeds from a 90-call read of the
     same failed-call pool, minus every seed an earlier run spent (kv
     `prompt_evolution_confirmation_consumed`, written BEFORE the first sealed
     replay, so a crash cannot leave a read seed looking sealed), at most 8 per
     run, judged by the holdout rule on calls no candidate was selected on.
     With fewer than the 5 that alpha 0.05 needs it does not run:
     `accepted-unconfirmed`, nothing spent. A CLI run never spends one.
   - **Outcomes:** `accepted` (confirmed), `accepted-unconfirmed`,
     `rejected-train|holdout|regression|underpowered|confirmation`,
     `rejected-success-regression|violation|degraded|underpowered`,
     `invalid-evaluator` (the judge was down on too much evidence: nothing
     measured, nothing refuted), `inconclusive-budget` (the run stops itself at
     25 minutes; the scheduler kills it at 30), `no-candidates`,
     `baseline-clean`.

   **Output is a PROPOSAL.** kv `prompt_evolution_latest` points at the latest
   run: hashes, gate readings, lane differences, the full candidate, and a
   capped line diff whose `codeEdit: false` warns that the edit sits in or
   after the learned-lessons block, so pasting it into the code would serve a
   different text from the one measured (diff lines are dropped first if the
   row passes 60,000 bytes; the TEXT column holds 65,535). Logs and Telegram
   carry hashes, gate statistics and the redacted rationale, never the prompt
   or caller text; Telegram
   says "Offline evidence only (H2)", names the proxy lane, and says whether
   last week's proposal is live verbatim. The durable history is one **Reality
   Ledger receipt** per run (`promptEvolutionReceipt.ts`): a
   `receptionist.prompt_experiment` event plus one H2 claim, posted with
   `STATENOUR_SYNC_KEY` (StateNour accepts the type through the bridge door
   only) and listed on StateNour `/proof` under "Receptionist experiments".
   The claim is `supported` only when the candidate was accepted AND
   confirmed, `refuted` only when a gate measured evidence against it, and
   `inconclusive` otherwise. PII-shaped strings are withheld before sending; a
   failed post never fails the run. The loop's files (runner, gate, cohorts,
   receipt, baseline, replay policy, judge, weekly job) are evaluator paths in
   `config/agent-os/evaluator-paths.json`.

   **Not done, or the operator's call:**
   - **Not observed in production.** Live proof: the first Monday run after the
     deploy logs `[evolve] result` with `baseline.source: live_provider` and a
     parity label, and a row appears on `/proof`. Whether the served prompt
     carries a lessons block or a `nickBehaviorHash` is unknown until then.
   - **Replay lane parity** (item 2): moving the replay onto `gpt-4o` with
     tools is an operator cost decision; see the proxy-lane rule below.
   - **Calibration.** The A/A and power figures are seeded simulations, not
     measurements on real traces; the resolution judge has no labelled
     calibration set. Each confirmation holds alpha 0.05 for the candidate it
     confirms; the share of false confirmations across many weeks is not
     bounded.
   - **Known misses** are pinned, not fixed: the prompt guard is lexical
     (`replayPolicy.test.ts` "KNOWN GAPS"), and redaction misses a lowercase
     name after "this is" and a bare name with no introduction
     (`callerTextRedaction.ts`, "Known limits").
   - **Applying a proposal** stays an operator edit + Push Config.
5. **The cage match** (`scripts/cage-match.ts`) is the *discovery* instrument: an
   adversarial LLM caller red-teams the prompt offline, zero customer contact.

**Instrument rules learned the hard way — read before trusting either number:**

- **A tireless simulated caller flatters the prompt.** The cage adversary keeps
  talking for 16–17 turns and hands the receptionist recovery chances real
  callers never give; it scored a HOLD on the exact seed the frozen real caller
  failed. **Cage for discovery, ghost replay for verdicts.**
- **Both duel lanes are pinned by name, never ambient.** A probe that exercises a
  different lane than the measured work is a false-green generator: one gauntlet
  failed all 8 matches on a dead lane and still exited 0 printing "0 losses"
  (ROS-086). A run that completes zero units of work now exits non-zero.
- `AI_FORCE_OLLAMA=true` reroutes **every** request — explicit pins included —
  onto one model, which silently puts the same model on both sides of a duel. The
  instruments strip it in-process; prod config is untouched.
- `OLLAMA_API_KEY` is **not** in `apps/nickstire/.env`. Its home is
  `apps/statenour/.env` locally and Railway in prod; inject it per shell for
  local instrument runs.
- Aggregate pass rates are **not** an A/B — the seed pool rotates as new calls
  vault. Same-seed movement is the only controlled comparison, and deepseek stays
  ±1–2 seeds nondeterministic even at temperature 0.
- **A ghost-replay verdict is a proxy-lane verdict.** It says how a candidate
  does on the replay model with no tools, not on the lane callers ride (item 2).
  The lane record names the REQUESTED replay model only: `ghostReplay` discards
  the model that served, so an `AI_FORCE_*` reroute is invisible. Read every
  accepted candidate as offline evidence (H2) until it has served.
- **Every replay instrument reads production.** Each nickstire worktree binds
  the production `DATABASE_URL`. `scripts/prompt-evolve.ts` reads vaulted calls
  and the live assistant (read-only; it writes only local files under
  `eval-datasets/prompt-evolution/`). `scripts/replay-sms-orchestrator.ts`
  reads up to 50 real `sms_orchestrations` rows per event type, and on `main`
  it also WRITES: `REPLAY_DRY_RUN` fakes only the send, so each replayed event
  inserts a `sent` row with the real phone and cooldown key (which the live
  cooldown reads), and replayed STOP / START / YES / CANCEL rewrite opt-outs,
  consent, bookings and reminders. On the branch above (not merged as of
  2026-10-09) it refuses to start without `--i-understand-this-reads-production`,
  runs every `orchestrateSms` inside `runInSmsReplayScope` (each write, send
  and notify is skipped and listed; `smsReplayScope.ts`), denies all `fetch`,
  and exits 1 when its read-only post-checks find a leaked or unexplained row.
  Those post-checks count orchestration and draft rows only; customers,
  bookings and the consent ledger rest on the scope and its tests.
  There `REPLAY_DRY_RUN=true` skips every orchestrator effect, STOP persistence
  included, so it must never be set on a Railway service. Run either script
  only with the operator's go-ahead (`prod-db-guard`).

**Four defect classes have been found by this loop and pushed live** (each
verified on its own failing seed before merge, and read-back verified on the
served prompt after each Push Config): name-ask transfers, the repeated-ballpark
stonewall, the invented parts policy + competitor referral, and the wrong-shop
caller. See ROS-085 and the ISSUE-REGISTRY rows for each.

### Outbound SMS delivery — operating contract

- Outbound routes **shop-first** through the Capevace/F25e gateway on the shop's own Verizon line. Twilio is configured but not the primary sender.
- A send blocked by quiet hours (8AM–8PM ET), an unreachable gateway, or the **global SMS pause** is **queued**, not failed. `sms_messages.status='queued'` is the durable record.
- **Rehydration is continuous** (2026-07-29): `rehydrateQueuedFromDb` runs at boot AND on the drain timer after each throttled stale-'sending' recovery pass (~5 min cadence), `LIMIT 100` per pass — a >100 backlog drains over successive passes without restarts. Rows younger than a 2-minute claim grace are left for their in-flight `queueForLater` stamp (double-load race). In-memory dedup is by **DB id, checked before the claim**.
- Rehydration atomically claims each row `queued → sending`. A crash-orphaned `sending` row is flipped back by `recoverStaleSendingRows` (>10 min → `queued`, >48h → `failed`) and now HAS a live consumer in the running process — the next timer rehydrate loads it.
- **Global SMS controls** (2026-07-29): `sms_global_pause` DB flag = the real kill switch for the F25e path (HOLD semantics — marketing+followups queue durably, confirmations+internal flow; drain holds while paused; unreadable state fails closed for marketing only). Shop-wide rolling-24h cap (`SMS_GLOBAL_DAILY_CAP`, default 200) counted from `sms_messages` refuses automated sends over cap. Human takeover is enforced at the `sendSms` chokepoint for automated classes (`humanInitiated: true` = operator-approved exemption). The old `SMS_KILL_SWITCH` env gates only the dead Twilio fallback and is display-only in practice.
- **SMS autonomy ladder** — `server/services/smsAutonomy.ts` declares level 0-4 per automation; `setRolloutMode` enforces each event type's declared ceiling. Ops surface: `smsOps.opsStatus` + the SMS Ops strip in the admin (pause lever, queue depth/age, caps, suppressions, ladder).
- **Autonomy census (2026-08-13, NT-004)** — `services/smsAutonomyCensus.ts` + a read-only panel under the Rollout Control Center: derives every lane from `SMS_AUTOMATION_REGISTRY` (never a hand-list) and live-reads each orchestrator lane's mode via the SAME `getRolloutMode` the dispatcher consults. Flags **only `over_ceiling`** as a defect ("off" may be intentionally dormant — operator's call); an unreadable mode renders UNKNOWN, never off; non-orchestrator lanes are listed as a disclosed blind spot. **DB-down honesty:** the dispatcher's reader falls back to `legacy_passthrough` when the DB is unreachable — the census pre-checks the substrate, stamps every lane "ladder unenforceable," and banners it, because in that state passthrough is the dispatcher's true effective behavior, not an operator choice. First PROD reading not yet taken as of 2026-08-13 — fixture-green proves the shape, not the reading.
- **Bounded retry + dead-letter** (Autopilot Wave 1, 2026-07-29, migration **0104 — hand-apply required**): a definitive drain failure increments `send_attempts` and dead-letters at 5 (`failed`, `failure_reason='max_retries_exceeded: …'`); the 48h rule stamps `stale_sending_expired`. Pre-0104 the code degrades to the old time-bounded-only behavior. Replay: `smsOps.replayFailed` (atomic `failed→queued`, attempts reset, audit-logged, idempotent).
- **Silent-stall alert**: gateway healthy + in-hours + unpaused + due rows queued >5 min → Telegram (transition-aware, hourly re-alert). Rehydration now runs EVERY drain cycle (60s), recovery stays 5-min throttled.
- **Stale-lead truth** (Autopilot Wave 1): the 2-24h follow-up cron claims via `lastFollowUpAt IS NULL` and marks a lead `contacted` ONLY after a confirmed dispatch (`sent`/`queued`). A blocked/failed attempt leaves `status='new'` — the 24h `stale_lead` collector surfaces it. The cron also skips leads with a pending callback or inbound SMS within 48h (channel dedupe).
- **Autopilot Wave 6** (2026-07-29): `abandoned_form` collector (2h–14d partials w/ phone, subsequent-lead/booking excluded; `partial` evidence, value null, call-first) + string-keyed reconciler. **Takeover release**: `smsOps.releaseTakeover` writes `customer.sms_takeover_released` (fail-LOUD direct insert); `isConversationHumanHeld` is release-aware (most-recent signal wins — a manual reply after a release re-arms). Decision Inbox UI: snooze picker (2h/1d/2d/1wk), manual-match toggle on Won (un-closable-opportunity fix; recorded `manual`, never verified), owner chip.
- **Autopilot Wave 4 — identity verdicts** (2026-07-29): `services/identityResolution.ts` computes `resolved|ambiguous|unresolved|conflicted` per phone from existing tables (no link table — the prod dry-run measured 99.9% resolved / 0 ambiguous / 1 conflicted = operator's own test phone, so a stored graph is evidence-refused; see the audit doc §4). Enforced: `sendOpportunityDraft` refuses personalized sends on ambiguous/conflicted/unreadable; `draftOutreach` surfaces the verdict in risk reasons. Inbound-path refusal (`loadCustomerContext`) and estimate-collector rules unchanged and authoritative.
- **Autopilot Wave 2** (2026-07-29): two more collectors — `no_show_booking` (open booking requests whose preferred date passed; `inferred` by design — FCFS shop, a date is an intention) and `human_pending_sms` (conversations past the 30-min human SLA; `critical`/`verified` — the highest-signal row the queue holds). Morning brief now leads with an EXCEPTIONS block (waiting customers, blocked sends, held queue, delivery failures; failed reads render UNKNOWN). Migration **0105 — hand-apply** adds `sms_messages.sent_at` (drain-stamped) making queue→sent latency honestly measurable (`smsOps.latencyMetrics.queueToSent`). Bridge §8: `draft_opportunity_sms` / `send_opportunity_sms` — the ONE bounded statenour texting action (opportunity-row identity, shown-body approval contract, durable idempotency via `sms.bridge_send` audit rows, full chokepoint gates).
- Verified 2026-07-20: a tuple-shape misread of the claim result made that claim always evaluate to zero rows, so every restart moved up to 100 messages into `sending` and sent none. 136 messages to 103 people accumulated between 2026-06-02 and 2026-07-19. Fixed (#962/#965, `lib/db-affected.ts` `affectedRowCount`), backlog released, 132 delivered.
- Every non-send path in `sendSms` now logs a reason, and the drain logs hold/resume transitions (#970). Before that, a message that never reached a customer left no trace anywhere.

### Outbound consent — one index, and a list that could not be read stops the lane (2026-09-16, #2361 `34d53af5c` + #2371 `46e3194f4`)

This is the 2026-09-10 rule at the top of this file — *a read that could not
run must not render as a confident zero* — applied to consent, where the
confident zero was "nobody opted out".

- **ONE definition.** `loadSuppressionIndex()` in `server/sms.ts` is the only
  answer to "may we contact this number". It unions FOUR sources —
  `customers.smsOptOut`, `sms_preferences`, the raw inbound message log
  (STOP/UNSUBSCRIBE/etc. via `shared/smsOptOutKeywords.ts`), and carrier block
  notices — and returns `{ok:true, phones, carrierBlocked, stale}` or
  `{ok:false, reason}`. A lane that queries any ONE of those by hand holds a
  narrower list than the shop's real consent state, which is exactly how this
  started: three voice lanes read `customers.smsOptOut` alone, inside a
  `catch { /* fail-soft */ }`.
- **`stale: true` does NOT mean "five minutes old".** Five minutes is the TTL —
  the FRESH path. `stale` is returned only when a refresh FAILED, and the cache
  it hands back has **unbounded** age (`stale()` never consults
  `optOutCacheLoadedAt`). Every lane therefore treats `stale` exactly as it
  treats `ok:false`. Reading `stale` as "recent enough" is the trap this
  contract exists to close.
- **An automated lane THROWS; an operator lane REFUSES.** A cron that skips
  silently reports a clean run to `cron_log` with nobody listening, so an
  unreadable index raises and the run is recorded failed — one error id per
  lane (`VOICE_RECOVERY_SUPPRESSION_UNREADABLE` / `_STALE`, and the
  `FOLLOWUP_CADENCE_` / `CONFIRMATION_CALLS_` / `EMAIL_CAMPAIGNS_` / `DRIP_`
  equivalents). An admin button has a human waiting, so `makeFollowUpCall`
  returns the reason instead: a silent no-op reads as a broken button and gets
  pressed again. No override flag, deliberately.
- **Lanes covered.** SMS is gated centrally — there is exactly ONE Twilio send
  site repo-wide and every automated class passes the `sendSms` chokepoint.
  Voice: `cron/jobs/voiceRecovery.ts`, `cron/jobs/followupCadence.ts`,
  `cron/jobs/confirmationCalls.ts`, plus the operator lane `routers/vapi.ts`
  `makeFollowUpCall`. Email: `services/emailCampaigns.ts` (flag
  `email_marketing_campaigns`, read ENABLED in prod) and
  `services/dripProcessor.ts`.
- **Confirmation calls are gated because the shop holds no slots.** A
  confirmation could otherwise claim transactional status, but that defence
  needs a held appointment the customer would forfeit, and this is an FCFS shop
  with no calendar, slot or bay model anywhere (see the Arrival load note under
  Authoritative operator surfaces). Operator answer, 2026-09-16: confirming
  attendance is fine, no spots are held. **The business fact is what makes that
  answer, not the cron's name** — if the shop ever starts holding real slots,
  revisit this lane first.
- **Suppression must run BEFORE the batch limit.** `emailCampaigns` took
  `LIMIT 15` and filtered afterwards. A customer suppressed via
  `sms_preferences` still satisfies `c.smsOptOut = 0`, so they occupied a slot;
  `lastEmailCampaignAt` is stamped only on a SUCCESSFUL send, so they were never
  aged out; and with no `ORDER BY` the same rows returned every day. That is
  **indefinite starvation** of everyone behind them, not a throughput dent. It
  now reads a bounded candidate window (4x the batch) and takes the batch from
  the unsuppressed remainder, logging `EMAIL_CAMPAIGNS_WINDOW_EXHAUSTED` rather
  than quietly under-sending. Send volume is unchanged at 15.
- **The drip EMAIL branch is unreachable today** — all 12 steps across all 4
  campaigns declare `channel: "sms"`. The missing check there was a latent trap
  for whoever adds the first email step, not a live hole; a test asserts the
  zero-email fact so nobody has to take that on trust. Drip counters are also
  split now (`sent` / `suppressed` / `processed`) — `sent++` used to be
  unconditional, so `cron_log` counted suppressed contacts as successful sends.
- **How the lanes are kept enumerated.** A guard keyed on the helper
  (`placeVapiOutboundCall(`) and scoped to `cron/jobs` could not see
  `makeFollowUpCall`, which dials with a raw `fetch` to
  `https://api.vapi.ai/call` — that fourth lane was found by sweeping the
  PROVIDER, not the helper. `cron/jobs/outboundLanes.suppression.test.ts` now
  walks all of `server/**` for three dial shapes plus an inventory pin on every
  VAPI-touching file, and its documented-exceptions list is **EMPTY**.
  Enumeration catches the lane nobody named; the behavioural suites
  (`makeFollowUpCallSuppression.test.ts`, `emailLanes.suppression.test.ts`, each
  sender stubbed to THROW so "nothing sent" is *witnessed* rather than inferred
  from a counter the code under test computed) catch a regression inside a lane
  already named. Both, or neither is enough — a mutation that kept every token
  and merely ignored the index result left the source-only sweep 13/13 green.
- **Known gap, reported not fixed:** an email unsubscribe is a
  `mailto:unsubscribe@nickstire.org` link recorded in no machine-readable place,
  so the index cannot see an email-only revocation; and `lint:brand-voice` does
  not scope the customer-facing templates in `emailCampaigns.ts` (`scopeOf()`
  covers pages, components, `services/vapi.ts` and the
  Sequences/Outreach/Recovery crons — and nulls any `admin/` path).

### Inbound SMS response — durability + human takeover (2026-07-21, NCSOS)

- Every inbound customer text now creates a durable **`sms_response_jobs`** row — the obligation to respond, deduped by a deterministic idempotency key so a provider redelivery maps to one job. The webhook still answers in-request for latency; the job row is the durable safety net. `server/services/smsResponseJobs.ts` (#986).
- A job leaves the queue only via a terminal status: `responded` (a reply was dispatched), `suppressed` (the AI deliberately did not auto-send — human owns it), `failed` (dispatch failed; the outbound layer owns delivery retry), or `dead` (retried and still threw). `startResponseJobProcessor` re-sweeps un-answered `pending` jobs on boot and every 45s and reclaims crashed `processing` jobs — so an inbound reply can no longer be silently lost to a restart.
- **Human takeover:** if an operator manually replied to a conversation within 60 minutes (signalled by the `customer.sms_manual_send` audit row), the orchestrator suppresses AI auto-send and downgrades to a draft the operator approves — the AI never texts over a live human. STOP/opt-out is handled earlier and is unaffected. `server/services/humanTakeover.ts` (#987).
- The SMS drafter now receives the customer identity, vehicle, open-estimate service, and last-VAPI-call gist that `loadCustomerContext` already loaded, so replies are personal, not cold (#988). The SMS persona prompt is a single shared SSOT constant (`nickSmsPersona.ts`) imported by both the live drafter and the fine-tune corpus exporter, so training data and serving cannot drift (#989).

## Contracts that are executable, not prose (2026-07-27)

Three governing contracts moved from markdown into typed modules that the code
actually reads. In each case the prose remains for humans; the module is what
runs, and a parity test fails the build if the two disagree.

- **Brand voice** — `shared/voice.ts` is the sole source of the kill list, the 7
  positive patterns, the surface rules and the CTA library. `docs/brand/VOICE.md`
  and `.claude/brand-voice-guidelines.md` no longer carry word lists; the
  brand-voice linter, both Instagram prompts and `voice-compliance.test.ts` all
  import the kernel. Before this the voice existed in seven disagreeing copies
  and "reliable" shipped to the live site (ROS-074). Adding a rule anywhere but
  the kernel fails `voiceKernelParity.test.ts`.
- **Metrics** — `shared/metricsContract.ts` carries the 27 canonical metrics from
  `docs/METRICS-CONTRACT.md` with their evidence levels and ROI-safety, plus the
  `MetricEnvelope` every executive metric response should travel in. It is a
  registry and validator only; no existing query or admin surface was rewired to
  it in this change (ROS-077). `Verified attributed revenue` is the single
  ROI-safe revenue concept, pinned by test.
- **Loop health** — `server/services/loopShapeContract.ts` declares, per loop,
  the output a healthy run produces. A run that succeeds while producing nothing
  is `dormant`; a run that succeeds without measuring its output is `unknown`,
  never healthy (ROS-078). Contracts and a pure classifier only — no observer is
  wired to it yet.

- **Shop-time dates** (2026-08-13, NT-009) — `server/lib/timezoneAssert.ts`
  `getBusinessDateKey()` is the server twin of the client helper: any
  "today"/"past-date" comparison over customer-facing dates must use it, never
  bare SQL `CURDATE()` (a UTC session's CURDATE() is already *tomorrow* in
  Cleveland between 20:00 ET and midnight ET). Converted at the two
  customer-touching sites: `detectNoShows` (was auto-cancelling + texting on
  the UTC boundary) and `confirmationCalls`' "tomorrow" (was correct only by
  coincidence of its 15–18 ET window). Fallback is EST-conservative — a sweep
  can run late, never early. DST + evening boundaries pinned by test. Bare
  `CURDATE()` remains in analytics/reporting queries where a ±4h window edge
  changes a chart, not a customer contact.

Answer-engine crawlers (`OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`,
`Claude-User`, `Google-Extended`, `meta-externalagent` and others) now receive
prerendered HTML. `GPTBot` was already present but is OpenAI's model-training
crawler, not the agent that answers a customer question (ROS-076).

### The approval queue is the one door for new AI-originated writes (2026-08-12, #1541)

- **`admin_proposals` (migration 0111, applied + read-back verified 2026-08-12) is a queue of
  INTENTS, not actions.** Every row's payload is validated against the executor registry in
  `server/services/proposals.ts` at INTAKE, and execution is reachable only through the
  compare-and-set chain `draft/pending_review → approved → executing → executed`. A rejected row
  has no structural path back to execution, and two concurrent approvers race the CAS with exactly
  one winner. Verified empty in prod at ship time (0 rows).
- **Executors create INTERNAL records only** — `create_callback` → a `callback_requests` row,
  `create_booking_request` → a `bookings` row at status `new`. Customer-facing sends are banned
  from this registry by policy: the confirmation SMS still fires only from the existing operator
  confirm path (`booking.updateStatus`). Adding an executor that texts, calls or posts would fork
  the send-gate policy — route it through the existing chokepoints instead.
- **Crash-orphan semantics, deliberately asymmetric.** A row resting at `approved` (the approve CAS
  landed, the execution claim did not) is RESUMABLE — the executor provably never ran. A row stuck
  at `executing` is NOT auto-retryable, because the process may have died after the executor's
  insert and before the terminal write; that ambiguity is operator territory, the same doctrine as
  a `publish_ambiguous` reel. The UI says so rather than offering a button.
- **The five existing approval lanes are untouched** (Instagram Studio drafts, `review_replies`,
  `sms_learning_recommendations`, `revenue_opportunities`, `nickgpt_drafts`). This table is for NEW
  action classes only; it does not absorb them and their hash-sealing/TTL semantics still govern.
- **Nick's call-end extraction is DRAFT-ONLY and flag-gated** (`vapi_action_proposals`, ships OFF).
  Deterministic gate first (`classifyCall` — spam, tech failures, handled and walk-in-directed
  calls, and any call without a verified telephony number never reach the LLM), then a pinned
  extractor whose parse THROWS on unknown shapes. The verified caller number is the only phone a
  draft may carry. **This does not contradict the 2026-06-05 no-rows-from-voice directive**: a
  draft is a review artifact, and the operational row exists only after a human approves it.
- **Attribution: `audit_log` is now an attributed ledger** (migration 0110, applied 2026-08-12):
  `actor_type` (`human_user` | `nick_receptionist` | `public` | …), `before_json`/`after_json`
  snapshots, `status` (`executed` | `proposed`), and a unique `idempotency_key`. Snapshots are
  PII-scrubbed by KEY and by VALUE — a phone or email typed into a free-text field (a public
  symptom box) is masked before it lands. The ledger middleware records only after a mutation
  succeeds and can never break the mutation.
- **Drafting and deciding are different permissions.** `proposals.create` resolves to
  `callbacks.manage` (front desk can flag work from the Sales Pipeline and the call drawer);
  approve / reject / retry require `settings.manage` (owner, manager). A queue whose buttons the
  gate refuses is worse than no button — that is why the split exists.

## Manual or operator-gated systems

- Applying SEO copy changes to source
- Publishing generated content or GBP material
- Approving and publishing reels (Instagram → Publish → **Reels segment** since the 2026-07-24 reel-absorption wave — the legacy Queue is deleted; hash-sealed via approveDraft/publishPost with a two-tap exact-payload confirm; earlier live verification 2026-07-17 with IG posts 18018908711883906 and 17877918753617173)
- Approving and publishing Instagram Studio V2 drafts — server-owned quality gate (review/declined-work sources are picked from real records; the server still verifies them), deterministic HTML→JPEG render, drafts persisted server-side with versioned autosave from the moment of generation, and an explicit approve → schedule/publish step behind a two-tap payload confirm; nothing posts without operator action (`server/services/instagramStudio.ts`, `server/routers/instagramStudio.ts`)
- Pushing VAPI prompt/configuration changes
- Resolving weak invoice or customer matches
- Approving outbound campaigns
- Correcting historical classifications
- Approving anything in the `admin_proposals` queue (`/admin` → Approvals) — nothing in it executes
  without a human tap, enforced server-side, not by hiding a button
- Production migrations and credential rotation

## Experimental or modeled systems

- Classifier-derived call outcomes
- Duration-based warm-transfer connection estimates
- Modeled receptionist pipeline value
- AI-generated recommendations and drafts
- Weak phone/time attribution without direct identifiers

These must remain visibly labeled as inferred or modeled.

## Retired or historical-only material

- Files under `docs/_archive/` are historical evidence, not current instructions.
- The archived `docs/_archive/root_reports/truth_os.md` is not the current operating contract.
- Old audit findings are not standing truth. Reverify them against current source, tests, generated output and production evidence.

## Not currently measurable with full confidence

- Universal transfer connection without a direct VAPI human-answer signal
- Arrival from a walk-in direction unless a later operational record is linked
- Paid revenue attributable to a call without a defensible invoice match
- Exhaustive GSC query/page totals from bounded dimensional API rows
- Revenue caused by a classifier outcome

## Authoritative operator surfaces

- Paid revenue: invoice-backed revenue views
- Leads and bookings: their respective operational tables and admin workflows
- Voice call activity: Voice Receptionist admin, with metric definitions from `METRICS-CONTRACT.md`
- Search performance: official GSC aggregate totals plus separately labeled detailed-row analysis
- System health: integration-specific timestamps and error states, not a single blended score
- Arrival load: the Today **Arrival load** strip (2026-08-13) — expected arrivals ("said they're coming today", voice/SMS-captured `expected_arrivals`, first client consumer of `dispatch.expectedArrivals`) + tomorrow's preferred-date bookings from the overview bundle. A planning signal for a deliberately slot-less FCFS shop, **not** a schedule — there is no calendar/slot/bay model anywhere, on purpose. Self-suppresses only when every source answered, is trustworthy, and is empty; an unreadable source renders as unknown, never zero. Home-screen doors: three admin PWA shortcuts (Approvals / Today / IG Ops via registry `?tab=` ids; iOS ignores manifest shortcuts — pin the URLs as separate icons instead)
- Instagram learning surfaces (Learn page, 2026-08-13 additions): the **hook & beat-structure swipe file** (`instagramAdmin.getSwipeFileCorrelations` — design signals from `reel_jobs.payload` joined to `ig_metric_snapshots` saves/shares/skip-rate; a sufficient comparison is capped at **MED/INFERRED** by construction — HIGH only ever comes from a deliberate `contentExperiments.ts` run) and the **multilingual dub worklist** (`instagramAdmin.getMultilingualDubCandidates` — REELS-only, reach-floored top performers worth manually enabling Meta AI translation for in Creator Studio; deliberately NOT an automation — verified 2026-08-13 that no Graph Content-Publishing API field triggers Meta's translation, and no YouTube channel exists in this stack). Both render honest-unknown on a failed read. `engagementRate` downstream of `getTopPosts()` is PERCENTAGE-scale (5.23 = 5.23%) — a 0-1-fraction assumption shipped a ×100 display bug once
- Instagram content: the five-view IG admin (`?igview=` Today / Create / Publish / Community / Insights, 2026-07-24). **Publish is the only queue** — Board (lifecycle × computed health, incl. the Attention lane), List, and Reels segments; Planning, reel recovery, autonomy control and settings live behind the gear. Views, filters and inner tabs are URL-persisted and honor browser history (popstate). Admin-wide rule pinned by tests: a failed read renders as *unknown*, never as an empty/positive state (`adminTruth.test.ts`, `emptyIsNotUnknown.test.ts`); client dialog globals are lint-banned (the iOS PWA suppresses them). **Create is evidence-first as of 2026-08-16** — source selection resolves real records (`alg_estimates` for declined work, `specials` for offers, 5-star reviews), the quality gate scores structured facts rather than string length, and every fact carries a `recorded | inferred | operator` basis so an INFERRED decline can never be asserted as a customer decision. Latency and read-honesty invariants (request ceiling vs server budget, `retry: 0`, the paused-query trap, fail-soft servers, three-state storage health) are documented in [IG-EVIDENCE-ARCHITECTURE.md](IG-EVIDENCE-ARCHITECTURE.md) — read it before changing any of them

## Production actions not performed by documentation changes

Documentation does not deploy, migrate data, reclassify history, contact customers, update VAPI, publish GBP content or modify external accounts.
