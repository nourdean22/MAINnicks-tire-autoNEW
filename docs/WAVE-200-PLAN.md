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

### **Phase 2 · Skill Registry runtime exposure** *(target: 1 week · 2-3 commits)*
- [ ] Convert the 50 highest-leverage skills in `data/skills-registry.json` → Anthropic Agent Skills format
  - Each becomes a directory under `apps/statenour/skills/<skill-id>/SKILL.md`
  - SKILL.md = YAML frontmatter (name · description) + progressive disclosure body + bundled scripts/refs/assets
- [ ] Mount the skills directory into Mastra agent's tool surface
- [ ] Wire **Anthropic Tool Search Tool** so Nick discovers skills on demand (85% context reduction)
- [ ] First-class skill suggestions surface in chat UI (current chat has hot-questions; add "skills Nick is using now")
- [ ] Validate against the Phase-1 Braintrust eval set · should not regress

### **Phase 3 · Inngest durability** *(target: 3-5 days · 2 commits)*
- [ ] OPERATOR: create Inngest account · paste `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` into Railway statenour-web env
- [ ] Rewire the existing `/api/cron/mega` fan-out as Inngest functions with `step.run` (each child cron = one step · auto-retry · cached on partial fail)
- [ ] Long-running agent tasks (Nick handles a multi-step plan) go on Inngest with `step.waitForEvent` for the operator's confirmation
- [ ] Existing Railway-cron triggers → emit Inngest events instead of HTTP calls (worker becomes simpler · or retires entirely if we ship LiveKit too)
- [ ] Telegram alert on any Inngest function failure (replaces ad-hoc cron-failure detection)

### **Phase 4 · LiveKit operator voice** *(target: 1-2 weeks · 4-6 commits + new Railway service)*
- [ ] OPERATOR: create LiveKit Cloud + Deepgram + Cartesia accounts (cost: ~$30-50/mo at expected 100-300 min/day operator usage)
- [ ] New repo dir: `apps/voice/` (Python · LiveKit Agents framework · pnpm workspace skips it · separate pyproject)
- [ ] Voice agent worker: streams audio in/out · same Mastra agent backend (HTTP bridge to statenour-web)
- [ ] New Railway service `statenour-voice` (Python builder · Dockerfile · port 8080 · healthcheck `/health`)
- [ ] Mobile launcher: a PWA-installable page at `/voice` on statenour-web · push-to-talk button · sub-400ms target
- [ ] First demo: speak "what are my 3 highest-leverage moves today" from phone → Nick answers in voice

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
- `apps/statenour/src/mastra/` — Phase 0 scaffold (this commit)
- `docs/MIGRATION_PLAN.md` — the Wave-100→200 Railway migration that landed today
