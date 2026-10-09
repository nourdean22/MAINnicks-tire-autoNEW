# syntax=docker/dockerfile:1.7
# Statenour worker · Express + node-cron · multi-stage
# Targets Railway · matches CP5 of MIGRATION_PLAN.md
#
# Build context: monorepo root (NOT apps/worker/) so workspace deps resolve.
# Build cmd:  docker build -f apps/worker/Dockerfile -t statenour-worker .
#
# Tier-2-F (2026-05-19): adopted BuildKit cache mounts for pnpm store.

# ── 0 · prune ──────────────────────────────────────────────────────────
FROM node:24-alpine3.23 AS pruner
RUN apk add --no-cache libc6-compat
WORKDIR /app
# turbo here must be the lockfile's turbo (apps/statenour/tests/repo/dockerfile-turbo-pin.test.ts):
# 2.9.14 cannot parse turbo.json's `agentGuidance` (#2936), so every build from 01:43Z on
# 2026-10-09 failed at `turbo prune` and production stayed on #2935.
RUN npm install -g turbo@2.11.6
COPY . .
RUN turbo prune @statenour/worker --docker

# ── 1 · deps ───────────────────────────────────────────────────────────
FROM node:24-alpine3.23 AS deps
RUN apk add --no-cache libc6-compat

WORKDIR /repo
RUN corepack enable

# Copy pruned workspace manifests + lockfile
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./

# Copy patches/ so the pnpm.patchedDependencies entries can apply.
# Only directories that exist in git may be listed here: git drops an empty
# directory, and a COPY of a missing path fails the whole build (2026-09-04
# to 2026-09-07 every statenour-web + worker deploy failed on the deleted
# apps/statenour/patches/). tests/repo/dockerfile-copy-sources.test.ts gates it.
COPY apps/nickstire/patches ./apps/nickstire/patches

RUN pnpm install --frozen-lockfile --filter @statenour/worker...

# ── 2 · build ──────────────────────────────────────────────────────────
FROM node:24-alpine3.23 AS build
WORKDIR /repo
RUN corepack enable

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /repo/packages/reel-engine/node_modules ./packages/reel-engine/node_modules

# Copy full pruned source files
COPY --from=pruner /app/out/full/ ./

# Build reel-engine dependency
RUN pnpm --filter @nour/reel-engine run build

# Compile TS → dist/, then use `pnpm deploy` to produce a self-
# contained, symlink-free deploy artifact at /deploy.
WORKDIR /repo/apps/worker
RUN pnpm run build
RUN pnpm deploy --filter @statenour/worker --prod --legacy /deploy

# ── 3 · runtime ────────────────────────────────────────────────────────
FROM node:24-alpine3.23 AS runtime
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
