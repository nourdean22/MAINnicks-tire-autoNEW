# Pattern: the producing half gets built, the consuming half never does

**Named 2026-08-29 after six independent instances surfaced in one night.**
This is not six bugs. It is one habit, and it has a reliable signature.

## The shape

Something is authored — a registry, a resolver, a field, a contract — and it is
correct. Nothing reads it. The work looks finished because the artifact exists,
tests pass because they exercise the artifact, and reviews pass because the code
is good. **Every check is green and the feature does nothing.**

It survives review precisely *because* the producing half is well made. Nobody
looks for the reader, because the writer is obviously right.

## The six instances

| # | Producer | Consumer | How long |
|---|---|---|---|
| 1 | `server/services/absurdityConcepts.ts` — 100 curated concepts | none since #346 | months |
| 2 | `contentFranchises.blockingConditions` / `requiredEvidence` / `disclosure` — declared for all 12 shows | no runtime reader; `brand-universe.test.ts:96` asserted only `.length > 0` | since the registry shipped |
| 3 | Reel packs — 136 authored | 104 unreachable; the bridge to production is a hand-edited array carrying a topic string and discarding the brief | unknown |
| 4 | `shared/duaFranchiseKits.ts` — 321 lines of audio palettes, vocabulary, participation asks | module + test only | shipped this way |
| 5 | `DuaConcept` — full authored gate incl. layer boundary, disclosure, level cap | nothing anywhere constructs one, so every authored-only gate is unreachable **by construction** | shipped this way |
| 6 | `server/lib/deployIdentity.ts` — `resolveNickDeployIdentity()` reads `RAILWAY_GIT_COMMIT_SHA` | zero consumers; `/api/health` served a static `version: "1.0.0"` instead | until 2026-08-29 |

Instance 6 is the sharpest: the function that makes deploys verifiable already
existed, unread, which is *why* a session had to prove its deploy by watching
`uptime` reset instead of reading the hash.

## The distinction that matters: unwired vs vacuous

Not every unwired thing should be wired. Two different verdicts:

- **Unwired** — a consumer would work today. Build it. (`resolveNickDeployIdentity`)
- **Vacuous by construction** — a consumer would still never fire, because its
  precondition cannot occur. Wiring it produces a seventh instance that *looks*
  connected. Say so instead.

`checkLayerBoundary` is vacuous: it forbids generated assets in Layer A
("real footage only"), and with no real shop footage no Layer A asset is ever
declared, so the rule cannot fire regardless of wiring. Recording that was worth
more than wiring it.

## How to detect it in your own diff

**Grep the symbol and count files.** Three files — module, test, and a comment or
doc — means nothing consumes it.

```bash
git grep -l "\bmySymbol\b" -- 'apps/<app>/**'
```

Read the list. If every entry is the module itself, its test, or documentation,
you have built a producer with no consumer. A transitive caller counts; a
docstring does not.

## How to not write it

- **Assert the consuming path, not the artifact.** A test that calls the resolver
  directly passes for the entire period nothing calls it. Assert the payload,
  the route, the rendered output — whatever a user or another system receives.
- **Mutate the wiring, not just the logic.** Delete the call site and confirm a
  test goes red. If none does, the wiring is unprotected. Every gate in
  `shared/dua.test.ts` and `server/deployIdentityHealth.test.ts` has such a
  mutation behind it.
- **Presence assertions are the tell.** `expect(x.length).toBeGreaterThan(0)` on
  a config array proves the array exists, never that anything reads it. That
  exact assertion covered instance 2 for its whole life.
- **When you cannot wire it, say which kind it is** — unwired or vacuous — and
  record it where the next session finds it, not in a session transcript.

## Related

- `docs/agent-audit/CONTROL-CANARY-COVERAGE.md` — ship the canary, not just the control
- `docs/agent-audit/KNOWN-FLAKY-CHECKS.md` — a red that is tracked beats a red that is folklore
