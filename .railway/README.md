# Railway configuration — `natural-appreciation`

This project's Railway infrastructure is defined in [`railway.ts`](./railway.ts).

**Status: APPLIED 2026-09-18.** `railway config apply` ran against production, the three legacy
`railway.json` files are deleted, and this file is now the single source of truth for build and
deploy config.

Verification immediately after the apply:

```
railway config plan
✓ Your Railway configuration is already up to date.

railway status
  Services   statenour-worker · perplexica · statenour-web · MAINnicks-tire-auto · searxng-perplexica
  Databases  Redis (redis-volume)
  Buckets    nickstire-media
```

All nine resources still present — **nothing was deleted**, which is the risk that actually
mattered: IaC removes any resource omitted from `resources:`.

**2026-09-23 · `perplexica`, `searxng-perplexica` and the 50 GB `perplexica-volume` retired.** The app
stopped calling them in #2599; they were deleted in the dashboard/API and removed from `resources:` here in
the same change, so the next `railway config plan` must read `already up to date` (not "2 to add").
Live inventory after: 3 app services + Redis (redis-volume) + nickstire-media.

---

## Why this exists

`railway.json` / `railway.toml` ("Config as Code") is **deprecated with a hard cutoff of
2026-12-01**. After that date those files stop being read and each service falls back to its
dashboard values — with **no error, no failed deploy, and no diff**.

## ⚠ This file is not a straight `railway config pull`

`railway config pull` imports **live project state**. It does **not** read `railway.json`, because
that file is an override applied at *deploy* time and never written back to the project. A naive
pull-and-commit therefore silently drops every override. Measured 2026-09-18:

| service | pulled `watchPatterns` | `railway.json` | lost |
|---|---:|---:|---:|
| `statenour-web` | 1 | 10 | **9** |
| `MAINnicks-tire-auto` | 1 | 8 | **7** |
| `statenour-worker` | 2 | 8 | **6** |

**22 watch patterns**, including every `packages/**` entry — exactly the defect repaired in #2418
(*"a shared-package change could not trigger the deploy that consumes it"*). It would have reverted
on 2026-12-01 with nothing to notice. Those three arrays were **ported by hand**; everything else is
verbatim live state.

## What was done (2026-09-18)

1. `railway config pull` imported live state — missing the 22 patterns above.
2. The three `watchPatterns` arrays were ported from the `railway.json` files.
3. `railway config plan` → `0 to add, 3 to change, 0 to destroy`.
4. `railway config apply` → 3 services updated; all three rebuilt, none went offline.
5. `railway config plan` again → `already up to date`.
6. The three `apps/*/railway.json` files were deleted — a service cannot be managed by both systems.
7. `scripts/agent-os/railwayWatchCoverage.test.mjs` was rewritten to read **this file** as the
   source of truth. It previously asserted `apps/<app>/railway.json` exists, so step 6 would have
   turned CI red; and it inspected only the JSON, so dropping a `packages/**` entry here would have
   left it green while production silently stopped redeploying on that package. It now also refuses
   when the two sources disagree, which is the only dangerous state during a migration.

## If you need to run it again

The IaC engine ships in the **Railway CLI ≥ 5.42.1**, not the TypeScript SDK:

```bash
npm install -g @railway/cli@latest
```

Run from the **primary checkout**, never a `.worktrees/*` worktree — every `node_modules` there is
an NTFS junction, and a package install inside one offers to wipe the shared tree with the prompt
defaulting to yes.

`railway.ts` imports `railway/iac`, so the `railway` package must resolve from wherever the file is
evaluated (`pnpm add -w -D railway`, or evaluate a copy with `--file` from a directory that has it).

**Always run `railway config plan` and confirm `0 to destroy` before `apply`.**

## 2026-09-23 · region and negated watch paths (not live until applied)

Two hand edits, both gated in `scripts/agent-os/`:

1. **Region.** `MAINnicks-tire-auto` and `statenour-web` now declare `us-east4-eqdc4a`, matching
   the live move made on 2026-09-23 (next to TiDB and Neon in AWS us-east-1). Before this edit an
   apply would have moved both back to `us-west2`. `railwayRegion.test.mjs` pins every service that
   holds `DATABASE_URL` to its database's region, or to a recorded "no DB client" reason.
2. **`!` watch paths.** Docs-only commits no longer redeploy nickstire (`docs/**` except
   `docs/reel-packs`, which the server reads at runtime, and `.remember/**`) or the worker (its
   three `.md` files). `railwayWatchCoverage.test.mjs` fails if any negation could exclude a build
   or runtime input; the proof for each exclusion is in its `NON_INPUTS` comment.

Operator steps, in order:

1. `railway config plan`. Expect exactly 2 changes and `0 to destroy`: the `watchPatterns` of
   `MAINnicks-tire-auto` and of `statenour-worker`. The regions are already live, so they should
   show NO diff. A region line or a `statenour-web` change means live is not what was recorded on
   2026-09-23: stop and check before applying.
2. `railway config apply` at a quiet hour. A watch-pattern change can rebuild the service.
3. `railway config plan` again. It must read *already up to date*.

## Notes

- `.railway/package.json` declares `{"type":"module"}`. The monorepo root has no `type` field, so it
  is CommonJS, and without this the `.ts` file fails to evaluate with *"Cannot use import statement
  outside a module."*
- Every variable renders as `preserve()` — the value Railway already holds is kept and **no secret
  values are in this repo**. Never pipe `railway config plan --show-values` into a log.
- Omitting a resource from `resources:` **deletes it**. Re-run `config pull` into a scratch copy and
  diff before hand-editing.
