---
name: verifier-reel-pipeline
description: Runtime-verify changes to nickstire's Instagram reel pipeline — reelVoice, reelAssembly, reelPipeline, reelBriefGen, or the reel-pipeline cron. Use this whenever you are asked to verify, test end-to-end, or observe the real behavior of anything under apps/nickstire/server/services/reel*, or when a change affects how reel jobs move through queued → generating → assets_ready → assembling → assembled. Read this BEFORE attempting to run the pipeline locally: it documents a live-production hazard (the repo's only DATABASE_URL points at prod TiDB) and a live-publish endpoint that will post to the real Instagram account. Also use it when a reel-pipeline verification looks blocked — it records exactly which paths are dead ends and why.
---

# Verifying the nickstire reel pipeline

This skill exists because reaching reel-pipeline code at runtime is genuinely
hard here, and the two obvious ways to do it are both dangerous. Read the
hazards before you run anything.

## Hazards — read first

**1. The repo's only `DATABASE_URL` is production TiDB.**
`apps/nickstire/.env` (in the main repo, not in harness worktrees) points at
`gateway01.us-east-1.prod.aws.tidbcloud.com`. There is no local or dev database
configured. This matters more than it looks: `processNextAssemblyJob` does not
read passively — it **selects a real `assets_ready` job and atomically claims
it** (`assets_ready → assembling`, `reelPipeline.ts:293-298`), then downloads
clips, runs ffmpeg, uploads to S3, and writes `assembled`. Running the pipeline
"just to look" mutates real operator work. Never point a verification run at the
repo `.env`.

**2. `contentAdmin.generateAndPublishLiveTestReel` publishes to live Instagram.**
`routers/content.ts:1550` — one `adminProcedure` call runs 5 LLM generation
attempts, generates Veo clips (real money), and then calls `publishToSocial`.
`scripts/run-live-test-reel.ts` invokes it with `dryRun: false`. Do not use
either as a verification handle, however convenient they look.

**3. Docker is not a way out on this machine (verified 2026-07-16) — and you
don't need it.** `docker --version` works (the CLI is installed) but the daemon
never starts: `wsl --list -v` reports **no installed distributions**, and Docker
Desktop's Windows backend needs WSL2. The safe target is `scripts/dev-db.mjs`
(mysql-memory-server, user-space, no admin) — see "Standing up a safe target"
below, which is a verified recipe.

## The surface map

The reel modules are internal — nothing calls `generateVoiceover` or
`assembleReel` from a CLI or a route directly. Verified call chain:

```
cron "reel-pipeline"            scheduler.ts:552   gated by REEL_GENERATION_ENABLED
  └─ processNextAssemblyJob()   reelPipeline.ts:267
       └─ assembleReel()        reelAssembly.ts  (called at reelPipeline.ts:308)
            ├─ downloads clipUrls to workDir     reelAssembly.ts:~450
            └─ generateVoiceover()               reelAssembly.ts:460
```

Dead ends, so you don't re-check them:

- No VO-preview endpoint exists. You cannot hear a voice without a full clip
  generation — that gap is itself a known finding, not something you missed.
- `scratch/gen-vo.ts` (and its `-google` / `-11labs` / `-openai` siblings) are
  standalone precursors. They do **not** import `services/reelVoice`; running
  them proves nothing about it.
- `scratch/assemble-reel.ts` is pure ffmpeg over a pre-existing `vo.wav`. It
  never calls `generateVoiceover`.
- `routers/content.ts` imports `processNextAssemblyJob` only inside
  `generateAndPublishLiveTestReel` (hazard 2). There is no "assemble job N"
  procedure.

## Preconditions for `processNextAssemblyJob` to do anything

It returns `{processed: false}` and silently does nothing unless all hold:

| Requirement | Where | Note |
|---|---|---|
| `REEL_GENERATION_ENABLED === "true"` | reelPipeline.ts:273 | exact string |
| `getDb()` returns a client | reelPipeline.ts:277 | **not** the prod URL |
| a `reel_jobs` row with `status = 'assets_ready'` | reelPipeline.ts:285 | oldest by `createdAt` |
| that row's CAS claim wins | reelPipeline.ts:293-298 | `affectedRows === 1` |
| `clipUrlsJson` parses to a non-empty array | reelPipeline.ts:304-305 | else throws |

A silent `{processed:false}` is the most likely outcome of a botched setup —
if nothing happens, walk this table before assuming the change is at fault.

## Standing up a safe target — VERIFIED RECIPE (ran end-to-end 2026-07-16)

The whole path is scripted. Two entry points:

**Just verify the VO gate** (the canonical example — boots DB, applies schema,
serves a real clip, seeds jobs, drives the real cron stage, prints a verdict):

```bash
pnpm exec tsx scripts/verify-reel-vo.mts     # from apps/nickstire
```

**Any other pipeline verification** — get a disposable DB and build on it:

```bash
node scripts/dev-db.mjs                      # prints a DATABASE_URL, Ctrl-C tears down
# or programmatically:
#   import { startDevDb } from "./scripts/lib/dev-db.mjs";
#   const { url, stop } = await startDevDb();
```

`startDevDb()` uses `mysql-memory-server` (nickstire devDependency — no Docker,
no admin; downloads a MySQL 8 binary on first run, ~150MB, cached after; boots
in ~8s) and applies the FULL schema via `drizzle-kit push` (~5s, 127/127
tables).

**The `search_performance` trap** (cost this recipe its first two attempts):
a naive `drizzle-kit push` on stock MySQL 8 dies with *"Specified key was too
long; max key length is 3072 bytes"* — `idx_search_perf_page` indexes
`page varchar(1000)` = 4000 bytes utf8mb4. Prod TiDB allows it; vanilla MySQL
does not, and push is sequential, so it silently yields **87 of 127 tables**
(everything alphabetically after the failure never lands, including
`social_content_inventory`). `startDevDb()` pre-creates that one table with a
`page(768)` prefix index so push skips it and completes. If the table count
guard in `scripts/lib/dev-db.mjs` ever trips, reconcile its shim with
`drizzle/schema.ts`.

Remaining ingredients (all verified):

- Serve a real mp4 over local HTTP as the clip URL — the repo ships
  `data/generated/clip-30008-1.mp4` (~1 MB). Assembly downloads clips *before*
  the VO call, so a fake URL fails earlier than the code you care about.
  `verify-reel-vo.mts` shows the ~10-line http.createServer pattern.
- ffmpeg is on PATH (Gyan build via winget) — a 1-beat job assembles in ~1.3s.
- Seed shape: see `verify-reel-vo.mts` (`briefId` notNull, `status =
  'assets_ready'`, payload = `ReelAssemblyBrief` from reelAssembly.ts:26,
  `clipUrlsJson` = JSON array).
- With no S3 creds, `storagePut` saves to `data/generated/` and returns a
  `https://nickstire.org/generated/...` URL — that is legitimate, not a bug:
  `/generated` is statically served (server/_core/index.ts:149). **Delete the
  emitted `reel-N.mp4` after a run** — `data/generated/` is NOT gitignored.

## What to observe

The pipeline reports through the job row, not stdout — read `reel_jobs` after
each pulse. That row *is* your evidence; capture it.

| Change under test | Drive | Expect |
|---|---|---|
| VO fail-closed (`reelVoice.ts`) | pulse with a `voiceoverScript` and no TTS creds | job → `assets_ready` (retry) then `failed` after `MAX_ATTEMPTS`, `error` naming the missing provider. **Not** `assembled` |
| VO opt-out | same + `REEL_VO_OPTIONAL=true` | job → `assembled`, silent mp4 |
| deliberately silent reel | payload with no `voiceoverScript` | job → `assembled`, no throw |
| assembly/ffmpeg changes | pulse a well-formed job | `assembled` + `mp4Url`; probe the mp4 with ffprobe for 1080x1920 / audio track |

Retry semantics are load-bearing when you read a result: on failure the job goes
back to `assets_ready` (clips are already generated) and only reaches `failed`
at `MAX_ATTEMPTS` (`reelPipeline.ts:326-330`). One pulse showing `assets_ready`
is a *failure*, not a pending success — check the `error` column.

## Probes worth running

The change points at these; they cost one extra pulse each:

- Empty `voiceoverScript` (`""` vs absent) — does it take the silent path or
  the throw path? The distinction is `.trim()` truthiness.
- `REEL_VO_OPTIONAL` set to something other than `"true"` (`"1"`, `"yes"`) —
  the check is an exact string compare, so these should *not* opt out.
- Two pulses against one job — the CAS should make the second a no-op.

## Worktree setup (harness worktrees)

Worktrees under `.claude/worktrees/` are created by the harness, not by
`scripts/worktree-setup.ps1`, so they lack two things the app needs:

- **`node_modules` junctions** → `pnpm exec vitest`/`tsc` fail with "not
  recognized". Fix with `mklink /j` from the main repo for the root, each
  `apps/*`, and each `packages/*`.
- **`.env`** → only `.env.example` is present. This is accidentally protective
  (see hazard 1) — supply a scoped env for your run rather than copying the
  real one in.

## Reporting

If you cannot stand up a database, the honest verdict is **BLOCKED**, and say
so — the pipeline has no runtime surface without one. Do not substitute
`vitest` or `typecheck` output and call it verification; the reel modules have
good unit coverage precisely because the runtime path is this hard to reach,
and passing tests here have never proven the pipeline works.
