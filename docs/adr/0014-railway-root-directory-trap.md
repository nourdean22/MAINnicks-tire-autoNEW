# ADR-0014 · Railway `rootDirectory` trap · the silent build-killer

> **Status**: Accepted (2026-05-18 · post-incident)
> **Date**: 2026-05-18 · diagnosed via Railway "Ask AI" Agent after
> 9 consecutive failed deploys
> **Decision drivers**: undetectable from local · same Docker context
> assumption as last-good deploy · operator + agent both spent 40+
> minutes diagnosing what Railway's own AI fixed in one prompt

---

## Context

On 2026-05-18 morning, an audit revealed every commit since 2026-05-17
22:24 UTC (`c7604fc`) failed to deploy to Railway with the error:

```
[deps 5/11] COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
failed to calculate checksum of ref xlcz1rbthtyc9xz5avtbuesdd::5ku6lhxitxs5buaiu0puuvfh1
```

The hash `xlcz1rbthtyc9xz5avtbuesdd` was IDENTICAL across 9 attempted
builds. This is the symptom that initially looked like BuildKit cache
corruption · the real cause was Railway's per-service `rootDirectory`
configuration silently flipped from the monorepo root to `apps/statenour`.

### Time spent on wrong diagnoses

| Hypothesis | Time | Result |
|---|---|---|
| Transient BuildKit cache | ~5 min · 1 redeploy | failed identical |
| Stale Dockerfile content hash | ~10 min · cache-bust commit | failed identical |
| GitHub mirror sync issue | ~5 min · empty commit | skipped (watched-files filter) |
| Source-file change forces snapshot refresh | ~10 min · health-route touch | failed identical |
| Symlink / encoding corruption in lock files | ~5 min · file inspection | files clean |
| **rootDirectory misconfig (Railway Agent diagnosis)** | ~3 min | **FIX** |

40 minutes wasted. Railway Agent identified it instantly because it
has access to the service config we didn't think to inspect.

## Decision

**Document the trap.** Capture the symptoms + diagnosis path so the
next operator session recognizes the pattern in seconds.

### The trap

Railway's per-service `rootDirectory` setting (Settings → Source) is:
- **Silently changeable** from the dashboard
- **Not in code** · invisible to git diff, ADRs, or CI
- **Mismatched against Dockerfile context assumption** = every
  `COPY apps/statenour/...` step fails with a confusing checksum error
  rather than a clear "directory not found"
- **Cached** in the form of a stuck snapshot ref · making it look like
  a cache corruption issue rather than a config issue

### Symptoms that mean "check rootDirectory"

1. Same `failed to calculate checksum of ref XXX` hash across multiple
   deploys despite source changes
2. Last good deploy is from a noticeably earlier point in time (today
   we had Phase A.2 9 hours old · all newer commits failing)
3. Build fails very early (steps 5-9 of deps stage) on a basic COPY
4. No code changes that would explain the failure

### Recovery

1. Railway dashboard → service → Settings → filter "root"
2. If `Root Directory` is set to anything other than empty/`/`, that's
   probably your bug (when Dockerfile assumes monorepo root)
3. Clear the field · click ✓ to save · the Deploy ⇧+Enter toolbar
   button appears
4. Click Deploy · new build picks up the corrected context
5. Verify by polling `/api/health` until fresh deploy state lands

### Why "Ask AI" worked

Railway's in-dashboard Agent has access to the service config (env
vars · build settings · deploy history). A natural-language question
gets it to cross-reference the error against the config in one shot.
For operator-facing config bugs, it's the fastest path · billable but
worth it.

## Prevention

### Adopted

- This ADR · adds the trap to operator knowledge so the diagnosis is
  one-prompt instead of 40-minutes-of-cache-busting
- Dockerfile comment block already explicitly documents the build
  context expectation (line 8-9 · `Build context: monorepo root`)

### Rejected · over-engineering

- **CI check that asserts Railway rootDirectory == "/"** · would
  require Railway API + secrets in CI · YAGNI for a 1-event problem
- **Pre-commit hook validating Dockerfile vs Railway config** · same
  problem · requires Railway API access from local
- **`railway.toml` checked into repo to override dashboard setting** ·
  promising but adds Railway-specific schema to maintain · revisit
  if this recurs

### Future · revisit if recurs

If we hit this trap a second time, ship the `railway.toml` approach
(declarative build config in the repo, overrides dashboard). Cost:
~20 lines of config + one ADR. Benefit: never silent again.

## Consequences

### Positive

- Next session recognizes the symptom set in seconds
- Railway Agent is now a known tool for operator-facing config bugs
- Dockerfile context expectation is durably documented

### Negative

- 40 minutes of real operator time lost on first encounter (this one)
- Phase D code shipped but didn't actually run in prod for 9 hours
  (the auto-join hook for first night's brain dumps + the nightly
  convergence scan both no-opped)
- No structural prevention beyond "check this setting" knowledge

### Neutral

- The 9 failed deploys produced harmless build noise · no data loss ·
  no impact on running Phase A.2 deployment serving traffic

## Operator action items

1. ~~Fix rootDirectory~~ — DONE 2026-05-18 (cleared the field)
2. Next time a "failed to calculate checksum of ref" error appears
   with the same hash across rebuilds, **check Settings → Root
   Directory FIRST** before doing anything else
3. *(optional · only if this recurs)* implement `railway.toml`
   override in repo root

## References

- `apps/statenour/Dockerfile` (line 8-9 · build context expectation
  documented)
- Railway Agent transcript at `https://railway.com/.../agent` (the
  exact prompt + diagnosis chain · billable feature but the unblock
  was worth it)
- This session's commit chain: `c7604fc..b79d6239` (8 failed deploys
  + the cache-bust attempt that taught us BuildKit wasn't the issue)
