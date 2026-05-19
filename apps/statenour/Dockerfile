# syntax=docker/dockerfile:1.7
# Statenour web service · Next.js standalone build · multi-stage
# Targets Railway · matches CP5 of MIGRATION_PLAN.md
#
# Stage 1 (deps)    · resolve workspace deps with pnpm@10.4.1
# Stage 2 (build)   · run `next build` · emit .next/standalone/
# Stage 3 (runtime) · minimal Alpine + just the standalone server
#
# Build context: monorepo root (NOT apps/statenour/) so workspace deps resolve.
# Build cmd:  docker build -f apps/statenour/Dockerfile -t statenour-web .
#
# Tier-2-F (2026-05-19): adopted BuildKit cache mounts (`--mount=type=cache`)
# for the pnpm store. Previous workaround was tweaking a "cache-bust comment"
# in this file when a deploy got stuck on a poisoned BuildKit layer. With
# cache mounts, the pnpm store lives in a separate cache filesystem · BuildKit
# can invalidate per-layer without restarting the whole pipeline. If a deploy
# still hangs on COPY checksum, the proper fix is `docker builder prune` on
# the Railway side, NOT editing this comment.

# ── 1 · deps ───────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
# CP5 note: better-sqlite3 was dropped along with dead lib/mastery/db.ts ·
# no native-compile deps required for prod install. Re-add python3+make+g++
# here if a future module needs native compilation.

WORKDIR /repo

# Enable corepack so the package.json pinned pnpm version is used
RUN corepack enable

# Copy workspace manifests first (best Docker layer cache)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/statenour/package.json ./apps/statenour/
COPY apps/nickstire/package.json ./apps/nickstire/
COPY apps/worker/package.json ./apps/worker/
# Tier-2-E: packages/ workspace packages must be declared before install
# so pnpm can resolve `workspace:*` references (currently @nour/utils ·
# add new packages here when they ship).
COPY packages/utils/package.json ./packages/utils/
# Copy patches/ so the pnpm.patchedDependencies entries can apply
COPY apps/statenour/patches ./apps/statenour/patches
COPY apps/nickstire/patches ./apps/nickstire/patches

# Install ONLY the @statenour/web app and its deps · skips nickstire + worker.
#
# NOTE on cache mounts: Railway's BuildKit variant rejects both `--mount=type=
# cache,id=<name>,...` (requires undocumented cacheKey prefix) and `--mount=
# type=cache,target=...` without an id (requires id). Standard BuildKit accepts
# either. Until Railway documents the expected format, ship without the cache
# mount · costs ~30s per deploy in pnpm install time but the build is green.
# Track as Tier-3 optimization · revisit when Railway docs surface the format.
RUN pnpm install --frozen-lockfile --filter @statenour/web...

# ── 2 · build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build
RUN apk add --no-cache libc6-compat

WORKDIR /repo
RUN corepack enable

# Copy resolved node_modules + workspace manifests from deps stage
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/statenour/node_modules ./apps/statenour/node_modules
# Tier-2-E hotfix · packages/utils/node_modules contains the pnpm symlinks
# for clsx + tailwind-merge that @nour/utils depends on. Without this COPY,
# Turbopack/webpack resolving @nour/utils → packages/utils/src/cn.ts then
# fails to find clsx (the resolution starts from packages/utils, not from
# apps/statenour). Found by Railway build f88c3359.
COPY --from=deps /repo/packages/utils/node_modules ./packages/utils/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/statenour ./apps/statenour
# Tier-3 follow-up (2026-05-19): @nour/utils now ships pre-built dist/
# (tsc-emitted .js + .d.ts + sourcemaps) instead of raw .ts source. The
# build step below emits packages/utils/dist/ which the Next.js bundler
# then resolves cleanly under both Bundler and Node16 module resolution.
COPY packages/utils ./packages/utils

# Build @nour/utils first · emits dist/ so statenour's next build can
# resolve the package via its proper exports map (./dist/index.js).
WORKDIR /repo/packages/utils
RUN pnpm run build

# Build the Next.js app · produces apps/statenour/.next/standalone/
# (Cache-mount for .next/cache disabled · Railway BuildKit constraint ·
# see note in deps stage. Tier-3 optimization · revisit later.)
ENV NODE_ENV=production
WORKDIR /repo/apps/statenour
RUN pnpm run build

# ── 3 · runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN apk add --no-cache libc6-compat

# Non-root user for the runtime · standard hardening
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

WORKDIR /app

# Next.js standalone server is self-contained · copy only what the
# server needs at runtime. No pnpm install in this stage.
COPY --from=build --chown=nextjs:nodejs /repo/apps/statenour/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/statenour/.next/static ./apps/statenour/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/statenour/public ./apps/statenour/public

USER nextjs

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080

# .next/standalone produces a `server.js` at the root of its output.
# The standalone build mirrors the source tree, so the file lives at
# apps/statenour/server.js when the monorepo path is preserved.
CMD ["node", "apps/statenour/server.js"]
