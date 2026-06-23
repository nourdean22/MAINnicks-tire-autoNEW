import { Prisma } from "@prisma/client";
const { Decimal, PrismaClientKnownRequestError } = Prisma;

import { getDemoState, makeDemoId, type DemoPersonalDailyLog } from "@/lib/demo-store";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/runtime";
import { clamp } from "@/lib/utils/format";
import { serializeForJson } from "@/lib/utils/serialize";

// Apr 18: DailyScore module retired. PersonalDailyLog still has a
// `dailyScore Int?` column — compute it locally from the per-log
// behaviors so existing rows stay meaningful. Same weights as the
// old lib/scoring/daily-score.ts (sleep 4, energy 3, mood 2, deep 5,
// revenue 6, workout 8, social 5, drift -8, distraction -6 → 0–100).
export type DailyScoreInput = {
  sleepHours?: number | null;
  energyScore?: number | null;
  moodScore?: number | null;
  workoutCompleted: boolean;
  deepWorkBlocks: number;
  revenueMoves: number;
  driftIncidents: number;
  distractionFlag: boolean;
  socialFamilyAction: boolean;
};
export function calculateDailyScore(input: DailyScoreInput): number {
  const raw =
    (input.sleepHours || 0) * 4 +
    (input.energyScore || 0) * 3 +
    (input.moodScore || 0) * 2 +
    input.deepWorkBlocks * 5 +
    input.revenueMoves * 6 +
    (input.workoutCompleted ? 8 : 0) +
    (input.socialFamilyAction ? 5 : 0) -
    input.driftIncidents * 8 -
    (input.distractionFlag ? 6 : 0);
  return clamp(Math.round(raw), 0, 100);
}
import { ServiceError } from "@/lib/utils/service-error";
import { personalLogCreateSchema, personalLogUpdateSchema } from "@/lib/validators/personal-logs";

function toDecimal(value: number | null | undefined) {
  return value == null ? null : new Decimal(value);
}

function sameDay(left: Date, right: Date) {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

export async function listPersonalLogs() {
  if (isDemoMode) {
    return serializeForJson(
      [...getDemoState().personalLogs]
        .sort((left, right) => right.logDate.getTime() - left.logDate.getTime())
        .slice(0, 21)
    );
  }

  const logs = await prisma.personalDailyLog.findMany({
    orderBy: {
      logDate: "desc"
    },
    take: 21
  });

  return serializeForJson(logs);
}

export async function getPersonalLogById(id: string) {
  if (isDemoMode) {
    const log = getDemoState().personalLogs.find((candidate) => candidate.id === id);
    return log ? serializeForJson(log) : null;
  }

  const log = await prisma.personalDailyLog.findUnique({
    where: { id }
  });

  if (!log) {
    return null;
  }

  return serializeForJson(log);
}

export async function createPersonalLog(input: unknown) {
  const payload = personalLogCreateSchema.parse(input);
  const dailyScore = calculateDailyScore(payload);

  if (isDemoMode) {
    const state = getDemoState();

    if (state.personalLogs.some((log) => sameDay(log.logDate, payload.logDate))) {
      throw new ServiceError("A personal log already exists for that date.", 400);
    }

    const now = new Date();
    const log: DemoPersonalDailyLog = {
      id: makeDemoId("personal-log"),
      logDate: payload.logDate,
      sleepHours: payload.sleepHours ?? null,
      energyScore: payload.energyScore ?? null,
      moodScore: payload.moodScore ?? null,
      workoutCompleted: payload.workoutCompleted,
      supplements: payload.supplements || null,
      deepWorkBlocks: payload.deepWorkBlocks,
      revenueMoves: payload.revenueMoves,
      driftIncidents: payload.driftIncidents,
      distractionFlag: payload.distractionFlag,
      socialFamilyAction: payload.socialFamilyAction,
      dailyScore,
      notes: payload.notes || null,
      tomorrowConstraint: payload.tomorrowConstraint || null,
      createdAt: now,
      updatedAt: now
    };

    state.personalLogs.push(log);
    return serializeForJson(log);
  }

  const log = await prisma.personalDailyLog.create({
    data: {
      ...payload,
      sleepHours: toDecimal(payload.sleepHours || null),
      dailyScore
    }
  });

  return serializeForJson(log);
}

export async function updatePersonalLog(id: string, input: unknown) {
  const payload = personalLogUpdateSchema.parse(input);

  if (isDemoMode) {
    const state = getDemoState();
    const log = state.personalLogs.find((candidate) => candidate.id === id);

    if (!log) {
      throw new ServiceError("Personal log not found.", 404);
    }

    if (
      payload.logDate &&
      state.personalLogs.some((candidate) => candidate.id !== id && sameDay(candidate.logDate, payload.logDate as Date))
    ) {
      throw new ServiceError("A personal log already exists for that date.", 400);
    }

    const dailyScore = calculateDailyScore({
      sleepHours: payload.sleepHours ?? log.sleepHours,
      energyScore: payload.energyScore ?? log.energyScore,
      moodScore: payload.moodScore ?? log.moodScore,
      workoutCompleted: payload.workoutCompleted ?? log.workoutCompleted,
      deepWorkBlocks: payload.deepWorkBlocks ?? log.deepWorkBlocks,
      revenueMoves: payload.revenueMoves ?? log.revenueMoves,
      driftIncidents: payload.driftIncidents ?? log.driftIncidents,
      distractionFlag: payload.distractionFlag ?? log.distractionFlag,
      socialFamilyAction: payload.socialFamilyAction ?? log.socialFamilyAction
    });

    Object.assign(log, {
      ...payload,
      logDate: payload.logDate ?? log.logDate,
      sleepHours: payload.sleepHours ?? log.sleepHours,
      energyScore: payload.energyScore ?? log.energyScore,
      moodScore: payload.moodScore ?? log.moodScore,
      workoutCompleted: payload.workoutCompleted ?? log.workoutCompleted,
      supplements: payload.supplements ?? log.supplements,
      deepWorkBlocks: payload.deepWorkBlocks ?? log.deepWorkBlocks,
      revenueMoves: payload.revenueMoves ?? log.revenueMoves,
      driftIncidents: payload.driftIncidents ?? log.driftIncidents,
      distractionFlag: payload.distractionFlag ?? log.distractionFlag,
      socialFamilyAction: payload.socialFamilyAction ?? log.socialFamilyAction,
      dailyScore,
      notes: payload.notes ?? log.notes,
      tomorrowConstraint: payload.tomorrowConstraint ?? log.tomorrowConstraint,
      updatedAt: new Date()
    });

    return serializeForJson(log);
  }

  const existing = await prisma.personalDailyLog.findUnique({
    where: { id }
  });

  if (!existing) {
    throw new ServiceError("Personal log not found.", 404);
  }

  const dailyScore = calculateDailyScore({
    sleepHours: payload.sleepHours ?? Number(existing.sleepHours),
    energyScore: payload.energyScore ?? existing.energyScore,
    moodScore: payload.moodScore ?? existing.moodScore,
    workoutCompleted: payload.workoutCompleted ?? existing.workoutCompleted,
    deepWorkBlocks: payload.deepWorkBlocks ?? existing.deepWorkBlocks,
    revenueMoves: payload.revenueMoves ?? existing.revenueMoves,
    driftIncidents: payload.driftIncidents ?? existing.driftIncidents,
    distractionFlag: payload.distractionFlag ?? existing.distractionFlag,
    socialFamilyAction: payload.socialFamilyAction ?? existing.socialFamilyAction
  });

  const log = await prisma.personalDailyLog.update({
    where: { id },
    data: {
      ...payload,
      ...(payload.sleepHours != null ? { sleepHours: toDecimal(payload.sleepHours) } : {}),
      dailyScore
    }
  });

  return serializeForJson(log);
}

export async function deletePersonalLog(id: string) {
  if (isDemoMode) {
    const state = getDemoState();
    const logIndex = state.personalLogs.findIndex((log) => log.id === id);

    if (logIndex === -1) {
      throw new ServiceError("Personal log not found.", 404);
    }

    state.personalLogs.splice(logIndex, 1);

    return {
      success: true
    };
  }

  try {
    await prisma.personalDailyLog.delete({
      where: { id }
    });
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === "P2025") {
      throw new ServiceError("Personal log not found.", 404);
    }

    throw error;
  }

  return {
    success: true
  };
}

export async function getPersonalSummary() {
  const logs = await listPersonalLogs();
  type LogShape = { dailyScore?: number | null; deepWorkBlocks?: number | null; driftIncidents?: number | null };
  const recent = logs.slice(0, 7) as LogShape[];
  const averageDailyScore = recent.length
    ? Math.round(recent.reduce((sum: number, log: LogShape) => sum + (log.dailyScore || 0), 0) / recent.length)
    : 0;
  const averageDeepWork = recent.length
    ? Math.round((recent.reduce((sum: number, log: LogShape) => sum + (log.deepWorkBlocks ?? 0), 0) / recent.length) * 10) / 10
    : 0;
  const driftBursts = recent.reduce((sum: number, log: LogShape) => sum + (log.driftIncidents ?? 0), 0);

  return {
    averageDailyScore,
    averageDeepWork,
    driftBursts
  };
}
