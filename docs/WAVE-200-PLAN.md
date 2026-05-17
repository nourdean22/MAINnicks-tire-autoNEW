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
- [ ] Swap `/api/ai/chat/route.ts` to call the Mastra agent (behind a feature flag · `AGENT_V2=true`)
- [ ] Braintrust eval set: 20 golden questions · LLM-as-judge scoring on 4 axes (correctness · tool-use · drift · brevity)
- [ ] Cutover: flip `AGENT_V2=true` in Railway env · monitor /system/logs for 24h · rollback ready by flipping back

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
- [ ] *(follow-up)* Telegram alert on Inngest function failure
  (Inngest webhook → existing alert pipeline · trivial wire-up)
- [ ] *(follow-up)* Collapse duplicated `MORNING_JOBS`/`EVENING_JOBS`
  arrays once cutover sticks 7d (shared config module)

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
- [ ] *(follow-up)* Cartesia voice clone training (uses existing
  `lib/ai/voice-clone-trainer.ts` weekly cron · operator pastes the
  resulting voice ID into CARTESIA_VOICE_ID)
- [ ] *(follow-up)* Dedicated voice-bridge bearer token (replaces
  STATENOUR_OWNER_COOKIE · rotates independently)

### **Phase 5 · Morning brief + ambient mode** *(target: 1 week · 2-3 commits)*
- [ ] Mastra workflow `morning-brief.workflow.ts` · fires daily at 5am ET via Inngest
- [ ] Aggregates: overnight errors · cron failures · commitments due today · new leads/calls · revenue delta · brain insights · ALG status
- [ ] Output: 1 Web Push notification (already have VAPID) · TL;DR voice file (Cartesia) saved at `/api/morning-brief/today.mp3`
- [ ] One-tap from push → opens the morning view (replaces the laptop ritual)
- [ ] Bonus: tap the push → trigger an outbound LiveKit voice call to the operator's phone with the brief

### **Phase 6 · Customer unified loop + predictive brain** *(target: 2-3 weeks · 5-8 commits)*
- [ ] Convex layer over existing nickstire Drizzle/MySQL (one-way read sync first · write-back optional later)
- [ ] React surface in nickstire admin: `Customer360` view per customer · timeline of every touch
- [ ] Mem0 layer for per-customer preference: "Brennen prefers afternoons · pays late · drives a Cadillac"
- [ ] Predictive layer: agentic RAG with Cohere Rerank 3.5 over `BrainMemory` · multi-hop for complex questions
- [ ] Letta episodic memory for "what did Nour decide last time about X"
- [ ] Anticipate cron upgrade: pre-computes 5 likely next-questions + drafts answers (existing cron extended)

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
- `apps/statenour/src/mastra/` — Phase 0 scaffold (this commit)
- `apps/statenour/src/inngest/` — Phase 3 scaffold (client + functions)
- `apps/voice/` — Phase 4 LiveKit Python worker
- `apps/statenour/app/voice/page.tsx` — Phase 4 PWA push-to-talk launcher
- `docs/MIGRATION_PLAN.md` — the Wave-100→200 Railway migration that landed today
