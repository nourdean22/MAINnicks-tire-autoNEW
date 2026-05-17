/**
 * POST /api/voice/token · Wave-200 Phase 4 (2026-05-17)
 *
 * Mints a LiveKit join token so the browser PWA at /voice can join
 * the operator's personal voice room. The Python agent worker
 * (apps/voice) is already listening for jobs on this room.
 *
 * Security model:
 *   · Owner-only · requireSession() short-circuits non-owners with 401
 *   · Tokens are short-lived (5 minutes · enough to join · re-mint
 *     for each session)
 *   · Room name is deterministic: `operator-{userId}` · only the
 *     operator + the LiveKit agent ever join it
 *   · Grant includes `canPublish` + `canSubscribe` for audio only ·
 *     no video · no data tracks
 *
 * Graceful degrade:
 *   · Returns 503 if LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing ·
 *     the UI shows "voice not configured · paste keys in env" instead
 *     of cryptic connection errors
 *
 * See: docs/adr/0006-livekit-voice-implementation.md
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Short — we never do real work here · 5s is generous.
export const maxDuration = 5;

const LIVEKIT_URL = (process.env.LIVEKIT_URL ?? "").trim();
const LIVEKIT_API_KEY = (process.env.LIVEKIT_API_KEY ?? "").trim();
const LIVEKIT_API_SECRET = (process.env.LIVEKIT_API_SECRET ?? "").trim();

const TOKEN_TTL_SECONDS = 5 * 60;

export async function POST(req: Request) {
  try {
    const user = await requireSession(req);

    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return NextResponse.json(
        {
          error: "LiveKit not configured",
          hint: "set LIVEKIT_URL · LIVEKIT_API_KEY · LIVEKIT_API_SECRET in Railway env",
        },
        { status: 503 },
      );
    }

    // Dynamic import keeps the livekit-server-sdk out of the cold
    // path for every other route that doesn't need it.
    const { AccessToken } = await import("livekit-server-sdk");

    const roomName = `operator-${user.id}`;
    const participantName = user.email;

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user.id,
      name: participantName,
      ttl: TOKEN_TTL_SECONDS,
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false, // audio only for v1
    });

    const token = await at.toJwt();

    return NextResponse.json({
      url: LIVEKIT_URL,
      token,
      room: roomName,
      identity: user.id,
      expiresInSeconds: TOKEN_TTL_SECONDS,
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      {
        error: "voice_token_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
