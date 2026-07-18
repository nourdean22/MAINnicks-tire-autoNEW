# Reel Pipeline · Operator Runbook

**Owner:** operator (Nour)
**Modules:**
- Compiler (Creative Compiler 2.0) · `client/src/lib/facelessReelStudio.ts` · `client/src/lib/creativeThesis.ts` · `server/services/reelBriefGen.ts` · `server/services/genomeGen.ts` · `server/services/conceptTournament.ts`
- Draft prep (retry-on-preflight) · `server/services/reelDraftPrep.ts`
- Visual world / image conditioning · `server/services/visualWorld.ts` · `server/services/referenceFrameScreen.ts` · `server/services/higgsfieldStudio.ts`
- Pipeline (enqueue → render → assemble) · `server/services/reelPipeline.ts` · `server/services/reelAssembly.ts`
- QA gate · `server/services/renderedQa.ts` · `server/services/postQaOrchestrator.ts`
- Governor + policy · `server/services/contentGovernor.ts` · `server/services/autonomyControl.ts`
- Publish door · `server/services/socialPublish.ts`
- Autonomous cron · `server/cron/jobs/dailyReelPost.ts` (tier `reel-pipeline` + `daily-reel-post`, `server/cron/scheduler.ts`)
- On-demand trigger · `POST /api/admin/reel-canary` (`server/routes/adminRoutes.ts`)

**Related:** `docs/execution/creative-compiler/CC2-FINAL-REPORT.md` (build history) · `docs/execution/creative-compiler/PIPELINE-ARCHAEOLOGY.md` (field-loss map)
**Last updated:** 2026-07-18 (live-render acceptance)

## What this enables

A faceless vertical Instagram Reel, generated end-to-end from a topic, with no
human in the loop except an optional approval tap. The chain:

1. **Compile** — a topic becomes a versioned creative brief: Truth → Strategy →
   Concept tournament → Creative Thesis Lock → beat intent → **provider-safe
   scene** (no generated lettering/logos/faces) → deterministic caption overlay.
2. **Preflight (M10)** — a deterministic gate blocks predictable defects
   (in-frame text, "free" claims, faceless violations) **before any spend**.
3. **Render** — 5–6 Higgsfield Seedance 1.5 clips (4s, 1080×1920), optionally
   anchored on a shared hero frame for continuity (image conditioning).
4. **Assemble** — ffmpeg stitches clips + VO + music + gold/black caption
   overlays into a 15–22s 1080×1920 H.264 MP4.
5. **Rendered QA (M11)** — a vision critic scores real frames against the brief;
   returns a publish gate (`proceed` / `needs_operator_override` / …).
6. **Publish** — through the ONE gated door (`publishToSocial`).

**Verified live 2026-07-18** — two defect-free reels posted through this chain:
[reel/Da6vIDnCW05](https://www.instagram.com/reel/Da6vIDnCW05/) (text-to-video)
and [reel/Da64wSMEX5d](https://www.instagram.com/reel/Da64wSMEX5d/) (image
conditioning — one hero tire in one consistent world across every beat).

## Job state machine (`reel_jobs.status`)

```
queued → generating → assets_ready → assembling → assembled → posted
                          ↑______(retry on failure, back to assets_ready)
                                             failed (after MAX_ATTEMPTS)
```

**Read the row, not stdout** — the pipeline reports through the `reel_jobs`
table. A repeated `assets_ready`/`generating` with a set `error` column is a
**failure loop**, not pending. `processNextReelJob` generates ALL clips in one
blocking call (~75s/clip, resumes via `clipUrlsJson`); the pulse advances one
stage per tick.

## On-demand: `POST /api/admin/reel-canary`

Headless driver for one reel through the full chain, with the M11 QA gate
**enforced before publish**. Auth: `Authorization: Bearer $ADMIN_API_KEY`.

> **The `ADMIN_API_KEY` in `apps/nickstire/.env` is STALE (401).** Inject the
> real prod value via `railway run` so it never prints:
> `railway run --service MAINnicks-tire-auto -- bash -c 'curl ... -H "Authorization: Bearer $ADMIN_API_KEY" ...'`

| Action | Body | Does |
|---|---|---|
| `start` | `{action, topic?, maxAttempts?}` | Compile brief (regenerates on a preflight block, `reelDraftPrep`) + attach visual world + enqueue (runs M10 preflight + spend/governor gates). Returns `jobId`, `conditioningMode`, `attempts`, `hook`, `caption`. |
| `advance` | `{action, jobId}` | Pump one bounded render slice (recover + gen + assemble), ≤100s. Call repeatedly until `status` is `assembled`/`failed`. |
| `qa` | `{action, jobId}` | Run rendered QA (M11) → `decision`, `findings`, `publishGate`. |
| `publish` | `{action, jobId, force?}` | Refuse unless the M11 gate returns `proceed` (or `force:true`, audited); post through `publishToSocial`. Returns `igPostId`, `permalink`. |

### Example (drive one reel, prod)

```bash
cd apps/nickstire   # railway is linked from the MAIN checkout, not a worktree
run() { railway run --service MAINnicks-tire-auto -- bash -c "$1"; }

# 1. compile + enqueue (topic optional; default is a pothole concept)
run 'curl -s -X POST https://nickstire.org/api/admin/reel-canary -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_API_KEY" -d "{\"action\":\"start\",\"topic\":\"Bald tires cannot grip wet Cleveland roads\"}"'
# → {"jobId":750001,"conditioningMode":"hero_image","attempts":1,...}

# 2. render — call until status assembled (each call ≤100s; watch the reel_jobs row too)
run 'curl -s -X POST .../reel-canary -H "..." -d "{\"action\":\"advance\",\"jobId\":750001}"'

# 3. QA gate
run 'curl -s -X POST .../reel-canary -H "..." -d "{\"action\":\"qa\",\"jobId\":750001}"'
# → {"decision":"approve","publishGate":"proceed","findings":[]}

# 4. publish (only if publishGate=proceed)
run 'curl -s -X POST .../reel-canary -H "..." -d "{\"action\":\"publish\",\"jobId\":750001}"'
# → {"igPostId":"...","permalink":"https://www.instagram.com/reel/..."}
```

## Autonomous daily reel

`daily-reel-post` cron (`REEL_AUTOPOST_ENABLED=true`) posts one AI-generated reel
per morning. It **enqueues only at ~9am ET** (or the analytics best-posting hour),
renders via the pulse, and **publishes on a later tick** (any hour). Idempotent:
at most once per Cleveland day; on failure the index is not advanced (retries the
same slot). Since #873 it regenerates on a preflight block instead of silently
losing the day's reel.

## Feature flags (Railway · `MAINnicks-tire-auto`)

| Flag | Effect | Default |
|---|---|---|
| `REEL_GENERATION_ENABLED` | pulse renders queued jobs (spend gate) | must be `true` to render |
| `REEL_PUBLISH_ENABLED` | `publishToSocial` reel door | `true` = live posting |
| `REEL_AUTOPOST_ENABLED` | the 9am daily reel cron | `true` = armed |
| `REEL_AUTO_VISUAL_WORLD` | build a hero-frame continuity anchor (locked invariants in every beat) | `true` |
| `REEL_IMAGE_CONDITIONING` | pass the hero frame to Seedance `--start-image` for frame-locked continuity | `true` (verified 2026-07-18) |
| `RENDERED_QA_ENABLED` | enable the on-demand rendered-QA endpoint | `true` |

Toggle: `railway variables --service MAINnicks-tire-auto --set "FLAG=value"`
(triggers a redeploy; wait for `uptime` to reset via `/api/health`).

## Guardrail stack (why an enqueue/publish gets blocked)

`enqueueReelJob` (and the publish door) run these in order — a block here is the
system working, not a bug. All values live in the **latest `autonomy_policy_versions`
row** (append-only; `getActivePolicy` caches **30s**):

| Block code | Rule | Field | Current |
|---|---|---|---|
| `RESERVATION_FEED_CAP` | posts/day | `limits.maxFeedPostsPerDay` | 2 |
| `RESERVATION_SPACING` | hours between feed posts | `limits.minimumFeedSpacingHours` | 3 |
| `REPEAT_CTA` | same CTA within window | (hardcoded 72h) | — |
| `REPEAT_TOPIC` | same topic within window | (hardcoded 7 days) | — |
| `BUDGET_DAILY_EXCEEDED` | daily generation **spend** | `limits.maxGenerationCostPerDayUsd` | $10 |

Preflight (M10) runs **before** the reservation, so a preflight-blocked attempt
leaks nothing. A reservation is created before the spend boundary — an enqueue
that fails *after* reserving (e.g. a DB error) **leaks a reserved slot** that
counts toward the day's cap until released.

### Read / adjust the policy (advanced)

Read-only inspect + a temporary, **append-only** change (30s to take effect on
prod; no restart needed). Always restore the original values.

```js
// railway run --service MAINnicks-tire-auto -- bash -c "NODE_PATH=<app>/node_modules node script.cjs"
const mysql = require("mysql2/promise");
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });
const [r] = await c.query("SELECT version, policy_json FROM autonomy_policy_versions ORDER BY version DESC LIMIT 1");
const p = JSON.parse(r[0].policy_json);
p.limits.maxFeedPostsPerDay = 3;      // e.g. bump; RESTORE after
p.version = r[0].version + 1;
await c.query("INSERT INTO autonomy_policy_versions (version, policy_json, note, created_by) VALUES (?,?,?,?)",
  [p.version, JSON.stringify(p), "temp bump — restore", "operator"]);
```

Release a leaked/stuck reservation:
`UPDATE content_reservations SET status='released' WHERE id='resv_…' AND status='reserved'`.
A POSTED reel can leave its reservation stuck `reserved` — it still legitimately
counts toward that day's cap.

## Image conditioning (frame-locked continuity)

With `REEL_IMAGE_CONDITIONING=true`, `attachAutonomousVisualWorld` generates a
hero frame, screens it (vision QA), and — since #873 — `generateReelClipVideo`
**downloads it to a local temp file** and passes the path to `--start-image`
(the CLI accepts a UUID or a file path, **not a public URL** — that was the bug).
On any download failure it degrades to text-only. Net effect: the same hero
object in the same environment/lighting across every beat.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| enqueue: `Reel preflight blocked (…)` | brief has in-frame text / "free" claim / faceless risk | expected — `reelDraftPrep` regenerates; retry / different topic |
| enqueue: `Blocked by content governor: …` | cap / spacing / repeat | wait the window, or temporarily adjust policy (above) |
| enqueue: `BUDGET_DAILY_EXCEEDED` | daily spend budget hit | resets at Cleveland midnight; or bump `maxGenerationCostPerDayUsd` (money guardrail — restore after) |
| enqueue: DB `Data too long for column 'payload'` | pre-#872 TEXT column | fixed → MEDIUMTEXT (`drizzle/0090`); ensure applied on the target DB |
| render: `--start-image … neither a UUID nor an existing file path` | pre-#873 URL-as-start-image | fixed → local file download; ensure #873 deployed |
| job stuck `generating`/`assets_ready` with `error` | clip-gen retry loop | read `error`; check Higgsfield creds (`hf account status`) / budget |
| `mp4Url` 404 after a redeploy | prod has no S3 → `/generated` local disk, wiped on redeploy | re-render; the IG post itself survives (Meta re-hosts on publish) |
| publish returns HTML / 401 on the canary route | route not deployed / bad key | wait for deploy (`uptime` reset); use `railway run` for the real key |

## Quality gates before declaring a reel good

- [ ] M11 QA `decision: approve` / `publishGate: proceed`, `findings: []`
- [ ] frame check: no garbled text, no faces/hands, no misspelled brand, captions correctly spelled (they are ffmpeg overlays, never Seedance-generated)
- [ ] 1080×1920, 15–22s, has an audio track
- [ ] within the day's cap / spacing / budget
