# ADR-0001 · Adopt Mastra as the agent orchestration layer

- **Status**: Superseded · 2026-06-02 (was Accepted · 2026-05-17). Commit `33a035257` ("delete Mastra Agent V2",
  pushed without a PR) deleted `src/mastra/**`, `/api/agent` and the `@mastra/*` dependencies; the AI SDK v6
  `streamText` pipeline is Nick's only path. No `@mastra` package or `mastra` source file remains in the repo.
  `AGENT_V2` is still set on Railway (`.railway/railway.ts:110`) but no code reads it. The text below is history.
- **Operator**: nour
- **Author**: Claude (during Wave-200 brainstorm session)
- **Supersedes**: the ad-hoc agent orchestration accreting in `apps/statenour/lib/ai/turn-intelligence.ts` + `lib/ai/system-prompt.ts` + `lib/ai/chat-mode.ts` (all stay · but Mastra becomes the orchestrator above them)

## Context

After the Railway migration landed, the operator's brainstorm settled on **#1 Nick-as-agent** as the highest-leverage next move. To ship Nick-as-agent without writing the agent framework ourselves, we picked a framework.

The agent space in May 2026 has two production-grade TypeScript options:
- **Mastra** (Gatsby team) · TS-native · 19K GitHub stars · 300K weekly npm
- **Vercel AI SDK v6** · already installed · ships an `Agent` abstraction + `ToolLoopAgent`

Plus the Python-side dominant: **LangGraph** + **Pydantic AI** (not TS, not picked).

Per Anthropic's "Building Effective Agents": *find the simplest solution possible, only increasing complexity when needed.*

## Decision

Adopt Mastra as the agent orchestration layer, sitting ON TOP of Vercel AI SDK v6. Mastra uses the AI SDK as its provider abstraction, so we don't replace what works — we add structure on top.

## Why Mastra over AI SDK v6 alone

| Capability | AI SDK v6 alone | Mastra (on top of AI SDK v6) |
|---|---|---|
| Agent abstraction | `Agent` + `ToolLoopAgent` (v6) | `Agent` with full lifecycle (build · run · suspend · resume) |
| Memory | bring-your-own (we have one) | 4-tier built-in: working · semantic · resource-scoped · workflow |
| Tools | `tool()` defs only | `createTool()` + dynamic discovery + MCP-first |
| Human-in-loop | manual via streamUI | `.suspend()` / `.resume()` first-class |
| Multi-step workflows | imperative composition | declarative graphs · checkpointable · time-travel-debuggable |
| Built-in evals | none | `mastra-evals` package · 30+ scorers shipped |
| MCP server-discovery | manual `experimental_createMCPClient` | first-class `mcpServers` config block |
| TypeScript ergonomics | excellent | excellent · zod-based input/output schemas |

The single line: **Mastra gives us workflow durability + multi-tier memory + first-class evals without re-implementing what AI SDK v6 already does well.** It's additive, not replacing.

## Rejected alternatives

| Option | Why rejected |
|---|---|
| **Roll our own** | We already started · it's the `lib/ai/turn-intelligence.ts` code accreting since v10.0.300. Production cost: every change is bespoke, no community support, no eval framework. **Mastra is what we'd be building, badly.** |
| **AI SDK v6 alone** | `ToolLoopAgent` is great for single-call tool chains but doesn't handle long-running workflows · no checkpointing · no native multi-tier memory. Hits a ceiling at ~5-tool / 3-step plans. |
| **LangGraph** | Python-first · would mean a Python service + IPC bridge to our TypeScript brain. Adds infra without 10x benefit. |
| **CrewAI** | Role-based multi-agent · we don't have role-based agents yet · would be premature. |
| **AutoGen** | Microsoft-led · stricter agent-to-agent message-passing pattern · over-engineered for solo-operator use. |
| **Inkeep / Kiln / Vellum** | Higher-level workflow builders · we want code-first not UI-first (operator already writes TypeScript fluently). |
| **Defer the decision** | We've been deferring it for 9 months. The accretion is paying interest. Pick now · adjust later if Mastra disappoints. |

## Consequences

### Positive
- Nick becomes capable of multi-step workflows without us building the runtime
- `lib/ai/turn-intelligence.ts` complexity gets a clean abstraction to live inside
- The 1,423-skill registry has a real runtime mounting point (via Mastra tool surface)
- Future agents (one per business domain · ALG · customer-recovery · social etc) reuse the same framework

### Negative
- Net add: ~30MB of dep weight (`@mastra/core` + `@mastra/memory` + `zod@4`)
- Learning curve: ~1 day for the operator to grok the Agent + Workflow + Step + Tool primitives
- Risk of framework lock-in: low (Mastra wraps AI SDK · escape hatch = drop Mastra · keep AI SDK)
- Mastra is young (1.x in 2025 · still moving fast) — version-pin tight + monitor changelog

### Neutral
- The existing chat path (`/api/ai/chat/route.ts`) stays unchanged until Phase 1 cuts over behind `AGENT_V2=true`. Zero risk of regression during scaffold.

## Implementation phases

See `docs/WAVE-200-PLAN.md` § "Sequenced execution".

- **Phase 0** (this commit): packages installed · empty scaffold · no agent wired
- **Phase 1**: first Mastra agent (`nick`) with 5 starter tools · cutover behind feature flag
- **Phase 2**: skill registry mounted as Mastra tool surface
- **Phase 3**: workflows on Inngest for durability
- **Phase 5**: morning-brief workflow

## Verification

- `pnpm tsc --noEmit` clean post-install (Phase 0 acceptance)
- Phase 1 cutover requires:
  - 20-question Braintrust eval suite green
  - 0 errors in /system/logs for 24h
  - Manual sanity from operator (5 hand-typed chats with various intents)
- Rollback: flip `AGENT_V2=false` env var in Railway

## References

- Mastra docs: <https://mastra.ai/docs>
- Anthropic "Building Effective Agents": <https://www.anthropic.com/research/building-effective-agents>
- AI SDK v6 announcement: <https://vercel.com/blog/ai-sdk-6>
- Production framework rankings: <https://alicelabs.ai/en/insights/best-ai-agent-frameworks-2026>
