# Faceless Reel Intelligence Studio

> **SUPERSEDED — HISTORICAL V1 DESIGN DOC (stamped 2026-08-13, ScanFinish Run 2
> audit round 2).** Everything below describes the June 2026 V1 as designed:
> never-posts, kill-switches `false as const`, component not yet routed. All
> three claims are now false — `PUBLISH_ENABLED`/`GENERATION_ENABLED`/
> `INSIGHTS_ENABLED` are `true` in `client/src/lib/facelessReelStudio.ts`, the
> Studio is routed at `/admin/reel-studio`, and a fully autonomous
> generate-assemble-publish pipeline runs daily (`server/cron/jobs/
> dailyReelPost.ts` + `server/services/reelPipeline.ts`). Current truth lives
> in `docs/CURRENT-TRUTH.md`, `docs/runbooks/reel-pipeline.md`, and
> `docs/NICKSTIRE-SCAN-LEDGER.md`. Kept for the V1 design rationale (the
> claim-safety banks, quality-gate weights, and 15-22s format contract that
> later systems inherited), not as guidance.

_Admin-only planning surface for premium faceless educational Instagram Reels for @nicks_tire_euclid. V1 (this PR) is preview-first and draft-first: it plans, scores, validates, and packages — it never generates media and never posts._

## Purpose

The existing IG autoposter (`server/services/igAutopost.ts`) can generate and post static content end-to-end. Reels need the OPPOSITE shape first: a creative/research/retention/QA control room where the operator produces a complete production brief — concepts, storyboard, Higgsfield prompts, assembly plan, caption, quality gate — before any video pipeline exists. This Studio is that control room.

| | IG autoposter | Reel Studio (this) |
|---|---|---|
| Output | posted static content | copy-paste production brief |
| External calls | LLM, image gen, IG/FB APIs (dry-run gated) | **none — structurally** |
| Human role | review dry-runs | drives every step; publishes manually |

## Files

- `client/src/lib/facelessReelStudio.ts` — types, brand constants, fact buckets / archetypes / motion lenses / object characters, claim-safety pattern banks, validators, 75-point quality gate, prompt-pack/checklist builders, kill-switch gates.
- `client/src/lib/facelessReelStudioPrompt.ts` — `buildFacelessReelSystemPrompt(options)` master prompt engine (text assembly only; no LLM call).
- `client/src/lib/facelessReelStudioSamples.ts` — 3 SAMPLE seed briefs (PRESSURE / POTHOLE / BRAKES).
- `client/src/pages/admin/FacelessReelStudio.tsx` — the Studio page (standalone; see Wiring below).
- `client/src/__tests__/faceless-reel-studio.test.ts` — safety/structure/score/prompt tests.

## Wiring status (deliberate)

The component is **not yet routed**. `App.tsx`, `shared/routes.ts`, and the admin nav are being edited concurrently by the IG Carousel Studio session and PRs #47/#49 — wiring from this PR would collide. After those land, wiring is two small edits (mirror the Carousel's `/admin/ig-studio` pattern, e.g. `/admin/reel-studio`), ideally as a shared Social Studio tab pair.

## Modes

- **Draft Only** — planning/copy/prompts/storyboard. No media instructions.
- **Asset Prep** — adds the Higgsfield prompt pack + ffmpeg assembly checklist + cover plan. Still no calls.
- **Publish Prep** — adds the manual Instagram publish + archive checklists. The publish button stays disabled.
- Disabled future modes (Generate Video · Assemble MP4 · Publish Reel · Read Reel Insights) all label: *"Disabled in this PR — no external generation or posting occurs."*

## Safety gates

1. **Kill-switches**: `PUBLISH_ENABLED` / `GENERATION_ENABLED` / `INSIGHTS_ENABLED` are `false as const`; `canPublish()`/`canGenerateVideo()`/`canAssembleMp4()`/`canReadInsights()` always refuse. There is no code path that could call out.
2. **Claim safety**: pattern banks block prices (none allowed in reels at all), "free" (except "free check"), guarantees, "best", stock/wait-time claims, fake urgency, overdiagnosis ("you definitely need", "your X is broken"), fearmongering. Approved soft language only: *can point to · may indicate · worth checking · one clue · do not guess · stop by and we'll take a look*.
3. **Faceless contract**: heuristic detector blocks face/talking-head/shop-tour subjects in beats and prompts; the publish checklist still requires a manual frame-scrub of the FINAL render — heuristics are not eyes.
4. **Format contract**: exactly one reel per run · 15–22s · 4–6 contiguous beats · 1080x1920 H.264 yuv420p 30fps +faststart · muted-first (every beat carries on-screen text) · loop plan required.
5. **Quality gate (75 pts, ≥70 to pass)**: first-frame scroll-stop 10 · muted-first 10 · beat structure 5 · length 5 · loop 5 · sourced fact 10 · faceless 10 · claim safety 10 · keyword 5 · winning concept ≥57/60 5.

## How to use

1. **Plan**: open the Studio → pick mode → *Copy Master Reel Prompt* → run it in your LLM of choice with your topic. Paste results back as a brief (manual in V1).
2. **Generate (Higgsfield, manual)**: *Copy Higgsfield Prompt Pack* → one 9:16 clip per beat at the beat's duration. Never ask the generator to render words — text is added in assembly. Always keep the negative prompt (faces/hands/text artifacts).
3. **Assemble (ffmpeg, manual)**: follow the Assembly Plan — concat beat clips → `libx264`, `yuv420p`, 30fps, 1080x1920, `-movflags +faststart`. A cut/push/text-change every 1.5–2.5s. Mix audio so the reel still teaches muted. Export a face-free cover frame.
4. **Publish (manual)**: walk the publish checklist — correct account (@nicks_tire_euclid), FB cross-post OFF, human watches the full reel, caption + keyword CTA copied from the Caption Studio.
5. **Archive**: save MP4 + cover, write the log entry (topic/fact/keyword/archetype/lens/character/date), update the repetition memory, record the IG URL on the brief.

## Content memory (V1 = manual)

The Windows-local logs (`Downloads/nicks-tire-reels-log.md`, `nicks-tire-content-log.md`) are NOT wired — deployed environments can't see local paths, and a brittle dependency was rejected. The Studio shows a manual paste/import placeholder with the repetition checklist (topic · fact · hook · archetype · motion lens · object character · keyword · CTA · same-day carousel/static overlap). DB-backed memory is roadmap item 1.

## Sample briefs

Three fully-worked SAMPLE briefs ship with the Studio (clearly labelled; `instagramUrl: null`; no fabricated URLs; label-only source notes from the approved proof families): **PRESSURE** (door-sticker myth · diagnostic HUD), **POTHOLE** (3-clue fake documentary · forensic scan), **BRAKES** (POV brake pad · product-ad macro).

## Future integration roadmap

1. DB-backed Reel memory (replace manual paste; feed the anti-repetition gate)
2. Live research/source collector (grounded fact gathering with citations)
3. Higgsfield generation integration (env-gated, dry-run-first, behind operator approval)
4. ffmpeg assembly integration (server-side render queue with the same checklist as the gate)
5. Instagram draft/publish integration (reuse the igAutopost dry-run spine; PUBLISH_ENABLED flip is a deliberate, reviewed change)
6. Insights feedback loop (read Reel metrics; learn which archetypes/lenses/keywords earn saves)
7. Boosted-performance learning (tie boosts to the attribution spine's UTM convention)
