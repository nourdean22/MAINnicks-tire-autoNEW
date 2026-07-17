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
| `REEL_VIDEO_PROVIDER=higgsfield` | provider pin | auto-select prefers Veo when ANY Gemini key exists — a present-but-dead key silently picks Veo, so pin explicitly |
| `HIGGSFIELD_CREDENTIALS_JSON` | **seed only** | the CLI ROTATES tokens on refresh; rotated pairs are persisted to `app_secret_kv.higgsfield_credentials_json`, which is preferred over this var (#798). Re-login only if BOTH die: `higgsfield auth login` (device flow), then paste `~/.config/higgsfield/credentials.json` into this var |
| `RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg fonts-dejavu-core` | runtime system packages | Railway migrated this service to **Railpack, which ignores `nixpacks.toml`** — the ffmpeg declaration there is dead config |
| `GEMINI_API_KEY` | brief generation | works for generateContent even while dead for Veo model access |

No S3 is configured: assembled MP4s live on ephemeral disk at `/generated/reel-<jobId>.mp4`. **Published reels are safe (Meta ingests the video), but local MP4s vanish on every redeploy.**

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
