"""
Voice-bridge configuration preflight — pure, dependency-free, testable.

WHY THIS IS ITS OWN MODULE: `agent.py` exits at import time when the LiveKit
Agents SDK is absent, so anything defined there cannot be tested without the
full voice stack installed. CI only runs a syntax check on the voice app
(`python -m py_compile`), which is why a bridge that has been pointing at a
DELETED endpoint since 2026-06-02 went unnoticed. Config validation needs no
SDK, so it lives here and is exercised by real assertions.

WHY STARTUP AND NOT REQUEST TIME: every failure this catches currently surfaces
as SPEECH TO A CUSTOMER mid-call — missing auth yields "I can't reach the
agent", a dead target yields "The agent returned an error. Try again in a
moment." A voice agent must never discover its brain is missing while someone
is talking to it. Refusing to start is the honest failure: the operator sees a
crashed service, and LiveKit stops routing calls to a worker that cannot answer.
"""

from __future__ import annotations

from urllib.parse import urlparse

#: The local-dev fallback. Never correct in a deploy.
STATENOUR_AGENT_URL_DEFAULT = "http://localhost:3001/api/agent"

#: Paths that USED to serve the voice bridge and no longer exist.
#:
#: `/api/agent` was deleted from statenour in 33a035257 ("delete Mastra Agent
#: V2 ... Delete src/mastra/**, /api/agent") on 2026-06-02, along with
#: src/mastra/agents/nick.ts and scripts/smoke-agent-v2.ts. Nothing replaced it
#: under that name. Checked STATICALLY, with no network call, because the answer
#: is the same everywhere: the route is gone in local dev and in production.
DELETED_BRIDGE_PATHS = ("/api/agent",)


def preflight_bridge(env: dict[str, str]) -> list[str]:
    """
    Return human-readable configuration problems that must stop the worker.

    Empty list means it is safe to start. Pure given `env`.
    """
    problems: list[str] = []

    configured = (env.get("STATENOUR_AGENT_URL") or "").strip()
    url = configured or STATENOUR_AGENT_URL_DEFAULT

    if not configured:
        problems.append(
            "STATENOUR_AGENT_URL is unset, so the bridge targets the local dev "
            f"default ({STATENOUR_AGENT_URL_DEFAULT}) — never correct in a deploy."
        )

    path = urlparse(url).path.rstrip("/") or "/"
    if path in DELETED_BRIDGE_PATHS:
        problems.append(
            f"STATENOUR_AGENT_URL points at {path}, which was DELETED from statenour "
            "in 33a035257 (2026-06-02). Every turn 404s and the caller hears "
            '"The agent returned an error." Point this at a live statenour chat '
            'endpoint and confirm it emits AI-SDK line-delimited `0:"text"` deltas '
            "before re-enabling."
        )

    has_token = bool((env.get("VOICE_BRIDGE_TOKEN") or "").strip())
    has_cookie = bool((env.get("STATENOUR_OWNER_COOKIE") or "").strip())
    if not (has_token or has_cookie):
        problems.append(
            "neither VOICE_BRIDGE_TOKEN (preferred) nor STATENOUR_OWNER_COOKIE is "
            "set — the bridge would 401 on every turn."
        )

    return problems
