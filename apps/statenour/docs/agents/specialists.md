# Specialist sub-agents

Task #13 (2026-05-23) introduced a **router + specialists** layer
sitting beside the live chat handler. The router classifies each
incoming user message and (optionally) dispatches it to a narrow
specialist instead of general Nick.

The layer IS wired into the live chat handler
(`app/api/ai/chat/route.ts`, the specialist-routing block near the
top of the POST handler), gated by the `ENABLE_SPECIALIST_ROUTING`
feature flag. With the flag off (the default), `routeMessage()`
short-circuits to `general` and nothing fires.

## Current specialists

> **Reality check (2026-07-09):** only `marketing-director` has an
> implementation (`lib/ai/agents/specialists/marketing-director.ts`)
> and a dispatch branch in the chat route. `financial-analyst`,
> `decision-coach`, and `schedule-keeper` are ROUTE NAMES ONLY — the
> router can classify to them, but the turn silently falls through to
> general Nick. No specialist file or test exists for them.

| Route                | Domain                                                              | Implemented? |
|----------------------|---------------------------------------------------------------------|--------------|
| `general`            | Default · the existing Nick chat path · unchanged                   | — (default)  |
| `financial-analyst`  | Net worth · savings rate · spending categories · cash flow · debt   | ❌ route only |
| `decision-coach`     | Trade-offs · weighing options · past-Nour patterns · recovery paths | ❌ route only |
| `schedule-keeper`    | Calendar shape · free blocks · day rhythm · reschedules (task #16)  | ❌ route only |
| `marketing-director` | Marketing campaigns · SEO/AEO optimization · copywriting · social channels | ✅ live (flag-gated) |

Distinguishing schedule-keeper from decision-coach is the
trickiest call: schedule-keeper is "WHERE in time" (placement) ·
decision-coach is "WHICH option" (choice). "Should I reschedule the
meeting?" → decision-coach (framing a choice). "Reschedule my meeting
to Thursday" → schedule-keeper (committing a placement). When the
classifier is uncertain the LLM tiebreak handles it.

## How to enable

Set the env var on the deploy (Railway · `.env.local` · etc.):

```
ENABLE_SPECIALIST_ROUTING=true
```

Anything other than the literal string `true` (unset · `false` ·
`shadow` · `0`) keeps the layer dormant — `routeMessage()` always
returns `{ route: "general", reason: "routing-disabled", confidence: 1 }`
and no specialist ever fires.

Default behavior with the flag off is unchanged from before task
#13 — verified by the router test suite.

## How the routing works

Two-pass classifier in `lib/ai/agents/router.ts`:

1. **Keyword pre-filter** — zero-cost regex scan on the latest user
   message. Anchored to high-intent phrases per specialist family
   (`net worth`, `savings rate`, `should i`, `trade-off`, `past nour`,
   `when can i`, `reschedule`, `free block`, etc.). Decision logic
   based on hit cardinality: exactly one family matches → route
   immediately · zero matches → general immediately · two or more
   families match → fall through to LLM tiebreak.
2. **LLM classifier** — only fires when two-plus keyword families
   match the same message (genuinely ambiguous · e.g. "when should
   I schedule my savings review?" hits schedule + financial +
   decision). Cheap `taskType: "classify"` call with a strict JSON
   output and `extract-structured` parsing. Malformed output silently
   falls back to general.

Every failure mode (provider down · LLM throws · bogus JSON · bogus
route name) coerces back to general so routing never blocks the chat
path.

## How to add a new specialist

1. Add the new route name to `SpecialistRoute` in
   `lib/ai/agents/types.ts`.
2. Create `lib/ai/agents/specialists/<name>.ts` with a `run<Name>()`
   function shaped like `marketing-director.ts` (the only existing
   specialist). Use `makeTracedAiChat("specialist-<name>", "brain")`
   so the call shows up in `/system/agent-traces`. Include the
   `[[HANDBACK: reason]]` marker rule in the system prompt.
3. Extend `lib/ai/agents/router.ts`:
   - Add a regex signal family at the top.
   - Update the pre-filter branching to recognize it.
   - Update the LLM classifier prompt's enum + rubric.
4. **Add a dispatch branch in `app/api/ai/chat/route.ts`** where
   `decision.route` is checked (search for `runMarketingDirector`).
   Without this step the router classifies to your specialist but the
   turn silently falls through to general Nick — this is exactly the
   state financial-analyst / decision-coach / schedule-keeper are in.
5. Add a test file under `tests/ai/agents/<name>.test.ts` (see
   `tests/ai/agents/router.test.ts` for the existing patterns).
6. Extend `tests/lib/validators/nick-classify-schema.test.ts` route
   enum check.
7. Add at least one eval scenario in
   `tests/eval/scenarios/specialist-routing-<name>.json` exercising
   the new specialist.

## Hand-back contract

Each specialist's system prompt instructs the model to append
`[[HANDBACK: reason]]` on its own line when the latest user message
has drifted out of its domain. The dispatcher (and tests) strip the
marker and surface `{ handBack: true, reason }` on the response.

The dispatcher IS wired for marketing-director: the chat route's
specialist block strips the marker and falls through to the normal
pipeline when `{ handBack: true }` comes back. Any new specialist's
dispatch branch must respect the same contract.

## Diagnostics

`nick.classifyMessage` tRPC mutation (operator-only) exposes the
router decision for any message payload. Useful for the UI affordance
that surfaces a small "decision-coach" chip when a specialist would
fire, and for end-to-end tests.
