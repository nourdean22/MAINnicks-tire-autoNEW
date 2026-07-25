/**
 * app/api/ai/chat/specialist-routing.ts — chat-route decomposition
 * slice (2026-07-25). The Specialist Sub-Agent Routing block moved
 * VERBATIM from route.ts (was inline between the interceptor fast-path
 * and the user-turn persist kickoff). Behavior preserved exactly:
 * same ordering guards, same budget check, same shadow-mode metric
 * recording, same dispatch + persist + fast-stream path.
 *
 * AG-42 · SAFETY reorder history: this block used to sit ABOVE the
 * interceptor fast-path AND above every budget check, so
 *   (a) an image-gen / decision-log / brain-dump message that also
 *       tripped a specialist keyword got hijacked away from its
 *       deterministic handler, and
 *   (b) the router LLM tiebreak + specialist dispatch spent money
 *       even after the daily budget was blown.
 * It runs AFTER the interceptors (deterministic intents win by
 * ordering) and behind a hoisted budget check. Shadow mode
 * (ENABLE_SPECIALIST_ROUTING="shadow") classifies + records what
 * WOULD have routed (SystemMetric `specialist.route`) but never
 * dispatches — measure on live traffic before flipping to "true".
 *
 * Private Lab: the CALLER gates this entire module on !privateMode
 * (specialist routing records content-derived route metrics and its
 * buildFastStream persists the reply); privateMode is still threaded
 * in for the persist-user-turn skip on the dispatch path, mirroring
 * the original inline logic exactly.
 */

import type { logger as rootLogger } from "@/lib/logger";
import type { recordError as recordErrorFn } from "@/lib/errors/record-error";

type Logger = ReturnType<typeof rootLogger.withSurface>;

export type SpecialistRoutingResult =
  | { kind: "handled"; response: Response }
  | { kind: "pass" };

export async function runSpecialistRouting(args: {
  messages: Array<Record<string, unknown>>;
  privateMode: boolean;
  convId: string | undefined;
  lastUserMsg: Record<string, unknown> & { role?: string };
  userContent: string;
  log: Logger;
  recordError: typeof recordErrorFn;
}): Promise<SpecialistRoutingResult> {
  const { messages, privateMode, convId, lastUserMsg, userContent, log, recordError } = args;

  const { isSpecialistRoutingEnabled, isSpecialistShadowMode } = await import("@/lib/ai/agents/types");
  if (!(isSpecialistRoutingEnabled() || isSpecialistShadowMode())) {
    return { kind: "pass" };
  }

  const { assertWithinBudget: assertSpecBudget } = await import("@/lib/ai/budget");
  const specBudget = await assertSpecBudget().catch(() => null);
  if (specBudget && !specBudget.ok) {
    log.info("specialist_routing_skipped", { reason: "budget_exceeded" });
    return { kind: "pass" };
  }

  const mappedMessages = messages.map(m => {
    const msg = m as any;
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (msg.parts && Array.isArray(msg.parts)) {
      content = msg.parts
        .map((p: any) => (p && typeof p.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join(" ");
    }
    const role = (msg.role === "user" || msg.role === "assistant" || msg.role === "system")
      ? (msg.role as "user" | "assistant" | "system")
      : ("user" as const);
    return { role, content };
  }).filter(m => m.content.length > 0);

  const { routeMessage } = await import("@/lib/ai/agents/router");
  const decision = await routeMessage({ messages: mappedMessages });

  const specShadow = isSpecialistShadowMode();
  // 2026-07-12 · record the classification in BOTH modes so routing
  // telemetry survives the shadow→live flip (was shadow-only, so the
  // operator went blind the moment routing went live). Fire-and-forget.
  {
    const { recordSpecialistRouteMetric } = await import("@/lib/ai/agents/router-metrics");
    const willDispatch = !specShadow && decision.route === "marketing-director";
    void recordSpecialistRouteMetric(decision.route, decision.confidence, decision.reason, {
      shadow: specShadow,
      dispatched: willDispatch,
    });
  }

  if (specShadow) {
    // Shadow: metric recorded above, never dispatch.
  } else if (decision.route === "marketing-director") {
    log.info("specialist_routing_match", { route: decision.route, reason: decision.reason });
    const { runMarketingDirector } = await import("@/lib/ai/agents/specialists/marketing-director");
    const specResult = await runMarketingDirector({ messages: mappedMessages });

    if (specResult.handBack) {
      log.info("specialist_handback", { route: decision.route, reason: specResult.reason });
    } else {
      // Prod-first dispatch guard · alert the operator the first time a
      // specialist actually handles a turn live (deduped, fire-and-forget).
      const { alertFirstSpecialistDispatch } = await import("@/lib/ai/agents/router-metrics");
      void alertFirstSpecialistDispatch(decision.route, decision.reason);
      // Private Lab: no user-message row, no BrainMemory auto-write.
      const { persistUserTurn } = await import("@/lib/services/chat/persist-user-turn");
      const resolvedConvId = privateMode
        ? (convId || "private")
        : await persistUserTurn({
            convId,
            lastUserMsg,
            userContent,
            log,
            recordError,
          });

      const { buildFastStream } = await import("@/lib/ai/chat/handlers/shared");
      return {
        kind: "handled",
        response: await buildFastStream(
          resolvedConvId,
          specResult.content,
          "specialist_marketing",
          specResult.provider || "reason"
        ),
      };
    }
  }

  return { kind: "pass" };
}
