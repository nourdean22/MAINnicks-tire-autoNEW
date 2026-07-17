# Exact next action

PR #828 is open with M1–M3 + the dead-air fix + /generated 404 honesty. On operator taps, in order:
1. Merge #828 (deploys registry seams, vault routes, audio fix, 404 fix).
2. Authorize `pnpm exec tsx scripts/apply-0088-media-registry.mts` (additive: media_assets + integration_tokens).
3. GCP: add `https://nickstire.org/api/oauth/drive/callback` to the OAuth client's redirect URIs; then `/api/admin/drive-vault/start` → approve (drive.file only).
4. Say the word on render credits → traj-001: real generation → first real rendered-QA verdict → selective repair → registry versions → Drive archive → reconciliation clean. The render also live-confirms the dead-air fix (the gate refuses any regression). Then vault the 19 git-committed masters and unblock removing 62MB from git.

Post-deploy probes (no tap needed, I run them): `/generated/definitely-not-real-xyz123.mp4` → must be 404 now; a fresh render's silencedetect → no gaps.

Next buildable without taps: caption-safezone-001 (verify current renderer against the baseline violation, then width-measurement enforcement), failure-rate-001 (classify the 59 failed jobs, read-only).
