# Reels Engine v2 - Source-aware production route (2026-10-09)

Doctrine `02-PRODUCTION-DOCTRINE.md` section 8 items 4-6 are now BUILT + WIRED. A beat declared
REAL binds the exact registry clip it names; a beat declared DETERMINISTIC is drawn locally; both
reach the final MP4 through the existing assembly lane and the existing publish door. Nothing in
this slice spends a credit, publishes, or changes a schedule.

## Compatibility map (code read at main `8e945f42`, changed in this slice)

| Mission concern | Was | Now | Where |
|---|---|---|---|
| Faceless means no hands | `FACE_SUBJECT_PATTERN` blocked gloves/hands on every beat; critic `HUMAN_PRESENT` blocked hands | `presenceProfile: "hands_only_real"` admits hands/tools ONLY on beats declared real; faces and figures block everywhere; generated beats keep object-only | `client/src/lib/facelessReelStudio.ts` (`validateFacelessSubject`, `runSafetyChecks`), `server/services/renderedQa.ts` (`handsExpectedBeats`, `applyPresenceExemptions`) |
| Timeline cannot exceed 4 s per beat | `briefToSegments` clamped every beat to `maxClipSeconds` (4) | per-beat cap: a bound real clip holds up to `min(12, probed duration)`; a card up to 8 s; generated beats stay at 4 | `server/services/reelAssembly.ts` (`segmentCapSeconds`, `REAL_CLIP_MAX_SECONDS`, `CARD_CLIP_MAX_SECONDS`) |
| Declaring a source does not execute it | generator held real + deterministic beats before spend | `beatsToResolveLocally` binds real beats (registry row verified: `real_shop`, reusable, current, video, sha256, duration) and renders cards, before the provider loop; unbound real beats still hold | `shared/shotRouter.ts`, `server/services/localBeatResolution.ts`, `realShotBinding.ts`, `deterministicCard.ts`, `reelPipeline.ts` (generation block) |
| Existing http clip skips generation without provenance | a URL in `clipUrls` was the whole proof | the job payload carries `shotLineage` (assetId, sha256, rights, source duration, trim, renderer); assembly hashes the downloaded bytes and refuses a mismatch | `shared/reelSourceProfile.ts`, `reelAssembly.ts` (`expectedClipSha256`, assembleReel) |
| Typography uppercases and strips `%` | `sanitizeCaption` | `captionStyle: "sentence"` keeps case, `%`, `/`, units; drawn with drawtext `expansion=none`; legacy filter string unchanged byte for byte | `reelAssembly.ts` (`sanitizeCaptionStyled`, `buildFfmpegArgs`) |
| A fully real Reel labelled AI | `shouldDiscloseAi` fell back to the env provider pin | lineage covering every clip with registry/card origins means no `is_ai_generated`; any provider URL or partial lineage keeps the label | `shared/reelDisclosure.ts`, `cron/jobs/dailyReelPost.ts`, `routers/instagramAdmin.ts` |
| Repair regenerates anything | `beatRepairRefusal` named only the old hold routes | a bound or drawn beat is refused for paid regeneration with the right reason | `server/services/selectiveRepair.ts` |
| Stock guard | refuses clip URLs containing `template-stock` | unchanged; registry footage and `reels/deterministic-card/` clips are not that lane | `server/services/qualityGate.ts` |

## How a real beat gets its footage (operator steps)

1. Capture the clip (05-CAPTURE-CHECKLIST.md). Vertical, 5-8 s, no plates, faces or paperwork.
2. Register it: `scripts/register-real-shop-clip.mts <file.mp4> --slug <P1-nail-macro> --job <note>`
   (dry run; add `--execute` to upload and register). It probes the clip with ffprobe, refuses
   anything that is not vertical video with a duration, uploads the exact bytes to
   `reels/real-shop/`, and writes a `real_shop` VIDEO row with `duration_ms`, dimensions and
   `checksum_sha256` (`RegisterAssetInput.durationMs`, added 2026-10-10: the column existed and
   nothing wrote it, so every registered clip was refused `no_duration`). The Instagram Studio
   upload still registers stills only. Shot list + command: `14-CAPTURE-DAY-CARD.md`.
3. Put the row id on the beat: `"realAssetId": "ma_..."` in the pack's `brief.json`. The pack
   builder carries it; nothing is inferred from prose.
   A photo of the bay works the same way for GENERATED beats (2026-10-10): register it with
   `--kind still` and put `"heroAssetId": "ma_..."` on the pack brief. Enqueue verifies the row
   (real_shop, current, JPEG/PNG/WebP, image URL) and makes it the brief's visual world, so every
   generated clip starts from Nick's actual shop. The clips are still generated; the AI label stays.
4. Enqueue as usual. At generation the pipeline verifies the row, binds URL + sha256, writes
   `sourceDurationSec` on the beat and a `shotLineage` row on the payload, and only then runs the
   provider loop for the remaining beats. A refusal names the beat, the asset and the reason
   (`REAL_ASSET_NOT_BINDABLE`), and nothing is generated.

A deterministic beat needs only `"cardLines": ["PLUG", "INSIDE PATCH"]` (or the capitalised labels
after "labels" in its visual). The card is an SVG rasterised by sharp, moved through the same ffmpeg
lane as template_stock beats (`buildBeatClipArgs` + `runFfmpeg`), re-hosted under
`reels/deterministic-card/`, and bound with its sha256.

The three proof packs now declare `presenceProfile: "hands_only_real"` and their card lines.
They still hold at enqueue until their real beats name a registered clip - by design.

## What this slice does not do

- Spend: no Higgsfield call changes. Publishing: no door is weakened; the stock guard, exact-asset
  approval, claim audit and disclosure gate are untouched or stricter.
- Studio UI: no new control for `realAssetId`, `cardLines`, `presenceProfile` or `captionStyle`.
  They are pack-file fields for now (the proof packs are committed JSON).
- Video registration from the Studio upload (duration probe) - the registry row shape supports it;
  the upload path does not probe video yet.
- The approval Queue does not show `describeShotLineage` lines yet.

## Regression fixtures (server/reelSourceAware.test.ts, shared/reelSourceProfile.test.ts)

| Fixture | Result |
|---|---|
| Legacy synthetic object-only job | gloves/hands still rejected; uppercase caption byte-identical; 4 s clamp |
| Registered real hands-only clip under hands_only_real | brief accepted; critic hands-only HUMAN_PRESENT exempted, recorded on the verdict |
| Unapproved face, or hands on a generated beat | held with the named reason |
| Registry row that is not real_shop / not video / not current / no checksum / no duration | refused with the typed reason, nothing generated |
| Mixed real + card + generated timeline | exact clip per slot, lineage per beat, assembly hashes the bytes |
| 7 s real clip, 12 s declaration on a 7 s clip, 40 s clip | 7 s, 7 s (trimmed, never padded), 12 s cap |
| Sentence caption with `%` and units | meaning preserved, `expansion=none` |
| All-real lineage vs partial / provider | AI label off vs on |

Receipts: `pnpm run check` exit 0; the suites above plus reelAssembly, reelRenderBudget,
captionSafeZone, reelTextSurfaces, reelAudioIntegrity, faceless-reel-studio, shotRouter,
selectiveRepair, reelLaneUnjam, angleBank, approvedReelPackRotation, renderedQa, criticPanel,
reelPipeline*, reelDraftPrep, declaredSourceAtGeneration, templateStockStudio, qualityGate green.
