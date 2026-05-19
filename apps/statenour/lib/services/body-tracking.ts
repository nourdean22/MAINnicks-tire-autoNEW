/**
 * Body tracking service · Phase XX (2026-05-19 AM).
 *
 * Daily check-in for weight + body composition + sleep + workout +
 * energy + stress + notes. Each field is optional · the operator
 * submits partial entries across the day (sleep in the morning ·
 * weight at night). All fields are upsert-by-date so re-submission
 * for the same day updates · doesn't create duplicates.
 *
 * Called by BOTH the legacy `/api/body` REST endpoint AND the new
 * `trpc.operator.{bodyTracking, logBodyEntry}` procedures · drift
 * impossible.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";

export const bodyEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weight: z.number().min(50).max(700).nullable().optional(),
  body_fat_pct: z.number().min(0).max(80).nullable().optional(),
  waist_inches: z.number().min(15).max(80).nullable().optional(),
  sleep_hours: z.number().min(0).max(16).nullable().optional(),
  workout_done: z.boolean().nullable().optional(),
  energy: z.number().int().min(1).max(5).nullable().optional(),
  stress: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type BodyEntryInput = z.infer<typeof bodyEntrySchema>;

const TARGET_WEIGHT = 186;

export interface BodyProgress {
  current: number;
  target: number;
  delta: number;
  rate_target: number;
  weeks_to_go: number;
  projected_date: string;
}

export interface BodyTrackingView {
  entries: Awaited<ReturnType<typeof prisma.bodyTracking.findMany>>;
  progress: BodyProgress | null;
}

export async function getBodyTracking(args: {
  range?: string;
}): Promise<BodyTrackingView> {
  const range = args.range ?? "90d";
  const days = range === "30d" ? 30 : range === "365d" ? 365 : 90;

  const entries = await prisma.bodyTracking.findMany({
    where: { date: { gte: toDateString(daysAgo(days)) } },
    orderBy: { date: "asc" },
  });

  const latest = await prisma.bodyTracking.findFirst({
    orderBy: { date: "desc" },
  });

  let progress: BodyProgress | null = null;
  if (latest && latest.weight !== null) {
    const delta = latest.weight - TARGET_WEIGHT;
    const weeklyRate = 1.25; // lbs/week
    const weeksToGo = Math.ceil(delta / weeklyRate);
    const projected = new Date();
    projected.setDate(projected.getDate() + weeksToGo * 7);
    progress = {
      current: latest.weight,
      target: TARGET_WEIGHT,
      delta,
      rate_target: weeklyRate,
      weeks_to_go: weeksToGo,
      projected_date: toDateString(projected),
    };
  }

  return { entries, progress };
}

export async function logBodyEntry(input: BodyEntryInput): Promise<{ ok: true }> {
  const date = input.date || today();
  // Partial-update semantics · fields the input omits stay untouched.
  const writeData = {
    weight: input.weight ?? undefined,
    bodyFatPct: input.body_fat_pct ?? undefined,
    waistInches: input.waist_inches ?? undefined,
    sleepHours: input.sleep_hours ?? undefined,
    workoutDone: input.workout_done ?? undefined,
    energy: input.energy ?? undefined,
    stress: input.stress ?? undefined,
    notes: input.notes ?? undefined,
  };
  await prisma.bodyTracking.upsert({
    where: { date },
    create: { date, ...writeData },
    update: writeData,
  });
  return { ok: true };
}
