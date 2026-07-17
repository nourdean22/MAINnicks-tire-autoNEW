# Decisions (do not relitigate without new evidence)

1. **Execution docs live in `apps/nickstire/docs/execution/creative-quality/`** — repo topology says per-app docs live in-app; root `docs/` is cross-cutting. (Directive named `docs/execution/...`; app-scoped placement honors intent.)
2. **One branch, milestone commits** (`nickstire/creative-quality-lh`), PR opened when a coherent reviewable slice exists; further milestones push to the same PR while open.
3. **Registry architecture**: DB `media_assets` = canonical metadata + lineage. Google Drive = durable human archive. `storagePut` (S3 when configured, else ephemeral local) = runtime delivery. A provider URL is never permanence; `googleDriveSyncState` may only read `synced` after size/metadata verification.
4. **Drive auth**: reuse nickstire's existing `GOOGLE_OAUTH_CLIENT_ID/SECRET` with statenour's refresh-token pattern; scope `drive.file` only (app-created files); token stored server-side; one-time operator consent via `/api/oauth/drive/start`. No new credential system.
5. **Baseline honesty**: scores carry method labels; audio naturalness explicitly NOT evaluated (no listening pass yet); N is small and stated. No fabricated percentages.
6. **62MB git-committed media is NOT removed until Drive archival verifies copies** — it is currently the only surviving copy of the published master (repo-media-cleanup-001 depends on drive-001 + traj-001).
7. **No public publishing in this haul**; acceptance campaigns stop at approval-ready + archived.
8. **Extend, don't duplicate**: no second storage helper, no second campaign state machine; producers integrate registry at existing seams (`assembleReel`, `carouselSlideRenderer`, `storagePut` call sites).
