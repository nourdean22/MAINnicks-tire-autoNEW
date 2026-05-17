# Statenour worker · Express + node-cron · multi-stage
# Targets Railway · matches CP5 of MIGRATION_PLAN.md
#
# Build context: monorepo root (NOT apps/worker/) so workspace deps resolve.
# Build cmd:  docker build -f apps/worker/Dockerfile -t statenour-worker .

# ── 1 · deps ───────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat

WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY apps/statenour/package.json ./apps/statenour/
COPY apps/nickstire/package.json ./apps/nickstire/
# Wave 49+CP7 fix · pnpm.patchedDependencies references files in these dirs.
# Even with `--filter @statenour/worker`, pnpm still reads patch files for
# lockfile integrity validation. Without these COPYs install fails with
# ENOENT on the wouter patch path.
COPY apps/nickstire/patches ./apps/nickstire/patches
COPY apps/statenour/patches ./apps/statenour/patches

RUN pnpm install --frozen-lockfile --filter @statenour/worker

# ── 2 · build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker ./apps/worker

WORKDIR /repo/apps/worker
RUN pnpm run build

# ── 3 · runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN apk add --no-cache libc6-compat

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 worker

WORKDIR /app

# Worker is much smaller than statenour-web · we copy node_modules + dist
COPY --from=build --chown=worker:nodejs /repo/apps/worker/dist ./dist
COPY --from=build --chown=worker:nodejs /repo/apps/worker/package.json ./package.json
COPY --from=build --chown=worker:nodejs /repo/apps/worker/node_modules ./node_modules

USER worker

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
