/**
 * Apple Health ingestion (H1, 2026-07-28 late · blueprint health batch).
 *
 * Two inlets, one service:
 *   · canonical — the batch schema this repo controls (Shortcuts recipe,
 *     future native bridge)
 *   · HAE — Health Auto Export's own payload shape, transformed here
 *     (pure function, unit-tested) into canonical samples. HAE lacks
 *     per-sample UUIDs, so sourceSampleId is a deterministic hash of
 *     (metric · date · qty · source) — replays dedupe at the DB's
 *     unique constraint, not by hope.
 *
 * Idempotency is two-layered: a replayed batchId returns the ORIGINAL
 * receipt without touching samples; within a fresh batch,
 * createMany({skipDuplicates}) dedupes per-sample against all history.
 * After commit, the summarizer patches BodyTracking for every ET date
 * the batch touched (fill-NULLs-only — the operator's manual entry
 * always wins).
 *
 * Privacy: no sample values in logs — counts and metric names only.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { summarizeHealthDates } from "@/lib/services/health-summary";

const log = rootLogger.withSurface("services/apple-health-ingest");

export const canonicalSampleSchema = z.object({
  sourceSampleId: z.string().min(1).max(190).optional(),
  type: z.string().min(1).max(80),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }).optional(),
  value: z.number().finite().optional(),
  unit: z.string().max(32).optional(),
  category: z.string().max(64).optional(),
  sourceName: z.string().max(120).optional(),
  sourceBundleId: z.string().max(190).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const canonicalBatchSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.string().min(8).max(190),
  samples: z.array(canonicalSampleSchema).min(1).max(5000),
});

export type CanonicalSample = z.infer<typeof canonicalSampleSchema>;

export interface IngestReceipt {
  batchId: string;
  accepted: number;
  deduplicated: number;
  rejected: number;
  summarizedDates: string[];
  committedAt: string;
  replayed: boolean;
}

const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** Deterministic per-sample identity when the exporter has no UUID. */
export function deriveSampleId(s: CanonicalSample): string {
  return (
    s.sourceSampleId ??
    sha16(`${s.type}|${s.startAt}|${s.endAt ?? ""}|${s.value ?? ""}|${s.category ?? ""}|${s.sourceName ?? ""}`)
  );
}

/**
 * Health Auto Export payload → canonical samples. PURE — unit-tested.
 * HAE shape: { data: { metrics: [{ name, units, data: [{ date, qty?,
 * Avg?, Min?, Max?, asleep?, inBed?, source? }] }], workouts: [...] } }.
 * Dates arrive as "2026-07-28 08:41:00 -0400" — normalized to ISO.
 */
export function transformHaePayload(payload: unknown): CanonicalSample[] {
  const out: CanonicalSample[] = [];
  // ?? {} guards the ROOT — optional chaining below can't save a null
  // payload itself (test-caught: a garbage POST would have 500'd).
  const root = (payload ?? {}) as {
    data?: {
      metrics?: Array<{
        name?: string;
        units?: string;
        data?: Array<Record<string, unknown>>;
      }>;
      workouts?: Array<Record<string, unknown>>;
    };
  };
  const toIso = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    const d = new Date(raw.replace(" ", "T").replace(" ", ""));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  for (const metric of root.data?.metrics ?? []) {
    const name = (metric.name ?? "").trim();
    if (!name) continue;
    for (const point of metric.data ?? []) {
      const startAt = toIso(point.date);
      if (!startAt) continue;
      // HAE emits qty for scalars; Avg/Min/Max for aggregated series;
      // asleep/inBed (hours) for sleep_analysis. Prefer the most
      // specific value; sleep gets its own metric names so the
      // summarizer never has to guess.
      if (name === "sleep_analysis") {
        const asleep = typeof point.asleep === "number" ? point.asleep : null;
        const inBed = typeof point.inBed === "number" ? point.inBed : null;
        if (asleep != null) {
          out.push({ type: "sleep_asleep_hours", startAt, value: asleep, unit: "hr", sourceName: typeof point.source === "string" ? point.source : undefined });
        }
        if (inBed != null) {
          out.push({ type: "sleep_in_bed_hours", startAt, value: inBed, unit: "hr", sourceName: typeof point.source === "string" ? point.source : undefined });
        }
        continue;
      }
      const value =
        typeof point.qty === "number" ? point.qty
        : typeof point.Avg === "number" ? point.Avg
        : typeof point.avg === "number" ? point.avg
        : undefined;
      if (value === undefined) continue;
      out.push({
        type: name,
        startAt,
        value,
        unit: typeof metric.units === "string" ? metric.units : undefined,
        sourceName: typeof point.source === "string" ? point.source : undefined,
      });
    }
  }

  for (const w of root.data?.workouts ?? []) {
    const startAt = toIso(w.start);
    if (!startAt) continue;
    const endAt = toIso(w.end) ?? undefined;
    out.push({
      type: "workout",
      startAt,
      endAt,
      category: typeof w.name === "string" ? w.name.slice(0, 64) : "workout",
      value: typeof w.duration === "number" ? w.duration : undefined,
      unit: "s",
      metadata: { raw: { name: w.name, distance: w.distance, energy: w.activeEnergyBurned } },
    });
  }
  return out;
}

/** ET calendar dates a sample set touches — the summarizer's work list. */
export function datesTouchedEt(samples: CanonicalSample[]): string[] {
  const days = new Set<string>();
  for (const s of samples) {
    days.add(
      new Date(s.startAt).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    );
  }
  return [...days].sort();
}

export async function ingestBatch(args: {
  batchId: string;
  inlet: "canonical" | "hae";
  samples: CanonicalSample[];
}): Promise<IngestReceipt> {
  const existing = await prisma.healthIngestBatch.findUnique({ where: { id: args.batchId } });
  if (existing) {
    return {
      batchId: existing.id,
      accepted: existing.accepted,
      deduplicated: existing.deduplicated,
      rejected: existing.rejected,
      summarizedDates: Array.isArray(existing.summarized) ? (existing.summarized as string[]) : [],
      committedAt: existing.committedAt.toISOString(),
      replayed: true,
    };
  }

  const rows = args.samples.map((s) => ({
    sourceSystem: "apple_health",
    sourceSampleId: deriveSampleId(s),
    metricType: s.type,
    startAt: new Date(s.startAt),
    endAt: new Date(s.endAt ?? s.startAt),
    numericValue: s.value,
    unit: s.unit,
    categoryValue: s.category,
    sourceName: s.sourceName,
    sourceBundleId: s.sourceBundleId,
    metadata: (s.metadata ?? undefined) as never,
    batchId: args.batchId,
  }));

  const created = await prisma.healthSample.createMany({ data: rows, skipDuplicates: true });
  const accepted = created.count;
  const deduplicated = rows.length - accepted;

  const summarizedDates = await summarizeHealthDates(datesTouchedEt(args.samples)).catch((e) => {
    // Summaries are a best-effort projection — ingestion truth stands
    // regardless, but the failure must be LOUD, not swallowed.
    log.error("health_summarize_failed", {
      batchId: args.batchId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [] as string[];
  });

  const committedAt = new Date();
  await prisma.healthIngestBatch.create({
    data: {
      id: args.batchId,
      inlet: args.inlet,
      accepted,
      deduplicated,
      rejected: 0,
      summarized: summarizedDates as never,
      committedAt,
    },
  });

  log.info("health_batch_ingested", {
    batchId: args.batchId,
    inlet: args.inlet,
    accepted,
    deduplicated,
    dates: summarizedDates.length,
  });

  return {
    batchId: args.batchId,
    accepted,
    deduplicated,
    rejected: 0,
    summarizedDates,
    committedAt: committedAt.toISOString(),
    replayed: false,
  };
}
