/**
 * buildChatResponse · May 02 · chat-route extract chunk 2
 *
 * Lifted verbatim from app/api/ai/chat/route.ts (the response assembly
 * block at lines 2216-2277). Owns the final transport shape:
 *
 *   1. Pull headers off the AI-SDK toUIMessageStreamResponse() Response
 *   2. Stamp 12 X-* telemetry headers (conv id, trace id, mode source,
 *      deeper-context counts/types, brain-block fire flags, persona,
 *      turn-signal: complexity/intent/shape/urgency/temp/CoT/critique)
 *   3. Wrap the stream body with the 7s SSE heartbeat (`: ping-<ts>\n\n`
 *      keepalive frames) so Cloudflare's 10s idle-kill + mobile Safari's
 *      background-fetch reaper don't drop the socket during slow tool
 *      calls (arsenal research, Venice cold-starts).
 *
 * Pure function over the inputs — no I/O, no closure capture, fully
 * testable. Mock toUIMessageStreamResponse() return shape and assert
 * the headers + body wrapping.
 */

import { withHeartbeat } from "@/lib/streaming/heartbeat";
import type { ChatMode } from "@/lib/ai/chat-mode";

// Subset of the turn classifier output that response headers care about.
// Mirroring the upstream type via structural typing avoids a re-export.
interface TurnSignal {
  complexity: string;
  intent: string;
  outputShape: string;
  urgency: string;
  temperature: number;
  useChainOfThought?: boolean;
  useTwoPassCritique?: boolean;
}

interface ContextBlocksFired {
  recall: boolean;
  skills: boolean;
  identity: boolean;
  ghost: boolean;
  qualitative: boolean;
  beliefs: boolean;
  nudges: boolean;
  contradictions: boolean;
  [key: string]: boolean;
}

export interface BuildChatResponseInput {
  /** The Response from result.toUIMessageStreamResponse(). */
  streamResponse: Response;
  convId: string;
  traceId: string;
  mode: ChatMode;
  modeOverride?: string | null;
  personality: string;
  turnSignal: TurnSignal;
  deeperContextCount: number;
  deeperContextTypes: string[];
  contextBlocksFired: ContextBlocksFired;
  /** Heartbeat interval in ms. Default 7000 — keeps Cloudflare + mobile happy. */
  heartbeatMs?: number;
}

export function buildChatResponse(input: BuildChatResponseInput): Response {
  const {
    streamResponse,
    convId,
    traceId,
    mode,
    modeOverride,
    personality,
    turnSignal,
    deeperContextCount,
    deeperContextTypes,
    contextBlocksFired,
    heartbeatMs = 7_000,
  } = input;

  const headers = new Headers(streamResponse.headers);
  headers.set("X-Conversation-Id", convId);
  // v10.0.28 — surface the AgentTrace traceId so the chat client
  // can let the operator click "this turn" and jump to
  // /system/agent-traces?search=<traceId>. The route already mints
  // and records traces via v10.0.10; this header just exposes the
  // id to the browser.
  headers.set("X-Trace-Id", traceId);
  // Apr 20 — mode-used header. Client ModePill reads this to show
  // what mode ACTUALLY ran (not just what the classifier predicted).
  // If Nour overrode via body.modeOverride, this reflects the
  // override; otherwise the auto-detected mode. Closes the feedback
  // loop between "what I expected" and "what happened".
  headers.set("X-Nick-Mode", mode);
  headers.set("X-Nick-Mode-Source", modeOverride ? "override" : "auto");
  // Deeper Context telemetry — the client-side transport reads these
  // headers and stores them for the Deeper Context badge. Non-blocking,
  // zero-cost when there were no hits (headers just stay at 0/empty).
  headers.set("X-Deeper-Context-Count", String(deeperContextCount));
  // Apr 19 · Per-turn brain-block flags as a single compact header so
  // the live streaming message can render ContextBlockBadges before
  // the persisted tokenUsage lands. Shape: comma-separated fired keys.
  const firedKeys = (Object.keys(contextBlocksFired) as Array<keyof ContextBlocksFired>)
    .filter((k) => contextBlocksFired[k]);
  if (firedKeys.length > 0) {
    headers.set("X-Context-Blocks", firedKeys.join(","));
  }
  // Apr 19 · Emit the inferred persona so the client can render a
  // tiny persona hint without needing tabs.
  headers.set("X-Persona", personality);
  // Apr 19 · Turn-signal telemetry. Client uses these to render the
  // reasoning trace + temperature dot + output-shape badge on each
  // assistant message without re-classifying.
  headers.set("X-Turn-Complexity", turnSignal.complexity);
  headers.set("X-Turn-Intent", turnSignal.intent);
  headers.set("X-Turn-Shape", turnSignal.outputShape);
  headers.set("X-Turn-Urgency", turnSignal.urgency);
  headers.set("X-Turn-Temp", String(turnSignal.temperature));
  if (turnSignal.useChainOfThought) headers.set("X-Turn-CoT", "1");
  if (turnSignal.useTwoPassCritique) headers.set("X-Turn-Critique", "1");
  // Apr 19 · Output critic telemetry. Populated by onFinish
  // (post-stream), so these headers land on the streamed response too
  // via Response wrapper — client reads them to render a tiny quality
  // bar. Note: onFinish runs AFTER this Response is returned on some
  // runtimes, so the reliable path is tokenUsage.critic/gate/factCheck
  // which lives on the persisted message; headers are best-effort and
  // primarily used for the STREAMING message (before the persist hits).
  if (deeperContextTypes.length > 0) {
    headers.set("X-Deeper-Context-Types", deeperContextTypes.join(","));
  }

  // B4 · Wrap the protocol stream with a 7s heartbeat. SSE comment
  // frames (`: ping-<ts>\n\n`) are spec-mandated ignored bytes — the
  // client parser sees nothing, but the socket stays hot through
  // slow tool calls (arsenal research, Venice cold-starts) that
  // would otherwise trigger Cloudflare's 10s idle-kill or mobile
  // Safari's background-fetch reaper.
  return new Response(withHeartbeat(streamResponse.body, heartbeatMs), {
    status: streamResponse.status,
    headers,
  });
}
