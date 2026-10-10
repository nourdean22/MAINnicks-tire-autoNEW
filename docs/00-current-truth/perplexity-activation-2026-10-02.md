# Perplexity activation receipt — 2026-10-02

Status: PARTIALLY ACTIVATED / BLOCKED ON PROJECT-SCOPED API KEY

## Production configuration

- Railway project: `natural-appreciation`
- Environment: `production`
- Service: `statenour-web`
- Variable name: `PERPLEXITY_API_KEY`
- Secret value is intentionally omitted from source and this receipt.
- The supplied credential was temporarily installed for canary probes, then removed after live endpoints identified it as the wrong credential class.
- Railway redeployment `1b8c2deb-5f02-4c61-be77-bf1fc826e093` reached terminal `SUCCESS` after removal.
- Production currently has no `PERPLEXITY_API_KEY`; this prevents known-bad 403 calls while preserving Tavily/Exa/Google fallback.
- Local worktree and last30days copies of the rejected credential were deleted after canary testing.

## Current API truth discovered live

The previous TypeScript adapter used `/chat/completions` with Sonar.
A live request returned HTTP 403 in ~160 ms with Perplexity's
`agent_api_migration_required` response directing Sonar callers to the
current Agent API.

A request to `/v1/agent` with the newly supplied credential returned HTTP
403 in ~134 ms: the supplied credential is an organization API key, and
Perplexity does not accept organization API keys on that endpoint.
A direct `/v1/sonar` probe returned the same organization-key restriction.
A direct Search API probe also returned HTTP 403 in ~190 ms.

## Code migration in this branch

- `lib/integrations/perplexity.ts`
  - adds retrieval-first Search API support
  - migrates synthesized research from retired Chat Completions to Agent API
  - preserves StateNour's stable helper surface
  - keeps Guardian timeouts/retries
  - parses citations from typed Agent API search-results output
- `lib/ai/multi-search.ts`
  - uses Perplexity Search API as the Perplexity quorum leg
  - keeps Tavily / Exa / Google independence and consensus logic
- `tests/integrations/perplexity.test.ts`
  - pins current Agent API request/response handling
  - pins Search API retrieval/citation handling
- `lib/ai/agent-actions/arsenal-actions.ts`
  - keeps Perplexity preferred for the agent action
  - falls back to the verified multi-source quorum on auth/quota/timeout/provider failure
- `tests/integrations/multi-search.test.ts`
  - updated to mock the retrieval-first Perplexity leg
- `tests/ai/agent-actions-perplexity-fallback.test.ts`
  - pins preferred-Perplexity and verified-fallback behavior

## Verification

- Targeted Vitest: 3 files / 22 tests PASS.
- Targeted ESLint on changed TypeScript/tests: PASS.
- Agent API HTTP-200 `failed` / `cancelled` statuses are explicitly rejected and test-pinned.
- Exact supplied secret scan against tracked files: NOT FOUND.
- Full StateNour typecheck initially exposed unbuilt workspace package artifacts.
  After building `@nour/social-assets`, `@nour/ai-capabilities`, and `@statenour/lenses`,
  `typecheck:raw` passes cleanly.
- last30days private config resolved the supplied key during the canary, then was deleted after the credential-class failure.
- last30days Search API canary: HTTP 403 with this credential type, 0 items.

## Activation ledger

1. Production variable: PENDING VALID PROJECT-SCOPED KEY; rejected organization key removed and runtime redeployed cleanly
2. Private local/last30days secret: NOT RETAINED after canary; re-add only after issuing the correct project-scoped key
3. Secret excluded from git: VERIFIED; `check:secrets` passes with 0 findings
4. TypeScript API migration: BUILT + TARGETED TESTED + LINTED
5. Cheap Search API live probe: BLOCKED — credential type rejected
6. Live citation proof: BLOCKED by same credential
7. `smartWebSearch`: MIGRATED + RESILIENT FALLBACK BUILT; live Perplexity proof blocked
8. StateNour deep research: fallback remains available; Perplexity leg blocked
9. last30days direct Perplexity: CODE READY; rejected credential removed from private config; live proof awaits project key
10. Cost/latency/quality receipt: PARTIAL — failure latency captured; success metrics await project key

## Required final activation

Create a Perplexity **project-scoped API key** in the Perplexity API console.
Replace `PERPLEXITY_API_KEY` in Railway production and the ignored local
secret. Then rerun Search API, citation, smartWebSearch, deep-research, and
last30days live canaries before merging this branch.

Do not commit, log, document, or expose either credential value.
