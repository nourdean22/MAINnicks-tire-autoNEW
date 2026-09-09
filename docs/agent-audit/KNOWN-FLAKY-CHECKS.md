# Known flaky CI checks

**A flake that lives only in a session transcript is invisible by tomorrow.**
"Known flaky, merged anyway" is exactly how a real failure eventually gets waved
through — the next person meets a red X, assumes it is the usual noise, and is
right until the day they are not.

**A row here is not permission to ignore a red.** It is evidence someone already
did the work of separating flake from defect, plus what they checked, so the next
person can either match the signature or discover they have something new.

**Before adding a row, prove it is not yours.** Minimum: it passes locally, and
your diff of the implicated file against `origin/main` is empty.

---

## `adapter parity + canaries` → `policy canaries (N files)`

| | |
|---|---|
| **Workflow** | `.github/workflows/agent-policy.yml` → `pnpm agent:verify` |
| **Failing group** | `policy canaries (N files)` — `verify.mjs` renders the LIVE file count into that label, so the number moves every time a canary is added (it read 11 when this row was first written). **Match on the words, never the count** — a number pinned here is a cache with no invalidation, and the first draft of this row went stale the same day it was written. `adapter parity` itself passes |
| **First recorded** | 2026-08-29, PR #2014 |
| **Frequency observed** | 2 of 4 runs on one branch, same commit range |
| **Verdict** | **Environmental, not a code defect** |

### Signature

The canary drives a real dev server and probes routes. It asserts the abort
message matches `/stopped answering while warming \/wedge/`, but the runner
emits the *more precise* message the wedge work introduced:

```
route /wedge failed with curl rc=52 (code 000) while /health answered 200
  — the server is alive and this route is broken, not slow
```

`curl rc=52` (empty reply) instead of a timeout. **The canary asserts the older,
vaguer wording, so on the runs where CI produces the precise message it fails.**
The subject improved; the canary was not updated with it.

### Evidence it was not introduced by PR #2014

1. `node scripts/agent-os/verify.mjs` locally → `agent-os verify: all checks green`
2. Passed on the immediately preceding CI run of the same branch, then failed on
   the next with no change to any implicated file
3. `git diff HEAD origin/main -- .github/workflows/e2e-statenour.yml` → **empty**;
   that file arrived via merge, unmodified

### The real fix

Update the canary to assert the *behaviour* — that warming aborts and names the
failing route — rather than one literal sentence. Asserting exact prose makes
every message improvement a false failure, which is what trained us to ignore it.

**Not done here** — it is a statenour-lane file and this was a nickstire change.
Left tracked rather than silently fixed across lanes.
