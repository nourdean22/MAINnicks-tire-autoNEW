/**
 * POST /api/agent · Wave-200 Phase 1 test endpoint (2026-05-17)
 *
 * Calls the Mastra `nick` agent directly · isolated from the legacy chat
 * pipeline. Used during Phase 1 validation to prove the agent + tools +
 * provider chain work end-to-end before we cut /api/ai/chat over to it.
 *
 * Owner-only. Returns AI SDK v6 streamed UI-message response (compatible
 * with useChat on the client). Not wired into the chat UI · operator hits
 * this via curl or a one-off page during validation.
 *
 * Pattern: Mastra's canonical Next.js App Router integration · the
 * `handleChatStream` helper does all the AI-SDK-v6 conversion + tool-loop
 * orchestration · we just feed it the request body and Mastra instance.
 *
 * Once AGENT_V2 ramps to 100% and the legacy /api/ai/chat path is retired,
 * this endpoint can be retired too — its only purpose is the cutover window.
 *
 * See: docs/WAVE-200-PLAN.md Phase 1
 */

import { requireSession } from "@/lib/auth-guard";
import { timingSafeEqual } from "node:crypto";

// force-dynamic · this is a streaming POST and must never be prerendered.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 2026-05-17 follow-up · WAVE-200 Phase 4 ADR-0006 promised a dedicated
 * voice-bridge bearer token so the LiveKit Python worker doesn't have
 * to carry the operator's session cookie. This is that hardening.
 *
 * Auth precedence:
 *   1. Authorization: Bearer <VOICE_BRIDGE_TOKEN> · the apps/voice
 *      Python worker uses this. Long-lived · rotates by re-pasting
 *      the env var on both services.
 *   2. requireSession(req) · the browser useChat() path · unchanged.
 *
 * Constant-time compare so the token can't be inferred via timing.
 * Returns the operator's user.id so memory thread/resource scoping
 * works identically across both auth paths (we hard-code the
 * operator's user.id when bridge auth is used · single-tenant system).
 */
const VOICE_BRIDGE_TOKEN = (process.env.VOICE_BRIDGE_TOKEN ?? "").trim();
const VOICE_BRIDGE_USER_ID =
  (process.env.VOICE_BRIDGE_USER_ID ?? "").trim() || "operator-1";

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

async function resolveOperator(
  req: Request,
): Promise<{ id: string; email: string; role: string }> {
  // Bridge token first (cheap · no DB hit)
  if (VOICE_BRIDGE_TOKEN) {
    const authHeader = req.headers.get("authorization") ?? "";
    if (safeEqual(authHeader, `Bearer ${VOICE_BRIDGE_TOKEN}`)) {
      return {
        id: VOICE_BRIDGE_USER_ID,
        email: "voice-bridge@statenour.local",
        role: "operator",
      };
    }
  }
  return requireSession(req);
}

export async function POST(req: Request) {
  const user = await resolveOperator(req);

  // Dynamic imports keep Mastra off the cold-path for the rest of the app
  // — /api/agent is the only consumer right now (Phase 1 test endpoint).
  const { handleChatStream } = await import("@mastra/ai-sdk");
  const { createUIMessageStreamResponse } = await import("ai");
  const { getMastra } = await import("@/src/mastra");

  const params = await req.json();

  // 2026-05-17 follow-up · Phase 1.2 memory wiring fix · without
  // explicit thread + resource IDs, Mastra creates a new memory
  // context per request and the working-memory + last-N message
  // window we just shipped silently no-op. Per Mastra's
  // AgentMemoryOption { thread: string|object, resource?: string },
  // we route:
  //   · thread → conversationId from client (or fallback per-operator)
  //   · resource → operator user.id (resource-scoped working memory
  //     follows the operator across conversations)
  // The client's existing chat composer sends `id` or `chatId` on
  // useChat · accept either; fall back to a stable default per operator
  // so even ad-hoc curl requests get coherent memory.
  const conversationId =
    typeof params?.id === "string" && params.id.length > 0
      ? params.id
      : typeof params?.chatId === "string" && params.chatId.length > 0
        ? params.chatId
        : typeof params?.conversationId === "string" && params.conversationId.length > 0
          ? params.conversationId
          : `default-${user.id}`;

  const paramsWithMemory = {
    ...params,
    memory: {
      thread: conversationId,
      resource: user.id,
    },
  };

  // handleChatStream produces a V6UIMessageStream that createUIMessageStreamResponse
  // converts to a streaming HTTP response. Same shape useChat() reads on the client.
  // Cast to never around the version-of-versions type drift documented in
  // src/mastra/agents/nick.ts (Mastra@1.35's bundled AI SDK provider !==
  // ai@6.0.162's bundled provider · structurally identical · cast for compile).
  // getMastra() is now async (race-safe promise singleton · 2026-05-17 follow-up)
  const mastra = await getMastra();
  const stream = await handleChatStream({
    mastra: mastra as never,
    agentId: "nick",
    params: paramsWithMemory,
    version: "v6",
  });

  return createUIMessageStreamResponse({ stream: stream as never });
}
