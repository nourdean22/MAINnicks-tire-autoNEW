# Creative-quality long haul — current state

Updated: 2026-07-17T13:45Z · branch `nickstire/creative-quality-lh` off main `4b9d3cac0` (#827)

## Verified facts (do not re-derive)

- Main through #827 merged and deployed (Railway SUCCESS 2026-07-17 09:15 EDT; health OK).
- Migrations 0083–0087 all journaled (idx 96–100). Prod columns for 0086/0087 verified live.
- **Permanence**: S3_BUCKET unset on prod (checked by key name, 113 vars); no Railway volume on the app service; `storagePut` → ephemeral disk. 19 files / 62MB media are git-committed (accidental permanence via Docker image) including the published reel master. `/generated/*` misses return 200 text/html via SPA catch-all.
- **Census**: reel_jobs 63 (59 failed / 2 posted / 2 assembled); creative_genomes 0 rows; inventory 30 pending "30-Day Reels" + 3 published.
- **Published-reel quality (measured)**: audio dead air 7.1s→22.0s (68%); character identity drift (two gremlin designs); caption safe-zone violations; mono 55kbps AAC; per-frame visual quality high; concept distinctive. Full record: QUALITY-BASELINE.json.
- Source clips are 8.0s each (7×8s for a 22s cut).
- Google: nickstire prod already has GOOGLE_OAUTH_CLIENT_ID/SECRET (admin login). statenour's `lib/services/google-oauth.ts` + `drive-api.ts` are the proven refresh-token pattern (read-only there; vault needs write w/ `drive.file` scope).
- ffmpeg/ffprobe 8.1 available on the dev machine; frame extraction + loudness measurement work locally.
- Worktree has no `.env`; inject `DATABASE_URL` from main checkout inline (never print).

## Milestones

| # | Milestone | State |
|---|---|---|
| M1 | Baseline + benchmarks | media_verified |
| M2 | Media registry (0088) | integration_verified (verify:media-registry 10/10 vs real MySQL; prod DDL awaits tap) |
| M3 | Drive Creative Vault | unit_verified (7 mocked-network tests; live round-trip owed after consent) |
| M-audio | Dead-air root cause + fix + render gate | media_verified (REAL-render trajectory: previously-fatal shape now renders 0 gaps, stereo). ROOT CAUSE CORRECTED: beds existed since #253; sidechaincompress ends output at KEY (VO) end → music truncated → apad silence. 'No beds' hypothesis was wrong (ls from reset cwd). |
| M-404 | /generated misses answer 404, not SPA HTML | implemented (post-deploy probe owed) |
| M-caption | Safe-zone width cap + per-line rendering | media_verified (real-pixel cropdetect ≤82% + margins; evidence frame inspected). Two NEW live-defect discoveries: hook ×1.35 could still overflow post-band-sizing; drawtext renders LF as tofu with some fonts — two-line captions had never rendered in prod. |
| M-failures | 94% failure-rate taxonomy | done — 49/59 = dead provider eras (Veo scopes/spend + pre-fix Higgsfield sessions); 9 = watchdog recoveries WORKING; 1 brief-shape. Headline rate is history, not current behavior. |
| M4 | Real QA→repair→archive trajectory | blocked (deploy + 0088 tap + Drive consent + credits) |

## Review gate — first live catches (2026-07-17, PR #828)

The gate's first-ever real PR-event runs produced three findings, all fixed on-branch:
1. Workflow token lacked `pull-requests: read` → FORBIDDEN (permissions block added).
2. Even then, the query's `statusCheckRollup` field needs `checks: read` and one forbidden field NULLS the whole response → field no longer requested in `--skip-ci-check` mode.
3. **The gate then caught a REAL P2**: apply-0088's comment filter silently dropped the first CREATE TABLE (media_assets would never have been created on prod). Fixed + proven on a bare dev db (both tables, 32/5 cols); thread resolved with evidence.

## Last verified commit / suite

- Base: `4b9d3cac0` (suite 2031/0 at #827 gate). Branch suite: **2051 passed / 0 failed** after audio milestone.
