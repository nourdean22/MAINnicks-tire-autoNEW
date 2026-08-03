"""
LiveKit operator-voice agent · Wave-200 Phase 4 (2026-05-17)

The operator's personal sub-400ms voice loop into Nick.

Stack (per ADR-0003):
  · LiveKit Agents 1.5 framework — handles WebRTC, audio routing,
    session lifecycle
  · Deepgram Nova-3 — sub-200ms STT (the lowest-latency tier
    available, English-only as of 2026)
  · Cartesia Sonic-3 — sub-150ms TTS (Cartesia's flagship model
    with operator-voice-clone capability we can wire up in a follow-up)
  · Mastra agent backend via HTTP — same Nick the chat surface
    talks to, accessed via the /api/agent endpoint shipped in Phase 1.
    Voice converts speech → text → POST → stream text reply → TTS

Why HTTP (not direct Python agent):
  · Single source of truth · the JS Mastra agent has all 138 tools +
    the brain memory + the skill recall layer. Re-implementing in
    Python doubles maintenance.
  · The latency budget (~400ms end-to-end) absorbs one local HTTP hop
    fine — the agent + STT + TTS dominate, not the bridge.
  · When Mastra ships a Python SDK we can revisit · today the JS SDK
    is the only one.

Run locally:
    LIVEKIT_URL=wss://YOUR-PROJECT.livekit.cloud \
    LIVEKIT_API_KEY=<key> \
    LIVEKIT_API_SECRET=<secret> \
    DEEPGRAM_API_KEY=<key> \
    CARTESIA_API_KEY=<key> \
    STATENOUR_AGENT_URL=http://localhost:3001/api/agent \
    STATENOUR_OWNER_COOKIE="appSession=..." \
    python agent.py dev

Production · run as a Railway service `statenour-voice` (separate
from statenour-web). The service exposes no public HTTP surface ·
all traffic is LiveKit WebRTC. Healthcheck: `/health` on port 8080
returned by the worker process.

See:
  - docs/adr/0003-livekit-operator-voice.md (strategy)
  - docs/adr/0006-livekit-voice-implementation.md (this implementation)
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any, AsyncIterator

# LiveKit Agents framework
try:
    from livekit import agents
    from livekit.agents import (
        AutoSubscribe,
        JobContext,
        WorkerOptions,
        cli,
        llm,
    )
    from livekit.agents.voice import Agent, AgentSession
    from livekit.plugins import deepgram, cartesia, silero
except ImportError as exc:
    # Graceful fail when deps not yet installed · the scaffold still
    # ships in the repo so the operator can review structure before
    # paying for the LiveKit/Deepgram/Cartesia accounts.
    raise SystemExit(
        "LiveKit Agents deps not installed. Run: pip install -r requirements.txt"
    ) from exc

import httpx  # type: ignore[import-untyped]

from bridge_preflight import STATENOUR_AGENT_URL_DEFAULT, preflight_bridge

logger = logging.getLogger("statenour-voice")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# ── config ──────────────────────────────────────────────────────────

# Where to POST chat turns. Defaults to the local dev endpoint · in
# prod set STATENOUR_AGENT_URL=https://autonicks.com/api/agent
STATENOUR_AGENT_URL = os.environ.get(
    "STATENOUR_AGENT_URL", STATENOUR_AGENT_URL_DEFAULT
)
# 2026-05-17 · prod default points at the Railway deploy
# (autonicks.com domain was dropped · Railway is canonical).
# Override via env in apps/voice Railway service.

# 2026-05-17 follow-up · ADR-0006 voice-bridge bearer token (preferred).
# Statenour-web /api/agent now accepts Authorization: Bearer <token> as
# alternative to the operator session cookie. Long-lived · rotates by
# re-pasting on both services. Set VOICE_BRIDGE_TOKEN to enable.
VOICE_BRIDGE_TOKEN = os.environ.get("VOICE_BRIDGE_TOKEN", "")

# Legacy · operator session cookie path (kept for back-compat). Used
# only when VOICE_BRIDGE_TOKEN is unset.
STATENOUR_OWNER_COOKIE = os.environ.get("STATENOUR_OWNER_COOKIE", "")

# Voice config · Cartesia Sonic-3 voice id. Cartesia's playground
# returns a UUID per voice — the default below is Cartesia's
# "Aspen" English-US baseline · swap for the operator's cloned voice
# once we ship voice-clone-trainer.
CARTESIA_VOICE_ID = os.environ.get(
    "CARTESIA_VOICE_ID", "78fef94e-30c8-4c8a-9b91-7c00aef60af7"
)

# Deepgram model · "nova-3" is the lowest-latency English tier.
# "nova-3-general" if multilingual is needed later.
DEEPGRAM_MODEL = os.environ.get("DEEPGRAM_MODEL", "nova-3")

# Cartesia model · sonic-3 is current flagship · sonic-2 fallback.
CARTESIA_MODEL = os.environ.get("CARTESIA_MODEL", "sonic-2")

# How long to wait on the agent before falling back to "give me a moment".
AGENT_TIMEOUT_SECONDS = float(os.environ.get("AGENT_TIMEOUT_SECONDS", "30"))


# ── HTTP bridge to Mastra ───────────────────────────────────────────

async def stream_from_mastra(user_text: str) -> AsyncIterator[str]:
    """
    POST to /api/agent and stream the response text chunks back.

    The endpoint returns an AI SDK v6 UI message stream. For voice we
    only care about the assistant-text deltas — we ignore tool-call
    chunks (they're for the visual chat UI). Cartesia receives the
    text deltas and starts speaking before the model finishes.
    """
    # Prefer the bridge token · fall back to cookie. Without either,
    # the endpoint 401s.
    if VOICE_BRIDGE_TOKEN:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {VOICE_BRIDGE_TOKEN}",
        }
    elif STATENOUR_OWNER_COOKIE:
        headers = {
            "Content-Type": "application/json",
            "Cookie": STATENOUR_OWNER_COOKIE,
        }
    else:
        yield "I can't reach the agent · VOICE_BRIDGE_TOKEN or STATENOUR_OWNER_COOKIE missing."
        return
    body = {"messages": [{"role": "user", "content": user_text}]}

    async with httpx.AsyncClient(timeout=AGENT_TIMEOUT_SECONDS) as client:
        try:
            async with client.stream(
                "POST", STATENOUR_AGENT_URL, headers=headers, json=body
            ) as response:
                if response.status_code != 200:
                    logger.error(
                        "agent_http_%s · body=%s",
                        response.status_code,
                        (await response.aread())[:300],
                    )
                    yield "The agent returned an error. Try again in a moment."
                    return

                # AI SDK v6 stream chunks are line-delimited. Each line
                # is `0:"text"` for text deltas · other types ignored.
                #
                # 2026-05-17 follow-up · the hand-rolled string-strip
                # parser broke on JSON escape sequences (Unicode
                # `’` curly apostrophes, embedded `\n`/`\t`,
                # escaped backslashes). Use `json.loads` so every
                # AI-SDK-conformant string round-trips correctly. Bad
                # chunks log + skip rather than poisoning the spoken
                # output with garbage.
                async for line in response.aiter_lines():
                    if not line or not line.startswith("0:"):
                        continue
                    try:
                        payload = json.loads(line[2:])
                    except (json.JSONDecodeError, ValueError) as exc:
                        logger.warning(
                            "stream_parse_failed · skip · err=%s · raw=%s",
                            exc,
                            line[:80],
                        )
                        continue
                    if isinstance(payload, str) and payload:
                        yield payload
        except httpx.TimeoutException:
            logger.warning("agent_timeout · text=%s", user_text[:80])
            yield "The agent took too long · try again with a shorter ask."
        except httpx.HTTPError as exc:
            logger.error("agent_http_error · %s", exc)
            yield "Something is wrong with the agent connection."


# ── LiveKit agent definition ────────────────────────────────────────

class NickVoiceAgent(Agent):
    """
    The voice-side wrapper for Nick. Replaces the LLM provider with
    our HTTP bridge so the entire 138-tool catalog stays in JS land.
    """

    def __init__(self) -> None:
        super().__init__(
            # No native instructions — the Mastra agent has its own
            # full system prompt (built per turn with brain context,
            # citations, voice profile etc.). We just convey what's
            # said.
            instructions=(
                "You are the voice surface of Nick. Speak back exactly "
                "what the agent returns · don't add commentary."
            ),
        )

    async def llm_node(  # type: ignore[override]
        self,
        chat_ctx: llm.ChatContext,
        tools: list[Any],
        model_settings: Any,
    ) -> AsyncIterator[str]:
        """
        Override the LLM node so instead of calling a local LLM we
        bridge to the Mastra agent via HTTP and stream back deltas.
        Cartesia consumes the deltas and starts speaking immediately.
        """
        # Pull the latest user message · everything else (system /
        # assistant history) is reconstructed by the Mastra agent
        # from its own memory layer.
        last_user = None
        for msg in reversed(chat_ctx.items):
            if getattr(msg, "role", None) == "user":
                last_user = msg.text_content
                break

        if not last_user:
            yield "I didn't catch that · try again."
            return

        async for chunk in stream_from_mastra(last_user):
            yield chunk


async def entrypoint(ctx: JobContext) -> None:
    """
    LiveKit job entrypoint · invoked when a participant joins a room.
    Constructs an AgentSession with STT + TTS + VAD + the agent above,
    then starts it on the participant's tracks.
    """
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    session = AgentSession(
        stt=deepgram.STT(model=DEEPGRAM_MODEL),
        tts=cartesia.TTS(model=CARTESIA_MODEL, voice=CARTESIA_VOICE_ID),
        vad=silero.VAD.load(),
        # No `llm=` · the agent's `llm_node` override above handles
        # the bridge to Mastra. LiveKit doesn't require a local LLM
        # when llm_node is overridden.
    )

    await session.start(agent=NickVoiceAgent(), room=ctx.room)

    # The session runs until the participant disconnects · LiveKit
    # handles cleanup automatically.


if __name__ == "__main__":
    # Refuse to register with LiveKit when the bridge cannot possibly work.
    # Starting anyway means LiveKit routes real calls to a worker whose only
    # possible output is a spoken apology.
    _problems = preflight_bridge(dict(os.environ))
    if _problems:
        logger.error("voice bridge preflight FAILED — refusing to start:")
        for _p in _problems:
            logger.error("  · %s", _p)
        logger.error(
            "Set the required env on the Railway `statenour-voice` service, "
            "or stop the service if the voice bridge is intentionally retired."
        )
        sys.exit(1)

    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
