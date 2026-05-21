import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/runtime";
import { serializeForJson } from "@/lib/utils/serialize";
import { ServiceError } from "@/lib/utils/service-error";
// ET-correct day boundaries. The prior local `new Date(y,m,d)` floored to
// midnight in the SERVER zone (UTC). See lib/utils/datetime.ts.
import {
  startOfDayET as startOfLocalDay,
  endOfDayET as endOfLocalDay,
} from "@/lib/utils/datetime";

function inferExpectedValue(item: {
  expectedValue: number | null;
  payload: unknown;
}) {
  const payload = (item.payload as Record<string, unknown> | null) || {};
  if (item.expectedValue != null) {
    return item.expectedValue;
  }
  for (const key of ["expected_value", "value_estimate", "estimate_total", "total", "ticket_total"]) {
    const value = payload[key];
    if (typeof value === "number") {
      return Math.round(value);
    }
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^0-9.-]/g, ""));
      if (!Number.isNaN(parsed)) {
        return Math.round(parsed);
      }
    }
  }
  return 0;
}

function serializeRecoveryAction(record: {
  action: string;
  outcome: string | null;
  note: string | null;
  nextFollowUpAt: Date | null;
  expectedValue: number | null;
  createdAt: Date;
}) {
  return serializeForJson({
    action: record.action,
    outcome: record.outcome,
    note: record.note,
    next_follow_up_at: record.nextFollowUpAt,
    expected_value: record.expectedValue,
    created_at: record.createdAt
  });
}

function buildWhyFirst(record: {
  priorityScore: number;
  expectedValue: number | null;
  nextFollowUpAt: Date | null;
  touchCount: number;
}) {
  const segments = [`priority ${Math.round(record.priorityScore)}`];

  if (record.expectedValue && record.expectedValue > 0) {
    segments.push(`value ${record.expectedValue}`);
  }

  if (record.nextFollowUpAt) {
    segments.push(`follow-up ${record.nextFollowUpAt.toISOString().slice(0, 10)}`);
  }

  if (record.touchCount > 0) {
    segments.push(`${record.touchCount} touch${record.touchCount === 1 ? "" : "es"}`);
  }

  return segments.join(" / ");
}

function computeQueueScore(record: {
  priorityScore: number;
  expectedValue: number | null;
  nextFollowUpAt: Date | null;
  touchCount: number;
}) {
  const expectedValue = record.expectedValue || 0;
  const dueTodayBoost = record.nextFollowUpAt && record.nextFollowUpAt.getTime() <= endOfLocalDay().getTime() ? 40 : 0;
  const overdueBoost = record.nextFollowUpAt && record.nextFollowUpAt.getTime() < Date.now() ? 18 : 0;
  const valueBoost = Math.min(Math.round(expectedValue / 125), 30);
  const touchPenalty = Math.min(record.touchCount * 3, 12);

  return record.priorityScore + dueTodayBoost + overdueBoost + valueBoost - touchPenalty;
}

function serializeRecoveryItem(record: {
  entityKey: string;
  source: string;
  title: string;
  summary: string;
  priorityScore: number;
  status: string;
  payload: unknown;
  lastTouchedAt: Date | null;
  nextFollowUpAt: Date | null;
  callbackNote: string | null;
  expectedValue: number | null;
  touchCount: number;
  updatedAt: Date;
  actionLogs?: Array<{
    action: string;
    outcome: string | null;
    note: string | null;
    nextFollowUpAt: Date | null;
    expectedValue: number | null;
    createdAt: Date;
  }>;
}) {
  const expectedValue = inferExpectedValue(record);

  return serializeForJson({
    entity_key: record.entityKey,
    source: record.source,
    title: record.title,
    summary: record.summary,
    priority_score: record.priorityScore,
    queue_score: computeQueueScore({
      priorityScore: record.priorityScore,
      expectedValue,
      nextFollowUpAt: record.nextFollowUpAt,
      touchCount: record.touchCount
    }),
    status: record.status,
    payload: (record.payload as Record<string, unknown> | null) || {},
    last_touched_at: record.lastTouchedAt,
    next_follow_up_at: record.nextFollowUpAt,
    callback_note: record.callbackNote,
    expected_value: expectedValue,
    touch_count: record.touchCount,
    updated_at: record.updatedAt,
    why_this_is_first: buildWhyFirst({
      priorityScore: record.priorityScore,
      expectedValue,
      nextFollowUpAt: record.nextFollowUpAt,
      touchCount: record.touchCount
    }),
    recent_actions: (record.actionLogs || []).map(serializeRecoveryAction)
  });
}

export async function listRecoveryWarRoom(limit = 16) {
  if (isDemoMode) {
    return {
      items: [],
      dueToday: [],
      highValue: [],
      metrics: {
        stagedValue: 0,
        highestValueCallback: 0,
        dueTodayCount: 0,
        recentEstimateCount: 0,
        recoveryTouchesToday: 0
      }
    };
  }

  const [items, todayLogs] = await Promise.all([
    prisma.stagedRecoveryItem.findMany({
      include: {
        actionLogs: {
          orderBy: { createdAt: "desc" },
          take: 3
        }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: Math.max(1, Math.min(limit, 32))
    }),
    prisma.recoveryActionLog.findMany({
      where: {
        createdAt: {
          gte: startOfLocalDay(),
          lt: endOfLocalDay()
        }
      }
    })
  ]);

  const serialized = items
    .map(serializeRecoveryItem)
    .sort((left, right) => (right.queue_score || 0) - (left.queue_score || 0));
  const dueToday = serialized
    .filter((item) => item.next_follow_up_at && new Date(item.next_follow_up_at).getTime() <= endOfLocalDay().getTime())
    .sort((left, right) => (right.queue_score || 0) - (left.queue_score || 0))
    .slice(0, 4);
  const highValue = [...serialized]
    .sort((left, right) => {
      const valueDelta = (right.expected_value || 0) - (left.expected_value || 0);
      if (valueDelta !== 0) {
        return valueDelta;
      }

      return (right.queue_score || 0) - (left.queue_score || 0);
    })
    .slice(0, 4);
  const stagedValue = serialized.reduce((sum, item) => sum + (item.expected_value || 0), 0);

  return {
    items: serialized,
    dueToday,
    highValue,
    metrics: {
      stagedValue,
      highestValueCallback: highValue[0]?.expected_value || 0,
      dueTodayCount: dueToday.length,
      recentEstimateCount: serialized.filter((item) => item.source === "ale_recent").length,
      recoveryTouchesToday: todayLogs.length
    }
  };
}

export async function updateRecoveryItem(
  entityKey: string,
  input: {
    status: string;
    note?: string | null;
    callbackNote?: string | null;
    nextFollowUpAt?: Date | null;
    outcome?: string | null;
    expectedValue?: number | null;
  }
) {
  if (isDemoMode) {
    throw new ServiceError("Recovery updates are unavailable in demo mode.", 400);
  }

  const item = await prisma.stagedRecoveryItem.findUnique({
    where: { entityKey }
  });

  if (!item) {
    throw new ServiceError("Recovery item not found.", 404);
  }

  const nextFollowUpAt =
    input.nextFollowUpAt ||
    (input.status === "follow_up"
      ? new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1, 9, 0, 0)
      : item.nextFollowUpAt);

  await prisma.$transaction(async (tx) => {
    const row = await tx.stagedRecoveryItem.update({
      where: { entityKey },
      data: {
        status: input.status,
        callbackNote: input.callbackNote ?? input.note ?? item.callbackNote,
        nextFollowUpAt,
        expectedValue: input.expectedValue ?? item.expectedValue ?? inferExpectedValue(item),
        lastTouchedAt: new Date(),
        touchCount: {
          increment: input.status === "open" ? 0 : 1
        },
        updatedAt: new Date()
      }
    });

    await tx.recoveryActionLog.create({
      data: {
        stagedRecoveryItemId: row.id,
        action: input.status,
        outcome: input.outcome || null,
        note: input.note || input.callbackNote || null,
        nextFollowUpAt,
        expectedValue: input.expectedValue ?? row.expectedValue ?? inferExpectedValue(row)
      }
    });
  });

  const updated = await prisma.stagedRecoveryItem.findUnique({
    where: { entityKey },
    include: {
      actionLogs: {
        orderBy: { createdAt: "desc" },
        take: 3
      }
    }
  });

  if (!updated) {
    throw new ServiceError("Recovery item not found after update.", 404);
  }

  return serializeRecoveryItem(updated);
}
