# Perplexity activation receipt — 2026-10-02

Status: PARTIALLY ACTIVATED / BLOCKED ON PROJECT-SCOPED API KEY

## Production configuration

- Railway project: `natural-appreciation`
- Environment: `production`
- Service: `statenour-web`
- Variable name: `PERPLEXITY_API_KEY`
- Secret value is intentionally omitted from source and this receipt.
- Variable mutation triggered Railway deployment `8bbf50ac-c345-4365-858f-e729fd6d662d`.
- Deployment reached terminal `SUCCESS` at 2026-10-02T11:05:42.599Z.
- A local ignored `.env.local` was used only for canary probes, then deleted because the repo's secret scanner intentionally scans ignored secret files too. No credential is retained in the worktree.

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

- Targeted Vitest: 3 files / 20 tests PASS.
- Targeted ESLint on changed TypeScript/tests: PASS.
- Exact supplied secret scan against tracked files: NOT FOUND.
- Full StateNour typecheck still fails on pre-existing unresolved workspace package modules
  (`@nour/social-assets`, `@nour/ai-capabilities`, `@statenour/lenses`) and their
  downstream implicit-any errors; no remaining typecheck error points at the Perplexity files.
- last30days global private config resolves `PERPLEXITY_API_KEY`: VERIFIED.
- last30days Search API canary: HTTP 403 with this credential type, 0 items.

## Activation ledger

1. Production variable: DONE
2. Private local secret: NOT RETAINED after canary; re-add only after issuing the correct project-scoped key
3. Secret excluded from git: VERIFIED; `check:secrets` passes with 0 findings
4. TypeScript API migration: BUILT + TARGETED TESTED + LINTED
5. Cheap Search API live probe: BLOCKED — credential type rejected
6. Live citation proof: BLOCKED by same credential
7. `smartWebSearch`: MIGRATED + RESILIENT FALLBACK BUILT; live Perplexity proof blocked
8. StateNour deep research: fallback remains available; Perplexity leg blocked
9. last30days direct Perplexity: PRIVATE CONFIG WIRED; live Perplexity proof blocked
10. Cost/latency/quality receipt: PARTIAL — failure latency captured; success metrics await project key

## Required final activation

Create a Perplexity **project-scoped API key** in the Perplexity API console.
Replace `PERPLEXITY_API_KEY` in Railway production and the ignored local
secret. Then rerun Search API, citation, smartWebSearch, deep-research, and
last30days live canaries before merging this branch.

Do not commit, log, document, or expose either credential value.
