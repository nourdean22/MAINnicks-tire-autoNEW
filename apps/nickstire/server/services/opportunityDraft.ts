/**
 * Decision Inbox → outreach bridge (2026-07-29, SMS Revenue Agent OS).
 *
 * The audit's finding: the Decision Inbox had NO bridge from a decision to a
 * message — the panel "never contacts a customer" and the operator had to
 * leave the surface to act. This service adds the missing half while keeping
 * every safety property:
 *
 *   - DETERMINISTIC drafts only. No LLM in this path — every sentence is
 *     assembled from verified facts already on the opportunity row (name,
 *     service, age, quote-on-file). A template cannot invent a wait time,
 *     a warranty, a discount, or a diagnosis.
 *   - DRAFT-ONLY autonomy (ladder level 1, key `opportunity_draft_bridge`):
 *     nothing sends without the operator tapping send on the exact text.
 *   - Channel honesty: callback / complaint / promise rows are CALL-first —
 *     they get no SMS draft at all, with the reason stated.
 *   - Send rides sendSms's full chokepoint (opt-out fail-closed, per-phone
 *     cap, global cap, pause, quiet-hour queue) with humanInitiated=true —
 *     operator approval is exempt from takeover suppression by design.
 *   - Every send is receipted on the opportunity (transition → attempted).
 */
import { createLogger } from "../lib/logger";
import type { OpportunityRow } from "./opportunityQueue";

const log = createLogger("opportunity-draft");

export type OutreachChannel = "call" | "sms";

export interface OpportunityDraftResult {
  ok: boolean;
  /** which channel the OS recommends for this source type */
  bestChannel: OutreachChannel;
  /** null when this source type is call-only or undraftable */
  draft: string | null;
  /** why there is no draft, when draft is null */
  noDraftReason?: string;
  /** compact risk label for the row UI */
  riskLabel: "low" | "elevated" | "human_only";
  riskReasons: string[];
  guardFindings: Array<{ code: string; message: string }>;
}

/** Call-first source types: an SMS would be the wrong first move. */
const CALL_ONLY: Record<string, string> = {
  callback: "Customer explicitly asked for a CALL — texting a callback request answers the wrong question.",
  review_recovery: "Complaint / service-recovery — human voice only, never an automated-feeling text.",
  promise_overdue: "A broken promise needs a person owning it on the phone, not a text.",
};

function firstName(name: string | null): string {
  const n = (name ?? "").trim();
  if (!n || /^customer$/i.test(n)) return "";
  return n.split(/\s+/)[0];
}

function greeting(name: string | null): string {
  const fn = firstName(name);
  return fn ? `Hey ${fn}, ` : "Hey, ";
}

/**
 * Deterministic draft per source type. Facts used are ONLY what the
 * collector verified onto the row. Voice: short, direct, human, no pressure
 * — and nothing the shop can't back up.
 */
export function buildDraftBody(opp: OpportunityRow): { draft: string | null; noDraftReason?: string } {
  const ev = (opp.evidence ?? {}) as Record<string, unknown>;
  switch (opp.sourceType) {
    case "stale_lead": {
      const problem = typeof ev.problem === "string" && ev.problem ? ev.problem.slice(0, 40) : null;
      const about = problem ? ` about ${problem}` : "";
      return {
        draft:
          `${greeting(opp.customerName)}it's Nick's Tire & Auto. You reached out${about} and we dropped the ball getting back to you — sorry about that. Still need a hand? We're walk-in, Mon-Sat 8-6, Sun 9-4, or just text back here.`,
      };
    }
    case "unapproved_estimate": {
      const service = typeof ev.service === "string" && ev.service ? ev.service.slice(0, 40) : "the work we scoped";
      return {
        draft:
          `${greeting(opp.customerName)}Nick's Tire & Auto here. We still have your quote on file for ${service}. No pressure — if you want it handled this week, text back or swing by. Questions welcome.`,
      };
    }
    case "deferred_service": {
      return {
        draft:
          `${greeting(opp.customerName)}Nick's Tire & Auto. From your inspection, a couple items you held off on are still open. Happy to go over them whenever you're ready — no pressure, just don't want it to sneak up on you.`,
      };
    }
    case "missed_call": {
      return {
        draft:
          `${greeting(opp.customerName)}sorry we missed your call — Nick's Tire & Auto. What can we help with? You can text right here or call back anytime, Mon-Sat 8-6.`,
      };
    }
    default: {
      const callOnly = CALL_ONLY[opp.sourceType];
      return {
        draft: null,
        noDraftReason: callOnly ?? `No draft template for source type '${opp.sourceType}' — call or handle manually.`,
      };
    }
  }
}

export function bestChannelFor(sourceType: string): OutreachChannel {
  return CALL_ONLY[sourceType] ? "call" : sourceType === "callback" ? "call" : "sms";
}

/** Risk label from evidence the collectors already attach. */
export function riskLabelFor(opp: OpportunityRow): { label: OpportunityDraftResult["riskLabel"]; reasons: string[] } {
  const reasons: string[] = [];
  const ev = (opp.evidence ?? {}) as Record<string, unknown>;
  if (CALL_ONLY[opp.sourceType]) {
    return { label: "human_only", reasons: [CALL_ONLY[opp.sourceType]] };
  }
  if (!opp.consentOk) reasons.push("consent_ok=0 — DNC/opt-out standing");
  if (ev.identityAmbiguous) reasons.push("identity ambiguous — phone matches multiple customers");
  const quoteFlags = Array.isArray(ev.quoteFlags) ? (ev.quoteFlags as unknown[]) : [];
  if (quoteFlags.length > 0) reasons.push(`quote guard flags: ${quoteFlags.map(String).join(", ")}`);
  if (opp.dataQuality === "inferred" || opp.dataQuality === "partial" || opp.dataQuality === "unknown") {
    reasons.push(`evidence quality: ${opp.dataQuality}`);
  }
  return { label: reasons.length > 0 ? "elevated" : "low", reasons };
}

export async function draftOpportunityOutreach(opp: OpportunityRow): Promise<OpportunityDraftResult> {
  const bestChannel = bestChannelFor(opp.sourceType);
  const { label, reasons } = riskLabelFor(opp);
  const { draft, noDraftReason } = buildDraftBody(opp);

  if (!draft) {
    return { ok: true, bestChannel, draft: null, noDraftReason, riskLabel: label, riskReasons: reasons, guardFindings: [] };
  }

  // Same deterministic guard the AI reply path runs — belt on suspenders even
  // for templates (catches an SSOT drift like a retired phone number).
  const { runNickgptPreflightGuard } = await import("./nickgptPreflightGuard");
  const { humanizeCopy } = await import("./smsOrchestrator");
  const humanized = humanizeCopy(draft);
  const guard = runNickgptPreflightGuard({
    eventType: "opportunity_draft_bridge",
    candidateBody: humanized,
    sourceType: "deterministic_template",
  });
  return {
    ok: true,
    bestChannel,
    draft: humanized,
    riskLabel: label,
    riskReasons: reasons,
    guardFindings: guard.findings.map((f) => ({ code: f.code, message: f.message })),
  };
}

export interface SendDraftParams {
  id: string;
  body: string;
  by: string;
}

export interface SendDraftResult {
  ok: boolean;
  error?: string;
  queued?: boolean;
}

/**
 * Operator-approved send. The operator saw and (optionally edited) the exact
 * body. Refuses on: missing/limbo opportunity, consent, no phone, critical
 * guard findings (toxicity / unresolved template vars — even an operator
 * shouldn't fat-finger those out the door), or a state that can't accept an
 * attempt. Everything else is the chokepoint's job.
 */
export async function sendOpportunityDraft(params: SendDraftParams): Promise<SendDraftResult> {
  const { listOpportunities, transitionOpportunity } = await import("./opportunityQueue");
  // No single-row getter exists; the list read is bounded and admin-only.
  const rows = await listOpportunities({ limit: 500 });
  const opp = rows.find((r) => r.id === params.id);
  if (!opp) return { ok: false, error: "opportunity not found" };
  if (!opp.consentOk) return { ok: false, error: "consent_ok=0 — this customer must not be texted" };
  if (!opp.customerPhone) return { ok: false, error: "no phone on this opportunity" };
  if (CALL_ONLY[opp.sourceType]) return { ok: false, error: CALL_ONLY[opp.sourceType] };
  const sendableStates = ["new", "assigned", "attempted", "no_response"];
  if (!sendableStates.includes(opp.state)) {
    return { ok: false, error: `state '${opp.state}' does not accept a new outreach attempt` };
  }

  const body = params.body.trim();
  if (!body) return { ok: false, error: "empty message" };
  if (body.length > 480) return { ok: false, error: "message too long (480 char cap ≈ 3 SMS segments)" };

  const { runNickgptPreflightGuard } = await import("./nickgptPreflightGuard");
  const guard = runNickgptPreflightGuard({
    eventType: "opportunity_draft_bridge",
    candidateBody: body,
    sourceType: "manual",
  });
  if (guard.severity === "critical") {
    return { ok: false, error: `blocked by preflight guard: ${guard.findings.map((f) => f.code).join(", ")}` };
  }

  const { sendSms } = await import("../sms");
  const result = await sendSms(opp.customerPhone, body, {
    via: "shop",
    messageClass: "customer_followup",
    humanInitiated: true,
    variantKey: `opp_bridge_${opp.sourceType}`,
  });

  if (!result.success) {
    log.warn("opportunity draft send failed", { id: params.id, error: result.error });
    return { ok: false, error: result.error ?? "send failed" };
  }

  const transition = await transitionOpportunity({
    id: params.id,
    to: "attempted",
    by: params.by,
    note: `SMS sent from Decision Inbox (${result.queued ? "queued for window" : "delivered to gateway"}): "${body.slice(0, 120)}${body.length > 120 ? "…" : ""}"`,
  });
  if (!transition.ok) {
    // The text went out; the receipt failing must be loud but not lie about the send.
    log.error("draft sent but transition failed — receipt missing", { id: params.id, error: transition.error });
  }
  return { ok: true, queued: result.queued === true };
}
