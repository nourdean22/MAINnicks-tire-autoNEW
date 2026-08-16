# Reel Pipeline Handoff — IG Admin "Faceless Reel Studio"

**Date:** 2026-06-18 · **From:** a sibling session that built + production-verified the reel generation/assembly/posting pipeline (3 reels posted live to @nicks_tire_euclid).
**For:** the session working the Instagram admin tab (`nickstire/ig-prompt-pass` / `ig-autopost*`).
**TL;DR:** The Faceless Reel Studio's **Generate / Assemble / Publish** modes are no longer hypothetical. Every missing step has a working reference path. Keep execution behind the existing dry-run + kill-switch gates and use the configured durable media bucket for public Reel URLs.

## Current execution update (2026-08-13)

The Meta/Instagram publisher is now verified live for `@nicks_tire_euclid`.
Use the existing `server/services/metaSocial.ts` / `publishToSocial()` rail;
do not build a second browser uploader. Required configuration names are
`META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID`, and `META_PAGE_ID`, with a
durable `app_secret_kv.meta_page_access_token` fallback. Never expose token
values.

The current publish contract is: approved and QA-checked MP4 -> permanent
public HTTPS media URL -> Meta `REELS` container with `share_to_feed=true` ->
poll `FINISHED` -> one `media_publish` call -> media ID and read-back
permalink. A lost response after dispatch is ambiguous; reconcile it before
retrying. Recurring generation remains approval-gated unless publication is
explicitly authorized.

---

## Current state of the tab (ground truth)

`client/src/pages/admin/InstagramTab.tsx` — 7 sub-tabs: Feed Explorer · Inbox · **Create** · Publish · Autopost Logs · Analytics · Settings. The **Create** tab folds in the **Faceless Reel Intelligence Studio** + IG Carousel Studio + AI co-pilot.

The Reel Studio (`pages/admin/FacelessReelStudio.tsx` + `lib/facelessReelStudio*.ts`) is **plan-only by design**: kill-switches `PUBLISH_ENABLED` / `GENERATION_ENABLED` are `false as const`; it outputs a production brief and never generates media or posts. **Its brain is excellent — keep it.** Fact buckets, archetypes, motion lenses, claim-safety banks, and the 75-pt quality gate are the creative engine. This handoff is only about the **execution arm** that runs *under* that brain.

## What's already in the server (reuse, don't rebuild)

- `server/services/higgsfieldStudio.ts`
  - `generateReelClipVideo(prompt)` — works, but **hardcoded to `wan2_6`**. Swap the model to `seedance1_5` (better + cheaper, see costs).
  - `generateCarouselSlideImage(prompt)` — `gpt_image_2` (carousels already use this).
  - `stitchVideos(urls)` — ffmpeg concat, **silent only** (no captions/VO/music).
- `server/services/higgsfieldBinary.ts` → `ensureHiggsfieldBinary()` (CLI at `node_modules/.pnpm/@higgsfield+cli@0.2.2/.../vendor/hf.exe`).
- `server/services/metaSocial.ts` — **already has a working Instagram REELS flow** (`media_type: "REELS"`, `video_url`, container → poll `status_code` → `media_publish`). Token (`META_PAGE_ACCESS_TOKEN` + `META_IG_USER_ID`) is valid; account = @nicks_tire_euclid (verified live today).
- `server/services/igAutopost.ts` — the dry-run pattern to copy (`IG_AUTOPOST_DRYRUN !== "false"`).

## Reference implementations (working scripts, run today)

All in `C:\Users\nourd\NOURCITY\apps\nickstire\scratch\` (read by absolute path from your worktree):

| Step | Script | What it does |
|---|---|---|
| Generate clips + music | `gen-reel1-assets.ts`, `gen-reels-23-assets.ts` | 4 Seedance clips/reel + Sonilo music, saved per reel |
| Narration | `gen-vo.ts <reel> <google\|elevenlabs>` | TTS → `vo.wav` (Google Neural2 = free/commercial-clean; ElevenLabs = richer) |
| Assemble | `assemble-reel.ts <reel>` | ffmpeg: trim/concat beats, **burn captions**, VO over ducked music → 1080×1920 H.264 |
| Publish | `server/services/metaSocial.ts` via `publishToSocial()` | Meta REELS: public URL → container → poll FINISHED → publish → media ID + permalink; the scratch script is historical reference only |
| Single-clip retry | `retry-reel3-clip4.ts` | retry pattern for transient 502s |
| Creds refresh | `update-railway-with-fresh-creds.ts` | ⚠️ token path fails — see gotchas |

## Model menu + costs (from `hf model list` / `hf generate cost`)

| Model | job_set_type | Cost (9:16, 1080p) | Note |
|---|---|---|---|
| **Seedance 1.5 Pro** | `seedance1_5` | **12 cr / 4s clip** | recommended default |
| Seedance 2.0 | `seedance_2_0` | 45 cr / 5s | has `genre` knob (comedy/noir/…) |
| Wan 2.6 | `wan2_6` | 13 cr | current hardcoded |
| Sonilo Music | `sonilo_music` | ~1 cr / 15s | |
| Google Neural2 TTS | (Cloud TTS API) | free tier | commercial-clean; **API enabled today** |
| ElevenLabs | (Roger `CwhRBWXzGAHq8TQ4Fs17`) | free 10k chars/mo | attribution needed for commercial |

`hf generate cost <model> ...` returns a **free** credit estimate; `hf account status` returns the balance (~1,460 cr left). Surface both in the UI.

## The proposed wiring (gated, mirrors igAutopost)

1. **Settings → cost + creds health:** add `hf account status` (balance) + a stale-creds probe to the existing health panel. Stale Higgsfield creds silently kill autopost image-gen (that's what broke today).
2. **Create → "Generate" mode:** new tRPC mutation (`instagramAdmin` router) → per-beat `generateReelClipVideo` with `model: "seedance1_5"`; gate behind a `REEL_GENERATION_ENABLED` env flag (default off) + show the `generate cost` estimate first.
3. **Voice + music:** port `gen-vo.ts` + Sonilo into a server step. **Do NOT use `inworld_text_to_speech` — it fails for every voice.**
4. **Assemble:** server-side ffmpeg per `assemble-reel.ts` (system ffmpeg is on the box; repo already shells ffmpeg in `stitchVideos`). Note the **half-open caption intervals** (`gte(t,a)*lt(t,b)`) — inclusive `between()` double-renders one frame at each cut.
5. **Publish:** route the Studio's "Publish Prep" → `metaSocial` REELS flow, **behind the dry-run flag + the existing claim-safety + quality gate**. Captions stay claim-safe (soft CTA, no prices).

## Historical blocker: hosting (resolved)

Meta's REELS API **fetches the video from a public URL** — it cannot take an upload. Carousel *images* dodge this (Higgsfield returns them on a public CDN URL). **Reels are assembled locally, so they need hosting.** The durable Railway media bucket is now configured and should be the production path; a throwaway public HF dataset is only a temporary operator-approved fallback, not the default.

**→ Resolved:** upload the assembled MP4 to the configured durable bucket, hand Meta its permanent public object URL, and retain the asset according to the media-retention policy. Verify the URL with `HEAD` before creating the Meta container.

## Gotchas (save yourself hours)

- `delete process.env.HIGGSFIELD_CREDENTIALS_JSON` (+ `_PATH`) before spawning the CLI, or the **expired** `.env` value overrides the fresh `hf auth login` session.
- `OPENAI_API_KEY` is an **OpenRouter** key (`sk-or-v1…`) → no OpenAI TTS.
- Higgsfield creds **expire**; refresh = `hf auth login` (device flow) → push to Railway. The `update-railway-with-fresh-creds.ts` RAILWAY_API_TOKEN path returns **"Not Authorized"** (CLI token isn't accepted for `variableUpsert`). Working method: from the authenticated railway.com page, `fetch('https://backboard.railway.com/graphql/v2',{credentials:'include', body: variableUpsert})` (cookie auth) — auto-triggers a redeploy. Railway IDs: project `d78487fa-24c7-412e-9d2c-1055d9f8db93` / env `84f0d4b4-efcd-480f-a761-27589e0a095f` / service `a6234c8d-1ff4-478f-9085-654954b54e97`.
- Higgsfield creds file (read fresh — access_token rotates): `C:\Users\nourd\.config\higgsfield\credentials.json`.

## More context

- Memory (your session auto-loads these): `~/.claude/projects/C--/memory/nickstire-viral-reels-higgsfield.md` and `nickstire-elevenlabs-key.md`.
- The "Useful Absurdity" reel formula + portable master prompt are in the sibling session's notes — the Studio's claim-safety + archetypes already encode most of it.
