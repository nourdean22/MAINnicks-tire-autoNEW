/**
 * Close-on-intent safety net (2026-11-07 receptionist audit, section 3).
 *
 * 90 inbound calls in 30 days showed come-in, quote, inspection or tire intent and ended
 * with no bookSlot and no sendConfirmationSms, so the counter never heard about them. The
 * prompt now asks for one of the two before goodbye; this catches the calls where the
 * assistant still skips it, and texts the counter the same COMING IN heads-up bookSlot
 * sends, marked "not booked by the assistant".
 *
 * Runs in the end-of-call webhook, not in the vapiCallEval cron that writes eval_outcome:
 * that cron ticks once a day, so a heads-up hooked there would reach the counter a day
 * late. classifyCall is the same pure function the cron uses, fed the same fields.
 */
import { businessState } from "@shared/shopState";
import { BUSINESS } from "@shared/business";
import { classifyCall, type VapiOutcomeCategory } from "./vapiCallClassifier";

const SAFETY_NET_OUTCOMES: ReadonlySet<VapiOutcomeCategory> = new Set<VapiOutcomeCategory>([
  "quote_or_inspection_intent",
  "tire_availability_intent",
  "lost_opportunity",
]);

const CLOSING_TOOLS = ["bookSlot", "sendConfirmationSms"];

/**
 * Every tool the assistant called: Vapi's role-tagged messages plus the persisted state
 * trail (tool rows carry metadata.tool). Null means neither source was readable: UNKNOWN,
 * which must not read as "no tool called".
 */
function calledToolNames(messages: unknown, trail: Array<{ metadata?: unknown }>): Set<string> | null {
  const names = new Set<string>();
  for (const t of trail) {
    const tool = (t.metadata as { tool?: unknown } | null | undefined)?.tool;
    if (typeof tool === "string" && tool) names.add(tool);
  }
  if (!Array.isArray(messages)) return names.size ? names : null;
  for (const m of messages) {
    const calls = (m as { toolCalls?: unknown })?.toolCalls;
    if (!Array.isArray(calls)) continue;
    for (const c of calls) {
      const name = (c as { function?: { name?: unknown } })?.function?.name;
      if (typeof name === "string" && name) names.add(name);
    }
  }
  return names;
}

interface EndOfCallEvent {
  call?: { type?: string };
  endedReason?: string | null;
  durationSeconds?: number;
  summary?: string;
  analysis?: { summary?: string; successEvaluation?: string; structuredData?: { outcome?: string; sentiment?: string } };
  artifact?: { transcript?: string; messages?: unknown };
}

export type IntentHeadsUpDecision =
  | { send: true; outcome: VapiOutcomeCategory; intents: string[] }
  | { send: false; reason: "outbound" | "shop_closed" | "tools_unknown" | "closing_tool_called" | "no_intent"; outcome?: VapiOutcomeCategory };

export function decideIntentHeadsUp(input: {
  event: EndOfCallEvent;
  trail: Array<{ metadata?: unknown }>;
  leadId: number | null;
  callbackId: number | null;
  /** Shop open now. A night caller's heads-up would wake the on-duty manager. */
  open: boolean;
  durationSeconds?: number;
}): IntentHeadsUpDecision {
  const e = input.event;
  if (e.call?.type === "outboundPhoneCall") return { send: false, reason: "outbound" };
  const result = classifyCall({
    durationSeconds: input.durationSeconds ?? e.durationSeconds ?? 0,
    endedReason: e.endedReason ?? null,
    aiSummary: e.summary ?? e.analysis?.summary ?? null,
    transcript: e.artifact?.transcript ?? null,
    messages: e.artifact?.messages,
    leadId: input.leadId,
    callbackId: input.callbackId,
    successEvaluation: e.analysis?.successEvaluation,
    sentiment: e.analysis?.structuredData?.sentiment,
  });
  if (!SAFETY_NET_OUTCOMES.has(result.outcome)) return { send: false, reason: "no_intent", outcome: result.outcome };
  const tools = calledToolNames(e.artifact?.messages, input.trail);
  if (tools === null) return { send: false, reason: "tools_unknown", outcome: result.outcome };
  if (CLOSING_TOOLS.some((t) => tools.has(t))) return { send: false, reason: "closing_tool_called", outcome: result.outcome };
  if (!input.open) return { send: false, reason: "shop_closed", outcome: result.outcome };
  return { send: true, outcome: result.outcome, intents: result.intents };
}

export function shopOpenNow(now: Date = new Date()): boolean {
  return businessState(now, BUSINESS.timezone, BUSINESS.hours.structured).state === "open";
}
