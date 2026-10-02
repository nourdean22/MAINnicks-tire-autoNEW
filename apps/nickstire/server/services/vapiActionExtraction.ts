/**
 * VAPI call-end → DRAFT proposals (trust ladder, Phase 6).
 *
 * Nick already generates the highest-intent structured events this business
 * has, and the daily evaluator already classifies them (vapiCallClassifier)
 * for the Missed Revenue Queue. What no path did: turn an EXPLICIT caller ask
 * ("have someone call me back", "I want to bring it in Friday") into a
 * reviewable intent the operator can approve. This module does exactly that —
 * and ONLY that:
 *
 *   · DETERMINISTIC FIRST (the resolutionJudge doctrine): classifyCall's regex
 *     outcome decides WHETHER extraction runs at all. Spam, tech failures,
 *     completed conversions and human-handled calls never reach the LLM.
 *   · The LLM is an extractor, not an actor. Its output lands as DRAFT rows in
 *     admin_proposals; nothing executes without a human tap (services/
 *     proposals.ts CAS chain). This honors the 2026-06-05 operator directive —
 *     ordinary voice inquiries create NO operational rows; a draft proposal is
 *     a review artifact, and the operational row exists only after approval.
 *   · Contact info: the VERIFIED telephony number (call.customer.number)
 *     always wins over anything spoken in the transcript. A model may not
 *     invent or override a phone number.
 *   · parseExtraction THROWS on unknown shapes — never defaults to acting
 *     (resolutionJudge's parse contract).
 *   · Model pin: Ollama-native substring so it routes without AI_FORCE_OLLAMA
 *     (the ROS-089 pinning doctrine).
 *   · At-most-once per (call, action kind) via admin_proposals' unique
 *     idempotency key — a webhook redelivery dedupes instead of duplicating.
 *
 * Gated by feature flag `vapi_action_proposals` (OFF by default — also the
 * deploy-order guard for migration 0111).
 */
import { BUSINESS } from "@shared/business";
import { createLogger } from "../lib/logger";
import { classifyCall, type VapiOutcomeCategory } from "./vapiCallClassifier";
import { createProposal, type CreateProposalResult } from "./proposals";

const log = createLogger("vapi-action-extraction");

export const VAPI_EXTRACT_MODEL = process.env.VAPI_EXTRACT_MODEL || "gpt-oss:120b";

/**
 * Outcomes worth an extraction pass. Everything else is either already
 * handled (hard_conversion, walk_in_directed, human_handoff — a person or a
 * tool owns it), noise (spam, abandoned, tech_failure), or has no ask
 * (resolved_info).
 */
export const ACTIONABLE_OUTCOMES: readonly VapiOutcomeCategory[] = [
  "callback_needed",
  "quote_or_inspection_intent",
  "tire_availability_intent",
  "lost_opportunity",
];

export interface CallMeta {
  callId: string;
  transcript: string;
  summary: string | null;
  customerName: string | null;
  /** Verified telephony number — the ONLY phone a proposal may carry. */
  customerPhone: string | null;
  durationSeconds: number;
  endedReason: string | null;
  /** VAPI's own call type, e.g. "inboundPhoneCall" / "outboundPhoneCall". */
  callType?: string | null;
  /**
   * CAPTURED EVIDENCE — what a mid-call tool already persisted for THIS call.
   * Without these the classifier's "already captured" branch could never fire
   * here, so a call scheduleCallback/escalate had already written a callback
   * for still drafted a second one (production: 38 of 44 drafts rejected).
   * Loaded by `loadCallCaptureEvidence`; all optional so an absent read
   * degrades to the pre-fix behavior, never to silence.
   */
  leadId?: number | null;
  callbackId?: number | null;
  bookingId?: number | null;
  reachedTool?: boolean;
  /** A callback_requests row already names this call (`callId=<id>` in its context). */
  existingCallbackForCall?: boolean;
  /** bookSlot already recorded the walk-in commitment (expected_arrivals.sourceRef = callId). */
  hasExpectedArrival?: boolean;
}

/**
 * OUTBOUND calls are ours: appointment confirmations and declined-work
 * recovery, placed BY the shop. Their transcripts are full of the same
 * reschedule/callback language an inbound ask uses, so `classifyCall` — which
 * has no direction awareness — would happily produce a draft for a customer we
 * already called, on a booking that already exists.
 *
 * Absent type is treated as INBOUND on purpose: the concrete case this closes
 * is our own outbound lane, which VAPI always types, and refusing every
 * untyped payload would silently disable the whole feature if the webhook
 * shape ever drops the field. The cost of the remaining case is one dismissible
 * draft; the cost of the other default is a feature that looks armed and does
 * nothing — the failure mode this repo keeps finding.
 */
export function isOutboundCall(callType: string | null | undefined): boolean {
  return typeof callType === "string" && /outbound/i.test(callType);
}

/**
 * Pure gate: should this call reach the LLM at all?
 * Returns the classified outcome when actionable, null otherwise.
 */
export function shouldExtract(meta: CallMeta): VapiOutcomeCategory | null {
  if (!meta.callId) return null;
  if (isOutboundCall(meta.callType)) return null;
  // No verified number = no proposal can safely name a contact. Skip.
  if (!meta.customerPhone || meta.customerPhone.replace(/\D/g, "").length < 7) return null;
  if (meta.transcript.trim().length < 40) return null;
  // Both draft kinds already owned by an operational row — nothing could survive
  // dropAlreadyOwned, so do not spend an LLM pass finding that out.
  if (callbackOwned(meta) && bookingOwned(meta)) return null;
  // Captured ids are deliberately NOT passed to classifyCall: a linked callback would make
  // the WHOLE call hard_conversion and suppress a separate, explicit booking ask in the same
  // call. Ownership is decided per draft kind (dropAlreadyOwned), not per call.
  const { outcome } = classifyCall({
    durationSeconds: meta.durationSeconds,
    endedReason: meta.endedReason,
    aiSummary: meta.summary,
    transcript: meta.transcript,
  });
  return ACTIONABLE_OUTCOMES.includes(outcome) ? outcome : null;
}

export interface ExtractedAction {
  kind: "create_callback" | "create_booking_request";
  /** Caller name as spoken, when the model heard one. */
  name: string | null;
  /** What the caller asked for, in their words. */
  reason: string;
  /** Service phrase for booking asks. */
  service: string | null;
  /** YYYY-MM-DD when the caller named a day; null otherwise. */
  preferredDate: string | null;
  /** 0-100, the model's honesty about how explicit the ask was. */
  confidence: number;
}

/** Today's calendar date in SHOP time (YYYY-MM-DD) — never the server's UTC day. */
export function shopToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Pure: the extractor's instruction. Exported so a test can pin its contract.
 * `today` (YYYY-MM-DD, shop time) is stated in the prompt: without it the model
 * had no anchor for "Friday" and emitted wrong or past dates.
 */
export function buildExtractionPrompt(today: string): string {
  const weekday = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()] ?? "";
  return [
    "You read ONE phone call transcript from an auto shop's AI receptionist.",
    `Today is ${weekday}, ${today} (shop time, ${BUSINESS.timezone}).`,
    "",
    "Extract ONLY actions the CALLER explicitly asked for. Two kinds exist:",
    '  "create_callback"        — the caller asked to be called back.',
    '  "create_booking_request" — the caller asked to bring the vehicle in / book work.',
    "",
    "Rules:",
    "- Only explicit asks. A pricing question alone is NOT a callback request.",
    "- NEVER invent contact information. Report a name only if the caller stated one.",
    "- Phone numbers are handled by the system — do not extract them.",
    `- preferredDate only when the caller named a concrete day, as "YYYY-MM-DD"; else null. Resolve relative days ("Friday", "tomorrow") against today. Never a past date: on or after ${today}.`,
    "- confidence 0-100: how explicit the ask was. 90+ only for verbatim requests.",
    "- Nothing actionable => an empty actions array. That is a good answer.",
    "",
    "Reply with ONE line of JSON:",
    '{"actions":[{"kind":"create_callback|create_booking_request","name":"...or null","reason":"caller\'s ask, one sentence","service":"...or null","preferredDate":"YYYY-MM-DD or null","confidence":0-100}]}',
  ].join("\n");
}

/**
 * Pure: parse the model's reply. Unknown shapes THROW — a draft the schema
 * cannot validate must never be created "best-effort". Caps at 3 actions and
 * one per kind (the idempotency key is per (call, kind) anyway). With `today`
 * (YYYY-MM-DD), a preferredDate before it is dropped to null — a past date is
 * a model error, not a caller ask.
 */
export function parseExtraction(raw: string, today?: string): ExtractedAction[] {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) throw new Error(`extractor returned no JSON object: ${raw.slice(0, 120)}`);
  const parsed = JSON.parse(m[0]) as { actions?: unknown };
  if (!Array.isArray(parsed.actions)) throw new Error("extractor JSON has no actions array");

  const out: ExtractedAction[] = [];
  const seenKinds = new Set<string>();
  for (const item of parsed.actions.slice(0, 3)) {
    const a = item as Record<string, unknown>;
    const kind = String(a.kind ?? "");
    if (kind !== "create_callback" && kind !== "create_booking_request") {
      throw new Error(`extractor returned unknown action kind "${kind}"`);
    }
    if (seenKinds.has(kind)) continue;
    seenKinds.add(kind);
    const reason = String(a.reason ?? "").trim();
    if (!reason) throw new Error(`extractor returned a ${kind} with no reason`);
    const confidenceRaw = Number(a.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.min(100, Math.max(0, Math.round(confidenceRaw))) : 0;
    const date =
      typeof a.preferredDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.preferredDate) && !(today && a.preferredDate < today)
        ? a.preferredDate
        : null;
    out.push({
      kind,
      name: typeof a.name === "string" && a.name.trim() && a.name.trim().toLowerCase() !== "null" ? a.name.trim().slice(0, 120) : null,
      reason: reason.slice(0, 500),
      service: typeof a.service === "string" && a.service.trim() ? a.service.trim().slice(0, 100) : null,
      preferredDate: date,
      confidence,
    });
  }
  return out;
}

/**
 * Pure: drop draft kinds an operational row already owns for this call.
 *   · create_callback — scheduleCallback/escalate already wrote callback_requests.
 *   · create_booking_request — bookSlot already recorded an expected arrival
 *     and told the caller NO appointment was booked (walk-in shop); approving a
 *     booking draft would contradict that.
 */
/**
 * Someone already owes this caller a contact: a linked callback, a callback row naming the
 * call, or a lead row (tireInquiry's rack check — staff follow up on it). A callback draft
 * would duplicate any of them.
 */
function callbackOwned(meta: CallMeta): boolean {
  return meta.callbackId != null || meta.leadId != null || meta.existingCallbackForCall === true;
}
/** A booking or the walk-in commitment for this call already exists. */
function bookingOwned(meta: CallMeta): boolean {
  return meta.bookingId != null || meta.hasExpectedArrival === true;
}

export function dropAlreadyOwned(
  actions: readonly ExtractedAction[],
  meta: CallMeta,
): { kept: ExtractedAction[]; dropped: Array<{ kind: ExtractedAction["kind"]; reason: string }> } {
  const kept: ExtractedAction[] = [];
  const dropped: Array<{ kind: ExtractedAction["kind"]; reason: string }> = [];
  for (const a of actions) {
    if (a.kind === "create_callback" && callbackOwned(meta)) {
      dropped.push({ kind: a.kind, reason: "callback_request_exists_for_call" });
    } else if (a.kind === "create_booking_request" && bookingOwned(meta)) {
      dropped.push({ kind: a.kind, reason: "booking_or_expected_arrival_exists_for_call" });
    } else {
      kept.push(a);
    }
  }
  return { kept, dropped };
}

/**
 * Pure: map extracted actions onto createProposal inputs. The verified
 * telephony number is injected here — the model never supplies a phone.
 */
export function buildProposalInputs(
  actions: readonly ExtractedAction[],
  meta: CallMeta,
  outcome: VapiOutcomeCategory,
): Array<Parameters<typeof createProposal>[0]> {
  const phone = meta.customerPhone ?? "";
  return actions.map((a) => {
    const name = a.name ?? meta.customerName ?? "Caller";
    const payload =
      a.kind === "create_callback"
        ? { name, phone, reason: a.reason, sourcePage: "vapi-call" }
        : {
            name,
            phone,
            service: (a.service ?? a.reason).slice(0, 100),
            ...(a.preferredDate ? { preferredDate: a.preferredDate } : {}),
            note: a.reason,
          };
    return {
      source: "nick_receptionist" as const,
      actor: "nick-receptionist",
      actionType: a.kind,
      title: `${a.kind === "create_callback" ? "Callback" : "Booking request"}: ${name} — ${a.reason.slice(0, 120)}`,
      payload,
      entityType: "vapi_call",
      entityId: meta.callId.slice(0, 64),
      context: {
        vapiCallId: meta.callId,
        outcome,
        endedReason: meta.endedReason,
        summary: meta.summary?.slice(0, 240) ?? null,
        extractedBy: VAPI_EXTRACT_MODEL,
      },
      confidence: a.confidence,
      idempotencyKey: `vapi:${meta.callId}:${a.kind}`,
    };
  });
}

export interface ExtractionRunResult {
  ran: boolean;
  outcome?: VapiOutcomeCategory;
  created: number;
  deduped: number;
  error?: string;
}

/**
 * The full pass: gate → LLM → parse → draft proposals. NEVER throws — the
 * webhook must ack regardless (PROTECTED-CORE: webhook idempotency), and a
 * failed extraction is a logged loss of ONE draft, not a lost call record
 * (vapi_call_logs was already written upstream).
 */
export async function maybeProposeCallActions(meta: CallMeta): Promise<ExtractionRunResult> {
  try {
    const outcome = shouldExtract(meta);
    if (!outcome) return { ran: false, created: 0, deduped: 0 };
    const today = shopToday();

    const { invokeLLM } = await import("../_core/llm");
    const res = await invokeLLM({
      messages: [
        { role: "system", content: buildExtractionPrompt(today) },
        {
          role: "user",
          content: `Transcript:\n${meta.transcript.slice(0, 8000)}\n\nSummary: ${meta.summary ?? "(none)"}\n\nYour JSON:`,
        },
      ],
      model: VAPI_EXTRACT_MODEL,
      maxTokens: 900,
      timeoutMs: 60000,
      temperature: 0,
      // Background enrichment must yield to live lanes (resolutionJudge is P1
      // for the same reason).
      priority: 1,
    });
    const raw = res.choices?.[0]?.message?.content ?? "";
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const { kept: actions, dropped } = dropAlreadyOwned(parseExtraction(text, today), meta);
    for (const d of dropped) {
      log.info("draft dropped — already owned by an operational row", { callId: meta.callId.slice(0, 16), kind: d.kind, reason: d.reason });
    }
    if (actions.length === 0) return { ran: true, outcome, created: 0, deduped: 0 };

    let created = 0;
    let deduped = 0;
    for (const input of buildProposalInputs(actions, meta, outcome)) {
      const result: CreateProposalResult = await createProposal(input);
      if (result.created) created++;
      else if ("deduped" in result && result.deduped) deduped++;
      else log.warn("proposal rejected at intake", { callId: meta.callId, error: "error" in result ? result.error : "unknown" });
    }
    log.info(`call ${meta.callId.slice(0, 12)} → ${created} draft proposal(s), ${deduped} deduped`, { outcome });
    return { ran: true, outcome, created, deduped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("extraction failed — no drafts created (loud, non-blocking)", {
      callId: meta.callId.slice(0, 16),
      error: message.slice(0, 200),
    });
    return { ran: true, created: 0, deduped: 0, error: message };
  }
}

/**
 * One bounded read of what this call ALREADY captured, for the gate above.
 * Reads the vapi_call_logs row the webhook just wrote (leadId/callbackId come
 * from the call-state trail there), plus the two rows a tool can write without
 * a trail id: a callback_requests row whose context embeds `callId=<id>`
 * (scheduleCallback/escalate) and an expected_arrivals row with
 * sourceRef = callId (bookSlot). Fails OPEN to {} with a warn — the gate then
 * behaves as before this existed (a possible duplicate draft a human rejects),
 * never as "captured".
 */
export async function loadCallCaptureEvidence(
  callId: string,
): Promise<Pick<CallMeta, "leadId" | "callbackId" | "reachedTool" | "existingCallbackForCall" | "hasExpectedArrival">> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return {};
    const likeCallId = `%callId=${callId.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const [rows] = await db.execute(sql`
      SELECT
        (SELECT leadId FROM vapi_call_logs WHERE vapiCallId = ${callId} LIMIT 1) AS leadId,
        (SELECT callbackId FROM vapi_call_logs WHERE vapiCallId = ${callId} LIMIT 1) AS callbackId,
        (SELECT convertedToLead FROM vapi_call_logs WHERE vapiCallId = ${callId} LIMIT 1) AS convertedToLead,
        EXISTS (SELECT 1 FROM callback_requests
                WHERE createdAt >= NOW() - INTERVAL 7 DAY AND context LIKE ${likeCallId}) AS hasCallback,
        EXISTS (SELECT 1 FROM expected_arrivals WHERE sourceRef = ${callId}) AS hasArrival`);
    const r = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {};
    const fk = (v: unknown): number | null => {
      const n = Number(v);
      return v != null && Number.isInteger(n) && n > 0 ? n : null;
    };
    return {
      leadId: fk(r.leadId),
      callbackId: fk(r.callbackId),
      reachedTool: Number(r.convertedToLead) === 1,
      existingCallbackForCall: Number(r.hasCallback) === 1,
      hasExpectedArrival: Number(r.hasArrival) === 1,
    };
  } catch (err) {
    log.warn("capture-evidence read failed — gate runs without it", {
      callId: callId.slice(0, 16),
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    return {};
  }
}
