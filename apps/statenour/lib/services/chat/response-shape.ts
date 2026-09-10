import { withHeartbeat } from "@/lib/streaming/heartbeat";
import type { ChatMode } from "@/lib/ai/chat-mode";
import { createCockpitSseStream } from "@/lib/ai/runtime/sse-stream";

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
  /**
   * 2026-08-28 · escalation provenance. `lane` is what ANSWERED;
   * `escalation` is what the operator ASKED for and whether they got it.
   * Both are needed: a refused escalation is invisible if you only report
   * the lane that served.
   */
  lane?: { provider?: string; modelId?: string };
  escalation?: { tier: string; escalated: boolean; blockedBy?: string; reason: string };
  turnSignal: TurnSignal;
  deeperContextCount: number;
  deeperContextTypes: string[];
  contextBlocksFired: ContextBlocksFired;
  /** Heartbeat interval in ms. Default 7000 — keeps Cloudflare + mobile happy. */
  heartbeatMs?: number;
  classification?: {
    intent: string;
    mode: "fast" | "operator" | "engineer";
    model: string;
    provider: string;
    targets: string[];
  };
  recalledMemories?: Array<{ id: string; content: string; similarity: number; category: string }>;
  /** 2026-09-10 · why recalledMemories is the length it is. An empty
   *  array is meaningless without this -- see RecallProvenance. */
  recallProvenance?: "OK" | "ZERO" | "ERROR" | "UNMEASURED";
  recallProvenanceReason?: string;
  contradictions?: Array<{ id: string; claim: string; reality: string; severity: string }>;
  onFinishPromise?: Promise<void>;
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
    classification,
    lane,
    escalation,
    recalledMemories = [],
    recallProvenance,
    recallProvenanceReason,
    contradictions = [],
    onFinishPromise = Promise.resolve(),
  } = input;

  const headers = new Headers(streamResponse.headers);
  headers.set("Content-Type", "text/event-stream");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("Connection", "keep-alive");
  // 2026-08-08 · nginx-class proxies (Railway's edge included) may buffer
  // response bodies unless told not to; buffered SSE arrives as one burst
  // instead of a stream. The sibling reason/stream route has set this
  // since it shipped -- this builder set every other SSE header but this
  // one, leaving the main chat stream to the proxy's defaults.
  headers.set("X-Accel-Buffering", "no");
  // Never leak the Private Lab sentinel (or the "temp" placeholder) to the
  // client — adopting it as activeConversationId inverts privacy after
  // toggle-off (self-review high #3). Emit blank; the client keeps its id.
  headers.set("X-Conversation-Id", convId === "private" || convId === "temp" ? "" : convId);
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
  // 2026-08-28 · lane provenance. Nineteen headers existed and NONE named
  // the provider, model, lane or effort — so five gates could silently
  // change which brain answered with no way for the operator to tell.
  if (lane?.provider) headers.set("X-Lane-Provider", lane.provider);
  if (lane?.modelId) headers.set("X-Lane-Model", lane.modelId);
  if (escalation && escalation.tier !== "none") {
    headers.set("X-Escalation-Tier", escalation.tier);
    headers.set("X-Escalation-Applied", escalation.escalated ? "1" : "0");
    // The load-bearing one: depth was requested and refused. Without it a
    // keyless/capped escalation is indistinguishable from never asking.
    if (escalation.blockedBy) {
      headers.set("X-Escalation-Blocked", escalation.blockedBy);
      headers.set("X-Escalation-Reason", escalation.reason.slice(0, 200));
    }
  }
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

  // Construct the custom cockpit SSE event stream
  const sseStream = createCockpitSseStream({
    aiSdkStream: streamResponse.body || new ReadableStream(),
    traceId,
    classification: classification || {
      intent: turnSignal.intent,
      mode: mode === "deep" ? "operator" : "fast",
      model: "unknown",
      provider: "unknown",
      targets: ["general"],
    },
    recalledMemories,
    recallProvenance,
    recallProvenanceReason,
    contradictions,
    onFinishPromise,
  });

  return new Response(withHeartbeat(sseStream, heartbeatMs), {
    status: streamResponse.status,
    headers,
  });
}

