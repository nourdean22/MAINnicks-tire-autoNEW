# Migration · runMultiAgent ← Persona Library (M.2 follow-up)

**Started:** Phase M.2 (2026-05-18 PM)
**Strategy:** Coexistence · inline sub-agents keep working · personas add structure
**Status:** Library shipped (M.2) · **1/N call sites wired (R · engine runMultiAgent)** · N.6 scorer now sees real persona keys

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

1. **`smart-tier runRouter` sub-pipeline** · the router's "multi"
   route currently calls `runMultiAgent(question, plan)` · would pick
   up the persona wiring automatically. Sanity-check there's no
   alternate construction path inside the router itself.
2. **`thorough-tier deep-research worker`** · uses 1 planner + N
   round agents + 1 synthesizer · planner = `execution-planner` ·
   round agents = `research-analyst` · synthesizer = `synthesizer`.
3. **Plan-derived steps with action verbs** · current Phase R wiring
   passes `research-analyst` to every plan step. Steps that read as
   "do X" rather than "find Y" should use `execution-planner`
   instead · would need a small `classifyStepIntent()` helper to
   choose between the two per line.
