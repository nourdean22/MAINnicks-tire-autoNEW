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
# @nour/reel-engine manifest · worker's src/scheduler.ts imports renderReelVideo.
COPY packages/reel-engine/package.json ./packages/reel-engine/
# Wave 49+CP7 fix · pnpm.patchedDependencies references files in these dirs.
# Even with `--filter @statenour/worker`, pnpm still reads patch files for
# lockfile integrity validation. Without these COPYs install fails with
# ENOENT on the wouter patch path.
COPY apps/nickstire/patches ./apps/nickstire/patches
COPY apps/statenour/patches ./apps/statenour/patches

# NOTE · cache-mount disabled (Railway BuildKit rejects both id-less and
# unprefixed-id forms · see apps/statenour/Dockerfile comment for context).
# The `...` ellipsis pulls transitive workspace deps · future-proofs against
# silent drops in `pnpm deploy --prod` if a future commit adds a workspace dep.
RUN pnpm install --frozen-lockfile --filter @statenour/worker...

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
# Tier-2-E: packages/utils source present for pnpm workspace symlink
# resolution. We do NOT run the tsc build here because:
#   1. Worker does not import @nour/utils today (verified · no code
#      reference). The `...` filter pulls it as a transitive workspace
#      dep but the dist/ artifact is unused at worker runtime.
#   2. Running `pnpm run build` in this stage fails with `tsc: not found`
#      because packages/utils/node_modules wasn't copied from deps · we
#      don't need it for the worker so don't pay the cost.
# If worker ever imports @nour/utils in the future, add:
#   COPY --from=deps /repo/packages/utils/node_modules ./packages/utils/node_modules
#   WORKDIR /repo/packages/utils
#   RUN pnpm run build
COPY packages/utils ./packages/utils
# @nour/reel-engine - worker's src/scheduler.ts imports renderReelVideo at
# RUNTIME, so (unlike @nour/utils above, which is copied-but-not-built because
# the worker never imports it) reel-engine MUST be built to emit dist/ before
# the worker's tsc - else `error TS2307: Cannot find module '@nour/reel-engine'`.
# Broke statenour-worker deploys from 2026-06-23 (#305) onward.
COPY --from=deps /repo/packages/reel-engine/node_modules ./packages/reel-engine/node_modules
COPY packages/reel-engine ./packages/reel-engine
WORKDIR /repo/packages/reel-engine
RUN pnpm run build

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

# Add Chromium and dependencies for Remotion
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

ENV REMOTION_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

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
