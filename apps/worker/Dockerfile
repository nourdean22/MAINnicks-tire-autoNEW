# syntax=docker/dockerfile:1.7
# Statenour worker · Express + node-cron · multi-stage
# Targets Railway · matches CP5 of MIGRATION_PLAN.md
#
# Build context: monorepo root (NOT apps/worker/) so workspace deps resolve.
# Build cmd:  docker build -f apps/worker/Dockerfile -t statenour-worker .
#
# Tier-2-F (2026-05-19): adopted BuildKit cache mounts for pnpm store.

# ── 1 · deps ───────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat

WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY apps/statenour/package.json ./apps/statenour/
COPY apps/nickstire/package.json ./apps/nickstire/
# Tier-2-E: packages/utils manifest must be present for workspace resolution.
COPY packages/utils/package.json ./packages/utils/
# Wave 49+CP7 fix · pnpm.patchedDependencies references files in these dirs.
# Even with `--filter @statenour/worker`, pnpm still reads patch files for
# lockfile integrity validation. Without these COPYs install fails with
# ENOENT on the wouter patch path.
COPY apps/nickstire/patches ./apps/nickstire/patches
COPY apps/statenour/patches ./apps/statenour/patches

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @statenour/worker...
# Note · the `...` ellipsis pulls transitive workspace deps. Worker doesn't
# currently import @nour/utils but this future-proofs against silent drops
# in `pnpm deploy --prod` if a future commit adds a workspace dep.

# ── 2 · build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker ./apps/worker
# pnpm deploy in the next stage reads patch files for lockfile integrity ·
# missing these → ENOENT on wouter patch in the deploy step.
COPY apps/nickstire/package.json ./apps/nickstire/
COPY apps/statenour/package.json ./apps/statenour/
COPY apps/nickstire/patches ./apps/nickstire/patches
COPY apps/statenour/patches ./apps/statenour/patches
# Tier-2-E: packages/utils source for worker (declared dep transitively).
COPY packages/utils ./packages/utils

# pnpm install in deps copied the .pnpm/ store + symlinked to it.
# Now compile TS → dist/, then use `pnpm deploy` to produce a self-
# contained, symlink-free deploy artifact at /deploy. Without this,
# the runtime stage gets pnpm symlinks pointing at /repo/node_modules/.pnpm/...
# which doesn't exist in the runtime image → ERR_MODULE_NOT_FOUND on express.
WORKDIR /repo/apps/worker
RUN pnpm run build
RUN pnpm deploy --filter @statenour/worker --prod --legacy /deploy

# ── 3 · runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN apk add --no-cache libc6-compat

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 worker

WORKDIR /app

# /deploy from build stage is self-contained: flat node_modules + dist + package.json.
# No pnpm symlinks → no runtime ERR_MODULE_NOT_FOUND.
COPY --from=build --chown=worker:nodejs /deploy ./

USER worker

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
