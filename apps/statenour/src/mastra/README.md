# `src/mastra/` · Wave-200 Phase 0 scaffold

> **Status (2026-05-17)**: scaffold only · NOT wired into live chat yet
> **See**: `docs/WAVE-200-PLAN.md` for the full roadmap
> **ADR**: `docs/adr/0001-mastra-adoption.md`

This directory is the **future home** of the Mastra agent layer. As of Phase 0 it
contains:

- `index.ts` · Mastra instance · empty agent registry (placeholder)
- `agents/nick.ts` · placeholder Nick agent definition (NOT YET CALLED · safe to delete during Phase 1)
- `tools/` · empty · Phase 1 lands the first 5 tools here

## Why scaffold without wiring

Phase 0 acceptance: `pnpm tsc --noEmit` stays clean after adding `@mastra/core` +
`@mastra/memory` + `braintrust` packages. We prove the deps don't conflict with
Next.js 16 / Vercel AI SDK v6 / Prisma 7 before we change a single user-visible
behavior.

## What lands when in subsequent phases

| Phase | File(s) | Behavior change |
|---|---|---|
| Phase 1 | `agents/nick.ts` (real) · `tools/{createTask,snoozeTask,closeLoop,pinMemory,sendOperatorAlert}.ts` · feature-flagged in `/api/ai/chat/route.ts` behind `AGENT_V2=true` | First Nick-as-agent surface · falls back to legacy chat code when flag off |
| Phase 2 | `skills/` directory + Tool Search Tool integration | 1,423-skill registry exposed at runtime |
| Phase 3 | `workflows/` directory · Inngest functions | Durable multi-step flows |
| Phase 5 | `workflows/morning-brief.ts` | Daily 5am ET push notification |
| Phase 4 (parallel · apps/voice/) | Python LiveKit agent worker · HTTP bridge to the Mastra agent here | Operator voice loop |

## Operator quickstart (when ready to ship Phase 1)

1. Set env vars in Railway statenour-web:
   ```
   AGENT_V2=false                    # leave false during dev; flip true at cutover
   BRAINTRUST_API_KEY=<from braintrust.dev>
   BRAINTRUST_PROJECT_NAME=statenour-nick
   ```
2. Tell Claude · Phase 1 starts · Claude wires the agent + tools + Braintrust scoring + feature flag
3. Operator validates · then `AGENT_V2=true` in Railway env · rollout
