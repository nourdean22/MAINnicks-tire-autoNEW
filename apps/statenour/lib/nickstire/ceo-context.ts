/**
 * Normalize nickstire → Statenour business sync payloads into a compact CEO context
 * for prompts, command deck, and RAG (stored separately from the raw audit payload).
 */

export type CeoPrioritizedAction = {
  priority: "critical" | "high" | "medium";
  title: string;
  detail: string;
};

export type CeoBusinessContextV1 = {
  schemaVersion: "ceo_context_v1";
  source: "nickstire";
  ingestVersion: string;
  updatedAt: unknown;
  prioritizedActions: CeoPrioritizedAction[];
  /** Subset of sync fields — keep shallow for storage */
  revenue?: unknown;
  estimateLeadFunnel?: unknown;
  declinedWork?: unknown;
  workOrders?: unknown;
  callbacks?: unknown;
  leads?: unknown;
  featureFlagSnapshot?: unknown;
  syncMeta?: unknown;
  intelligence?: unknown;
};

function num(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v) || 0;
  return 0;
}

export function buildCeoContextFromNickSyncPayload(
  raw: Record<string, unknown>
): CeoBusinessContextV1 {
  const version = typeof raw.version === "string" ? raw.version : "v1";
  const funnel = raw.estimateLeadFunnel as Record<string, unknown> | undefined;
  const last7 = funnel?.last7d as Record<string, unknown> | undefined;
  const last30 = funnel?.last30d as Record<string, unknown> | undefined;
  const declined = raw.declinedWork as Record<string, unknown> | undefined;
  const callbacks = raw.callbacks as Record<string, unknown> | undefined;
  const leads = raw.leads as Record<string, unknown> | undefined;

  const actions: CeoPrioritizedAction[] = [];

  const stale7 = num(last7?.staleNewEstimates);
  if (stale7 > 0) {
    actions.push({
      priority: "high",
      title: "Stale estimate leads (48h+)",
      detail: `${stale7} estimate-style leads still "new" in the last 7 days — follow up before conversion drops.`,
    });
  }

  const stale30 = num(last30?.staleNewEstimates);
  if (stale30 > stale7) {
    actions.push({
      priority: "medium",
      title: "Stale estimate leads (30d window)",
      detail: `${stale30} still new in the rolling 30-day window.`,
    });
  }

  const safetyDeclined = num(declined?.safetyItemCount);
  if (safetyDeclined > 0) {
    actions.push({
      priority: "critical",
      title: "Declined work with safety items",
      detail: `${safetyDeclined} customer(s) with open declined lines flagged safety-related — prioritize callbacks.`,
    });
  }

  const newCallbacks = num(callbacks?.new);
  if (newCallbacks > 0) {
    actions.push({
      priority: "high",
      title: "New callback requests",
      detail: `${newCallbacks} waiting in nickstire — speed-to-callback drives conversion.`,
    });
  }

  const urgentLeads = num(leads?.urgent);
  if (urgentLeads > 0) {
    actions.push({
      priority: "critical",
      title: "Urgent leads",
      detail: `${urgentLeads} high-urgency lead(s) in nickstire pipeline.`,
    });
  }

  const openWo = raw.workOrders as Record<string, unknown> | undefined;
  const blocked = num(openWo?.blocked);
  if (blocked > 0) {
    actions.push({
      priority: "high",
      title: "Blocked work orders",
      detail: `${blocked} WO(s) in blocked status — clear bottlenecks on the floor.`,
    });
  }

  return {
    schemaVersion: "ceo_context_v1",
    source: "nickstire",
    ingestVersion: version,
    updatedAt: raw.timestamp ?? new Date().toISOString(),
    prioritizedActions: actions.slice(0, 8),
    revenue: raw.revenue,
    estimateLeadFunnel: raw.estimateLeadFunnel,
    declinedWork: raw.declinedWork,
    workOrders: raw.workOrders,
    callbacks: raw.callbacks,
    leads: raw.leads,
    featureFlagSnapshot: raw.featureFlagSnapshot,
    syncMeta: raw.syncMeta,
    intelligence: raw.intelligence,
  };
}
