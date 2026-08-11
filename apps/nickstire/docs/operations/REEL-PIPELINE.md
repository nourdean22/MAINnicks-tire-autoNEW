# Reel Manufacturing Pipeline — Operations

**Status:** live and verified end-to-end (two reels published through the full chain on 2026-07-16/17: IG posts `18018908711883906`, `17877918753617173`)
**Verified against:** `main` after PR #805 (2026-07-17)

Every claim in this document was observed live during the 2026-07-16/17 arc, not inferred from code. Live behavior overrides this document; update it in the change that alters a contract.

## End-to-end flow

```
Studio wizard (Advanced Reel Studio, admin → Growth → Instagram → Studio)
  → contentAdmin.generateReelBrief        gemini-2.5-flash, two passes (initial + critic), both maxTokens 24576
  → quality gate                          calculateReelQualityScore, min 70/75; server RE-SCORES at enqueue (#781)
  → contentAdmin.enqueueReelJob           creates reel_jobs row + social_content_inventory draft (status generating)
  → cron "reel-pipeline" (pulse tier)     one gen step + one assembly step per pulse; cadence 3-15 min
      generation: queued → generating     one Higgsfield Seedance 1.5 clip per beat (9:16, 4s, 1080p),
                                          per-beat progressive persistence (retry resumes, never re-spends)
      assembly:   assets_ready →          ffmpeg trim/xfade/captions/music → RENDER-INTEGRITY GATE → assembled;
                  assembling → assembled  inventory draft set to review_ready
  → operator approves                     Queue tab → "Reels & legacy drafts" → Approve (instagramAdmin.approveDraft,
                                          requires expectedVersion; ffprobe-validates media + writes hash approval)
  → instagramAdmin.publishPost            verifies approval hashes, claim-checks caption, Meta Graph container
                                          + publish → igPostId; inventory → published
```

## Environment contract (Railway service `MAINnicks-tire-auto`)

| Variable | Role | Notes |
|---|---|---|
| `REEL_GENERATION_ENABLED=true` | arms the cron pipeline | `requiresEnv` gate on the pulse job |
| `REEL_PUBLISH_ENABLED=true` | publish kill-switch | checked inside `publishToSocial` |
| `REEL_VIDEO_PROVIDER` | provider pin | **prod reads `template_stock` (verified 2026-08-11), NOT `higgsfield`** — the paid lane was dropped per "Dropping the paid video provider" below, so reels now render on the free local ffmpeg lane, which is **not draft-first** (see step 3 there). Auto-select prefers Veo when ANY Gemini key exists — a present-but-dead key silently picks Veo, so pin explicitly |
| `HIGGSFIELD_CREDENTIALS_JSON` | **seed only** | the CLI ROTATES tokens on refresh; rotated pairs are persisted to `app_secret_kv.higgsfield_credentials_json`, which is preferred over this var (#798). Re-login only if BOTH die: `higgsfield auth login` (device flow), then paste `~/.config/higgsfield/credentials.json` into this var |
| `RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg fonts-dejavu-core` | runtime system packages | Railway migrated this service to **Railpack, which ignores `nixpacks.toml`** — the ffmpeg declaration there is dead config |
| `GEMINI_API_KEY` | brief generation | works for generateContent even while dead for Veo model access |
| `REEL_FALLBACK_TO_TEMPLATE_STOCK=true` | degrade instead of going dark | when the paid provider returns a `PAUSE_PROVIDER` verdict (plan wall, dead session), render the rest of that reel on the free local ffmpeg lane. **Off by default** — it changes what the shop publishes |

Durable object storage IS configured (verified 2026-08-05): Railway Bucket
`nickstire-media-oq6yt1u22`, wired via `S3_BUCKET` + `S3_ENDPOINT` + `S3_REGION` +
`S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY`. `CLOUDFRONT_DOMAIN` is deliberately
ABSENT: that is exactly the condition under which `usesProxiedReads()` is true and
`publicObjectUrl` hands out permanent links through `{SITE_URL}/generated/{key}`
rather than presigned ones that expire. Assembled MP4s therefore SURVIVE a
redeploy - `reel-1290001.mp4` (12.36 MB) and `reel-1320001.mp4` (15.06 MB) both
still return `200 video/mp4` after three redeploys on 2026-08-05.

This paragraph used to read *"No S3 is configured ... local MP4s vanish on every
redeploy"*. That was true when written and is now false. The same sentence had
been copied into a `template-stock-reel-lane` capability-ledger blocker, where it
outlived its cause and drove a wrong plan a week later. **Re-check the env before
repeating an infrastructure claim you read in a doc.**

## Dropping the paid video provider

Higgsfield is doing two jobs and only one of them is obvious. It generates the
clips **and it hosts them**: `parseResultUrl` returns Higgsfield's own CDN URL, so
a Higgsfield clip never touches our bucket. Cancelling it removes the hosting
too - every other provider re-hosts through `storagePut`.

1. **Storage: already answered.** The bucket above is live, so
   `assertDurableStorageForGeneration` passes and the free lane will not refuse.
   Do NOT set `REEL_ALLOW_EPHEMERAL_STORAGE` - it buys nothing now and it disarms
   a fail-closed guard that exists because prod once lost clips.
2. **Arm the fallback** - `REEL_FALLBACK_TO_TEMPLATE_STOCK=true` (set in prod
   2026-08-05). Reels degrade to the free lane the next time the paid provider
   returns a `PAUSE_PROVIDER` verdict, instead of the job going terminal and the
   account going quiet.
3. **Judge the first one.** No `template_stock` reel has ever been published, so
   whether the format earns reach is unmeasured. **Repair-loop note (2026-08-11):**
   pixel-defect blocks on this lane no longer dead-end in `needs_paid_repair` —
   the repair router now prices a beat regen at the ACTIVE provider's cost
   (`reelClipCostUsd(selectReelVideoProvider())`), so on this $0 lane the gate
   returns `auto_repair` and `dailyReelPost` queues the repair itself through
   `requestBeatRepair` (one-in-flight, cost boundary, and the policy repair cap
   all still enforced there). The repaired job re-assembles, rendered QA
   re-verdicts the NEW mp4, and publish happens only if THAT passes. The
   2026-08-05 job 1410001 sat 39 pulses in `needs_paid_repair` because the
   "paid" label was stamped when regen meant Higgsfield credits — the decision
   layer now reads the same cost truth the execution layer already did. Note that this lane is **NOT
   draft-first**: `cron/jobs/dailyReelPost.ts` sees an `assembled` job and calls
   `publishToSocial` itself, with no approval step - the `approveDraft` gate
   belongs to the admin surface, not this cron. To hold one for review set
   `REEL_PUBLISH_ENABLED=false` and it assembles and waits. Setting
   `REEL_AUTOPOST_ENABLED=false` instead stops generation entirely, because that
   cron both ENQUEUES and PUBLISHES.
4. **Then cancel**, and pin `REEL_VIDEO_PROVIDER=template_stock` so the selector
   stops preferring a provider that is gone.

Also lost on cancellation: `reference_frames` (Visual World hero images, roughly
$0.10 each, `REEL_AUTO_VISUAL_WORLD=true`). The IG autopost image path does *not*
depend on it - that branch routes to the branded-poster renderer.

## Render-integrity gate (#800/#801)

A reel may not become `assembled` until the pipeline proves, on the rendered file:

1. container duration within 0.75s of the storyboard contract (beats + 3s SAVE freeze);
2. **video-stream** duration within 0.75s of the contract — the container reports full length via the AUDIO track even when the video track ends early;
3. ≥ 80% of the expected 30fps frame count (when `nb_frames` is reported);
4. ≥ 3 distinct MD5s among 5 frames sampled across the timeline (**motion proof**).

A violation throws and the job retries/fails loudly. History that made this necessary: `zoompan` (a stills filter) poisoned chained-xfade PTS into a one-frozen-frame render that got published; prod's ffmpeg **5.1** then dropped the `tpad` freeze clones (non-advancing PTS) that local 8.1 rendered fine. Both shapes are permanent regression tests in `reelAssembly.test.ts`.

## Manual forensics recipe ("is the video real?")

```bash
ffprobe -v error -select_streams v -show_entries stream=duration,nb_frames -of compact <url-or-file>
# container format=duration LIES via the audio track — always read the VIDEO stream line
for t in 1 6 12 18 21 24; do ffmpeg -v error -ss $t -i <file> -frames:v 1 -f md5 -; done
# identical MD5s = frozen; d41d8... (empty-string MD5) = no frame decodes there
```

## Recovery procedures (all zero-generation-cost)

- **Re-assemble without re-generating clips:** flip the job `assembled → assets_ready` (CAS on status), clear `error`, `attempts`, `mp4Url`. Clips resume-skip by index from `clipUrlsJson`.
- **Retry a terminal-failed job:** flip `failed → queued` with `attempts: 0`; per-beat persistence resumes at the first missing clip.
- **Session expired mid-run:** fix credentials (above); the job self-retries on the next pulse until `MAX_ATTEMPTS`, then needs the manual flip.
- The pulse's 4-minute budget timing out mid-generation (`CRON_TIMEOUT_LOCK_HELD`) is **benign**: the worker keeps generating past the timeout and every finished beat is already persisted.

## Known limits / open items

- The deterministic carousel overlay renderer does not exist (`textOverlayPlan` has no consumer) — carousel production is deterministic-poster or manual.
- `review_pipeline` is empty because Google Places returns `REQUEST_DENIED` for the configured key (GCP console fix) — until then, `review`/`declined_work` proof sources cannot verify and season/weather/manual briefs must carry LLM-attached proof notes from the accepted families.
- Reel #1 (`18018908711883906`) predates the freeze fix and renders as a held frame; the operator chose to keep it.
- Prod ffmpeg is 5.1 (deb12) vs 8.x locally: **repro locally, but always verify on the prod output** — version drift produced real defects twice in one night.
