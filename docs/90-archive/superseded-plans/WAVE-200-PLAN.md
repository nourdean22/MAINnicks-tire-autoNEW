# Wave 200 · Operator OS evolution · the substrate move

> **Status**: planning + Phase 0 scaffold landed 2026-05-17
> **Operator decision**: green-lit Mastra + Braintrust + LiveKit on 2026-05-17
> **Single architectural bet**: 1 substrate (Mastra agent layer) → 5 surfaces unlock
> **Wave-180 → Wave-200**: stops being "code we wrote for AI" → starts being "AI that operates on our behalf"

---

## Why this exists

After the Railway migration + the coherency sweep landed (CP1-CP10, 6,126 lines of dead code removed, 16 commits on main, 0 typecheck errors), the operator asked the hard question: *"is this everything · is this coherent · how do we evolve to the next level."*

The honest answer was: the infrastructure is excellent but the **UX is passive**. The operator OS has 22 system dashboards, 435 → 402 API endpoints, 991 wisdom entries, 1,423 indexed skills, 107 active commitments — but the operator still has to **navigate** to get value. Every interaction is operator-pull.

Wave 200 flips the polarity: **system-push**. The infrastructure stays · the AI starts using it on the operator's behalf.

---

## The 3 architectural picks (operator-approved)

### Pick 1 · **Mastra** as the agent layer

> Why: in-circle TypeScript agent framework (19K stars · 300K weekly npm · April 2026). 4-tier memory · MCP-first · `.suspend()/.resume()` for human-in-loop · built-in evals · layers ON TOP of Vercel AI SDK v6 (which we already run).

What it replaces: the ad-hoc agent orchestration code accreting in `apps/statenour/lib/ai/*`.
What it doesn't replace: Vercel AI SDK v6 (Mastra uses it under the hood), Anthropic SDK (still the provider), Venice/Ollama/OpenAI fallback chain (stays).
See: `docs/adr/0001-mastra-adoption.md` for tradeoffs + rejected alternatives.

### Pick 2 · **Braintrust** as the eval+observability layer

> Why: connects evals + production traces in one workflow. Production traces → test cases in 1 click. LLM-as-judge runs inline on live traces. Helicone is now in maintenance (Mintlify acq.) — Braintrust is the live answer.

What it replaces: the home-grown `/api/system/eval-results` registry pattern (we keep the page, swap the backend).
What it adds: every Nick reply gets scored in flight · regressions trigger alerts · the eval set grows from real traffic, not synthetic seeds.
See: `docs/adr/0002-braintrust-observability.md`.

### Pick 3 · **LiveKit** as the operator-facing voice layer

> Why: sub-400ms end-to-end with LiveKit Agents 1.5 + Deepgram Nova-3 + Cartesia Sonic-3. Native MCP. 60-80% cheaper than VAPI above 10k mins/month. Self-assembled = full customization.

What it complements: VAPI stays for the shop's **customer-facing** voice receptionist (the Auto Nicks line at 216-424-9249). LiveKit is for the operator's **personal** voice loop to Nick.
Where it runs: a new Railway service `statenour-voice` (Python) alongside the existing 4.
See: `docs/adr/0003-livekit-operator-voice.md`.

---

## The 5 surfaces that unlock (per the operator brainstorm)

| # | Surface | Substrate this needs from above |
|---|---|---|
| 1 | **Nick-as-agent** (chat that can act) | Mastra + Anthropic Agent Skills + Inngest (durability) |
| 2 | **Morning brief** (one push instead of 5 dashboards) | Mastra workflow scheduled on Inngest · Braintrust scoring inline |
| 3 | **Customer unified loop** | Convex/Triplit real-time layer · Mastra agent reading aggregated customer state |
| 4 | **Predictive brain** | Mem0 + Letta layered over existing brain · agentic RAG with Cohere Rerank 3.5 |
| 5 | **Mobile-first ambient console** | LiveKit voice + Web Push (VAPID already wired) · same Mastra agent backend |

---

## Sequenced execution · Phase 0 → Phase 6

### **Phase 0 · Foundation** *(Claude session 2026-05-17 · LANDED)*
- [x] WAVE-200-PLAN.md (this doc)
- [x] ADR-0001 Mastra
- [x] ADR-0002 Braintrust
- [x] ADR-0003 LiveKit operator voice
- [x] `@mastra/core` + `braintrust` packages installed in `apps/statenour/`
- [x] `apps/statenour/src/mastra/` scaffold (empty index + first agent placeholder)
- [x] typecheck still passes · build still passes

### **Phase 1 · Nick-as-agent v1** *(target: 1 week · 3-5 commits)*
- [ ] OPERATOR: create Braintrust project + paste `BRAINTRUST_API_KEY` into Railway statenour-web env
- [ ] OPERATOR: create LiveKit Cloud account + Deepgram + Cartesia accounts (or self-hosted LiveKit if cost-sensitive)
- [ ] 5 starter tools wired to Mastra:
  - `createTask(title · due · domain)`
  - `snoozeTask(id · until)`
  - `closeLoop(id · evidence)`
  - `pinMemory(text · category)`
  - `sendOperatorAlert(channel · message)` *(SMS via F25e · push via VAPID · email NOT — Resend killed)*
- [ ] Mastra agent definition: `apps/statenour/src/mastra/agents/nick.ts`
  - Provider: same Venice/Ollama/Anthropic chain via existing `@/lib/ai/provider`
  - Memory: Mastra `@mastra/memory` (working-memory + semantic-recall) wired into existing `BrainMemory` table
  - Tools: the 5 above + dynamic discovery via Anthropic Tool Search Tool over skill registry
- [x] Swap `/api/ai/chat/route.ts` to call the Mastra agent (behind
  feature flag `AGENT_V2=true`) · LANDED 2026-05-17 as early-exit
  gate after rate-limit · zero impact when flag off
- [x] Braintrust eval set: 20 golden questions · LLM-as-judge scoring
  on 4 axes (correctness · tool-use · drift · brevity) · LANDED in
  `evals/nick-baseline.eval.ts`
- [x] Phase 1.2 · Mastra working memory + last-N message window ·
  LANDED 2026-05-17 · `src/mastra/memory.ts` · in-process storage for
  zero schema impact · resource-scoped working memory template ·
  per ADR-0009
- [x] Phase 1.2 follow-up · thread/resource ID wiring through the
  Mastra cutover path · LANDED 2026-05-17 · without this Mastra
  memory silently no-ops on flip. Both `/api/agent` and `/api/ai/chat`
  AGENT_V2 branch now inject `memory: { thread: conversationId,
  resource: user.id }` into params.
- [x] AGENT_V2 smoke test · LANDED 2026-05-17 ·
  `scripts/smoke-agent-v2.ts` · runs 2 turns in-process · validates
  agent construct + stream + memory carry-over. `pnpm tsx
  scripts/smoke-agent-v2.ts` before flipping the flag.
- [ ] OPERATOR: run smoke test → flip `AGENT_V2=true` in Railway env ·
  monitor /system/logs for 24h · rollback ready by flipping back
- [x] Phase 1.3 · `@mastra/pg` flag-gated scaffold · LANDED 2026-05-17
  · `MASTRA_MEMORY_BACKEND=pg` env flag activates persistent storage
  · default (unset) stays in-process · zero schema risk on the deploy
  · graceful fallback if DATABASE_URL missing or PG construct throws
  · @mastra/pg installed (`@mastra/pg@1.11.0`)
- [ ] OPERATOR: flip `MASTRA_MEMORY_BACKEND=pg` when ready · verify
  `mastra` schema appears in Neon · `\d mastra.*` to inspect

### **Phase 2 · Skill Registry runtime exposure** *(LANDED via inheritance — 2026-05-17 · see ADR-0004)*

Audit during Phase 2 kickoff revealed the substrate was already shipped
at v10.0.431-434 (the recall layer + `searchSkills` tool + auto-inject
context block). Mastra agent inherits `nourTools` which inherits
`brainTools.searchSkills` — so Phase 1's flag flip simultaneously enables
Phase 2's runtime skill access.

- [x] `data/skills-registry.json` · 1,423 skills indexed with embeddings
- [x] `lib/skills/skill-recall.ts` · semantic search · cosine over `VectorEmbedding`
- [x] `lib/skills/skill-context.ts` · auto-injects top-3 relevant skills per turn
- [x] `searchSkills` tool (in `brain.ts`) · explicit lookup surface
- [x] Mastra agent inherits via `nourTools` spread (Phase 1 commit `b27b58fb`)
- [x] ADR-0004 documents the architecture + why we rejected Anthropic Tool Search Tool
- [ ] *(optional follow-up)* Wire Anthropic Tool Search Tool as a wrapper IF
  Anthropic becomes the dominant provider — not needed today
- [ ] *(optional follow-up)* Chat UI badge: "skills Nick used this turn"
  (telemetry already written to `SystemMetric` rows · just needs a view)

### **Phase 3 · Inngest durability** *(SCAFFOLD LANDED 2026-05-17 · 1 commit · see ADR-0005)*

Scaffold + first function shipped. Operator action items below
remain blocking for prod cutover · code runs in dev mode until then.

- [x] `inngest@4.4.0` installed in `apps/statenour/`
- [x] `src/inngest/client.ts` · lazy singleton + `isInngestFullyConfigured()`
- [x] `src/inngest/functions/mega-fanout.ts` · morning + evening fan-out
  with `step.run` per child cron · concurrency 6 · retries 3
- [x] `app/api/inngest/route.ts` · serve endpoint (GET/POST/PUT)
- [x] ADR-0005 documents adoption + cutover + rollback
- [ ] OPERATOR: create Inngest account at https://app.inngest.com
- [ ] OPERATOR: create app `statenour-web` · paste `INNGEST_EVENT_KEY`
  + `INNGEST_SIGNING_KEY` into Railway statenour-web env
- [ ] OPERATOR: connect `https://autonicks.com/api/inngest` in
  Inngest dashboard "Apps" page
- [ ] OPERATOR: verify two functions appear with cron schedules
- [ ] OPERATOR: after 7 consecutive successful runs · disable Railway
  cron entry for `/api/cron/mega` (the Inngest cron takes over)
- [ ] *(follow-up)* `step.waitForEvent` for operator-in-loop workflows
  (used by Phase 4-6 functions · scaffold supports it but no
  consumer yet)
- [x] Telegram alert on Inngest function failure · LANDED 2026-05-17 ·
  shared `onInngestFailure` handler wired to all 4 functions · types
  tightened to Inngest's `FailureEventArgs` · reuses existing
  sendTelegram · fires only after retries exhaust
- [x] Collapse duplicated `MORNING_JOBS`/`EVENING_JOBS` arrays into
  shared `src/inngest/jobs.ts` · LANDED 2026-05-17 · both legacy
  `/api/cron/mega` route and Inngest fan-out import from one source
  · drift bait eliminated · `app/api/cron/mega/route.ts` dropped
  222 LOC of dead reference
- [x] step.waitForEvent example · LANDED 2026-05-17 ·
  `src/inngest/functions/bulk-sms-approval.ts` · operator approves
  via Telegram inline command · 30min timeout · TEMPLATE only (no
  actual SMS dispatch wired · zero risk of accidental mass-SMS)
- [x] Inngest local dev runner · LANDED 2026-05-17 · `inngest-cli`
  devDep + `pnpm --filter @statenour/web inngest:dev` script
- [x] Operator runbook · LANDED 2026-05-17 ·
  `docs/operator/inngest-setup.md` · 5-step paste-and-go +
  rollback + troubleshooting
- [x] Health endpoint surfaces Inngest config + function count +
  mega-job counts + Braintrust wrap status + AGENT_V2 flag · LANDED
  2026-05-17 · single probe shows the full Wave-200 substrate state

### **Phase 4 · LiveKit operator voice** *(SCAFFOLD LANDED 2026-05-17 · 1 commit · see ADR-0006)*

Full scaffold shipped · operator accounts + Railway service +
env-var paste are the blocking action items for prod cutover.

- [x] `apps/voice/` Python LiveKit Agents worker (`agent.py` +
  `requirements.txt` + `Dockerfile` + `.dockerignore` + `.python-version`
  + `.gitignore` + `README.md`)
- [x] HTTP bridge in `agent.py` · `llm_node` override POSTs each turn
  to `/api/agent` (Phase 1 Mastra endpoint) · streams text deltas to
  Cartesia
- [x] Owner-only LiveKit JWT mint endpoint · `app/api/voice/token/route.ts`
- [x] PWA push-to-talk launcher · `app/voice/page.tsx` · lazy-imports
  livekit-client · one-tap connect/disconnect · graceful degrade
- [x] `livekit-server-sdk` + `livekit-client` installed in `apps/statenour/`
- [x] ADR-0006 documents Python vs JS · HTTP bridge vs in-process LLM ·
  persistent vs ephemeral rooms · operator action items
- [ ] OPERATOR: create LiveKit Cloud + Deepgram + Cartesia accounts
- [ ] OPERATOR: add new Railway service `statenour-voice` (build path
  `apps/voice`, Dockerfile, watch `apps/voice/**`)
- [ ] OPERATOR: paste env vars (LIVEKIT_URL, LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET, DEEPGRAM_API_KEY, CARTESIA_API_KEY,
  CARTESIA_VOICE_ID, STATENOUR_AGENT_URL, STATENOUR_OWNER_COOKIE)
- [ ] OPERATOR: install PWA from `https://autonicks.com/voice` on phone
  (Add to Home Screen)
- [ ] First demo: tap voice button on phone · say "what are my 3
  highest-leverage moves today" · Nick speaks the reply
- [ ] *(follow-up · OPERATOR)* Cartesia AUDIO voice clone training.
  IMPORTANT clarification (2026-05-17): `lib/ai/voice-clone-trainer.ts`
  is the TEXT voice profile (Fireflies → BrainMemory · style + cadence
  for the prompt builder) · NOT Cartesia. The audio clone is a manual
  Cartesia dashboard step: record 3-5 min of clean audio → upload to
  Cartesia → copy the resulting voice ID → set `CARTESIA_VOICE_ID` in
  Railway env (apps/voice + statenour-web). Until then default
  Cartesia voice (Aspen) is used.
- [ ] *(follow-up)* Dedicated voice-bridge bearer token (replaces
  STATENOUR_OWNER_COOKIE · rotates independently)

### **Phase 5 · Morning brief + ambient mode** *(LANDED 2026-05-17 · 1 commit · see ADR-0007)*

Multi-channel morning brief shipped. The legacy Telegram path stays
unchanged · new Inngest function adds Web Push + pre-rendered audio.

- [x] `src/inngest/functions/morning-brief.ts` · 3-step orchestrator
  (compose · web-push · voice-file) · cron 10:00 UTC daily
- [x] `app/api/morning-brief/today.mp3` · owner-only audio playback
  endpoint · reads from BrainMemory cache · 5min HTTP cache
- [x] Cartesia TTS integration via `https://api.cartesia.ai/tts/bytes`
  · gracefully skipped when CARTESIA_API_KEY unset
- [x] Web Push via existing VAPID pipeline (`lib/notifications/push.ts`)
  · `chatSeed` lets operator tap notification and land in chat
  pre-quoted
- [x] Legacy `/api/cron/morning-brief` Telegram path unchanged
  (additive · backward compatible)
- [x] ADR-0007 documents the layered architecture + rejected
  alternatives + caching strategy
- [ ] *(operator follow-up · optional)* After 7 days of clean Inngest
  runs, remove the `sendTelegram(brief.text)` call from
  `/api/cron/morning-brief/route.ts` if push-only is preferred
- [x] "Play today's brief" button on `/voice` page · LANDED 2026-05-17 ·
  HEAD probe surfaces "no audio today" vs error · auto-disables
  while a voice session is live so playback doesn't compete
- [ ] *(future · Phase 5+)* Outbound LiveKit voice call with the
  brief read live (waits for Cartesia voice clone training to finish)

### **Phase 6 · Customer unified loop + predictive brain** *(SCAFFOLD LANDED 2026-05-17 · 1 commit · see ADR-0008)*

Pragmatic scope · ship the read path + inference layer on the existing
stack. Convex / Mem0 / Letta deferred per ADR-0008 (revisit when
evidence demands them · zero blocking action items today).

- [x] `customer_detail` query added to nickstire-side nour-os-query
  handler · returns customer + last-10-invoices + last-5-estimates +
  last-5-ALG + last-5-callbacks in one round-trip
- [x] `lib/brain/customer-preferences.ts` · pure-function inference
  (visitFrequency · paymentBehavior · conversionRate · declinedValue ·
  avgTicket · LTV tier · openRecovery · hasOpenCallback) · 250 LOC ·
  rule-based · operator-auditable
- [x] `app/api/customer-360/[customerId]` · owner-only read endpoint ·
  bridge + cached prefs + degraded-mode fallback
- [x] `app/(mastery)/customer-360/[customerId]/page.tsx` · single-pane
  view · LTV badge · summary line · 6-stat grid · 4-tab timeline ·
  mobile-first · matches editorial-minimalist aesthetic
- [x] `src/inngest/functions/customer-preferences.ts` · daily 11:00 UTC
  recompute · concurrency 4 · per-customer step retries ·
  soft-degrades when `recent_customer_ids` query unavailable
- [x] Cohere Rerank 3.5 + agentic RAG · already shipped at v10.0.363
  in `lib/brain/cohere-rerank.ts` + `lib/brain/contextual-recall.ts`
  (verified during Phase 6 audit · same as Phase 2 skill registry —
  the substrate predates Wave-200)
- [x] ADR-0008 documents layered approach + Convex/Mem0/Letta deferral
- [ ] OPERATOR: add `recent_customer_ids` query handler to nickstire's
  nour-os-query.ts (~10 LOC SQL · returns
  `{ customerIds: string[] }`) — enables the daily Inngest recompute.
  Until then, per-visit live recompute still works fine
- [x] Wire morning-brief composer to surface preferences for the
  top-3 declined-work customers · LANDED 2026-05-17 ·
  `lib/services/morning-brief.ts` `annotateWithPreferences()` · pure
  read · gracefully empty when no customer IDs flow through bridge ·
  zero noise when preference cache empty
- [x] Outreach campaign builder · LANDED 2026-05-17 ·
  `app/(mastery)/outreach/page.tsx` segments by LTV tier · payment
  behavior · min declined value · operator-composes message · POSTs
  to `/api/outreach/propose` which emits `bulk-sms/proposed` Inngest
  event · operator approves/rejects via Telegram `/approve <id>` /
  `/reject <id>` (handled in `app/api/telegram/webhook/route.ts`) ·
  dispatch step in `bulk-sms-approval` Inngest function is TEMPLATE
  until nickstire-side bulk-SMS endpoint is wired (zero risk of
  accidental mass-SMS today)
- [ ] *(future · Phase 6+)* Convex layer · evaluate when real-time
  receptionist co-pilot lands
- [ ] *(future)* Mem0 SaaS · evaluate if rule-based inference feels
  narrow after 30d of use
- [ ] *(future)* Letta episodic memory · "what did Nour decide last
  time about X" — substrate already there via BrainMemory · needs a
  consumer that asks the question

### **Phase D · /journal pattern-radar** *(LANDED 2026-05-18 · see ADR-0013)*

Evolves /journal from chronological storage into a Pattern Radar
surface. Quiet by default · alerts fire only on CONVERGENCE
(multiple recent entries pointing at one emerging theme) · operator
names the cluster · it becomes a pinned thread auto-growing with
future similar entries.

- [x] Q1-Q5 brainstorming + Understanding Lock confirmed by operator
- [x] ADR-0013 documents the design + 10-item Decision Log + the
  vector-database-engineer audit fix (cached centroid on the thread
  row to avoid N×M roundtrip on capture)
- [x] schema · JournalThread + JournalThreadEntry (polymorphic
  membership via entrySource + entryId · 4 bounded source types)
- [x] migrations-pending/0002_journal_threads · parked per WAVE-200
  non-negotiable #1
- [x] services · journal-convergence (gather → embed → cluster →
  prune → suggest → persist) + journal-threads (CRUD + rolling
  centroid + dormancy)
- [x] API · /api/journal/threads + /api/journal/convergence (both
  owner-gated)
- [x] inngest · journal-convergence-scan (nightly 22:00 UTC) +
  journal-thread-dormancy (daily 23:00 UTC) · health endpoint
  fn count 6 → 8
- [x] UI · ThreadRadar + ThreadRail wired into /journal page
  (ABOVE the metacognition card · null when empty so page looks
  unchanged unless something fires)
- [x] OPERATOR: apply parked migration via Neon SQL editor — APPLIED
  2026-05-18 · both `journal_threads` + `journal_thread_memberships`
  verified in prod Neon
- [ ] OPERATOR: open /journal day after first 22:00 UTC cron · name
  first thread if convergence fires

---

## Cost projection

| Service | Setup | Monthly | Notes |
|---|---|---|---|
| Mastra | $0 | $0 | OSS · runs in our existing Railway containers |
| Braintrust | $0 (free tier) | $0 → $50 | 1M spans/mo free · paid tier when we exceed |
| Inngest | $0 (free tier) | $0 → $20 | 50K events/mo free · paid tier when we exceed |
| LiveKit Cloud | $0 | ~$30 | $0.20/connection-min · ~100-300 min/day · operator-only |
| Deepgram Nova-3 | $0 | ~$15 | $0.0043/min STT |
| Cartesia Sonic-3 | $0 | ~$20 | $0.015/min TTS |
| Mem0 | $0 | $0 → $50 | Free tier 50K memories · self-host option |
| Cohere Rerank 3.5 | $0 | ~$15 | $0.005/query · ~3K queries/day cap |
| Convex (Phase 6 only) | $0 | $25 | Free tier 1M function calls · we'd exceed |

**Total expected new monthly run rate**: ~$175/mo at full ramp. Offset partially by VAPI minute reduction (Nour talks to Nick on LiveKit instead) + Resend already dropped.

---

## Non-negotiables (lessons learned from the migration)

1. **No prod DB schema changes without a parked migration first** (the `Task.snoozed_until` bug ate 2 hours · don't repeat)
2. **Every new code path ships with a Braintrust eval before it goes live** (catch regressions before the operator notices)
3. **No new framework adoption without an ADR** (Mastra/Braintrust/LiveKit each get one · future picks too)
4. **No dead code accumulation** (after each phase: run the orphan finder · delete what nothing imports · commit "chore · orphan delete")
5. **Operator-facing surfaces stay mobile-first** (44px tap targets · push notifications first · voice second · desktop third)
6. **The 1,423-skill registry stays the source of truth** (we expose them at runtime · we don't fork them per surface)

---

## Rollback plan (per phase)

| Phase | What to revert | How |
|---|---|---|
| 1 (Nick v2) | The Mastra agent endpoint | `AGENT_V2=false` env flag · old chat code stays in place during the cutover window |
| 2 (Skills runtime) | Anthropic Tool Search Tool wiring | Remove the tool from Mastra agent config · skills fall back to static include |
| 3 (Inngest) | Mega fan-out durability | Revert mega/route.ts to the current concurrency-limited Promise.all pattern |
| 4 (LiveKit) | Voice service | Stop the Railway statenour-voice service · operator switches back to text chat |
| 5 (Morning brief) | Workflow + notification | Disable the Inngest cron · operator goes back to manual dashboard scan |
| 6 (Customer 360) | Convex layer | Drop the Convex schema · React surface falls back to existing tab-by-tab admin |

---

## What this doc IS NOT

- Not a contract — phases will reorder if reality demands
- Not a complete spec — each phase needs its own design pass before implementation
- Not solo work — the operator decides when each phase starts based on their bandwidth + the prior phase's pass criteria

---

## Linked artifacts

- `docs/adr/0001-mastra-adoption.md` — Mastra decision + rejected alternatives
- `docs/adr/0002-braintrust-observability.md` — Braintrust decision
- `docs/adr/0003-livekit-operator-voice.md` — LiveKit + Deepgram + Cartesia decision
- `docs/adr/0004-skill-registry-runtime.md` — why we kept the existing recall layer (Phase 2)
- `docs/adr/0005-inngest-durable-workflows.md` — Inngest adoption + cutover (Phase 3)
- `docs/adr/0006-livekit-voice-implementation.md` — LiveKit Python worker + HTTP bridge (Phase 4)
- `docs/adr/0007-morning-brief-multichannel.md` — multi-channel brief delivery (Phase 5)
- `docs/adr/0008-customer-360-predictive-brain.md` — Customer 360 + preferences layer (Phase 6)
- `docs/adr/0009-mastra-memory.md` — Mastra in-process memory now · `@mastra/pg` Phase 1.3 (Phase 1.2)
- `docs/adr/0010-goals-page-merge.md` — /plan + /mastery merged into /goals · LADDER + SIDEBAR · pruner cron (Phase A.1 · post Wave-200)
- `docs/adr/0011-meta-scoreboard.md` — /scoreboard page · 5 anchors + 4 anomaly detectors · calm/alive state · brief feeds meta (Phase A.2)
- `docs/adr/0012-mission-lifegoal-fk.md` — Mission.lifeGoalId schema migration · parked at prisma/migrations-pending/ (Phase A.3)
- `docs/adr/0013-journal-pattern-radar.md` — /journal pattern-radar · convergence detection → named threads · centroid cache via vector-DB audit (Phase D)
- `docs/system-pages-audit.md` — 35-page /system/* consolidation plan · operator action items per row (Phase C)
- `apps/statenour/src/mastra/` — Phase 0 scaffold (this commit)
- `apps/statenour/src/mastra/memory.ts` — Phase 1.2 Mastra memory factory
- `apps/statenour/src/inngest/jobs.ts` — single source of truth for mega-cron job arrays
- `apps/statenour/src/inngest/on-failure.ts` — Telegram alert handler typed against FailureEventArgs
- `apps/statenour/src/inngest/functions/bulk-sms-approval.ts` — step.waitForEvent example
- `docs/operator/inngest-setup.md` — paste-and-go operator runbook
- `apps/statenour/src/inngest/` — Phase 3 scaffold (client + functions)
- `apps/voice/` — Phase 4 LiveKit Python worker
- `apps/statenour/app/voice/page.tsx` — Phase 4 PWA push-to-talk launcher
- `docs/MIGRATION_PLAN.md` — the Wave-100→200 Railway migration that landed today
