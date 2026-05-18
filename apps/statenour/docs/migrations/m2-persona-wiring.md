# Migration · runMultiAgent ← Persona Library (M.2 follow-up)

**Started:** Phase M.2 (2026-05-18 PM)
**Strategy:** Coexistence · inline sub-agents keep working · personas add structure
**Status:** Library shipped (M.2) · **3/N call sites wired (R + S.1 + T)** · T adds RESEARCH_PLANNER + RESEARCH_SYNTHESIZER specialists for the deep-research worker · N.6 scorer now feeds from multi-agent fan-out AND deep-research worker

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

Next call sites to wire:

1. ~~**`smart-tier runRouter` sub-pipeline**~~ **DONE in Phase S.3**
   (verified · the router's "multi" route calls
   `runMultiAgent(question, plan)` which now passes typed personas
   per plan line via R + S.1's wiring. No separate code change
   needed · inheritance documented in `engine.ts` above runRouter.)
2. ~~**`thorough-tier deep-research worker`**~~ **DONE in Phase T**
   · extracted `RESEARCH_PLANNER` + `RESEARCH_SYNTHESIZER` as
   specialist personas in `lib/ai/personas/index.ts` · `deep-research.ts`
   now does `personaToSystemPrompt(RESEARCH_PLANNER)` /
   `personaToSystemPrompt(RESEARCH_SYNTHESIZER)` at module load ·
   `recordPersonaUsage` calls wired so N.6 scorer sees the deep-
   research persona keys (planner duration · synth duration ·
   implied-confidence). All domain anchors preserved (JSON output
   shape · Cleveland OH tire-shop framing · Perplexity `[N]`
   citation markers).
3. ~~**Plan-derived steps with action verbs**~~ **DONE in Phase
   S.1** · `classifyStepIntent()` helper now picks
   `research-analyst` vs `execution-planner` per plan line based
   on the leading verb. 36 action verbs whitelisted with
   conjugations (build/building/built etc).
