---
name: nickstire-verify
description: Use before committing or pushing changes to the nickstire app (apps/nickstire/) — the real local verification sequence, the brand-voice linter false-positive trap, and the prerender regen rule.
---

# nickstire-verify

Verify a nickstire change is safe to commit/push. The master gate is
`pnpm run verify`, but it has a few non-obvious traps that have burned
multiple sessions.

## Run, in order (from `apps/nickstire/`)

1. `pnpm run check` — `tsc --noEmit`. Must be 0 errors.
2. `pnpm test` — vitest. Must end `Test Files N passed (N)`, exit 0.
3. `pnpm run build` — `vite build` + esbuild server + maybe-prerender.
4. (full gate) `pnpm run verify` — env + check + lint + source-lint +
   hooks-lint + route-validate + tests + build.

## Traps

- **Brand-voice linter on CSS class names.** The pre-commit
  `brand-voice` linter regex-matches banned words (`premium`, `tier`,
  etc.) in the staged diff — including CSS class names. The
  project-wide Tailwind utility `btn-premium` appears in 5+ existing
  files but triggers the lint when added in a new diff. The lint
  message itself suggests `git commit --no-verify` — DO NOT. The
  correct fix is to edit the **newly-added** content: rephrase
  comments and remove `btn-premium` (or any flagged utility) from
  newly-added classNames. Pre-existing usages stay untouched (the
  linter only checks the staged diff).
- **`pnpm test | tail` masks the exit code.** A piped command's exit
  status is `tail`'s (0), not vitest's. Read the actual
  `Test Files … failed` summary line, or run `pnpm test; echo "EXIT=$?"`
  with no pipe.
- **`pnpm run verify` can hit a pnpm-bootstrap glitch.** If `verify`
  fails before any of the inner gates run (no actionable output),
  fall back to running each gate individually (check / test / build).
- **Migrations are hand-applied SQL.** After editing
  `drizzle/schema.ts`, generate / hand-write the `drizzle/NNNN_*.sql`
  migration and apply it to the DB before re-running `pnpm run check`.
  There is no auto-migrate. The check fails until the migration is
  applied.
- **Prerender is generated, not hand-edited.** Changes to nav, SEO,
  NAP, or page copy that should appear in `prerendered/*.html` need
  `pnpm run prerender` (or `PRERENDER_ON_BUILD=1 pnpm run build`).
  CI audits this. The SPA hydrates on top of prerendered HTML — so a
  nav change reaches users via the JS bundle immediately, but the
  prerendered HTML (what crawlers see) stays stale until regen.
- **`pnpm run lint:hooks` audits hook-after-early-return.** A hook
  called after an `if (...) return null` silently breaks React. The
  lint catches it; don't bypass.
- **`pnpm run validate:routes` confirms registered routes match
  handler files.** Run after adding / removing routes.

## Multi-session push protocol

`main` is shared between concurrent Claude sessions (e.g., nickstire
+ statenour). On a push:

1. `git fetch origin` first.
2. Read `git log origin/main..HEAD --oneline` to see all unpushed
   commits — including the **other** session's. Whoever pushes carries
   everyone's committed work.
3. The pre-push hook runs `turbo run build --filter=...[$UPSTREAM]`
   for **both apps**. If the other session has a broken build in its
   working tree, your push is also blocked. Do NOT `--no-verify`
   (that's the gate stopping a broken deploy).
4. Don't rewrite shared history (disrupts the other session).
5. If blocked by the other app, surface to the operator with a
   self-contained prompt for that session to fix and push.

## Deploy verification

After a successful push:
1. `curl -s https://nickstire.org/api/health` returns `uptime` in
   seconds since the container started. A successful redeploy resets
   it. Poll uptime; when it drops to a low value, the new container
   is serving.
2. Browser caches OLD JS bundles aggressively. Verify a deploy by
   either (a) `curl` for the actual bundle and grep for new strings,
   or (b) hard-reload with `?cb=fresh` query param to force a clean
   load.
3. Railway watch-paths are per-app: `apps/nickstire/**` triggers a
   nickstire redeploy only; `apps/statenour/**` triggers statenour.
   A test-only file under `apps/nickstire/` still triggers a redeploy
   (bundle is identical, but container restarts).
