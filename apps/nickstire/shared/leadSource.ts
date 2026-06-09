/**
 * Lead-source classification — one source of truth for telling a real
 * sales/service lead apart from an operational caller/callback artifact.
 *
 * WHY THIS EXISTS
 * The website "Call Me Back" form AND the VAPI voice agent both write rows
 * into `leads` with `source="callback"`, but they are NOT the same thing:
 *
 *  - The web callback form (`callback.submit`) also writes a `callback_requests`
 *    row and links it via `leads.callbackId`. That lead is therefore a DUPLICATE
 *    of a record already counted on the Callbacks surface. Counting it again as a
 *    "stale lead" double-counts the same person (see Today's Money Risks).
 *
 *  - The voice-agent rack-check (`voiceAgent.tireInquiry` / `checkTireStock`)
 *    writes a `source="callback"` lead with NO `callback_requests` row and a NULL
 *    `callbackId`. It is counted only once (as a lead), so it must KEEP counting.
 *
 * The discriminator is `callbackId`, not `source` alone. A blanket
 * "exclude source=callback" would make voice rack-check promises vanish.
 *
 * Pure + dependency-free so it is shared by the client (money-risk counting,
 * Leads badges) and the server (future: morningBrief / controlCenter counts),
 * and unit-tested in isolation.
 *
 * Audit: docs/audits/NICKSTIRE-LEAD-SOURCE-HYGIENE-AUDIT.md
 */

/** The `leads.source` MySQL enum (drizzle/schema.ts). */
export type LeadSource =
  | "popup"
  | "chat"
  | "booking"
  | "manual"
  | "callback"
  | "fleet"
  | "financing_preapproval"
  | "sms"
  | "careers";

export type LeadOriginKind =
  /** Real sales/service lead (popup, chat, booking, manual, fleet, financing, sms, careers). */
  | "trueLead"
  /** `source="callback"` lead LINKED (callbackId set) to a callback_requests row
   *  already counted on the Callbacks surface — a duplicate of that callback. */
  | "duplicateLink"
  /** Phone/voice-agent originated (VAPI rack-check): `source="callback"`, no linked
   *  callback_requests row. A real operational item — count it once. */
  | "phoneCall"
  /** Web callback lead with no linked callback_requests row (rare: the
   *  callback_requests insert failed). Operational — count once. */
  | "operationalCallback"
  /** `source` missing / not a recognized value. */
  | "unknown";

/** Minimal structural view of a lead row — assignable from a Drizzle `leads` row. */
export interface LeadOriginInput {
  source?: string | null;
  callbackId?: number | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

/** Heuristic: a `source="callback"` lead created by the VAPI voice agent. */
function isVoiceOrigin(lead: LeadOriginInput): boolean {
  const medium = (lead.utmMedium ?? "").toLowerCase();
  const campaign = (lead.utmCampaign ?? "").toLowerCase();
  return medium === "phone" || campaign.includes("vapi") || campaign.includes("voice");
}

/**
 * Classify a lead row by its true origin. See module header for the rationale
 * behind using `callbackId` (not `source` alone) to split the callback cluster.
 */
export function classifyLeadOrigin(lead: LeadOriginInput): LeadOriginKind {
  const source = (lead.source ?? "").trim();
  if (!source) return "unknown";
  if (source !== "callback") return "trueLead";

  // source === "callback" — disambiguate the operational-caller cluster.
  if (lead.callbackId != null) return "duplicateLink"; // already counted as a callback
  if (isVoiceOrigin(lead)) return "phoneCall";
  return "operationalCallback";
}

/**
 * True when this lead is a duplicate of a `callback_requests` row already counted
 * on the Callbacks surface — so it MUST be excluded from any "stale lead" /
 * pipeline count to avoid double-counting the same person. The single predicate
 * the Money-Risks counting relies on.
 */
export function isCallbackDuplicateLead(lead: LeadOriginInput): boolean {
  return classifyLeadOrigin(lead) === "duplicateLink";
}

/** True for any `source="callback"` lead (web callback, voice, or linked duplicate). */
export function isOperationalCallerLead(lead: LeadOriginInput): boolean {
  const kind = classifyLeadOrigin(lead);
  return kind === "duplicateLink" || kind === "phoneCall" || kind === "operationalCallback";
}

/** Short, distinct operator-facing label for a lead's source. */
export function leadSourceLabel(lead: LeadOriginInput): string {
  switch (classifyLeadOrigin(lead)) {
    case "phoneCall":
      return "PHONE";
    case "duplicateLink":
    case "operationalCallback":
      return "CALLBACK";
    case "unknown":
      return "—";
    case "trueLead": {
      const source = (lead.source ?? "").trim();
      return source ? source.toUpperCase() : "—";
    }
  }
}
