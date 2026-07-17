# Exact next action

PR is open with M1–M3. On operator taps, in order:
1. Merge the PR (deploys registry seams + vault routes).
2. Authorize `pnpm exec tsx scripts/apply-0088-media-registry.mts` (creates media_assets + integration_tokens on prod).
3. GCP: add `https://nickstire.org/api/oauth/drive/callback` to the OAuth client's redirect URIs; then hit `/api/admin/drive-vault/start` and approve.
4. Say the word on render credits → run traj-001 (real generation → rendered-QA verdict → selective repair → registry versions → Drive archive → reconcile clean), which also archives the 19 git-committed masters into the vault and unblocks repo-media-cleanup-001.

Parallel buildable without taps: audio-dead-air-001 (assembly music-bed fix + deterministic audio gate) and generated-404-001 — next milestones on this branch.
