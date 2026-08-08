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

## Before pushing a diff that touches `client/` — the DoD compiler

`completion-authority` derives its requirements **per-diff**. Touching any
`client/` file (an edit, a rename, even a DELETION) derives an
`operator-walkthrough` requirement, and the `.completion/evidence.json`
entry on `main` was written for a PREVIOUS diff — so an untouched entry is
**stale by definition** and fails the gate.

Rewrite the matching entry to prove THIS diff before pushing. Say what the
operator sees, and if the answer is "nothing", prove it (zero importers,
identical render) rather than asserting it. Preserve the prior entry under
a `...-superseded-<date>` key — the manifest is rolling, not append-only.

Witnessed on #1428: red in 22s on a stale entry, green in 31s once rewritten.

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
- **The exit code lies in two different ways — read the SUMMARY LINE.**
  `pnpm test | tail` reports `tail`'s status (0), not vitest's. And
  `pnpm test; echo "EXIT=$?"` — which this skill used to recommend — is
  no better under `run_in_background`: a compound command reports the
  LAST command's status, so the completion notification said
  **"exit code 0" while 24 files and 234 tests had failed** (2026-08-08).
  Run the command ALONE and read `Test Files … passed/failed`. If no
  summary line was printed at all, the run did not finish — see the
  teardown-crash trap below.
- **`pnpm run verify` can hit a pnpm-bootstrap glitch.** If `verify`
  fails before any of the inner gates run (no actionable output),
  fall back to running each gate individually (check / test / build).
- **The full suite can CRASH AT TEARDOWN and print no summary.** On
  Windows the default pool has ended with `ELIFECYCLE Test failed` after
  every test passed — observed 2026-08-08 with **528 pass markers, 0 fail
  markers, 0 "Failed Tests" banners, and no summary line** (a libuv
  `UV_HANDLE_CLOSING` assertion appeared from a separate script the same
  session). Do not read that as a regression, and do not read it as
  green. Triage by counting markers —
  `grep -cE '^ *(×|❯) '` returning 0 means nothing failed — then re-run
  under `--pool=forks --poolOptions.forks.singleFork=true` for an actual
  summary. **Marker counting is triage; the summary line is the receipt.**
- **Never mutate the working tree while a suite is running.** A
  background suite reads the tree continuously, so a `git checkout`,
  `git stash`, or edit mid-run rewrites files under it and produces
  phantom failures. The tell is that failures cluster in ONE vitest
  project — 2026-08-08: **24 failed files, every one `client/**`, zero
  `server/**`**, and a clean re-run passed 425/425. Wait for the run, or
  branch before starting it.
- **When a fail-open is safe only because another middleware runs
  first, that ORDER is the security control — pin it with a test.**
  `adminProcedure` chains `requireAdminIdentity` (throws FORBIDDEN for
  non-admins) before `requireFreshMfaAndPermission` (which contains a
  deliberate, documented fail-open to pre-RBAC owner when the role row
  is unreadable). The fail-open is correct — choosing `viewer` would let
  a DB hiccup lock the owner out mid-shift, the exact lockout reversed on
  2026-07-16 — but it is safe ONLY because authentication already ran.
  As of 2026-08-08 no test covers that ordering, so a refactor
  reordering `.use()` calls would silently turn an authorization
  fail-open into an authentication one. Assert that the EARLIER gate
  rejects, not just that the later one behaves.
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

## Instrument runs (cage match / ghost replay / any measurement script)

Three instrument-integrity failures in one arc (2026-08-06/07) share a
shape: the measurement lied while every gate stayed green.

- **A liveness probe must exercise the EXACT model/lane/config the
  measured work uses.** The 2026-08-07 cage gauntlet probed the ambient
  default lane (gpt-4o, key present), then burned all 8 seeds against the
  pinned adversary lane (Ollama, key absent). A probe of a different lane
  is a false-green generator. Fixed structurally in #1416
  (`probeBothLanes()`); hold new instruments to the same bar.
- **A run that completed ZERO units of work must exit non-zero.** The
  same gauntlet printed `0 losses` with exit 0 after 0 matches ran.
  Zero-measured must never render as zero-findings.
- **Model lanes must be pinned in the instrument, never ambient.**
  Without `AI_FORCE_OLLAMA` a bare `invokeLLM` resolves to
  `LLM_MODEL || gpt-4o` on OpenAI; with it, EVERY request — explicit
  pins included — flattens onto one model, silently defeating duel
  role-diversity. Pin by Ollama-native substring name (routes with no
  flag); see `AGENT_MODEL` in `scripts/cage-match.ts` and
  `GHOST_AGENT_MODEL` in `server/services/ghostReplay.ts`.

## Running a script that needs real credentials

- **nickstire's `.env` does NOT carry the Ollama key.** `OLLAMA_API_KEY`
  lives in `apps/statenour/.env` locally and on Railway in prod — grep
  proof 2026-08-07: absent from both the primary and worktree nickstire
  `.env`. Inject it per-shell for local instrument runs.
- **Background / `run_in_background` shells inherit NO inline env.**
  Earlier runs worked only because the interactive shell happened to
  carry the key; the fresh background shell had nothing. Set the env in
  the SAME command that runs the script.
- Scripts that need a foreign-app key must fail fast naming its home
  (pattern: `scripts/cage-match.ts` after #1416).

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
