/**
 * Lead service · v10.0.53 · Wave A · cleanup.
 *
 * Pre-cleanup: 258 lines, 7 exports — listLeads / getLeadById /
 * parseLeadInquiry / getUrgentLeads / createLead / updateLead /
 * deleteLead — production paths were dead `Promise.resolve(...)`
 * placeholders since lead persistence moved to nickstire.
 *
 * Post-cleanup: 3 exports — `listLeads`, `getUrgentLeads`,
 * `createLead`. These are the ones with external consumers:
 *   - listLeads + getUrgentLeads → lib/services/dashboard.ts
 *   - createLead → lib/services/capture.ts (capture-to-LEAD flow)
 * The orphans (getLeadById, parseLeadInquiry, updateLead,
 * deleteLead) had zero external callers and are deleted. Lead CRUD
 * belongs on nickstire admin.
 *
 * createLead in production previously did `Promise.resolve(null)`
 * then `getLeadById(lead.id)` → CRASH (TypeError: Cannot read
 * properties of null). This was a real CRITICAL bug — converting
 * a capture item to LEAD silently crashed in production. Now
 * createLead in production throws a typed ServiceError with a
 * clear "use nickstire admin" message; capture.ts catches and
 * surfaces the message to the user instead of crashing the route.
 *
 * Production behavior for the read methods: empty + warn-logged
 * once. Consumers already degrade gracefully (counts show 0,
 * dashboard cards hide).
 */

import { getDemoState, makeDemoId, type DemoLead } from "@/lib/demo-store";
import { isDemoMode } from "@/lib/runtime";
import { parseLeadIntake } from "@/lib/scoring/lead-parser";
import { addDays } from "@/lib/utils/datetime";
import { serializeForJson } from "@/lib/utils/serialize";
import { ServiceError } from "@/lib/utils/service-error";
import { leadCreateSchema } from "@/lib/validators/leads";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/leads");

let warnedMissingBridge = false;
function warnMissingBridge(method: string) {
  if (warnedMissingBridge) return;
  warnedMissingBridge = true;
  log.warn("bridge_missing", {
    method,
    note: "lead data lives on nickstire admin; no bridge query exposed yet · reads return empty, writes throw",
  });
}

function defaultFollowUpDueAt(urgency: string) {
  const now = new Date();
  if (urgency === "HIGH") return addDays(now, 1);
  if (urgency === "LOW") return addDays(now, 5);
  return addDays(now, 2);
}

function decorateLeads(leads: DemoLead[]) {
  type DecoratedLead = ReturnType<typeof serializeForJson<DemoLead[]>>[number] & {
    effectiveLeadType: string;
    effectiveUrgency: string;
    effectiveValueEstimate: number;
  };
  type SerializedLead = ReturnType<typeof serializeForJson<DemoLead[]>>[number];
  return serializeForJson(leads)
    .map((lead: SerializedLead): DecoratedLead => ({
      ...lead,
      effectiveLeadType: lead.manualLeadTypeOverride || lead.leadType,
      effectiveUrgency: lead.manualUrgencyOverride || lead.urgency,
      effectiveValueEstimate:
        lead.manualValueEstimateOverride ?? lead.valueEstimate ?? 0,
    }))
    .sort((left: DecoratedLead, right: DecoratedLead) => {
      const urgencyOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      const leftU = urgencyOrder[left.effectiveUrgency as keyof typeof urgencyOrder];
      const rightU = urgencyOrder[right.effectiveUrgency as keyof typeof urgencyOrder];
      if (leftU !== rightU) return rightU - leftU;
      const leftDate = left.followUpDueAt
        ? new Date(left.followUpDueAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      const rightDate = right.followUpDueAt
        ? new Date(right.followUpDueAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      return leftDate - rightDate;
    });
}

export async function listLeads() {
  if (isDemoMode) {
    return decorateLeads(
      [...getDemoState().leads].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      ),
    );
  }
  warnMissingBridge("listLeads");
  return decorateLeads([]);
}

export async function getUrgentLeads(limit = 5) {
  const leads: Awaited<ReturnType<typeof listLeads>> = await listLeads();
  const now = Date.now();
  return leads
    .filter(
      (lead: (typeof leads)[number]) =>
        ["NEW", "CONTACTED"].includes(lead.status) &&
        (lead.effectiveUrgency === "HIGH" ||
          (lead.followUpDueAt
            ? new Date(lead.followUpDueAt).getTime() <= now
            : false)),
    )
    .slice(0, limit);
}

export async function createLead(input: unknown) {
  const payload = leadCreateSchema.parse(input);
  const parser = parseLeadIntake(payload.inquiryText);

  if (isDemoMode) {
    const state = getDemoState();
    const now = new Date();
    const lead: DemoLead = {
      id: makeDemoId("lead"),
      fullName: payload.fullName,
      source: payload.source,
      leadType: payload.leadType || parser.leadType,
      manualLeadTypeOverride: payload.manualLeadTypeOverride || null,
      inquiryText: payload.inquiryText,
      urgency: payload.urgency || parser.urgency,
      manualUrgencyOverride: payload.manualUrgencyOverride || null,
      valueEstimate: payload.valueEstimate ?? parser.valueEstimate,
      manualValueEstimateOverride: payload.manualValueEstimateOverride ?? null,
      status: payload.status,
      lastContactAt: payload.lastContactAt || null,
      followUpDueAt:
        payload.followUpDueAt ||
        defaultFollowUpDueAt(
          payload.manualUrgencyOverride || payload.urgency || parser.urgency,
        ),
      objectionType: payload.objectionType || null,
      assignedTo: payload.assignedTo || null,
      outcome: payload.outcome || null,
      bookingValue: payload.bookingValue ?? null,
      timeToResponseMinutes: payload.timeToResponseMinutes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    state.leads.push(lead);
    // Demo path returns the freshly-created lead row; no DB round-trip needed.
    return decorateLeads([lead])[0];
  }

  // Production: lead persistence lives on nickstire admin. There's
  // no bridge mutation exposed yet, so we explicitly fail with a
  // typed error rather than silently dropping the lead. Caller
  // (capture.ts) catches and renders a clear UX message.
  warnMissingBridge("createLead");
  throw new ServiceError(
    "Lead creation requires nickstire admin access — open the captured item in nickstire to create the lead there.",
    501,
  );
}
