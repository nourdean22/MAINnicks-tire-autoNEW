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
# 2026-05-18 cache-bust: 7 commits failed to deploy with persistent
# BuildKit "failed to calculate checksum of ref xlcz1rbthtyc9xz5avtbuesdd"
# (same hash on every retry → bad layer cached on Railway's build infra).
# Tweaking this comment changes the Dockerfile content hash so BuildKit
# starts a fresh cache key. Safe no-op for the build itself.

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
# Copy patches/ so the pnpm.patchedDependencies entries can apply
COPY apps/statenour/patches ./apps/statenour/patches
COPY apps/nickstire/patches ./apps/nickstire/patches

# Install ONLY the @statenour/web app and its deps · skips nickstire + worker
RUN pnpm install --frozen-lockfile --filter @statenour/web...

# ── 2 · build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build
RUN apk add --no-cache libc6-compat

WORKDIR /repo
RUN corepack enable

# Copy resolved node_modules + workspace manifests from deps stage
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/statenour/node_modules ./apps/statenour/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/statenour ./apps/statenour

# Build the Next.js app · produces apps/statenour/.next/standalone/
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
