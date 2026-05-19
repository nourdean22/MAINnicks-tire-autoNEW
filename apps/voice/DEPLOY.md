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
| Stack | Python 3.x · LiveKit Agents SDK · OpenAI Realtime API |

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
- `OPENAI_API_KEY` · Realtime API access
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
| High latency (>800ms) | OpenAI Realtime rate limit OR LiveKit region drift | Check `/system/voice-latency` metrics · consider re-region |
| Crash on join | Python version mismatch | Verify `.python-version` matches Railway Python image |

## Related docs

- `apps/voice/agent.py` · the agent definition
- `apps/voice/README.md` · setup
- `apps/statenour/lib/services/voice-latency.ts` · telemetry (currently broken · Prisma model missing per known issues)
