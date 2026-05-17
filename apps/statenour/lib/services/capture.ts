import { CaptureConversionTarget, CaptureTriageStatus, MissionDomain } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/runtime";
import { createLead } from "@/lib/services/leads";
import { createMission, listMissions } from "@/lib/services/missions";
import { createTask } from "@/lib/services/tasks";
import { serializeForJson } from "@/lib/utils/serialize";
import { ServiceError } from "@/lib/utils/service-error";

function extractMetadataTags(metadata: unknown) {
  const payload = (metadata as Record<string, unknown> | null) || null;
  return Array.isArray(payload?.tags) ? payload.tags.map((tag) => String(tag).toLowerCase()) : [];
}

function inferPrimaryTag(record: {
  kind: string;
  title: string;
  summary: string;
  metadata: unknown;
}) {
  const tags = extractMetadataTags(record.metadata);
  if (tags.includes("customer")) {
    return "customer";
  }
  if (tags.includes("reference")) {
    return "reference";
  }
  if (tags.includes("personal")) {
    return "personal";
  }
  if (record.kind === "image") {
    return "ops";
  }
  if (/lead|quote|estimate|callback|customer/i.test(`${record.title} ${record.summary}`)) {
    return "customer";
  }
  return "idea";
}

function inferActionabilityScore(record: {
  kind: string;
  title: string;
  summary: string;
  metadata: unknown;
}) {
  let score = record.kind === "image" ? 58 : 65;
  if (/urgent|today|call|estimate|callback|follow up/i.test(`${record.title} ${record.summary}`)) {
    score += 20;
  }
  const tags = extractMetadataTags(record.metadata);
  if (tags.includes("customer")) {
    score += 10;
  }
  if (tags.includes("reference")) {
    score -= 10;
  }
  return Math.max(5, Math.min(100, score));
}

function buildHistoricalTagBoosts(records: Array<{ primaryTag: string | null; conversionTarget: CaptureConversionTarget | null }>) {
  const boosts = new Map<string, number>();

  for (const record of records) {
    if (!record.primaryTag) {
      continue;
    }

    const current = boosts.get(record.primaryTag) || 0;
    const increment =
      record.conversionTarget === CaptureConversionTarget.LEAD || record.conversionTarget === CaptureConversionTarget.MISSION
        ? 8
        : record.conversionTarget === CaptureConversionTarget.TASK
          ? 6
          : 3;
    boosts.set(record.primaryTag, current + increment);
  }

  return boosts;
}

function computeCaptureSortScore(
  record: {
    kind: string;
    title: string;
    summary: string;
    metadata: unknown;
    primaryTag: string | null;
    actionabilityScore: number;
    triageStatus: CaptureTriageStatus;
    conversionTarget: CaptureConversionTarget | null;
    capturedAt: Date;
  },
  historicalTagBoosts: Map<string, number>
) {
  const primaryTag = record.primaryTag || inferPrimaryTag(record);
  const tags = extractMetadataTags(record.metadata);
  let score = record.actionabilityScore || inferActionabilityScore(record);

  if (record.triageStatus === CaptureTriageStatus.NEW) {
    score += 12;
  }

  if (primaryTag === "customer") {
    score += 18;
  }

  if (primaryTag === "reference") {
    score -= 18;
  }

  if (record.conversionTarget === CaptureConversionTarget.LEAD || record.conversionTarget === CaptureConversionTarget.MISSION) {
    score += 10;
  }

  if (tags.includes("customer") || /lead|estimate|callback|quote|customer/i.test(`${record.title} ${record.summary}`)) {
    score += 10;
  }

  const minutesOld = Math.max((Date.now() - record.capturedAt.getTime()) / 60_000, 0);
  score += Math.max(15 - Math.floor(minutesOld / 90), 0);
  score += Math.min(historicalTagBoosts.get(primaryTag) || 0, 18);

  return score;
}

function serializeCaptureItem(record: {
  itemKey: string;
  source: string;
  kind: string;
  title: string;
  summary: string;
  excerpt: string | null;
  contentPath: string | null;
  status: string;
  triageStatus: CaptureTriageStatus;
  primaryTag: string | null;
  actionabilityScore: number;
  conversionTarget: CaptureConversionTarget | null;
  convertedTaskId: string | null;
  convertedMissionId: string | null;
  convertedLeadId: string | null;
  triagedAt: Date | null;
  metadata: unknown;
  capturedAt: Date;
  syncedAt: Date;
}) {
  return serializeForJson({
    item_key: record.itemKey,
    source: record.source,
    kind: record.kind,
    title: record.title,
    summary: record.summary,
    excerpt: record.excerpt,
    content_path: record.contentPath,
    status: record.status,
    triage_status: record.triageStatus.toLowerCase(),
    primary_tag: record.primaryTag,
    actionability_score: record.actionabilityScore,
    conversion_target: record.conversionTarget?.toLowerCase() || null,
    converted_task_id: record.convertedTaskId,
    converted_mission_id: record.convertedMissionId,
    converted_lead_id: record.convertedLeadId,
    triaged_at: record.triagedAt,
    metadata: (record.metadata as Record<string, unknown> | null) || {},
    captured_at: record.capturedAt,
    synced_at: record.syncedAt
  });
}

export async function listCaptureItems(limit = 20) {
  if (isDemoMode) {
    return [];
  }

  const [rows, converted] = await Promise.all([
    prisma.captureInboxItem.findMany({
      where: {
        status: "active"
      },
      orderBy: [{ capturedAt: "desc" }],
      take: Math.max(12, Math.min(limit * 3, 60))
    }),
    prisma.captureInboxItem.findMany({
      where: {
        triageStatus: CaptureTriageStatus.CONVERTED,
        primaryTag: {
          not: null
        }
      },
      select: {
        primaryTag: true,
        conversionTarget: true
      },
      take: 60,
      orderBy: { updatedAt: "desc" }
    })
  ]);

  const historicalTagBoosts = buildHistoricalTagBoosts(converted);
  const ranked = [...rows]
    .sort((left, right) => computeCaptureSortScore(right, historicalTagBoosts) - computeCaptureSortScore(left, historicalTagBoosts))
    .slice(0, Math.max(1, Math.min(limit, 50)));

  return ranked.map(serializeCaptureItem);
}

export async function getActionableCaptureItems(limit = 3) {
  if (isDemoMode) {
    return [];
  }

  const [rows, converted] = await Promise.all([
    prisma.captureInboxItem.findMany({
      where: {
        status: "active",
        triageStatus: {
          not: CaptureTriageStatus.ARCHIVED
        }
      },
      orderBy: [{ capturedAt: "desc" }],
      take: Math.max(8, Math.min(limit * 4, 24))
    }),
    prisma.captureInboxItem.findMany({
      where: {
        triageStatus: CaptureTriageStatus.CONVERTED,
        primaryTag: {
          not: null
        }
      },
      select: {
        primaryTag: true,
        conversionTarget: true
      },
      take: 60,
      orderBy: { updatedAt: "desc" }
    })
  ]);

  const historicalTagBoosts = buildHistoricalTagBoosts(converted);
  const ranked = [...rows]
    .sort((left, right) => computeCaptureSortScore(right, historicalTagBoosts) - computeCaptureSortScore(left, historicalTagBoosts))
    .slice(0, Math.max(1, Math.min(limit, 6)));

  return ranked.map(serializeCaptureItem);
}

export async function triageCaptureItem(
  itemKey: string,
  input: {
    triageStatus?: CaptureTriageStatus;
    primaryTag?: string | null;
    actionabilityScore?: number | null;
    conversionTarget?: CaptureConversionTarget | null;
  }
) {
  if (isDemoMode) {
    throw new ServiceError("Capture triage is unavailable in demo mode.", 400);
  }

  const existing = await prisma.captureInboxItem.findUnique({
    where: { itemKey }
  });

  if (!existing) {
    throw new ServiceError("Capture item not found.", 404);
  }

  const updated = await prisma.captureInboxItem.update({
    where: { itemKey },
    data: {
      triageStatus: input.triageStatus || CaptureTriageStatus.TRIAGED,
      primaryTag: input.primaryTag ?? existing.primaryTag ?? inferPrimaryTag(existing),
      actionabilityScore: input.actionabilityScore ?? existing.actionabilityScore ?? inferActionabilityScore(existing),
      conversionTarget: input.conversionTarget ?? existing.conversionTarget,
      triagedAt: new Date()
    }
  });

  return serializeCaptureItem(updated);
}

async function resolveTaskMissionId(inputMissionId?: string) {
  if (inputMissionId) {
    return inputMissionId;
  }

  const missions = await listMissions();
  const candidate = missions.find((mission: { status: string }) => mission.status === "ACTIVE") || missions[0];
  if (!candidate) {
    throw new ServiceError("Create a mission before converting a capture item into a task.", 400);
  }

  return candidate.id;
}

export async function convertCaptureItem(
  itemKey: string,
  input: {
    target: CaptureConversionTarget;
    missionId?: string;
    domain?: MissionDomain;
    successMetric?: string | null;
    urgency?: "LOW" | "MEDIUM" | "HIGH";
    valueEstimate?: number | null;
    note?: string | null;
  }
) {
  if (isDemoMode) {
    throw new ServiceError("Capture conversion is unavailable in demo mode.", 400);
  }

  const item = await prisma.captureInboxItem.findUnique({
    where: { itemKey }
  });

  if (!item) {
    throw new ServiceError("Capture item not found.", 404);
  }

  let convertedTaskId: string | null = null;
  let convertedMissionId: string | null = null;
  let convertedLeadId: string | null = null;
  let created: { type: string; id: string; title: string; destinationLabel: string } | null = null;

  if (input.target === CaptureConversionTarget.TASK) {
    const missionId = await resolveTaskMissionId(input.missionId);
    const task = await createTask({
      title: item.title,
      missionId,
      status: "READY",
      nextPhysicalAction: input.note || item.excerpt || item.summary || `Process ${item.title}`,
      effort: "M15",
      roiScore: Math.max(20, Math.min(100, item.actionabilityScore)),
      frictionScore: 30,
      energyRequired: "MEDIUM",
      context: "ANYWHERE",
      waitingOn: null,
      dueDate: null,
      driftRisk: 15,
      finishCondition: `The captured input "${item.title}" is processed into real work and closed.`
    });
    if (!task) {
      throw new ServiceError("Failed to create task from capture.", 500);
    }
    convertedTaskId = task.id;
    created = {
      type: "task",
      id: task.id,
      title: task.title,
      destinationLabel: "Task queue"
    };
  }

  if (input.target === CaptureConversionTarget.MISSION) {
    const mission = await createMission({
      title: item.title,
      domain: input.domain || MissionDomain.BUSINESS,
      status: "ACTIVE",
      priority: 7,
      roiScore: Math.max(35, Math.min(100, item.actionabilityScore)),
      neglectCost: 60,
      successMetric: input.successMetric || item.summary
    });
    convertedMissionId = mission.id;
    created = {
      type: "mission",
      id: mission.id,
      title: mission.title,
      destinationLabel: "Mission index"
    };
  }

  if (input.target === CaptureConversionTarget.LEAD) {
    const lead = await createLead({
      fullName: item.title,
      source: "OTHER",
      inquiryText: item.excerpt || item.summary || item.title,
      leadType: "OTHER",
      urgency: input.urgency || "MEDIUM",
      valueEstimate: input.valueEstimate ?? Math.max(150, item.actionabilityScore * 10),
      status: "NEW"
    });
    convertedLeadId = lead.id;
    created = {
      type: "lead",
      id: lead.id,
      title: lead.fullName,
      destinationLabel: "Lead queue"
    };
  }

  const updated = await prisma.captureInboxItem.update({
    where: { itemKey },
    data: {
      status: input.target === CaptureConversionTarget.ARCHIVE ? "archived" : "active",
      triageStatus: input.target === CaptureConversionTarget.ARCHIVE ? CaptureTriageStatus.ARCHIVED : CaptureTriageStatus.CONVERTED,
      primaryTag:
        input.target === CaptureConversionTarget.REFERENCE
          ? "reference"
          : input.target === CaptureConversionTarget.PERSONAL
            ? "personal"
            : item.primaryTag || inferPrimaryTag(item),
      conversionTarget: input.target,
      convertedTaskId,
      convertedMissionId,
      convertedLeadId,
      triagedAt: new Date(),
      actionabilityScore:
        input.target === CaptureConversionTarget.REFERENCE || input.target === CaptureConversionTarget.ARCHIVE
          ? Math.min(item.actionabilityScore, 25)
          : item.actionabilityScore
    }
  });

  if (input.target === CaptureConversionTarget.REFERENCE) {
    created = {
      type: "reference",
      id: updated.id,
      title: updated.title,
      destinationLabel: "Reference lane"
    };
  }

  if (input.target === CaptureConversionTarget.PERSONAL) {
    created = {
      type: "personal",
      id: updated.id,
      title: updated.title,
      destinationLabel: "Personal lane"
    };
  }

  if (input.target === CaptureConversionTarget.ARCHIVE) {
    created = {
      type: "archive",
      id: updated.id,
      title: updated.title,
      destinationLabel: "Archive"
    };
  }

  return serializeForJson({
    item: serializeCaptureItem(updated),
    created
  });
}
