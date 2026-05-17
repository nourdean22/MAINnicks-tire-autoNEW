# ADR-0003 · LiveKit + Deepgram + Cartesia for operator-facing voice

- **Status**: Accepted · 2026-05-17
- **Operator**: nour
- **Author**: Claude (Wave-200 brainstorm session)
- **Complements**: VAPI (which stays · for the shop's customer-facing voice receptionist at 216-424-9249)

## Context

Today's voice infrastructure:
- **VAPI** is wired into nickstire admin for the shop's voice receptionist ("Nick" line at 216-424-9249)
- Customer calls VAPI → Gemini 2.5 Flash → tools (`scheduleDropoff` · `lookupCustomer` · `submitCallback`) → transfer-to-shop fallback
- 0 voice-side surface for the OPERATOR's own use (Nour talking TO Nick about his own work)

The operator spends most of the day on phone, often hands-busy (shop floor). Typing chat doesn't work in those windows. Voice does.

VAPI **could** do operator voice too, but:
- $0.09-0.35/min managed pricing · costs ~$60-200/mo at expected operator usage
- 600-1000ms end-to-end latency · feels slow for back-and-forth
- Locks us into VAPI's tool framework · separate from Mastra
- Pricing doesn't scale into "ambient · always-on" workflow

## Decision

Add a **separate** operator-facing voice loop using:
- **LiveKit Agents** (Python · `livekit-agents-python` 1.5.x) · WebRTC transport · self-assembled
- **Deepgram Nova-3** STT · ~80ms latency · best-in-class English
- **Cartesia Sonic-3** TTS · ~90ms latency · best-value voice model
- **Same Mastra agent backend** as the chat surface (HTTP bridge · single brain)

Target: **sub-400ms** end-to-end voice loop (operator speaks → Nick replies).

VAPI keeps the shop line. LiveKit becomes the operator line. Different audiences, different infrastructure.

## Why LiveKit over VAPI for the operator

| Capability | VAPI | LiveKit Agents 1.5 |
|---|---|---|
| End-to-end latency | 600-1000ms | 320-400ms |
| Cost @ 100-300 min/day | $60-200/mo | ~$30/mo |
| Tool framework | VAPI's (separate) | Native MCP · same surface as Mastra |
| Voice customization | Limited · VAPI menu | Full · pick STT · LLM · TTS independently |
| Backend control | Webhook-only | Full bidirectional via WebRTC |
| Interruption handling | Good | Better (adaptive · 1.5 release) |
| Self-host option | No | Yes (LiveKit OSS server) |

The single line: **VAPI is great for customers. LiveKit is great for operators who want voice as a primary interface.**

## Rejected alternatives

| Option | Why rejected |
|---|---|
| **VAPI for both** | Cost scales badly at expected usage. Same orchestration as customer flow forces awkward feature flags. |
| **Pipecat** | More flexible than LiveKit (you wire each component manually) · we don't need that flexibility · LiveKit's convention-over-configuration ships faster. |
| **Retell** | Newer · managed · narrower component selection · costs land between VAPI and LiveKit-self-assembled. |
| **OpenAI Realtime API** | Beautiful audio · GPT-4o voice · but tool calling is weaker · vendor lock · pricing not yet competitive at sustained usage. |
| **Browser-only with Web Speech API** | Free · but Web Speech accuracy is dramatically worse than Deepgram and the latency is +500ms. Not viable. |
| **Defer voice entirely** | Voice is the unlock for shop-floor usage. Without it the operator can't reach Nick during work hours. Deferring = losing 6+ hours/day of potential interaction. |

## How it integrates

```
Operator (phone PWA)
  ↓  WebRTC bidirectional audio
  ↓
LiveKit Cloud (or self-hosted)
  ↓  Python agent worker (Railway: statenour-voice)
  ├──→ Deepgram Nova-3 (STT)
  ├──→ Mastra Agent HTTP bridge → statenour-web /api/agent (NEW · Phase 4)
  │      ↓ same Mastra agent as chat · same tools · same memory
  │      ↓ same Braintrust scoring on every turn
  │      ↑
  ├──→ Cartesia Sonic-3 (TTS)
  ↓
Operator (audio response)
```

Same brain, two surfaces (chat + voice). The Mastra agent doesn't care which surface fired it.

## Where it runs

**New Railway service**: `statenour-voice`
- Source: `apps/voice/` (Python · pnpm workspace ignores it · separate `pyproject.toml`)
- Builder: Dockerfile (Python 3.12 · LiveKit Agents framework deps)
- Port: 8080 (health) + WebRTC port range
- Resources: 1GB RAM (LiveKit agent worker)
- Domain: optional public URL (LiveKit Cloud handles WebRTC signaling either way)

## Consequences

### Positive
- Operator can talk to Nick during shop hours without typing
- Sub-400ms feels conversational (versus VAPI's 800ms which feels delayed)
- Same backend agent · no code duplication between chat and voice
- Voice cost stays predictable (we control the stack)
- Future: outbound voice (Nick calls operator with the morning brief · Phase 5)

### Negative
- New service to maintain (Python · adds polyglot complexity to a TS monorepo)
- LiveKit Cloud is a paid SaaS (free dev tier · ~$30/mo at expected operator usage)
- Three new API keys (LiveKit · Deepgram · Cartesia)
- Mobile PWA install required to get push-to-talk button on the home screen

### Neutral
- VAPI stays. Shop receptionist line unaffected.
- The Mastra agent backend doesn't know voice from chat. Cleanly separated.

## Implementation phases

See `docs/WAVE-200-PLAN.md` § Phase 4.

Phase 4 is the implementation phase · scaffold ships after Phase 1 (Mastra agent) and Phase 3 (Inngest durability) are stable.

## Operator action items (before Phase 4)

1. Visit <https://livekit.io> · sign up for LiveKit Cloud · create a project (suggest name: `statenour-operator`)
2. Generate API key + secret · copy
3. Visit <https://deepgram.com> · sign up · generate API key (Nova-3 access)
4. Visit <https://cartesia.ai> · sign up · generate API key (Sonic-3 voice access)
5. Pick a voice clone or stock voice · note the voice ID
6. Set in Railway statenour-voice env (when the service exists in Phase 4):
   ```
   LIVEKIT_URL=wss://<your-project>.livekit.cloud
   LIVEKIT_API_KEY=<key>
   LIVEKIT_API_SECRET=<secret>
   DEEPGRAM_API_KEY=<key>
   CARTESIA_API_KEY=<key>
   CARTESIA_VOICE_ID=<voice id from step 5>
   STATENOUR_WEB_URL=https://statenour-web-production.up.railway.app
   CRON_SECRET=<same as web · for the agent HTTP bridge auth>
   ```

## Verification

- Phase 4 acceptance:
  - Phone-side: push-to-talk button → speak "what's on my plate today" → audio reply within 400ms median
  - Same Mastra agent backend confirmed (the eval suite for chat must also pass when fired via the voice bridge)
  - Cost burn: <$50/mo after 1 week of typical usage
- Rollback: stop the `statenour-voice` Railway service · operator switches back to text chat in /chat

## References

- LiveKit Agents 2026 playbook: <https://www.forasoft.com/blog/article/livekit-ai-agents-guide>
- Voice agent stack guide: <https://hamming.ai/resources/best-voice-agent-stack>
- LiveKit vs Pipecat: <https://sellerity.co/blog/livekit-pipecat-web-voice-agents>
