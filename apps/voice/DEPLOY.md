# statenour-voice · deploy contract

**Role** · Python LiveKit voice agent for the "Nick" persona (sub-500ms speech-to-speech).
Distinct from the Twilio VAPI agent (`216-424-9249`) which is configured externally.

## Railway service

| Field | Value |
|---|---|
| Project | `natural-appreciation` |
| Project ID | `d78487fa-24c7-412e-9d2c-1055d9f8db93` |
| Service | `statenour-voice` |
| Service ID | `fd46d4cf-62a4-4379-98e2-a03eb19ed54c` |
| Environment | `production` |
| Region | US West |
| Build context | `apps/voice/` (Python · NOT monorepo root) |
| Dockerfile | `apps/voice/Dockerfile` |
| Stack | Python 3.11 (Dockerfile) · LiveKit Agents SDK · Deepgram Nova-3 STT · Cartesia Sonic TTS · Silero VAD |

## Deploy trigger

Auto-deploys on push to **`main`** when files under `apps/voice/**` change.

Notably **not part of the Turbo task graph** · Python isn't a pnpm package. Turbo's
affected detection won't catch shared-dep changes (e.g. brand tokens) · this is OK
for now since voice doesn't share Node.js deps with the other apps.

## Pre-deploy validation

```bash
cd apps/voice
python -m py_compile agent.py  # syntax check
# No automated test suite yet · see Tier-3 backlog
```

## Build pipeline

```
deps  → pip install -r requirements.txt
runtime → python agent.py (long-running websocket agent)
```

## Env vars (Railway-managed)

CRITICAL:
- `DEEPGRAM_API_KEY` · Nova-3 STT
- `CARTESIA_API_KEY` · Sonic TTS
- `STATENOUR_AGENT_URL` · the statenour chat endpoint this bridges to. **Required** — the worker refuses to start without it (see Known-broken below)
- `VOICE_BRIDGE_TOKEN` · bearer token for that endpoint (preferred over the legacy `STATENOUR_OWNER_COOKIE`)
- `LIVEKIT_API_KEY` · agent registration
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL` · LiveKit Cloud websocket endpoint

## Rollback

Railway dashboard → Deployments → previous green → Redeploy.

If the voice agent is misbehaving in a customer call, kill the service replica
(Railway → service → Settings → replicas 0) · falls back to text-only chat.

## Common failure modes

| Symptom | Diagnosis | Fix |
|---|---|---|
| Agent doesn't connect | LiveKit creds drift | Re-sync `LIVEKIT_*` env vars from LiveKit Cloud console |
| High latency (>800ms) | Deepgram/Cartesia rate limit OR LiveKit region drift | Check `/system/voice-latency` metrics · consider re-region |
| Crash on join | Python version mismatch | Verify `.python-version` matches Railway Python image |

## Related docs

- `apps/voice/agent.py` · the agent definition
- `apps/voice/README.md` · setup
- `apps/statenour/lib/services/voice-latency.ts` · telemetry (currently broken · Prisma model missing per known issues)


## Known-broken · the bridge target no longer exists (2026-08-03)

`agent.py` POSTs each turn to `STATENOUR_AGENT_URL`, whose default is
`http://localhost:3001/api/agent`. **That route was deleted** from statenour in
`33a035257` ("delete Mastra Agent V2 … Delete src/mastra/**, /api/agent",
2026-06-02), along with `src/mastra/agents/nick.ts` and
`scripts/smoke-agent-v2.ts`. Nothing replaced it under that name.

Until this is repointed, every turn 404s and the caller hears *"The agent
returned an error. Try again in a moment."* The worker now **refuses to start**
rather than answering calls it cannot serve — see `bridge_preflight.py`.

To fix, an operator must decide one of:

1. **Repoint** `STATENOUR_AGENT_URL` at a live statenour chat endpoint
   (`/api/ai/chat` is the obvious candidate) and confirm it streams AI-SDK
   line-delimited `0:"text"` deltas, which is what `stream_from_mastra` parses.
   Also confirm the endpoint accepts `Authorization: Bearer <VOICE_BRIDGE_TOKEN>`
   for a machine caller rather than only an operator session cookie.
2. **Retire** the service — stop the Railway `statenour-voice` deployment and
   delete `apps/voice`.

This was not repointed automatically because neither the correct target nor the
service's deployment state can be established from the repository, and guessing
would replace a loud failure with a silent wrong one.
