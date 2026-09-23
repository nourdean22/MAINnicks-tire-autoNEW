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
  /** Tire inquiries counted (one per tool call). */
  total: number;
  /** Most-asked first; ties by size. */
  sizes: Array<{ size: string; count: number; new: number; used: number }>;
  /** Inquiries with no usable size: the caller did not know it, or it did not parse. */
  sizeUnknown: number;
}

/** Summarise the `demand` metadata of tireInquiry state rows. Rows without it are skipped. */
export function summarizeTireDemand(metadatas: ReadonlyArray<unknown>): TireDemandSummary {
  const bySize = new Map<string, { size: string; count: number; new: number; used: number }>();
  let total = 0;
  let sizeUnknown = 0;
  for (const m of metadatas) {
    const meta = (m && typeof m === "object" ? m : {}) as { tool?: unknown; demand?: Partial<TireDemand> };
    if (meta.tool !== "tireInquiry" || !meta.demand || typeof meta.demand !== "object") continue;
    total++;
    const size = typeof meta.demand.size === "string" ? meta.demand.size : null;
    if (!size) {
      sizeUnknown++;
      continue;
    }
    const row = bySize.get(size) ?? { size, count: 0, new: 0, used: 0 };
    row.count++;
    if (meta.demand.condition === "new") row.new++;
    if (meta.demand.condition === "used") row.used++;
    bySize.set(size, row);
  }
  const sizes = Array.from(bySize.values()).sort((a, b) => b.count - a.count || a.size.localeCompare(b.size));
  return { total, sizes, sizeUnknown };
}

/** Whole minutes since midnight in the shop's timezone. A duration, so the DB clock's zone never matters. */
export function minutesSinceShopMidnight(now: Date, timeZone = "America/New_York"): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const min = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + min;
}
