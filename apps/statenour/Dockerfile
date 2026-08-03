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

# ── 0 · prune ──────────────────────────────────────────────────────────
# ALPINE PINNED DELIBERATELY — do not relax to bare `node:24-alpine`.
# The runtime stage installs python3 from the alpine repos for the vendored
# MoneyPrinter tool, so the ALPINE release decides the PYTHON version:
#   alpine 3.23 -> python 3.12.13   (litellm requires >=3.10,<3.14)  OK
#   alpine 3.24 -> python 3.14.5    -> "No matching distribution found for
#                                       litellm==1.86.2" and the build dies.
# `node:24-alpine` floats to the newest alpine, which is how the Node 20->24
# bump broke a PYTHON dependency and failed the statenour deploy (2026-08-03).
FROM node:24-alpine3.23 AS pruner
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo@2.9.14
COPY . .
RUN turbo prune @statenour/web --docker

# ── 1 · deps ───────────────────────────────────────────────────────────
FROM node:24-alpine3.23 AS deps
RUN apk add --no-cache libc6-compat

WORKDIR /repo

# Enable corepack so the package.json pinned pnpm version is used
RUN corepack enable

# Copy pruned workspace manifests + lockfile
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./

# Copy patches/ so the pnpm.patchedDependencies entries can apply
COPY apps/statenour/patches ./apps/statenour/patches
COPY apps/nickstire/patches ./apps/nickstire/patches

# Prisma 7's `postinstall: prisma generate` (apps/statenour) needs the schema
# AT INSTALL TIME.
COPY apps/statenour/prisma/schema.prisma ./apps/statenour/prisma/schema.prisma

RUN pnpm install --frozen-lockfile --filter @statenour/web...

# ── 2 · build ──────────────────────────────────────────────────────────
FROM node:24-alpine3.23 AS build
RUN apk add --no-cache libc6-compat

WORKDIR /repo
RUN corepack enable

# Copy resolved node_modules + workspace manifests from deps stage
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/statenour/node_modules ./apps/statenour/node_modules
COPY --from=deps /repo/packages/utils/node_modules ./packages/utils/node_modules
COPY --from=deps /repo/packages/lenses/node_modules ./packages/lenses/node_modules
COPY --from=deps /repo/packages/social-assets/node_modules ./packages/social-assets/node_modules
COPY --from=deps /repo/packages/ai-capabilities/node_modules ./packages/ai-capabilities/node_modules

# Copy full pruned source files
COPY --from=pruner /app/out/full/ ./

# Build dependencies first
RUN pnpm --filter @nour/utils run build
RUN pnpm --filter @statenour/lenses run build
RUN pnpm --filter @nour/social-assets run build
RUN pnpm --filter @nour/ai-capabilities run build

# Build the Next.js app · produces apps/statenour/.next/standalone/
ENV NODE_ENV=production
WORKDIR /repo/apps/statenour
RUN pnpm run build

# ── 3 · runtime ────────────────────────────────────────────────────────
FROM node:24-alpine3.23 AS runtime
RUN apk add --no-cache libc6-compat python3 ca-certificates ffmpeg imagemagick py3-pip py3-wheel \
 && pip install --no-cache-dir --break-system-packages \
      moviepy==2.2.1 \
      edge-tts==7.2.7 \
      fastapi==0.136.3 \
      uvicorn==0.32.1 \
      openai==2.24.0 \
      loguru==0.7.3 \
      google-generativeai==0.8.6 \
      requests==2.33.1 \
      pydub==0.25.1 \
      litellm==1.86.2 \
      toml \
      python-multipart==0.0.27 \
      pyyaml==6.0.3 \
      yt-dlp==2025.1.15

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
