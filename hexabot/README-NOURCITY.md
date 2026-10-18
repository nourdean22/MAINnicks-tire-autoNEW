# Hexabot (vendored, not deployed)

- Upstream: https://github.com/hexabot-ai/Hexabot at tag `v3.5.0` (commit `3c5473d1f0a3c99f47a2c88cb6e8bd1e9b2e9e5e`), shallow clone, `.git` removed.
- Vendored 2026-10-18 by operator decision (see `docs/UPSTREAMS.md`). Same pattern as `MoneyPrinterTurbo/` and `ad-factory/`: a folder at the repo root, outside the pnpm workspace globs (`apps/*`, `packages/*`).
- Removed from the copy: `.github/`, `.husky/` and every upstream `AGENTS.md` (the root one and the seven under `packages/*`), so upstream CI, git hooks and agent policy do not apply to this repo. Shell scripts keep their executable bit.
- Node: `@hexabot-ai/cli` 3.5.0 needs Node >= 24.17.0 and `rea-agents` 6.5.0 needs ^22.19.0, ^24.11.0 or >= 26 (Node 25 is out). The root `engines` stays `>=24.0.0` because it also governs the deployed apps; on Node 24.0-24.16 the Hexabot CLI will not run.
- **Not deployed.** No Railway service, no domain, no secret in this repo. Nothing in `apps/` imports it.
- License: upstream reports NOASSERTION to the GitHub API; read `LICENSE.md` before any customer-facing use.

## Start it locally (needs Docker; this machine had none on 2026-10-18)

1. Install Docker Desktop yourself (system change; agents do not do this).
2. From this folder: `copy docker\.env.example docker\.env` and edit the values. Never commit `.env`.
3. `docker compose -f docker/docker-compose.yml --env-file docker/.env up -d` starts `api` (port 3000), `frontend` (port 8080) and `postgres` (16). The compose file pulls `hexastack/hexabot-api:latest` and `hexastack/hexabot-ui:latest`, which are unpinned; pin them before relying on it.
4. Stop: `docker compose -f docker/docker-compose.yml --env-file docker/.env down`.

The CLI path from upstream's README also works without this folder: the root `package.json` carries `@hexabot-ai/cli` as a devDependency, so `pnpm exec hexabot --help` runs it.

## Remove

Delete this folder and run `pnpm remove -w @hexabot-ai/cli`.
