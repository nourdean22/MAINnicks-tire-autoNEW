# statenour-voice · LiveKit operator voice agent

The operator's personal sub-400ms voice loop into Nick. Runs as a
separate Railway service from `statenour-web` because LiveKit Agents
is a Python framework (the JS SDK exists for the client side but the
agent worker is Python-only as of 2026-05).

## What it does

1. Operator joins a LiveKit room from their phone (via the PWA
   launcher at `/voice` on statenour-web)
2. This Python worker accepts the job, opens audio tracks both ways
3. Operator speaks → Deepgram Nova-3 transcribes (~180ms)
4. Transcribed text → HTTP POST to `https://autonicks.com/api/agent`
   (the Mastra endpoint shipped in Wave-200 Phase 1)
5. Mastra agent reply streams back as text deltas
6. Cartesia Sonic-2 speaks the deltas as they arrive (no buffering)
7. Operator hears Nick speak in real-time · target sub-400ms loop

## Why HTTP bridge (not in-process LLM)

The Mastra agent has 138 tools + the full brain memory + skill recall.
Re-implementing in Python would double the maintenance burden. The
HTTP hop is ~5-15ms locally · way under the latency budget.

## Local development

```bash
cd apps/voice
python3.11 -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt

# Run statenour-web in another terminal first:
#   pnpm --filter @statenour/web dev

# Get an owner session cookie from autonicks.com or localhost:3001
# (DevTools → Application → Cookies → appSession value)

export STATENOUR_AGENT_URL=http://localhost:3001/api/agent
export STATENOUR_OWNER_COOKIE='appSession=<your-cookie>'
export LIVEKIT_URL=wss://<your-project>.livekit.cloud
export LIVEKIT_API_KEY=<key>
export LIVEKIT_API_SECRET=<secret>
export DEEPGRAM_API_KEY=<key>
export CARTESIA_API_KEY=<key>

python agent.py dev
```

The agent prints a dispatch URL · open it in your browser to test.

## Production deployment (Railway)

1. **Operator prerequisites** (one-time):
   - LiveKit Cloud account → create project → copy URL/key/secret
   - Deepgram account → copy API key (free tier 200hrs/mo)
   - Cartesia account → copy API key + voice ID
2. **Railway setup**:
   - Add new service in the existing Railway project
   - Build config: Dockerfile · path `apps/voice/Dockerfile`
   - Watch path: `apps/voice/**`
   - Env vars:
     - `LIVEKIT_URL` `LIVEKIT_API_KEY` `LIVEKIT_API_SECRET`
     - `DEEPGRAM_API_KEY` (optional: `DEEPGRAM_MODEL=nova-3`)
     - `CARTESIA_API_KEY` `CARTESIA_VOICE_ID`
     - `STATENOUR_AGENT_URL=https://autonicks.com/api/agent`
     - `STATENOUR_OWNER_COOKIE=appSession=...`
3. Deploy · the worker auto-registers with LiveKit Cloud
4. Test from the PWA at `https://autonicks.com/voice`

## Cost estimate

At ~100-300 minutes/day operator usage:
- LiveKit Cloud: ~$30/mo (connection-min based)
- Deepgram Nova-3: ~$15/mo ($0.0043/min)
- Cartesia Sonic-2: ~$20/mo ($0.015/min)
- Railway service: ~$5/mo (small Python container, mostly idle)

**Total: ~$70/mo** · operator can scale Cartesia down by using
Sonic-2 instead of Sonic-3 (already default) or rate-limiting voice
session length.

## References

- ADR-0003 · LiveKit operator voice (strategy)
- ADR-0006 · LiveKit implementation (this scaffold)
- Wave-200 Plan · Phase 4 entries
- LiveKit Agents docs · https://docs.livekit.io/agents/
- Deepgram Nova-3 · https://deepgram.com/learn/announcing-nova-3
- Cartesia Sonic · https://cartesia.ai/docs/api-reference/tts
