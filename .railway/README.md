# Railway configuration — `natural-appreciation`

This project's Railway infrastructure is defined in [`railway.ts`](./railway.ts).

**Status: PREPARED, NOT APPLIED.** The file is verified and committed; the `apply` is an
operator action. Nothing in this directory has changed the live project yet.

---

## Why this exists

`railway.json` / `railway.toml` ("Config as Code") is **deprecated with a hard cutoff of
2026-12-01**. After that date the three `railway.json` files in this repo stop being read and each
service falls back to its dashboard values — with **no error, no failed deploy, and no diff**.

Three files are affected:

| file | service |
|---|---|
| `apps/statenour/railway.json` | `statenour-web` |
| `apps/nickstire/railway.json` | `MAINnicks-tire-auto` |
| `apps/worker/railway.json` | `statenour-worker` |

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
on 2026-12-01 with nothing to notice. Those three arrays in `railway.ts` are **ported from the
`railway.json` files on purpose**; everything else is verbatim live state.

## Verification already done

```
railway config plan
Plan: 0 to add, 3 to change, 0 to destroy
  ~ Update statenour-worker      build.watchPatterns
  ~ Update MAINnicks-tire-auto   build.watchPatterns
  ~ Update statenour-web         build.watchPatterns
```

**`0 to destroy` is the safety proof.** IaC deletes any resource omitted from the `resources:`
array, and this project holds **5 services + a Redis database + 2 volumes + 1 storage bucket**
(`statenour-web`, `MAINnicks-tire-auto`, `statenour-worker`, `perplexica`, `searxng-perplexica`,
`Redis`, `redis-volume`, `perplexica-volume`, `nickstire-media`). All nine are captured.

## Operator runbook — in this order

Run from the **primary checkout** (`C:\Users\nourd\NOURCITY`), never a `.worktrees/*` worktree:
every `node_modules` there is an NTFS junction, and a package install inside one offers to wipe the
shared tree with the prompt defaulting to yes.

**1. Railway CLI must be ≥ 5.42.1.** The IaC engine now ships in the CLI, not the TypeScript SDK.

```bash
npm install -g @railway/cli@latest
```

**2. Install the SDK at the repo root** so `railway.ts`'s `import ... from "railway/iac"` resolves.
This edits `package.json` + `pnpm-lock.yaml`, and `pnpm-lock.yaml` is itself a watch pattern for all
three services — expect a deploy.

```bash
pnpm add -w -D railway
```

**3. Re-verify the plan before applying.** It must still read `0 to destroy`.

```bash
railway config plan --verbose
```

**4. Apply** — this is a deploy-config change against production.

```bash
railway config apply
```

**5. Only after a green apply, delete the three `railway.json` files.** A service cannot be managed
by both systems, so they are removed *after* the handover, never before — deleting them first drops
the overrides immediately.

## Notes

- `.railway/package.json` declares `{"type":"module"}`. The monorepo root has no `type` field, so it
  is CommonJS, and without this the `.ts` file fails to evaluate with *"Cannot use import statement
  outside a module."*
- Every variable renders as `preserve()` — the value Railway already holds is kept and **no secret
  values are in this repo**. Never pipe `railway config plan --show-values` into a log.
- Omitting a resource from `resources:` **deletes it**. Re-run `config pull` into a scratch copy and
  diff before hand-editing.
