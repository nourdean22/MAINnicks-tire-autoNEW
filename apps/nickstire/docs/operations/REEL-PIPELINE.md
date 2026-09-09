# Reel Manufacturing Pipeline — Operations

**Status:** live and verified end-to-end (two reels published through the full chain on 2026-07-16/17: IG posts `18018908711883906`, `17877918753617173`)
**Verified against:** `main` after PR #805 (2026-07-17)

Every claim in this document was observed live during the 2026-07-16/17 arc, not inferred from code. Live behavior overrides this document; update it in the change that alters a contract.

## 2026-08-31 contract update

The approved-pack rotation is a production-input queue, not a topic list.
`dailyReelPost` loads the exact reviewed pack files, hashes and embeds them in
an `episode-contract-v1` snapshot, and refuses topic-only regeneration when the
reviewed input is missing or malformed. `reel_jobs` carries stable episode and
idempotency identity, an explicit queue-state projection, and a
`morning`/`midday`/`evening` production slot. The additive migration
`drizzle/0113_reel_episode_contract_queue.sql` was hand-applied to production
TiDB on 2026-08-31 after deploy `699e54900`; read-back confirmed all seven
columns and the episode-version, idempotency, and queue indexes. Enqueue still
fails closed if all required columns and uniqueness indexes are not readable.

The 30 unmaterialized 2026-08-31 slugs introduced by `27e993fb2` were removed
from the rotation. They may be re-added only with tracked pack directories and
reviewed `brief.json` inputs, so a missing pack cannot permanently pin the
cursor at the first unavailable episode.

Production readiness (`production_ready_at`) is separate from publication
scheduling (`publication_scheduled_at`). The daily producer refills only when
the READY buffer is at or below one episode, targeting three. An assembled
episode still requires the exact-asset + exact-caption human approval row
before the existing `publishToSocial` Meta choke point can run.

Higgsfield API request IDs are persisted before an ambiguous retry. A later
worker polls that same request and does not submit a replacement; only a
provider-reported terminal failure clears the handle for a new attempt.
PySceneDetect is deferred: the current lane already has ffprobe,
render-integrity, and frame-sampling QA, while a Python runtime would add no
contract value until a fixture-backed cut-list adapter exists. The hookup is
specified as: pin the runtime, add `detectSceneCuts(mp4Path)`, compare cuts to
storyboard boundaries in rendered QA, and ship red/green fixtures before
enabling it.

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
| `REEL_VIDEO_PROVIDER` | provider pin | **prod reads `higgsfield`, re-verified live 2026-09-09.** This row previously asserted `template_stock` "(verified 2026-08-11), NOT `higgsfield`" and had been wrong for some time — the paid lane is the one running, so a reel costs money and "Dropping the paid video provider" below is HISTORY, not current state. Re-read it yourself before acting: `railway run -s MAINnicks-tire-auto -- node -e "console.log(process.env.REEL_VIDEO_PROVIDER)"`. Auto-select prefers Veo when ANY Gemini key exists — a present-but-dead key silently picks Veo, so pin explicitly |
| `HIGGSFIELD_CREDENTIALS_JSON` | **seed only** | the CLI ROTATES tokens on refresh; rotated pairs are persisted to `app_secret_kv.higgsfield_credentials_json`, which is preferred over this var (#798). Re-login only if BOTH die: `higgsfield auth login` (device flow), then paste `~/.config/higgsfield/credentials.json` into this var |
| `RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg fonts-dejavu-core` | runtime system packages | Railway migrated this service to **Railpack, which ignores `nixpacks.toml`** — the ffmpeg declaration there is dead config |
| `GEMINI_API_KEY` | brief generation | works for generateContent even while dead for Veo model access |
| `REEL_FILM_GRAIN` | optical finish | `true` since 2026-09-09. Adds moving LUMA-plane grain (`FILM_GRAIN_STRENGTH`, currently 8) plus a `PI/12` vignette to the final encode, before the caption overlay so burned-in text stays clean. Applied at ASSEMBLY, so it changes the next reel assembled and never an already-assembled one. Exact-match on `"true"`: a flag that arms on `1` or `yes` is a flag that arms by accident, and this one alters every published frame |
| `REEL_AUTO_VISUAL_WORLD` | approved reference frame | `true` in prod (verified 2026-09-09). Load-bearing: when a reel carries a visual world, `buildReelContinuityBlock` returns its locked invariants EARLY and never reaches its own `LENS_PALETTES` line, so `visualWorld.ts` is the file that decides that reel's palette |
| `REEL_FALLBACK_TO_TEMPLATE_STOCK` | legacy compatibility flag | Paid-provider failures remain non-publishable (`needs_regen`); the former silent stock fallback is removed. Do not use this flag to bypass exact-asset QA or human approval. |

## Meta publishing contract

The live social handoff uses the existing Meta Graph rail in
`server/services/metaSocial.ts` through `publishToSocial()`. Do not create a
parallel browser-upload path for production reels.

Required configuration is `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID`, and
`META_PAGE_ID`. The service may reload the page token from the durable
`app_secret_kv` record `meta_page_access_token`, so an environment-variable
check alone is not a complete disarm or readiness check. Never print token
values; report only presence and safe account-readback status.

Before a live post:

1. Confirm the final MP4 passed rendered-media QA and has human approval.
2. Confirm the video is available at a permanent public HTTPS URL. Meta cannot
   fetch a local Windows path. Use the configured durable media bucket and its
   public object URL for assembled reels.
3. Make a read-only Graph identity check for the configured Instagram account.
4. Create the `REELS` container with `share_to_feed: true`, then poll until
   `status_code=FINISHED`.
5. Call `media_publish` once. A timeout or lost response is `publish_ambiguous`;
   reconcile recent media or the publish-attempt ledger before considering a
   retry.
6. Record the returned media ID and read-back permalink in the content ledger.
   A container ID without those receipts is not proof of publication.

For explicit Facebook targets, use the same approved master through the
existing social publisher and record the Facebook post ID separately. Do not
publish from a recurring batch unless the task explicitly authorizes it and
the approval gate is satisfied.

## Creative quality floor

The Reel product is motion-first. A single image, static poster, Ken-Burns
zoom, or repeated loop with voiceover is not a finished Reel and must not pass
the publish gate.

Every publishable reel must show 5-8 purposeful visual beats across roughly
20-35 seconds, at least 4 distinct video source clips (or 5 verified motion
beats), a visual change about every 1.5-2.5 seconds, and at least one physical
action. The sequence should include a hook, symptom/detail, explanation or
cutaway, consequence/proof, safe action, and branded CTA ending. Captions and
logos are composited in post; voiceover is an audio layer, not a replacement
for footage.

The image-only routes in `server/services/igAutopost.ts` are not a valid
finished-Reel fallback. Prefer the real motion route in
`server/services/higgsfieldStudio.ts` (`generateReelClipVideo` -> Seedance /
Higgsfield, then `stitchVideos`) and use lower-cost motion routes for support
beats. If multi-shot motion cannot be produced or verified, stop at draft /
production-ready status and do not publish.

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
2. **Do not arm a silent fallback.** Paid-provider failures remain
   non-publishable and surface as `needs_regen`; the operator must reconcile the
   provider and explicitly regenerate.
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
   layer now reads the same cost truth the execution layer already did. The
   daily cron requires a live `reel_publish_approvals` row bound to the exact
   caption and exact MP4 before calling `publishToSocial`; missing or unreadable
   approval holds the job. `REEL_PUBLISH_ENABLED=false` remains an independent
   publish kill switch. Setting
   `REEL_AUTOPOST_ENABLED=false` instead stops generation entirely, because that
   cron both ENQUEUES and PUBLISHES.
4. **Then cancel**, and pin `REEL_VIDEO_PROVIDER=template_stock` so the selector
   stops preferring a provider that is gone.

Also lost on cancellation: `reference_frames` (Visual World hero images, roughly
$0.10 each, `REEL_AUTO_VISUAL_WORLD=true`). The IG autopost image path does *not*
depend on it - that branch routes to the branded-poster renderer.

## Cron budgets — a lane can fail purely because it inherited the default

Tier jobs race against `jobTimeoutMs(job)`, which falls back to
`DEFAULT_JOB_TIMEOUT_MS` (4 min). That default is sized for the database-only
jobs that make up most of the estate. A lane that waits on a PROVIDER needs its
own budget or it fails on the clock while the handler is still working:

| job | budget | why |
|---|---|---|
| `reel-pipeline` | 14 min | renders ~5 clips at ~90s each; measured ~11 min 2026-09-08 |
| `ig-autopost` | 10 min | generates an image AND uploads it to Meta — two third-party round trips. Was failing 20 of 703 runs on the 4-min default (measured over 7 days, 2026-09-09) |

**The upper bound is the tier's own cadence** (pulse = 15 min). Over it, a slow
run still holds its cross-dyno lock when the next pulse fires, and the pulse
skips — that shape cost roughly an hour of dead pipeline after a deploy.

## Where to look first — Pipeline health

**Instagram admin → gear menu → "Pipeline health"** (`?igview=pipeline`),
backed by `instagramAdmin.reelPipelineHealth` → `server/services/reelPipelineHealth.ts`.
Read-only; it issues SELECTs and nothing else.

It answers, without a database client: the 30-day forward schedule with the
**first day that has nothing to post** called out, measured hook performance
(`reels_skip_rate` per published reel, best and worst), the queue by state,
cost per PUBLISHED reel, and the health of the three lanes.

Two things it will tell you that are easy to get wrong by eye:

- **A queue of finished reels is not a stuck queue.** On 2026-09-09, 32 reels sat
  `assembled` and looked like idle inventory; they were a scheduled run with no
  gaps for 28 days. Read the dates, not the count.
- **The screen says UNKNOWN rather than zero when the read fails.** An empty
  schedule and a failed query look identical once they reach a chart.

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
