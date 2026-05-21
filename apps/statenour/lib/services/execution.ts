import { CommunicationMode, DayState, EmpireLane } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { isDemoMode } from "@/lib/runtime";
import { serializeForJson } from "@/lib/utils/serialize";
import { ServiceError } from "@/lib/utils/service-error";
// ET-correct day boundaries. The prior local `new Date(y,m,d)` floored to
// midnight in the SERVER zone (UTC on Railway), landing "today" 4-5h off
// Eastern. See lib/utils/datetime.ts.
import {
  startOfDayET as startOfLocalDay,
  endOfDayET as endOfLocalDay,
} from "@/lib/utils/datetime";

function inferEmpireLaneFromMission(domain?: string | null) {
  if (!domain) {
    return EmpireLane.MONEY;
  }

  if (domain === "HEALTH") {
    return EmpireLane.HEALTH;
  }

  if (domain === "PERSONAL") {
    return EmpireLane.PERSONAL;
  }

  return EmpireLane.MONEY;
}

function resolveOperatingMode(checkIn?: { operatingMode: CommunicationMode } | null, shadowMode = false) {
  if (checkIn?.operatingMode) {
    return checkIn.operatingMode;
  }

  return shadowMode ? CommunicationMode.SHADOW : CommunicationMode.DIRECT;
}

function buildResolutionNote(input: {
  resolutionType: "DONE" | "DEFER" | "BLOCKED" | "REPLACE";
  note?: string | null;
  deferReason?: string | null;
  blockedReason?: string | null;
  replaceReason?: string | null;
}) {
  if (input.resolutionType === "DEFER") {
    return input.deferReason || input.note || "Deferred from Today.";
  }

  if (input.resolutionType === "BLOCKED") {
    return input.blockedReason || input.note || "Blocked from Today.";
  }

  if (input.resolutionType === "REPLACE") {
    return input.replaceReason || input.note || "Replaced from Today.";
  }

  return input.note || null;
}

async function getTopOpenTask() {
  return prisma.task.findFirst({
    // v10.0.529.106 wave-77 · migrated to activeOnly() helper.
    where: activeOnly({
      status: {
        notIn: ["DONE", "ARCHIVED"]
      },
    }),
    include: {
      mission: true
    },
    orderBy: [{ autoPriority: "desc" }, { dueDate: "asc" }, { updatedAt: "desc" }]
  });
}

async function getCheckInForDate(date = new Date()) {
  if (isDemoMode) {
    return null;
  }

  return prisma.operatorCheckIn.findUnique({
    where: {
      checkInDate: startOfLocalDay(date)
    }
  });
}

function serializeKernel(state: {
  id: string;
  stateDate: Date;
  dayState: DayState;
  currentCommand: string | null;
  currentTaskId: string | null;
  activeMissionId: string | null;
  activeEmpireLane: EmpireLane;
  blockedReason: string | null;
  deferReason: string | null;
  lastResolvedCommand: string | null;
  tomorrowFirstMove: string | null;
  recoveryQuota: number;
  recoveryTouches: number;
  missionMoved: boolean;
  shadowMode: boolean;
  openedAt: Date;
  closedAt: Date | null;
  checkIn?: {
    energyScore: number;
    focusScore: number;
    driftPressure: number;
    operatingMode: CommunicationMode;
    empireLane: EmpireLane;
    notes: string | null;
  } | null;
  currentTask?: {
    id: string;
    title: string;
    nextPhysicalAction: string;
    finishCondition: string;
    mission: {
      id: string;
      title: string;
      domain: string;
    };
  } | null;
}) {
  const currentTask = state.currentTask;
  const operatingMode = resolveOperatingMode(state.checkIn, state.shadowMode);

  return serializeForJson({
    id: state.id,
    stateDate: state.stateDate,
    dayState: state.dayState.toLowerCase(),
    currentCommand: state.currentCommand,
    currentTaskId: state.currentTaskId,
    activeMissionId: state.activeMissionId,
    activeMissionTitle: currentTask?.mission.title || null,
    activeEmpireLane: state.activeEmpireLane.toLowerCase(),
    blockedReason: state.blockedReason,
    deferReason: state.deferReason,
    lastResolvedCommand: state.lastResolvedCommand,
    tomorrowFirstMove: state.tomorrowFirstMove,
    recoveryQuota: state.recoveryQuota,
    recoveryTouches: state.recoveryTouches,
    recoveryQuotaRemaining: Math.max(state.recoveryQuota - state.recoveryTouches, 0),
    missionMoved: state.missionMoved,
    shadowMode: state.shadowMode,
    operatingMode: operatingMode.toLowerCase(),
    openedAt: state.openedAt,
    closedAt: state.closedAt,
    currentTask: currentTask
      ? {
          id: currentTask.id,
          title: currentTask.title,
          nextPhysicalAction: currentTask.nextPhysicalAction,
          finishCondition: currentTask.finishCondition,
          missionTitle: currentTask.mission.title,
          missionId: currentTask.mission.id,
          missionDomain: currentTask.mission.domain
        }
      : null,
    checkIn: state.checkIn
      ? {
          energyScore: state.checkIn.energyScore,
          focusScore: state.checkIn.focusScore,
          driftPressure: state.checkIn.driftPressure,
          operatingMode: state.checkIn.operatingMode.toLowerCase(),
          empireLane: state.checkIn.empireLane.toLowerCase(),
          notes: state.checkIn.notes
        }
      : null,
    needsCheckIn: !state.checkIn
  });
}

async function refreshExecutionStateRecord(state: {
  currentTaskId: string | null;
  currentCommand: string | null;
  activeMissionId: string | null;
  activeEmpireLane: EmpireLane;
}) {
  const currentTask = state.currentTaskId
    ? await prisma.task.findUnique({
        where: { id: state.currentTaskId },
        include: {
          mission: true
        }
      })
    : null;

  if (currentTask && !["DONE", "ARCHIVED"].includes(currentTask.status)) {
    return {
      currentTask,
      currentCommand: state.currentCommand || currentTask.nextPhysicalAction,
      activeMissionId: state.activeMissionId || currentTask.missionId,
      activeEmpireLane: state.activeEmpireLane || inferEmpireLaneFromMission(currentTask.mission.domain)
    };
  }

  const topTask = await getTopOpenTask();
  return {
    currentTask: topTask,
    currentCommand:
      state.currentCommand ||
      topTask?.nextPhysicalAction ||
      "Check in, lock one lane, and define the next physical move.",
    activeMissionId: topTask?.missionId || state.activeMissionId,
    activeEmpireLane: topTask ? inferEmpireLaneFromMission(topTask.mission.domain) : state.activeEmpireLane
  };
}

export async function getDailyExecutionState(date = new Date()) {
  const stateDate = startOfLocalDay(date);

  if (isDemoMode) {
    return serializeKernel({
      id: "demo-state",
      stateDate,
      dayState: DayState.OPEN,
      currentCommand: "Set one mission and one next move.",
      currentTaskId: null,
      activeMissionId: null,
      activeEmpireLane: EmpireLane.MONEY,
      blockedReason: null,
      deferReason: null,
      lastResolvedCommand: null,
      tomorrowFirstMove: null,
      recoveryQuota: 5,
      recoveryTouches: 0,
      missionMoved: false,
      shadowMode: false,
      openedAt: new Date(),
      closedAt: null,
      currentTask: null,
      checkIn: null
    });
  }

  const [checkIn, existingState] = await Promise.all([
    getCheckInForDate(date),
    prisma.dailyExecutionState.upsert({
      where: { stateDate },
      update: {},
      create: {
        stateDate,
        dayState: DayState.OPEN,
        activeEmpireLane: EmpireLane.MONEY,
        recoveryQuota: 5,
        openedAt: new Date()
      }
    })
  ]);

  const refreshed = await refreshExecutionStateRecord(existingState);
  const shouldUpdate =
    refreshed.currentCommand !== existingState.currentCommand ||
    refreshed.currentTask?.id !== existingState.currentTaskId ||
    refreshed.activeMissionId !== existingState.activeMissionId ||
    refreshed.activeEmpireLane !== existingState.activeEmpireLane ||
    Boolean(checkIn) !== existingState.shadowMode;

  const state = shouldUpdate
    ? await prisma.dailyExecutionState.update({
        where: { id: existingState.id },
        data: {
          currentCommand: refreshed.currentCommand,
          currentTaskId: refreshed.currentTask?.id || null,
          activeMissionId: refreshed.activeMissionId || null,
          activeEmpireLane: checkIn?.empireLane || refreshed.activeEmpireLane,
          shadowMode: checkIn?.operatingMode === CommunicationMode.SHADOW || existingState.shadowMode
        }
      })
    : existingState;

  return serializeKernel({
    ...state,
    activeEmpireLane: checkIn?.empireLane || state.activeEmpireLane,
    shadowMode: checkIn?.operatingMode === CommunicationMode.SHADOW || state.shadowMode,
    currentTask: refreshed.currentTask,
    checkIn
  });
}

export async function recordOperatorCheckIn(input: {
  energyScore: number;
  focusScore: number;
  driftPressure: number;
  operatingMode: CommunicationMode;
  empireLane: EmpireLane;
  notes?: string | null;
}) {
  if (isDemoMode) {
    throw new ServiceError("Check-in persistence is unavailable in demo mode.", 400);
  }

  const stateDate = startOfLocalDay();
  const checkIn = await prisma.operatorCheckIn.upsert({
    where: { checkInDate: stateDate },
    update: {
      ...input,
      notes: input.notes || null
    },
    create: {
      checkInDate: stateDate,
      ...input,
      notes: input.notes || null
    }
  });

  await prisma.dailyExecutionState.upsert({
    where: { stateDate },
    update: {
      activeEmpireLane: input.empireLane,
      shadowMode: input.operatingMode === CommunicationMode.SHADOW,
      dayState: DayState.OPEN,
      closedAt: null
    },
    create: {
      stateDate,
      activeEmpireLane: input.empireLane,
      shadowMode: input.operatingMode === CommunicationMode.SHADOW,
      dayState: DayState.OPEN,
      recoveryQuota: 5,
      openedAt: new Date()
    }
  });

  return {
    checkIn: serializeForJson(checkIn),
    execution: await getDailyExecutionState()
  };
}

export async function resolveCurrentCommand(input: {
  resolutionType: "DONE" | "DEFER" | "BLOCKED" | "REPLACE";
  note?: string | null;
  deferReason?: string | null;
  blockedReason?: string | null;
  replaceReason?: string | null;
  replacementCommand?: string | null;
  recoveryTouch?: boolean;
}) {
  if (isDemoMode) {
    throw new ServiceError("Command resolution is unavailable in demo mode.", 400);
  }

  const stateDate = startOfLocalDay();
  const state = await prisma.dailyExecutionState.upsert({
    where: { stateDate },
    update: {},
    create: {
      stateDate,
      dayState: DayState.OPEN,
      activeEmpireLane: EmpireLane.MONEY,
      recoveryQuota: 5,
      openedAt: new Date()
    }
  });

  const currentTask = state.currentTaskId
    ? await prisma.task.findUnique({
        where: { id: state.currentTaskId }
      })
    : null;

  if (!state.currentCommand && !currentTask && input.resolutionType !== "REPLACE") {
    throw new ServiceError("No current command is active.", 400);
  }

  const resolutionNote = buildResolutionNote(input);

  await prisma.$transaction(async (tx) => {
    if (currentTask) {
      if (input.resolutionType === "DONE") {
        await tx.task.update({
          where: { id: currentTask.id },
          data: {
            status: "DONE",
            lastTouchedAt: new Date()
          }
        });
      }

      if (input.resolutionType === "DEFER") {
        await tx.task.update({
          where: { id: currentTask.id },
          data: {
            status: "WAITING",
            waitingOn: resolutionNote || "Deferred from Today.",
            lastTouchedAt: new Date()
          }
        });
      }

      if (input.resolutionType === "BLOCKED") {
        await tx.task.update({
          where: { id: currentTask.id },
          data: {
            status: "WAITING",
            waitingOn: resolutionNote || "Blocked from Today.",
            lastTouchedAt: new Date()
          }
        });
      }

      if (input.resolutionType === "REPLACE") {
        await tx.task.update({
          where: { id: currentTask.id },
          data: {
            status: "WAITING",
            waitingOn: resolutionNote || "Replaced from Today.",
            lastTouchedAt: new Date()
          }
        });
      }
    }

    await tx.commandResolution.create({
      data: {
        dailyExecutionStateId: state.id,
        resolutionType: input.resolutionType,
        commandText: state.currentCommand || currentTask?.nextPhysicalAction || "Unspecified command",
        commandSource: currentTask ? "task" : "manual",
        taskId: currentTask?.id || null,
        missionId: currentTask?.missionId || state.activeMissionId,
        empireLane: state.activeEmpireLane,
        note: resolutionNote,
        replacementCommand: input.replacementCommand || null
      }
    });
  });

  const nextTask =
    input.resolutionType === "REPLACE" && input.replacementCommand
      ? null
      : await getTopOpenTask();

  const nextCommand =
    (input.resolutionType === "REPLACE" ? input.replacementCommand : null) ||
    nextTask?.nextPhysicalAction ||
    state.tomorrowFirstMove ||
    "Capture the next clean move.";

  await prisma.dailyExecutionState.update({
    where: { id: state.id },
    data: {
      dayState: DayState.OPEN,
      currentCommand: nextCommand,
      currentTaskId: nextTask?.id || null,
      activeMissionId: nextTask?.missionId || state.activeMissionId,
      activeEmpireLane: nextTask ? inferEmpireLaneFromMission(nextTask.mission.domain) : state.activeEmpireLane,
      blockedReason: input.resolutionType === "BLOCKED" ? resolutionNote || "Blocked from Today." : null,
      deferReason: input.resolutionType === "DEFER" ? resolutionNote || "Deferred from Today." : null,
      lastResolvedCommand: state.currentCommand || currentTask?.nextPhysicalAction || null,
      recoveryTouches: input.recoveryTouch ? { increment: 1 } : undefined
    }
  });

  return getDailyExecutionState();
}

export async function resetDay(input: {
  empireLane?: EmpireLane;
  shadowMode?: boolean;
  recoveryQuota?: number;
  currentCommand?: string;
  activeMissionId?: string;
}) {
  if (isDemoMode) {
    throw new ServiceError("Day reset is unavailable in demo mode.", 400);
  }

  const stateDate = startOfLocalDay();
  const checkIn = await getCheckInForDate();
  const topTask = await getTopOpenTask();
  const activeEmpireLane = input.empireLane || checkIn?.empireLane || inferEmpireLaneFromMission(topTask?.mission.domain);
  const currentCommand = input.currentCommand || topTask?.nextPhysicalAction || "Check in and define the next physical move.";

  await prisma.dailyExecutionState.upsert({
    where: { stateDate },
    update: {
      dayState: DayState.OPEN,
      currentCommand,
      currentTaskId: topTask?.id || null,
      activeMissionId: input.activeMissionId || topTask?.missionId || null,
      activeEmpireLane,
      blockedReason: null,
      deferReason: null,
      recoveryTouches: 0,
      recoveryQuota: input.recoveryQuota ?? 5,
      missionMoved: false,
      shadowMode: input.shadowMode ?? checkIn?.operatingMode === CommunicationMode.SHADOW,
      openedAt: new Date(),
      closedAt: null
    },
    create: {
      stateDate,
      dayState: DayState.OPEN,
      currentCommand,
      currentTaskId: topTask?.id || null,
      activeMissionId: input.activeMissionId || topTask?.missionId || null,
      activeEmpireLane,
      recoveryQuota: input.recoveryQuota ?? 5,
      shadowMode: input.shadowMode ?? checkIn?.operatingMode === CommunicationMode.SHADOW,
      openedAt: new Date()
    }
  });

  return getDailyExecutionState();
}

export async function shutdownDay(input: {
  missionMoved: boolean;
  tomorrowFirstMove: string;
  notes?: string | null;
}) {
  if (isDemoMode) {
    throw new ServiceError("Day shutdown is unavailable in demo mode.", 400);
  }

  const stateDate = startOfLocalDay();
  await prisma.dailyExecutionState.upsert({
    where: { stateDate },
    update: {
      dayState: DayState.CLOSED,
      missionMoved: input.missionMoved,
      tomorrowFirstMove: input.tomorrowFirstMove,
      currentCommand: input.tomorrowFirstMove,
      currentTaskId: null,
      closedAt: new Date()
    },
    create: {
      stateDate,
      dayState: DayState.CLOSED,
      missionMoved: input.missionMoved,
      tomorrowFirstMove: input.tomorrowFirstMove,
      currentCommand: input.tomorrowFirstMove,
      activeEmpireLane: EmpireLane.MONEY,
      recoveryQuota: 5,
      closedAt: new Date()
    }
  });

  if (input.notes) {
    await prisma.executionInsight.create({
      data: {
        insightType: "day_shutdown",
        title: "Shutdown note",
        detail: input.notes,
        score: input.missionMoved ? 70 : 40,
        metadata: {
          state_date: stateDate.toISOString().slice(0, 10),
          tomorrow_first_move: input.tomorrowFirstMove
        }
      }
    });
  }

  return getDailyExecutionState();
}

export async function listRecentCommandResolutions(limit = 8) {
  if (isDemoMode) {
    return [];
  }

  const rows = await prisma.commandResolution.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 20))
  });

  return serializeForJson(rows);
}

export async function getExecutionKernel(date = new Date()) {
  const [execution, recentResolutions] = await Promise.all([getDailyExecutionState(date), listRecentCommandResolutions(6)]);
  const dayStart = startOfLocalDay(date);
  const dayEnd = endOfLocalDay(date);
  const doneCount = isDemoMode
    ? 0
    : await prisma.commandResolution.count({
        where: {
          resolutionType: "DONE",
          createdAt: {
            gte: dayStart,
            lt: dayEnd
          }
        }
      });

  return {
    execution,
    recentResolutions,
    doneCount
  };
}
