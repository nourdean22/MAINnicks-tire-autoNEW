# Migration · runMultiAgent ← Persona Library (M.2 follow-up)

**Started:** Phase M.2 (2026-05-18 PM)
**Strategy:** Coexistence · inline sub-agents keep working · personas add structure
**Status:** ✅ **COMPLETED in Phase U (2026-05-18 PM)** · all 4 reasoning sub-pipelines wired · 10 typed personas live in the registry · N.6 scorer feeds from EVERY sub-pipeline

## Why

Phase M.2 shipped `lib/ai/personas/index.ts` with 8 typed persona
objects (`role · goal · backstory · outputHint`). The intent was to
let `runMultiAgent` accept persona keys instead of inline
`{ name, task, outputHint }` tuples · single edit to tune a persona
applies to every caller.

M.2 deferred the actual `runMultiAgent` wiring · ships the library
+ helper (`personaToSystemPrompt`) without consumer migration.

## Current state

- Library exists at `lib/ai/personas/index.ts` (8 personas)
- `personaToSystemPrompt(p)` helper builds CrewAI-style system prompt
- Phase N.6 added `recordPersonaUsage()` hook · captures parent tier
  + duration · sets up data plumbing for future scoring
- `runMultiAgent` in `lib/ai/reasoning/engine.ts` still constructs
  sub-agents inline (line 174-220ish)

## What needs to happen

1. Extend `SubAgentTask` interface in `lib/ai/multi-agent-orchestrator.ts`
   to optionally accept a `persona: PersonaKey` field
2. When persona key is present, replace inline name/task/outputHint
   with the persona's role/goal/backstory/outputHint via
   `personaToSystemPrompt(persona)`
3. Update engine's `runMultiAgent` wrapper to pass persona keys
   instead of inline tuples for the standard worker patterns (research-
   analyst, contrarian-critic, execution-planner)
4. Plumb the persona key into the post-completion telemetry call so
   N.6's `recordPersonaUsage()` sees real persona keys instead of
   "step_1"/"step_2" placeholders

## Risk

Low · purely additive. Inline `{ name, task, outputHint }` tuples
keep working (`persona?: PersonaKey` is optional). Migration is
per-call-site · can be incremental.

## Rollback

Per-call-site: pass inline tuple instead of persona key. No code change
to the persona library or the orchestrator.

## Next milestone

~~Pick one engine sub-pipeline (e.g. `runMultiAgent` in the engine.ts
wrapper) and convert its 2-fallback sub-agents ("what" + "why") to
named personas (`research-analyst` + `contrarian-critic`).~~ **DONE
in Phase R (2026-05-18 PM).** The fallback split now uses
research-analyst + contrarian-critic · plan-derived steps use
research-analyst. N.6's `recordPersonaUsage` now sees real persona
keys.

Call sites · all wired:

1. ✅ **`runMultiAgent` (engine.ts)** · DONE in Phase R · the engine's
   2-fallback sub-agents ("what" + "why") map to research-analyst +
   contrarian-critic. Plan-derived steps map per-line via
   `classifyStepIntent()` (S.1) · research-analyst for find-X
   tasks · execution-planner for do-Y action verbs.
2. ✅ **`smart-tier runRouter`** · DONE in Phase S.3 (inheritance ·
   no code change needed · documented in engine.ts above runRouter ·
   the router's "multi" path calls runMultiAgent which inherits R+S.1).
3. ✅ **`thorough-tier deep-research worker`** · DONE in Phase T ·
   `RESEARCH_PLANNER` + `RESEARCH_SYNTHESIZER` specialist personas
   preserve the JSON output shape + Cleveland OH tire-shop framing
   + Perplexity `[N]` citation markers the inline strings carried.
   recordPersonaUsage wired so N.6 scorer sees the deep-research
   persona keys.
4. ✅ **`pretask-fanout` (3 lenses)** · DONE in Phase U · research lens
   → research-analyst · risk lens → contrarian-critic · plan lens
   → execution-planner. Mapping pinned in `LENS_PERSONA_KEY`
   exported constant so test catches any drift. recordPersonaUsage
   wired per lens so the scorer feeds from this pipeline too.

## How N.6's scorer feeds now

Pre-M.2 · `recordPersonaUsage` was called with placeholder names
(`step_1`, `what`, `why`) so `scorePersonas()` produced meaningless
per-placeholder verdicts. Post-U the scorer sees a finite set of real
persona keys across all 4 reasoning sub-pipelines:

| persona key | which sub-pipeline writes it |
|---|---|
| `research-analyst` | runMultiAgent (S.1 routing) · pretask-fanout (research lens) |
| `contrarian-critic` | runMultiAgent fallback · pretask-fanout (risk lens) |
| `execution-planner` | runMultiAgent (S.1 routing) · pretask-fanout (plan lens) |
| `research-planner` | deep-research worker (T) |
| `research-synthesizer` | deep-research worker (T) |

When `scorePersonas()` runs it can now compute per-persona
`avgConfidence` and `fallbackRate` across the entire reasoning stack.
