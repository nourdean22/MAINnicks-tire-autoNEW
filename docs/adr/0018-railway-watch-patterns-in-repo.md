# ADR-0018 · Railway watch patterns move into the repo · the deploy that never fires

> **Status**: Accepted (2026-09-18)
> **Date**: 2026-09-18 · measured against live Railway during the cron-lifecycle wave
> **Supersedes**: the "Future · revisit if recurs" clause of
> [ADR-0014](0014-railway-root-directory-trap.md)
> **Decision drivers**: second occurrence of the same trap class · every
> dashboard stays green while production runs stale code · the remedy
> ADR-0014 named is now cheap because the check needs no Railway API

---

## Context

ADR-0014 recorded a Railway **dashboard** setting (`rootDirectory`) silently
diverging from what the Dockerfile actually needed, costing 9 failed deploys and
40+ minutes of diagnosis. It closed with:

> **Future · revisit if recurs** — If we hit this trap a second time, ship the
> `railway.toml` approach (declarative build config in the repo, overrides
> dashboard). Cost: ~20 lines of config + one ADR. Benefit: never silent again.

**This is the second time, on a different field.**

Measured 2026-09-18 against live Railway (`natural-appreciation` / production):

| service | watchPatterns (live, dashboard-set) |
|---|---|
| `statenour-web` | `["apps/statenour/**"]` |
| `statenour-worker` | `["apps/worker/**", "apps/statenour/lib/**"]` |
| `nicks-tire-auto` | `["apps/nickstire/**"]` |

And what those services actually build from, per `package.json` workspace
dependencies (which is what `turbo prune` reads) and confirmed by each
Dockerfile's own `COPY` lines:

| service | workspace closure |
|---|---|
| `statenour-web` | `packages/{ai-capabilities,lenses,social-assets,utils}` |
| `statenour-worker` | `packages/reel-engine` |
| `nicks-tire-auto` | `packages/{gbp-publisher,meta-ads-architect,utils}` |

Plus `pnpm-lock.yaml`, `pnpm-workspace.yaml`, root `package.json` and
`turbo.json` for all three — and `apps/nickstire/patches/**`, which root
`package.json` `pnpm.patchedDependencies` applies to the frozen install and
which BOTH Dockerfiles `COPY` explicitly. A patch edit changes all three images
and nothing watched it.

★ `nicks-tire-auto` is the PUBLIC SITE and shares `@nour/utils` with statenour,
so a single `packages/utils` commit could leave two products serving stale
builds at once. It was missed in the first cut of this ADR, which scoped to the
two services whose Dockerfiles made the dependency visible — a reminder that
the Dockerfile is the echo, not the cause: nickstire builds via RAILPACK with
`pnpm --filter nicks-tire-auto... build`, where the `...` pulls the same
workspace closure with no COPY line to notice.

**None of those paths were watched.** Editing `packages/utils` changed what
production *would* build and did not cause production to build it. The old
image kept serving until some unrelated `apps/statenour/**` commit happened to
trigger a rebuild.

★ This failure is worse than ADR-0014's. That one produced nine loud red
deploys. This one produces *nothing*: no failed build, no alert, no red
dashboard — just an artifact that quietly does not match `main`. The only
symptom is a fix that "didn't work" for reasons nobody can reproduce locally.

Root `AGENTS.md` already states "A change under `packages/` or to
`pnpm-lock.yaml` affects both web apps." The repo knew. The deploy trigger did not.

## Decision

**Move watch patterns into `apps/<service>/railway.json` under `build.watchPatterns`,**
and add a repo-side gate that asserts coverage.

ADR-0014 explicitly **rejected** a CI check against the Railway API as
over-engineering — "requires Railway API + secrets in CI · YAGNI". That
reasoning was correct and is why this ADR does not do that either. Moving the
patterns into version control changes the economics: both sides of the
comparison become files, so `scripts/agent-os/railwayWatchCoverage.test.mjs`
runs with **no network, no credentials and no Railway access at all**. The check
ADR-0014 rightly refused to build is not the check being built here.

⚠⚠ **THE GATE'S LOCATION IS PART OF THE DECISION, NOT AN ACCIDENT.** It began in
`apps/statenour/tests/deploy/`, and review caught that the worker and nickstire
assertions could never fire on a worker-only or nickstire-only diff: CI selects
work with `turbo --affected`, `@statenour/worker` has no `test` script, and
nothing draws an edge from those apps to statenour's suite. A cross-service
invariant parked inside ONE service's tests is absent exactly when the other
services change. It now lives in `scripts/agent-os/`, which
`agent-policy.yml` runs on EVERY pull request, Node-only, with auto-discovery
of `*.test.mjs`. That workflow file is deliberately not edited — per its own
header, touching `.github/workflows/**` flips test.yml into a ~50-minute sweep.

The gate derives required paths from `package.json` workspace dependencies and
from root `pnpm.patchedDependencies` — the *causes* that `turbo prune` and the
frozen install actually read — rather than from the Dockerfile's `COPY` lines,
which are a hand-maintained echo. Asserting against the echo would pass happily
on the day the two drift, which is exactly the day a package silently stops
deploying. A second assertion catches drift in the other direction: any
`packages/` path a Dockerfile copies must appear in the declared closure.

⚠ **A PATTERN NARROWER THAN THE REQUIREMENT IS NOT COVERAGE.** The first
`covers()` also returned true when the pattern's prefix was a DESCENDANT of the
requirement, so `packages/utils/src/**` counted as watching `packages/utils` —
missing `package.json`, `tsconfig.json` and the build scripts, all real inputs.
The gate would have passed a materially broken config. Only a prefix equal to or
an ancestor of the requirement counts, and a mutation fixture pins that case.

**Coverage, not equality.** Extra patterns only cause an unnecessary rebuild; a
missing one is the bug. The gate can therefore only push toward deploying more
often, never less — the safe direction for a check whose failure mode is
"production quietly runs stale code".

## Verification

- Live watch patterns and Dockerfile inputs read directly from Railway and the
  repo, not inferred.
- **Merge semantics proven empirically before relying on them**: the existing
  `deploy` block omits `healthcheckTimeout`, yet live config carries 30/60. A
  field absent from `railway.json` survives, so a partial `build` block cannot
  reset `builder: DOCKERFILE` or `dockerfilePath`. Those stay dashboard-owned
  and are deliberately NOT restated here — smallest change, smallest blast radius.
- **`railway.json` is proven live, not assumed.** The live config carries
  `healthcheckPath: /api/system/heartbeat`, which exists only in
  `apps/statenour/railway.json`. Railway detects config at the package directory
  root for monorepos, which is why it applies despite `rootDirectory` being `/`.
- **Positive control**: reverting `watchPatterns` to the measured-live value
  makes the gate fail and name all six unwatched inputs. A coverage check that
  can only pass proves nothing.

## Consequences

### Positive

- A shared-package change now triggers the deploy that consumes it.
- The patterns are reviewable in a PR instead of living in a dashboard nobody diffs.
- Adding a workspace dependency without widening the patterns fails CI.

### Negative / accepted

- More rebuilds: a `pnpm-lock.yaml` change now redeploys both services. That is
  correct — the lockfile changes the image — and the cost is build minutes.

### ⚠⚠ DATED RISK · 2026-12-01

Railway has **deprecated Config as Code**. Per its docs: existing
`railway.json` / `railway.toml` files "continue to work for services that
already use them until **2026-12-01** (hard cutoff)", and new services cannot
opt in. The replacement is Infrastructure as Code (`.railway/railway.ts`).

On that date these files stop applying and **both `watchPatterns` and
`healthcheckPath` silently revert to dashboard values** — re-opening this exact
trap, and ADR-0014's, on a known calendar date. This is not hypothetical and it
is not far away.

**Owner action before 2026-12-01:** migrate `apps/statenour/railway.json` and
`apps/worker/railway.json` to `.railway/railway.ts`, and repoint the gate's
reader at it. The gate's assertions do not change — only where it reads the
patterns from.

## Amendment · 2026-09-23 · negated watch paths

"Coverage, not equality" still holds, with one deliberate exception: `!` negations
in `.railway/railway.ts`, added because 8 of 32 shop-server deploys on
2026-09-22/23 were docs-only commits, each restarting ~118 in-process jobs.
A negation is the one edit that makes the gate allow deploying LESS, so it is
fenced: every top-level path in an app counts as an input unless `NON_INPUTS`
in the gate names it with evidence, and a negation that could exclude any input
(including one inside a non-input, such as nickstire's runtime-read
`docs/reel-packs`) fails. Positive controls: planting `!packages/utils/**`,
`!apps/nickstire/docs/**` or `!apps/statenour/docs/**` each turns it red.

## References

- [ADR-0014](0014-railway-root-directory-trap.md) — the first occurrence
- `scripts/agent-os/railwayWatchCoverage.test.mjs` — the gate (runs on every PR
  via `agent-policy.yml`, which auto-discovers it)
- `apps/statenour/Dockerfile` lines 72-75 · `apps/worker/Dockerfile` line 45 —
  the copied packages; line 54 / line 34 — the copied patch directory
- `scripts/agent-os/gateReachability.test.mjs` — the prior art for "a gate that
  cannot fire is not a gate", which is what moved this check out of a
  per-service suite
- Railway docs: Config as Code reference (watch patterns) · Config as Code
  deprecation notice (2026-12-01 cutoff)
