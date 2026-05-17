import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { z } from "zod";

// v10.0.37 — input validation schema for the body-tracking POST.
// v10.0.529.106 · Wave 63 · added sleep_hours / workout_done / energy /
// stress so the daily check-in is single-table. Each optional · the
// operator can submit a partial entry (e.g. just sleep on the morning
// of, weight on the evening of).
const bodyEntrySchema = z.object({
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

const TARGET_WEIGHT = 186;

export const GET = apiHandler(async (req) => {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "90d";
  const days = range === "30d" ? 30 : range === "90d" ? 90 : range === "365d" ? 365 : 90;

  const entries = await prisma.bodyTracking.findMany({
    where: { date: { gte: toDateString(daysAgo(days)) } },
    orderBy: { date: "asc" },
  });

  const latest = await prisma.bodyTracking.findFirst({
    orderBy: { date: "desc" },
  });

  let progress = null;
  if (latest && latest.weight !== null) {
    const delta = latest.weight - TARGET_WEIGHT;
    const weeklyRate = 1.25; // target lbs/week
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
}, { auth: "owner" }); // v10.0.37 — was unauthed

// v10.0.37 — input validation via bodyEntrySchema (top of file).
// Pre-fix req.json() was passed verbatim to Prisma — bad types
// (string for weight, NaN, Infinity) threw a raw Prisma error
// that leaked column names through the 500 body.
export const POST = apiHandler(async (req) => {
  const body = bodyEntrySchema.parse(await req.json());
  const date = body.date || today();

  // v10.0.529.106 · Wave 63 · partial-update semantics: fields the
  // POST omits stay untouched (`undefined` not written). Operator
  // hits the API multiple times per day with different slices.
  const writeData = {
    weight: body.weight ?? undefined,
    bodyFatPct: body.body_fat_pct ?? undefined,
    waistInches: body.waist_inches ?? undefined,
    sleepHours: body.sleep_hours ?? undefined,
    workoutDone: body.workout_done ?? undefined,
    energy: body.energy ?? undefined,
    stress: body.stress ?? undefined,
    notes: body.notes ?? undefined,
  };
  await prisma.bodyTracking.upsert({
    where: { date },
    create: { date, ...writeData },
    update: writeData,
  });

  return { ok: true };
}, { auth: "owner" });
// v10.0.256 audit fix · POST was unauthenticated. v10.0.37 added auth
// to GET only (was leaking body-tracking history). The mutating POST
// was missed · anyone could submit weight / body-fat / waist data
// for any date, polluting the body-tracking timeline that feeds the
// daily brief and the 8-axis self-model. Now owner-gated to match GET.
