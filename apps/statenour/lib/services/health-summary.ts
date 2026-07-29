/**
 * Health summarizer (H2, 2026-07-28 late · blueprint health batch).
 *
 * THE payoff step: BodyTracking is the incumbent daily canonical that
 * the sleep/fitness/mental-health analyzers, the MODE→RECOVERY trigger
 * and the morning brief already consume. This module projects raw
 * Apple Health samples into that row — so the moment real data flows,
 * the existing intelligence lights up with zero new consumers.
 *
 * Precedence rule (simple + honest): FILL NULLS ONLY. A field the
 * operator wrote by hand — or any earlier writer set — is NEVER
 * overwritten. Manual always wins; the patch is computed per-day
 * against the current row (buildBodyPatch is PURE and unit-tested).
 *
 * Field mapping (only fields BodyTracking actually has — no schema
 * inflation tonight; restingHR/HRV/steps live in health_samples and
 * are read directly by the Nick tools):
 *   sleepHours  ← max sleep_asleep_hours sample that ET day
 *   weight      ← latest body_mass / weight_body_mass sample (lb)
 *   bodyFatPct  ← latest body_fat_percentage sample (fraction→pct safe)
 *   workoutDone ← any workout sample that day
 */
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/health-summary");

export interface DayAggregates {
  sleepHours: number | null;
  weightLb: number | null;
  bodyFatPct: number | null;
  workoutDone: boolean;
}

export interface BodyRowFields {
  sleepHours: number | null;
  weight: number | null;
  bodyFatPct: number | null;
  workoutDone: boolean | null;
}

/** PURE: given the existing row's fields, patch ONLY what is null. */
export function buildBodyPatch(
  existing: BodyRowFields | null,
  agg: DayAggregates,
): Partial<{ sleepHours: number; weight: number; bodyFatPct: number; workoutDone: boolean }> {
  const patch: ReturnType<typeof buildBodyPatch> = {};
  if ((existing?.sleepHours ?? null) === null && agg.sleepHours != null) patch.sleepHours = agg.sleepHours;
  if ((existing?.weight ?? null) === null && agg.weightLb != null) patch.weight = agg.weightLb;
  if ((existing?.bodyFatPct ?? null) === null && agg.bodyFatPct != null) patch.bodyFatPct = agg.bodyFatPct;
  if ((existing?.workoutDone ?? null) === null && agg.workoutDone) patch.workoutDone = true;
  return patch;
}

/** ET-day boundaries as UTC instants (EDT in July; DST-correct via Intl). */
function etDayRange(dateEt: string): { gte: Date; lt: Date } {
  // dateEt is YYYY-MM-DD in America/New_York. Find the UTC instant of
  // that day's midnight ET by probing the offset at noon UTC that day.
  const noon = new Date(`${dateEt}T12:00:00Z`);
  const etHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(noon),
  );
  const offsetH = 12 - etHour; // 4 in EDT, 5 in EST
  const gte = new Date(`${dateEt}T00:00:00Z`);
  gte.setUTCHours(gte.getUTCHours() + offsetH);
  const lt = new Date(gte);
  lt.setUTCHours(lt.getUTCHours() + 24);
  return { gte, lt };
}

const WEIGHT_METRICS = ["body_mass", "weight_body_mass"];
const FAT_METRICS = ["body_fat_percentage"];

async function aggregatesForDay(dateEt: string): Promise<DayAggregates> {
  const range = etDayRange(dateEt);
  const samples = await prisma.healthSample.findMany({
    where: {
      startAt: { gte: range.gte, lt: range.lt },
      metricType: { in: ["sleep_asleep_hours", "workout", ...WEIGHT_METRICS, ...FAT_METRICS] },
    },
    select: { metricType: true, numericValue: true, startAt: true },
    orderBy: { startAt: "asc" },
  });

  let sleepHours: number | null = null;
  let weightLb: number | null = null;
  let bodyFatPct: number | null = null;
  let workoutDone = false;
  for (const s of samples) {
    if (s.metricType === "sleep_asleep_hours" && s.numericValue != null) {
      sleepHours = Math.max(sleepHours ?? 0, s.numericValue);
    } else if (WEIGHT_METRICS.includes(s.metricType) && s.numericValue != null) {
      weightLb = s.numericValue; // asc order → last assignment = latest
    } else if (FAT_METRICS.includes(s.metricType) && s.numericValue != null) {
      // HAE emits percent (e.g. 24.1) but a fraction (0.241) means the
      // exporter's unit toggled — normalize either way.
      bodyFatPct = s.numericValue <= 1 ? s.numericValue * 100 : s.numericValue;
    } else if (s.metricType === "workout") {
      workoutDone = true;
    }
  }
  return { sleepHours, weightLb, bodyFatPct, workoutDone };
}

/**
 * Patch BodyTracking for each ET date. Returns the dates actually
 * modified (empty patch → untouched, not counted).
 */
export async function summarizeHealthDates(dates: string[]): Promise<string[]> {
  const touched: string[] = [];
  for (const dateEt of dates) {
    const agg = await aggregatesForDay(dateEt);
    const existing = await prisma.bodyTracking.findUnique({
      where: { date: dateEt },
      select: { sleepHours: true, weight: true, bodyFatPct: true, workoutDone: true },
    });
    const patch = buildBodyPatch(existing, agg);
    if (Object.keys(patch).length === 0) continue;
    await prisma.bodyTracking.upsert({
      where: { date: dateEt },
      create: { date: dateEt, ...patch, notes: null },
      update: patch,
    });
    touched.push(dateEt);
    log.info("body_tracking_patched", { date: dateEt, fields: Object.keys(patch) });
  }
  return touched;
}
