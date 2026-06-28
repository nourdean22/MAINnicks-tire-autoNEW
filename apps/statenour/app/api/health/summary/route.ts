import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { evaluateReadiness } from "@/lib/health-governor/readiness";

const SyncBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sleepHours: z.number().nullable().optional(),
  energyScore: z.number().int().min(1).max(5).nullable().optional(),
  moodScore: z.number().int().min(1).max(10).nullable().optional(),
  workoutCompleted: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),

  // Extended health metrics
  stimulantTaken: z.boolean().nullable().optional(),
  caffeineMg: z.number().nullable().optional(),
  zepboundDayOffset: z.number().nullable().optional(),
  sorenessScore: z.number().int().min(0).max(10).nullable().optional(),
  injuryFlag: z.boolean().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("x-statenour-health-sync-secret") || req.headers.get("authorization");
    const secret = process.env.STATENOUR_HEALTH_SYNC_SECRET;

    if (!secret) {
      return NextResponse.json(
        { error: "STATENOUR_HEALTH_SYNC_SECRET is not configured on the server." },
        { status: 500 }
      );
    }

    const cleanAuth = authHeader?.replace("Bearer ", "").trim();
    if (cleanAuth !== secret.trim()) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const json = await req.json();
    const data = SyncBodySchema.parse(json);

    // Resolve date component to midnight UTC to prevent timezone shifts
    const todayStr = new Date().toISOString().split("T")[0];
    const logDate = data.date ? new Date(data.date + "T00:00:00Z") : new Date(todayStr + "T00:00:00Z");

    // Fetch existing log to merge notes and summary
    const existingLog = await prisma.personalDailyLog.findUnique({
      where: { logDate },
    });

    let existingNotesText = "";
    let existingSummary: any = {};
    if (existingLog?.notes) {
      try {
        if (existingLog.notes.trim().startsWith("{")) {
          const parsed = JSON.parse(existingLog.notes);
          existingNotesText = parsed.notes ?? "";
          existingSummary = parsed.healthSummary ?? {};
        } else {
          existingNotesText = existingLog.notes;
        }
      } catch (e) {
        existingNotesText = existingLog.notes;
      }
    }

    const newNotesText = data.notes !== undefined ? (data.notes ?? "") : existingNotesText;

    const newSummary = {
      ...existingSummary,
      ...(data.stimulantTaken !== undefined && { stimulantTaken: data.stimulantTaken }),
      ...(data.caffeineMg !== undefined && { caffeineMg: data.caffeineMg }),
      ...(data.zepboundDayOffset !== undefined && { zepboundDayOffset: data.zepboundDayOffset }),
      ...(data.sorenessScore !== undefined && { sorenessScore: data.sorenessScore }),
      ...(data.injuryFlag !== undefined && { injuryFlag: data.injuryFlag }),
    };

    const packedNotes = JSON.stringify({
      notes: newNotesText,
      healthSummary: newSummary,
    });

    const sleepDecimal = data.sleepHours !== undefined && data.sleepHours !== null ? new Prisma.Decimal(data.sleepHours) : undefined;

    // Upsert the log
    const updatedLog = await prisma.personalDailyLog.upsert({
      where: { logDate },
      create: {
        logDate,
        sleepHours: sleepDecimal,
        energyScore: data.energyScore,
        moodScore: data.moodScore,
        workoutCompleted: data.workoutCompleted ?? false,
        notes: packedNotes,
      },
      update: {
        ...(data.sleepHours !== undefined && { sleepHours: sleepDecimal }),
        ...(data.energyScore !== undefined && { energyScore: data.energyScore }),
        ...(data.moodScore !== undefined && { moodScore: data.moodScore }),
        ...(data.workoutCompleted !== undefined && data.workoutCompleted !== null && { workoutCompleted: data.workoutCompleted }),
        notes: packedNotes,
      },
    });

    // Run governor logic
    const latestState = await prisma.stateLog.findFirst({
      orderBy: { createdAt: "desc" },
    });

    const sleepVal = data.sleepHours !== undefined ? data.sleepHours : (existingLog?.sleepHours ? existingLog.sleepHours.toNumber() : null);
    const energyVal = data.energyScore !== undefined ? data.energyScore : (existingLog?.energyScore ?? latestState?.energyLevel ?? null);
    const focusVal = latestState?.focusQuality ?? null;
    const driftVal = latestState?.driftLevel ?? null;
    const sorenessVal = newSummary.sorenessScore ?? null;
    const injuryVal = newSummary.injuryFlag ?? null;
    const workoutVal = data.workoutCompleted !== undefined ? data.workoutCompleted : (existingLog?.workoutCompleted ?? null);

    const decision = evaluateReadiness({
      sleepHours: sleepVal,
      energyLevel: energyVal,
      focusQuality: focusVal,
      driftLevel: driftVal,
      sorenessScore: sorenessVal,
      injuryFlag: injuryVal,
      workoutCompletedToday: workoutVal,
    });

    const isShadowActive = decision.mode === "SHADOW_MODE" || decision.mode === "LOCKDOWN";

    // Upsert DailyExecutionState
    await prisma.dailyExecutionState.upsert({
      where: { stateDate: logDate },
      create: {
        stateDate: logDate,
        shadowMode: isShadowActive,
        blockedReason: decision.mode === "LOCKDOWN" ? decision.reasons.join("; ") : null,
        currentCommand: decision.recommendedCommand,
      },
      update: {
        shadowMode: isShadowActive,
        blockedReason: decision.mode === "LOCKDOWN" ? decision.reasons.join("; ") : null,
        currentCommand: decision.recommendedCommand,
      },
    });

    return NextResponse.json({
      success: true,
      logDate: logDate.toISOString().split("T")[0],
      decision,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation Error", details: err.issues }, { status: 400 });
    }
    console.error("Health summary sync failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
