/**
 * Phone tire demand — what callers asked for, in a form the counter can use.
 *
 * WHY. An ordinary tire inquiry has persisted nothing but the call record since
 * the 2026-06-05 no-lead directive; the assistant now says the size was
 * "noted" (#2559), and nothing downstream could read the note. The census
 * (2026-09-23) put tire needs at about 37% of readable episodes. The size a
 * caller asked about is the one fact the counter can act on today: pull it,
 * check stock, have it ready when they pull up.
 *
 * WHERE IT LIVES. The webhook already appends a `tool_called` state for every
 * tireInquiry; this adds `demand` to that row's metadata. Size and new/used
 * only: never the caller's name or phone.
 */
import { extractTireSize } from "@shared/callDemandExtraction";

export type TireCondition = "new" | "used" | "either";

export interface TireDemand {
  /** Normalised (215/60R17), or null when the caller gave none or it did not parse. */
  size: string | null;
  condition: TireCondition | null;
}

/** Read a tireInquiry call's arguments (JSON string or object). Total: never throws. */
function tireDemandFromToolArgs(raw: unknown): TireDemand {
  let args: Record<string, unknown> = {};
  try {
    if (typeof raw === "string") args = (JSON.parse(raw || "{}") ?? {}) as Record<string, unknown>;
    else if (raw && typeof raw === "object") args = raw as Record<string, unknown>;
  } catch {
    args = {};
  }
  const sizeText = typeof args.tireSize === "string" ? args.tireSize : "";
  const cond = args.newOrUsed;
  return {
    size: sizeText ? extractTireSize(sizeText) : null,
    condition: cond === "new" || cond === "used" || cond === "either" ? cond : null,
  };
}

/**
 * Metadata for a tool call's state row. Consumer: the tool-calls branch of
 * server/routes/webhooks/vapi.ts. A tireInquiry also carries `demand`.
 */
export function toolCallStateMetadata(name: string | undefined, toolCallId: string | undefined, rawArgs: unknown): Record<string, unknown> {
  return {
    tool: name,
    toolCallId,
    ...(name === "tireInquiry" ? { demand: tireDemandFromToolArgs(rawArgs) } : {}),
  };
}

export interface TireDemandSummary {
  /** Tire callers: distinct calls with at least one tireInquiry. */
  total: number;
  /** Most-asked first; ties by size. `count` is calls that asked for the size. */
  sizes: Array<{ size: string; count: number; new: number; used: number }>;
  /** Calls whose tire inquiries gave no usable size: the caller did not know it, or it did not parse. */
  sizeUnknown: number;
}

/** One tool_called state row: the Vapi call id (voice_latency_events.call_id) and its metadata. */
export interface ToolCallStateRow {
  callId: string;
  metadata: unknown;
}

/**
 * Summarise the `demand` metadata of tireInquiry state rows, ONE CALLER PER
 * CALL (post-merge audit J, 2026-09-23). A caller who asks for front and rear
 * sizes, or an assistant that re-calls the tool, writes several rows for one
 * call; counted per row, that read as several callers and over-pulled stock.
 * A size asked twice in one call counts once for that size; two sizes in one
 * call count once each. Rows without `demand` are skipped.
 */
export function summarizeTireDemand(rows: ReadonlyArray<ToolCallStateRow>): TireDemandSummary {
  const calls = new Map<string, Map<string, Set<TireCondition | null>>>();
  for (const { callId, metadata } of rows) {
    const meta = (metadata && typeof metadata === "object" ? metadata : {}) as { tool?: unknown; demand?: Partial<TireDemand> };
    if (meta.tool !== "tireInquiry" || !meta.demand || typeof meta.demand !== "object") continue;
    const sizes = calls.get(callId) ?? new Map<string, Set<TireCondition | null>>();
    calls.set(callId, sizes);
    const size = typeof meta.demand.size === "string" ? meta.demand.size : null;
    if (!size) continue;
    const conditions = sizes.get(size) ?? new Set<TireCondition | null>();
    conditions.add(meta.demand.condition ?? null);
    sizes.set(size, conditions);
  }

  const bySize = new Map<string, { size: string; count: number; new: number; used: number }>();
  let sizeUnknown = 0;
  for (const sizes of Array.from(calls.values())) {
    if (sizes.size === 0) sizeUnknown++;
    for (const [size, conditions] of Array.from(sizes.entries())) {
      const row = bySize.get(size) ?? { size, count: 0, new: 0, used: 0 };
      row.count++;
      if (conditions.has("new")) row.new++;
      if (conditions.has("used")) row.used++;
      bySize.set(size, row);
    }
  }
  const sizes = Array.from(bySize.values()).sort((a, b) => b.count - a.count || a.size.localeCompare(b.size));
  return { total: calls.size, sizes, sizeUnknown };
}
