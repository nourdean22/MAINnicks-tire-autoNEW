# Session ledger — statenour

**Updated:** 2026-08-28 (escalation + follow-ups wave)

**Objective:** chat-stack completion — WP1 (routing) and WP3 (job substrate), per the
2026-08-28 build order.

**Shipped:** #1977 (Phase 0 + WP2 durable resume) · #1983 (escalate-on-ask + agent
follow-ups + rule-7 verification pass).

**Last decision (operator, reversed twice — final answer stands):**
"all frontier" -> "no dont switch from ollama" -> "keep ollama but escalate".
Ollama Cloud is the base chat lane. A turn reaches a metered Anthropic model ONLY on an
explicit depth marker (/deep, /thorough, /mega, "comprehensive", "deep dive",
"spare no expense"). The complexity-classifier alternative was BUILT, MEASURED AND
REJECTED — do not retry it (p50 operator message is 64 chars; classifyCore returns
"quick" for most real asks).

**Blocker:** none code-side. Operator-side switches, all off by design:
  · ANTHROPIC_API_KEY — until set, escalation is inert AND says so (X-Escalation-Blocked)
  · NICK_AGENT_FOLLOWUPS=1 + the per-cron kill switch + wiring agent-followups into
    lib/inngest/jobs.ts — all three required before a single unprompted message can fire
  · optional: NICK_ESCALATION_DAILY_CAP (default 20), NICK_FOLLOWUP_* caps

**Next action:** mission promotion + Inngest Realtime progress streaming is the one WP3
piece NOT built. Substrate verified (inngest@4.4.0 exports ./realtime in-SDK) — and use
`throttle`, NOT `rateLimit`: rateLimit silently SKIPS excess runs, which for a
user-initiated mission means the turn vanishes.

**Open operator decision:** the AI SDK's DOCUMENTED resume pattern is resumable-stream +
Redis; ours is a Postgres poll. REDIS_URL IS set on Railway, so adopting the documented
pattern is available and would delete our tail loop — needs an UPSTREAMS row and a go.
See docs/audits/CHAT-COMPLETION-PHASE0-2026-08-28.md §5.
