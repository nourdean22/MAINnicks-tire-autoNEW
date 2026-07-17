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
| M1 | Baseline + benchmarks | media_verified (this commit) |
| M2 | Media registry (0088) | in progress |
| M3 | Drive Creative Vault | planned |
| M4 | Real QA→repair→archive trajectory | blocked (deploy + credits + Drive grant) |

## Last verified commit / suite

- Base: `4b9d3cac0` (suite 2031 passed / 0 failed at #827 gate).
