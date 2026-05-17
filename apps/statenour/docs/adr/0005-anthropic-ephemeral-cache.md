# ADR-0005 · Anthropic ephemeral prompt cache · breakpoint placement

**Status:** Accepted
**Date adopted:** v10.0.362 (`aiChat()`) → v10.0.446 (`streamText`)
**Backfilled:** 2026-05-07 (v10.0.450)

## Context

The Nick system prompt is large: 8-12K tokens including operator
identity, behavioral profile, causation chains, tools catalog,
weekly rhythm, live data snapshots, brain wisdom recall, and
recent conversation context. At Anthropic's standard rates this is
expensive per turn — and most of the prefix is stable across turns
within a single conversation (the operator's identity, behavioral
profile, tools catalog, etc. don't change message-to-message).

Anthropic's prompt cache offers up to **90% discount** on the
cached portion of the prefix, with a 5-minute TTL window. To
qualify, the request must:

1. Have at least 1024 tokens before the cache breakpoint (Haiku)
   or 2048 tokens (Sonnet, Opus).
2. Pass the cached content via `providerOptions.anthropic.
   cacheControl: { type: "ephemeral" }` on the specific message
   block.
3. Place breakpoints at boundaries where the prefix content is
   genuinely stable — dynamic content after the breakpoint kills
   the cache hit.

The naive `streamText({ system: "long string", messages: [...] })`
shape passes the system as a flat string with NO `providerOptions`
attachment, so the cache marker is never set and the discount is
never claimed.

## Decision

Wire `cacheControl: ephemeral` at **two distinct call sites** with
careful breakpoint placement:

1. **`aiChat()` non-streaming path** (`lib/ai/provider.ts:1007-1027`,
   shipped v10.0.362):
   - Used by judge eval, adversarial critic, structured extraction
     calls.
   - Detects `entry.name === "anthropic" && systemPrompt.length > 200`,
     then converts the call shape from `{ system: string, messages }`
     to `{ messages: [{ role: "system", content, providerOptions:
     { anthropic: { cacheControl: { type: "ephemeral" } } } }, ...] }`.

2. **`streamText` primary chat path** (`app/api/ai/chat/route.ts`,
   shipped v10.0.446):
   - Mirrors the same pattern via the `buildConfig` callback inside
     `streamWithFallback`. When `inferProviderName(model) ===
     "anthropic"`, the system prompt folds into `messages[0]` with
     the cacheControl marker. Otherwise (Venice / Ollama / OpenAI),
     keep the legacy `system: string` form because:
     - Venice / Ollama have no server-side caching (no-op anyway).
     - OpenAI auto-caches prefixes ≥ 1024 tokens regardless of the
       message shape, so no explicit marker is needed.

The breakpoint is placed **at the end of the system prompt** so
that the entire identity + profile + tools catalog + brand voice
prefix is one contiguous cacheable block. Dynamic content (live
data snapshot, fresh wisdom recall, current conversation history)
lives in the `messages` array AFTER the system message, so it does
not invalidate the cache.

## Consequences

**Positive:**

- 90% input-token discount on Anthropic-served turns once the cache
  warms (within 5 minutes of first request). For an 8-12K token
  prefix, this is the difference between Anthropic-fallback being
  expensive and Anthropic-fallback being affordable.
- Cache hit rate is observable via `/api/system/cache-telemetry`
  (route exists since v10.0.385) — the operator can see how often
  the discount fires.
- The pattern is duplicated cleanly between `aiChat()` and
  `streamText` paths · same breakpoint logic · same provider
  detection (`inferProviderName` exported from
  `stream-with-fallback.ts` at v10.0.446 · was internal before).

**Negative:**

- The breakpoint placement is fragile · any inline edit to the
  v1 prompt builder that interleaves dynamic content into the
  static prefix kills the cache hit. The v1/v2 split (ADR-0003)
  was partially motivated by this — v2's typed-section structure
  is designed to keep the static prefix stable.
- Anthropic is fallback-position #4 in the chain (ADR-0001), so
  the cache savings only realize on fallback turns. Most chat
  serves from Venice / Ollama where the cache marker is a no-op.
- Cache hit rate at runtime is currently **unverified** for the
  v10.0.446 streamText path — open question from the v10.0.444
  prompt audit · needs traffic accumulation + telemetry read.
- 5-minute TTL means a slow chat (operator pauses 6 minutes mid-
  conversation) loses the cache and pays the full prefix cost on
  the next message.

## Alternatives considered

- **No caching · accept the cost** — rejected. Anthropic-fallback
  cost was the primary driver of needing the 4-provider chain
  (ADR-0001). Caching makes Anthropic affordable when it does fire.
- **OpenAI-style automatic caching only** — rejected as a complete
  solution because Anthropic doesn't auto-cache. Explicit markers
  are required.
- **Multiple breakpoints** (cache the first 4K, then the next 4K,
  etc.) — rejected on simplicity grounds. The API supports up to 4
  breakpoints but our prefix is small enough that one is sufficient.
  Multiple breakpoints would help if the prefix were 50K+ tokens.
- **Persist + replay the cache id across requests** — not supported
  by Anthropic's ephemeral cache (it's automatic-by-content-hash,
  not session-scoped).

## References

- `lib/ai/provider.ts` lines 1007-1027 · aiChat() cacheControl wiring
  (v10.0.362)
- `app/api/ai/chat/route.ts` buildConfig · streamText cacheControl
  wiring (v10.0.446)
- `lib/ai/stream-with-fallback.ts` · `inferProviderName` exported
  for the streamText path
- `app/api/system/cache-telemetry/route.ts` · runtime hit-rate
  observability
- v10.0.362 commit · `aiChat()` cacheControl introduction
- v10.0.446 commit · streamText extension (closes the audit Fix #1)
- ADR-0001 · provider chain (Anthropic at fallback position 4)
- ADR-0003 · v1/v2 split (v2's stable prefix structure makes the
  cache friendlier)

## Open items

- Verify the v10.0.446 streamText cacheControl is actually firing
  in production · check `/api/system/cache-telemetry` after the
  push has accumulated traffic. Surface the hit rate on the
  observability dashboard if it isn't already.
- Decide whether to cache the **system prompt + tools catalog**
  together (one breakpoint) vs **system + tools at separate
  breakpoints** (two cache layers). Tools catalog changes when
  new tools land · keeping it on a separate breakpoint would
  preserve the system-prefix cache across tool catalog refreshes.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
