# ADR-0006 · LiveKit voice implementation · Python worker + JS bridge

> **Status**: Accepted (2026-05-17 · Wave-200 Phase 4)
> **Decision drivers**: ADR-0003 picked LiveKit · this ADR is the
> implementation shape — Python worker vs JS · room-per-operator vs
> dispatch · HTTP bridge vs direct LLM

---

## Context

ADR-0003 picked LiveKit Agents + Deepgram + Cartesia as the substrate
for the operator's personal voice loop. That ADR left the
implementation shape open — three real choices needed answers before
Phase 4 could ship:

1. **Worker language**: LiveKit Agents has SDKs in TypeScript and
   Python. Which one runs the agent?
2. **LLM integration**: Re-implement the agent natively in the worker
   process, or bridge to the existing Mastra/Vercel-AI-SDK chain via
   HTTP?
3. **Room topology**: One persistent room per operator vs. ephemeral
   rooms dispatched per session.

## Decision

### 1 · Worker language: **Python**

The Python SDK is the canonical reference implementation. LiveKit's
own docs, examples, and plugin ecosystem (Deepgram · Cartesia ·
ElevenLabs · OpenAI · Anthropic · silero VAD) ship Python-first.
The TypeScript Agents SDK exists but lags by ~2 minor versions and
the plugin coverage is thinner.

Cost of the language split: one extra Railway service to deploy.
Mitigated by the fact that nothing else in the repo will follow
into Python · this is an island.

### 2 · LLM integration: **HTTP bridge to Mastra**

The Python worker overrides `Agent.llm_node()` to POST the
transcribed user utterance to the existing `/api/agent` Mastra
endpoint (Wave-200 Phase 1) and stream the response text back as
deltas that Cartesia consumes.

**Why bridge instead of in-process LLM:**

- The Mastra agent has 138 tools · the full brain memory · the skill
  recall layer · the provider chain (Venice → Ollama → Anthropic →
  OpenAI). Re-implementing in Python doubles maintenance burden and
  splits the single source of truth.
- HTTP hop latency is ~5-15ms over the same Railway private network
  · negligible vs. the STT (180ms) + TTS (150ms) budget.
- The Mastra agent already streams · we pipe deltas directly to
  Cartesia so spoken output starts before model generation completes.
- When (if) Mastra ships a Python SDK we can revisit · today JS is
  the only one.

**Cost**: one HTTP round-trip per voice turn. The endpoint requires
an owner session cookie (`requireSession()`) · the worker holds it
as an env var (`STATENOUR_OWNER_COOKIE`) · operator pastes a long-
lived browser session cookie once.

**Authentication risk**: the cookie is the operator's session. If it
leaks (e.g. via Railway env-var exposure) anyone holding it can chat
as the operator. Mitigation:
- Railway env vars are encrypted at rest, only visible to the
  service principal · same trust boundary as other secrets there
- The cookie can be rotated at any time (sign out + back in to
  regenerate) without redeploying
- Future hardening: a dedicated `voice-bridge` API endpoint with its
  own bearer token (rotates independently, scoped to voice traffic
  only) · punted until we have evidence the operator-cookie path is
  insufficient

### 3 · Room topology: **One persistent room per operator**

Room name is deterministic: `operator-{userId}`. The Python worker
auto-registers with LiveKit Cloud and accepts any job for any room
matching its dispatch pattern (default: accept all). When the
operator joins from the PWA, the agent joins their room.

**Why persistent vs ephemeral**:
- Reconnect-safe · if the operator's phone drops Wi-Fi briefly they
  reconnect to the same room without re-issuing a token
- Faster session start · LiveKit doesn't tear down infrastructure
  between turns
- Simpler debugging · one room to inspect in LiveKit's dashboard
- No multi-tenant complexity · this is a single-operator system

Cost: the room counts as "connected minutes" only when participants
are present, so idle persistent rooms cost $0.

## Implementation

### File layout (`apps/voice/`)

| File | Purpose |
|---|---|
| `agent.py` | The LiveKit worker · entrypoint + `NickVoiceAgent` class with `llm_node` override |
| `requirements.txt` | Python deps · pinned · 5 packages |
| `Dockerfile` | Multi-stage build · Python 3.11-slim runtime |
| `.dockerignore` | Excludes `__pycache__`, venv, env files |
| `.python-version` | `3.11` |
| `.gitignore` | Standard Python ignores |
| `README.md` | Setup steps · local dev + Railway prod |

### File layout (statenour-web side · `apps/statenour/`)

| File | Purpose |
|---|---|
| `app/api/voice/token/route.ts` | LiveKit JWT mint endpoint · owner-only · 5min TTL |
| `app/voice/page.tsx` | PWA-installable launcher with push-to-talk UI (added in this commit) |

### Operator action items

One-time setup before voice works in prod:

1. **Accounts**:
   - LiveKit Cloud free tier · create project · copy URL · API key · secret
   - Deepgram free tier · copy API key
   - Cartesia free tier · copy API key + voice ID (default Aspen)
2. **statenour-web Railway env** (add):
   - `LIVEKIT_URL` · `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET`
3. **Add new Railway service** `statenour-voice`:
   - Repo: same monorepo · build path `apps/voice`
   - Build: Dockerfile · `apps/voice/Dockerfile`
   - Watch path: `apps/voice/**`
   - Env vars (paste):
     - `LIVEKIT_URL` · `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET`
     - `DEEPGRAM_API_KEY`
     - `CARTESIA_API_KEY` · `CARTESIA_VOICE_ID`
     - `STATENOUR_AGENT_URL=https://autonicks.com/api/agent`
     - `STATENOUR_OWNER_COOKIE=appSession=...` (from a logged-in browser)
4. **install** `livekit-server-sdk` in `apps/statenour/`:
   ```bash
   pnpm --filter @statenour/web add livekit-server-sdk
   ```
5. **Deploy** the new Railway service · wait for green healthcheck
6. **Test**: open `https://autonicks.com/voice` on phone · tap push-
   to-talk · say "what's my morning brief" · Nick speaks the reply

## Rejected alternatives

### TypeScript LiveKit Agents worker

Same monorepo · would consume the existing pnpm setup. Rejected
because:
- Plugin ecosystem lags (Deepgram, Cartesia, Silero have lower-
  quality TS wrappers as of 2026-05)
- Community examples are Python-dominant · slower debugging
- We already accept "Python is an island" — adding the Railway
  service is the one-time cost we pay regardless

### Direct LLM in Python (no HTTP bridge)

Re-implement Nick in Python with native Anthropic/OpenAI SDK calls
and re-build the tool catalog. Rejected immediately — doubles
maintenance · fragments the brain layer.

### Ephemeral rooms · one per voice session

Spin up a new room per join · tear down on disconnect. Rejected
because:
- Reconnect needs a fresh token mint cycle · adds 200-500ms to
  reconnect time
- More LiveKit metric noise · harder to monitor "is the voice
  surface healthy"
- No real benefit for a single-operator system

### Shared LiveKit project with VAPI

VAPI also uses LiveKit under the hood for some flows. We could
multiplex. Rejected because:
- VAPI is for the shop's customer-facing line · totally different
  trust boundary
- Sharing the project crosses business + personal concerns · clean
  separation matters more than infra savings (which would be $0
  anyway at this volume)

## Consequences

### Positive

- Single source of truth (Mastra agent) regardless of input modality
- Operator voice loop targets ~400ms · way better than VAPI's typical
  800-1200ms (different ADR documents that)
- Voice can be retired entirely by stopping the `statenour-voice`
  Railway service · zero impact on chat
- The same Mastra agent serves chat · voice · future channels
  (LiveKit's native MCP, embedded smart devices, etc.) without
  re-implementation
- PWA launcher means no app-store submission · operator installs to
  home screen via standard browser flow

### Negative

- One more service to monitor on Railway (~$5/mo idle baseline)
- Python toolchain in a JS-dominant monorepo · contributors need
  to know both (mitigated by README clarity + tight scope of the
  Python code)
- HTTP bridge depends on the owner-cookie auth · if cookies expire
  the voice loop dies until the env var is updated (future hardening:
  dedicated voice-bridge bearer token)
- LiveKit + Deepgram + Cartesia all add to the dependency graph ·
  each could change pricing or shut down · LiveKit and Deepgram are
  the most mature · Cartesia is the newest (founded 2024)

### Neutral

- LiveKit's plugin ecosystem changes monthly · we'll need to bump
  pinned versions in `requirements.txt` once a quarter
- Voice quality is bounded by Cartesia's TTS · if it gets worse we
  can swap to ElevenLabs Flash (Cartesia is currently better at the
  sub-150ms tier · ElevenLabs is the fallback)

## References

- ADR-0003 · LiveKit operator voice (strategy · why LiveKit at all)
- `apps/voice/agent.py` · the worker implementation
- `apps/voice/README.md` · operator setup
- `apps/statenour/app/api/voice/token/route.ts` · token mint
- `apps/statenour/app/voice/page.tsx` · PWA launcher
- LiveKit Agents 1.5 docs · https://docs.livekit.io/agents/
- Deepgram Nova-3 announcement · https://deepgram.com/learn/nova-3
- Cartesia Sonic docs · https://cartesia.ai/docs
