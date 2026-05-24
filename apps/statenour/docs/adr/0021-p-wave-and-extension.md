# ADR-0021 · P-wave · migrations applied · OSS rewire · Chrome extension MVP · operator-state expansion

**Status:** ACCEPTED · 2026-05-23 LATE-NIGHT
**Companion code:** `apps/statenour/lib/auth/extension-token.ts` · `apps/statenour/app/api/brain/{dump,by-url}/route.ts` · `apps/statenour/app/(mastery)/system/api-tokens/page.tsx` · `apps/statenour/lib/ai/strategic-frameworks/{index,types}.ts` (shim) · `packages/chrome-extension/` · `prisma/migrations/20260512_v526_voice_latency/` · operator-state opt-ins in `/api/ai/{page-insight,plan-day,assist}` + `lib/services/ai-coach-goal.ts` · tests at `tests/lib/services/state-calibration.test.ts` + `tests/lib/auth/extension-token.test.ts`
**Tasks:** P1 · P2 · P3 · P4 · P5 · Wave I · Wave I.b · Wave J · all closed

## Context

ADR-0020 (M1 Closed-Loop Calibrated Brain) shipped the substrate but
left routed items open: parked migrations to apply · OSS lens consumer
rewire · first operator-state opt-in · Chrome extension build ·
publish-ready packaging. This ADR records the P-wave that closed all
five, then extended into Wave I (more state opt-ins + tests) and
Wave J (Chrome ext F3 page-aware re-discovery).

## Decision

### P-wave (P1-P5)
- **P1** · `prisma/migrations/20260512_v526_voice_latency/` applied to
  prod Neon via `apply-pending-migration.ts` · 3 statements ok ·
  `prisma migrate resolve --applied` · 31 migrations applied total ·
  Wave F's gated VoiceLatencyEvent composite index now also live.
- **P2** · OSS lens consumer rewire as a SHIM (not full sed-rewrite).
  `lib/ai/strategic-frameworks/index.ts` re-exports REGISTRY +
  aliases `pickFrameworks→detectLenses` + `hasBusinessIntent→hasStrategicIntent`
  + custom `composeStrategicLensBlock()` wrapper that preserves the
  Wave E featured-fallback path. All 49 inline framework files
  deleted. Zero consumer code changed · chat path stays untouched.
- **P3** · `/api/ai/page-insight` is the first operator-state opt-in.
  `formatOperatorStateBlock(snap)` injected after the lens block ·
  gated by `confidence > 0` to skip cold-start no-data injection.
  Pivoted from "morning brief" (pure template · no LLM call to
  influence).
- **P4** · `packages/chrome-extension/` MV3 MVP shipping F1 brain dump.
  Vanilla JS popup + options + service worker (no React for MVP).
  `Cmd+Shift+B` from any tab → 4-line composer → `POST /api/brain/dump`.
  Supporting infrastructure:
    - `lib/auth/extension-token.ts` · sha256-hashed token storage in
      BrainMemory(category=api_token) · issue/validate/list/revoke
    - `/api/brain/dump` · token-authed POST · Zod-validated
    - `/system/api-tokens` operator surface · 3 new tRPC procedures
- **P5** · `@statenour/lenses` v0.1.0 publish-ready: CHANGELOG.md ·
  `pnpm pack` verified 131KB · LICENSE + README + dist/ + src/ ·
  operator runs `pnpm publish --access public` for the npm 2FA prompt.

### Wave I (more state opt-ins + tests)
- 3 more AI surfaces opt into the operator-state block (same pattern
  as P3): `/api/ai/plan-day` · `/api/ai/assist` (alongside existing
  task-counts stateContext · two layers of state now) ·
  `lib/services/ai-coach-goal.ts`. This compounds the M1 calibration
  data: more chip taps now carry the operator-state snapshot.
- **Wave I.b** · 19 new tests across 2 files:
  - `tests/lib/services/state-calibration.test.ts` · 6 cases ·
    empty grid · mood × kind bucketing · unstamped row count ·
    other-kind classification · per-mood + per-kind rollups · DB
    error degradation
  - `tests/lib/auth/extension-token.test.ts` · 13 cases · issue
    format · sha256 storage · label sanitization · validate
    rejection paths · sha256 match · revoked-row filter · DB error
    degradation · list shape · revoke flow

### Wave J (Chrome ext F3 · page-aware re-discovery)
- `/api/brain/by-url` · token-authed GET · two-pass lookup:
  exact `metadata.sourceUrl === url` first · domain fallback if
  under limit (matches against `metadata.sourceUrl` substring +
  `content` substring for legacy rows).
- Extension popup `popup.js` queries this on open · renders prior
  notes ABOVE the composer in a scrollable mini-panel · hidden when
  no matches OR before lookup completes. Fire-and-forget · network
  failure silently hides the panel · doesn't block compose.
- Extension bumped to v0.2.0.

## Consequences

### Positive
- **Substrate becomes self-feeding.** Every chip tap on every AI
  surface now stamps the operator's state. As the operator uses
  Nick, the M1 calibration grid fills out. The dataset compounds
  daily without operator action.
- **Token surface is hardened.** sha256 at rest · soft-delete
  revocation · 13 tests cover the rejection paths · validate-token
  is constant-time-ish (sha256 + indexed lookup). Adequate for
  single-operator threat model · upgrade path to dedicated ApiToken
  table is documented in the lib comment.
- **Re-discovery is automatic.** Open the extension on a page you've
  noted before · the popup surfaces those notes before you even type.
  Closes one of the biggest gaps vs Reflect/Mem (they have it · we
  didn't · now we do).
- **Zero consumer churn on OSS extraction.** The shim approach
  cleanly preserves the chat path (off-limits) and 12+ other lens-
  using surfaces · ZERO of them needed import changes. Two source
  copies became one with no behavior drift.
- **Tests catch regressions on substrate.** state-calibration math
  and extension-token auth are now regression-proof.

### Negative
- **Operator-state opt-ins add ~60ms to each AI surface** ·
  `currentOperatorState()` fires 3 Prisma queries per opt-in. Cached
  per turn would be cheaper · current pattern reads fresh every time.
  Acceptable cost for the supervised signal · revisit if surfaces
  start showing latency regressions in telemetry.
- **Chrome extension is unpacked-only for now.** No Chrome Web Store
  distribution · operator drags `dist/` into chrome://extensions on
  each install. Acceptable for single-operator use · would change if
  the extension becomes a public deliverable.
- **OSS publish not yet executed.** `@statenour/lenses` v0.1.0 is
  in `packages/lenses/` and shippable. Operator runs `pnpm publish`
  for the npm 2FA prompt · the 6-LOC publish gate is the only
  remaining step.

### Neutral
- **Wave J's two-pass lookup may need tuning.** The domain-fallback
  pass uses `string_contains` on a JSON path · this is supported by
  Prisma + PostgreSQL but isn't blazing fast on large brain_memory
  tables. Acceptable at current scale · revisit if the by-url query
  shows up in slow-query telemetry.

## Alternatives considered

1. **Apply Wave F voice index in a separate migration** (P1 alt).
   Rejected · the index is gated behind a `DO $$ table-existence`
   check so applying it inline with P1 was free · saves a round-trip
   to prod Neon.
2. **Full consumer rewire instead of shim** (P2 alt). Rejected ·
   the chat path is off-limits per the operator's standing directive ·
   shim preserves zero-touch + same source of truth.
3. **Build Chrome ext with React + Vite** (P4 alt). Rejected for
   MVP · vanilla JS popup is ~150 LOC · React would add ~50KB of
   bundle + a build pipeline. MVP doesn't need the framework cost.
   Upgrade path is clean if F2-F5 demand React.
4. **Dedicated ApiToken Prisma model** (P4 alt). Rejected for MVP ·
   BrainMemory(category=api_token) sidesteps a schema migration ·
   shape is correct for v0.1 single-operator use. Upgrade to dedicated
   table when scope/quota columns become real.

## Open items

- `pnpm publish` for @statenour/lenses · npm 2FA prompt (only the
  operator can do this · everything else is ready).
- Chrome extension F2 · selection → ask Nick (right-click + side
  panel + SSE). ~2h slice · would add the biggest UX win after F1+F3.
- More operator-state opt-ins · current 4 surfaces (page-insight ·
  plan-day · assist · ai-coach-goal) cover the highest-value paths ·
  follow-ups when the calibration grid suggests a wider net.
- Tests for `shadow-judge queue` (Q2 from earlier wave) · the enqueue
  + drain code is untested · would round out the test coverage on
  recent substrate work.
