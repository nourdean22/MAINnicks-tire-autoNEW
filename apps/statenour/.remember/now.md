# Session ledger — statenour

Updated: 2026-09-01

**Updated:** 2026-09-01 (audit wave · #2057 docs · #2058 P0 · #2059 wiring · #2060 N-1 follow-up)

**Objective:** land the 2026-09-01 research brief + forensic audit, synthesize them into one
decision document, then fix every defect the audit VERIFIED — each with a test that failed
first — and prove the P0 closed on production. Read
`docs/research/2026-09-01-statenour-plan.md` before re-deriving any of it.

**Shipped:** #2057 `ca056cbc2` (5 docs) · #2058 `1bc3d43b0` (P0: dotted-path session-gate
bypass, BOTH halves — `isStaticFile()` + root-level matcher; verified 307 on prod `1bc3d43`
at 2026-09-02 00:13Z for /decisions/1.2, 9.9, abc.def, 1.png, 1.js) · #2059 `b7d0f62f3`
(P-1 memory quarantine wired to inbound gmail via `lib/brain/external-memory-intake.ts`;
S-1 recall fenced as `memory_recall`; W-1 dead top ticker deleted + layout comment
corrected; W-3 BottomPulseTicker rendered in the a11y test; R5 `tests/repo/ui-mount-graph
.test.ts` reachability gate with PARKED + inverse check) · #2060 (N-1 `NICK_MUTATION_LOCK`
fails CLOSED at both enforcement points; three superseded Ultron components deleted, PARKED
= 13) — see RECONCILIATION top.

**S-1 was one-fifth done in #2059** — the cross-session thread (#2062), hybrid recall,
anticipatory recall, chat recall (#2064) and the memory-returning TOOLS (`searchMemories`,
`searchColdMemory`, `searchConversations`, customer-360 notes) all reached the model unfenced
until 2026-09-02. Two gates now enumerate the producers (`tests/ai/prompt-block-fencing-gate
.test.ts`) and a behavioural test runs the real `buildBrainContext` with malicious rows
(`tests/ai/brain-context-fencing.test.ts`). When asked "is X fenced", enumerate EVERY assembler.

**Behaviour change to know about:** inbound gmail memories now wait for review at
/system/inbox instead of landing in BrainMemory automatically (sent mail + Apple Notes
still write directly). Telegram nudges unaffected.

**Last decision (operator):** "every upgrade, don't stop until merged" — so N-1's failure
direction (fail closed, matching middleware.ts) shipped instead of waiting; reverting is one
line per file. The 2026-08-28 decision still stands: Ollama Cloud is the base chat lane,
metered Anthropic only on an explicit depth marker; the complexity classifier was built,
measured and REJECTED — do not retry it.

**Blocker:** none code-side. Operator-side switches carried from 2026-08-28, all off by
design: ANTHROPIC_API_KEY (escalation inert + says so until set) · NICK_AGENT_FOLLOWUPS=1 +
the per-cron kill switch + wiring agent-followups into lib/inngest/jobs.ts (all three before
a single unprompted message can fire) · optional NICK_ESCALATION_DAILY_CAP / NICK_FOLLOWUP_*.

**Open operator decisions (do NOT decide on agent initiative):**
  · /business — DECIDED 2026-09-02: deleted (redirect to /stats). The coaching CRM has no
    navigable home now; that cost was named and accepted.
  · langfuse:false + sentry:false in production (/api/version) — Railway env, not code.
  · AI SDK v6 → v7 (providers a full major behind).
  · The 13 remaining PARKED components (3D scene, actions/loops island, compound-chain,
    four Ultron cards) — re-mount or delete.
  · Routing drive / calendar / reviews ingestion through the intake — inbox-volume call.
  · Carried from 2026-08-28: WP3 mission promotion + Inngest Realtime progress streaming is
    NOT built (use `throttle`, not `rateLimit` — rateLimit silently SKIPS excess runs);
    resumable-stream + Redis vs the Postgres poll needs an UPSTREAMS row and a go
    (docs/audits/CHAT-COMPLETION-PHASE0-2026-08-28.md §5).

**Next action:** exercise ONE authenticated control end to end (the audit's largest gap —
read-only mode never ran a handler → API → authz → DB → UI round trip), starting with
/system/inbox review → BrainMemory commit for a quarantined gmail item, since #2059 made that
path live.
