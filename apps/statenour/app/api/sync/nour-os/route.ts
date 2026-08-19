import { prisma } from "@/lib/prisma";
import { syncHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { processGmailItems } from "@/lib/integrations/gmail-sync";
// v10.0.529.99 · Wave 43 · route open_loop creates through canonical
// service · was prisma.task.create direct with hardcoded "m-inbox".
import { createTask } from "@/lib/services/tasks";
import { resolveInboxMissionId } from "@/lib/services/missions";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const dynamic = "force-dynamic";

/**
 * POST /api/sync/nour-os — Receive data pushes from local NOUR OS.
 * Auth: x-sync-key or Bearer token (handled by syncHandler).
 * Accepts: { module: string, data: any }
 */
export const POST = syncHandler(async (req) => {
  const body = await req.json();
  const { module, data } = body;

  if (!module || !data) {
    throw new ServiceError("module and data required", 400);
  }

  let result: unknown;

  switch (module) {
    case "energy": {
      result = await prisma.stateLog.create({
        data: {
          energyLevel: data.energyLevel ?? 5,
          focusQuality: data.focusQuality ?? 5,
          driftLevel: data.driftLevel ?? 0,
          executionReadiness: data.executionReadiness ?? 5,
        },
      });
      break;
    }
    case "daily_score": {
      // v10.0.60 · Wave A part 3 · DailyScore retired Apr 19. Local
      // agent still emits this event; we route to BrainMemory
      // category="identity_snapshot" so the score isn't lost. The
      // refresh-identity cron + mastery surface engagement also
      // touch this row, so an external sync write is one of three
      // paths.
      result = await prisma.brainMemory.upsert({
        where: {
          category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" },
        },
        create: {
          category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
          key: "current",
          content: JSON.stringify(data),
          confidence: 0.9,
          source: "sync:nour-os-local",
        },
        update: {
          content: JSON.stringify(data),
        },
      });
      break;
    }
    case "vision": {
      const events = Array.isArray(data.events) ? data.events : [data];
      result = await prisma.visionEvent.createMany({
        data: events.map((e: { timestamp: string; event: string; camera?: string; data?: unknown }) => ({
          timestamp: new Date(e.timestamp),
          event: e.event,
          camera: e.camera,
          data: e.data,
          source: "local",
        })),
        skipDuplicates: true,
      });
      break;
    }
    case "habits": {
      // v10.0.60 · Wave A part 3 · HabitLog retired Apr 19. Local
      // agent's habit toggles now route to DAILY-loop Tasks
      // (lastCompletedAt + streakCount). Find or no-op per habit.
      if (Array.isArray(data.habits)) {
        let synced = 0;
        for (const h of data.habits) {
          const habitKey = String((h as { habitKey?: string }).habitKey ?? "").trim();
          const completed = !!(h as { completed?: boolean }).completed;
          if (!habitKey) continue;
          const task = await prisma.task.findFirst({
            where: {
              loopKind: "DAILY",
              deletedAt: null,
              title: { equals: habitKey, mode: "insensitive" },
            },
            select: { id: true },
          });
          if (!task) continue;
          await prisma.task
            .update({
              where: { id: task.id },
              data: completed
                ? {
                    streakCount: { increment: 1 },
                    lastCompletedAt: new Date(),
                    lastTouchedAt: new Date(),
                  }
                : {
                    lastTouchedAt: new Date(),
                  },
            })
            .catch(() => undefined);
          synced++;
        }
        result = { synced };
      }
      break;
    }
    case "brain_dump": {
      result = await prisma.brainDump.create({ data });
      break;
    }
    case "financial": {
      result = await prisma.financialSnapshot.upsert({
        where: { date: data.date },
        create: data,
        update: data,
      });
      break;
    }
    case "decisions": {
      result = await prisma.masteryDecision.create({ data });
      break;
    }
    case "patterns": {
      result = await prisma.patternDetection.create({ data });
      break;
    }
    case "insights": {
      result = await prisma.executionInsight.create({
        data: {
          insightType: data.insightType || "local_sync",
          title: data.title,
          detail: data.detail || data.title,
          score: data.score ?? 0,
          metadata: data.metadata ?? { source: "nour-os-local" },
        },
      });
      break;
    }
    case "journal": {
      // v10.0.60 · Wave A part 3 · Journal entries route through the
      // brainDump model (existing canonical journal store).
      result = await prisma.brainDump.create({
        data: {
          date: data.date || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
          rawThoughts: data.rawThoughts || data.text || "",
          summary: data.summary,
          extractedItems: data.extractedItems,
        },
      });
      break;
    }
    case "commitment": {
      result = await prisma.commitment.create({
        data: {
          dateMade: data.dateMade || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
          toWhom: data.toWhom || "self",
          description: data.description,
          deadline: data.deadline,
          domain: data.domain,
        },
      });
      break;
    }
    case "open_loop": {
      // Apr 18: OpenLoop retired. The local runner still sends
      // "open_loop" events — we absorb them into the Task INBOX
      // so no capture is lost. Event payload shape stays stable.
      //
      // v10.0.529.99 · Wave 43 · route through canonical createTask
      // service · dynamically resolve the Inbox missionId via the
      // helper (was hardcoded "m-inbox" string · fragile if the row
      // is ever deleted). syncTaskPriorities will derive autoPriority
      // from roiScore + frictionScore + age so the priorityMap-based
      // value is captured as autoPriorityExplanation rather than the
      // hardcoded autoPriority field (which the schema doesn't
      // accept on create).
      const inboxMissionId = await resolveInboxMissionId();
      const priorityLabel = String(data.priority ?? "medium");
      result = await createTask({
        title: String(data.title ?? "Untitled task").slice(0, 150),
        missionId: inboxMissionId,
        status: "INBOX",
        nextPhysicalAction: String(data.title ?? "").slice(0, 150) || "start",
        effort: "M15",
        roiScore: 50,
        frictionScore: 50,
        energyRequired: "MEDIUM",
        context: "ANYWHERE",
        finishCondition: data.description ? String(data.description).slice(0, 200) : "done when complete",
        autoPriorityExplanation: `from ${data.source ?? "nour-os-local"}${data.domain ? ` · ${data.domain}` : ""} · operator-priority=${priorityLabel}`,
      });
      break;
    }
    case "body": {
      result = await prisma.bodyTracking.upsert({
        where: { date: data.date },
        create: data,
        update: data,
      });
      break;
    }
    case "devices": {
      const devices = Array.isArray(data.devices) ? data.devices : [data];
      const results = [];
      for (const d of devices) {
        const dev = await prisma.smartDevice.upsert({
          where: { platformDeviceId: d.platformDeviceId },
          create: {
            name: d.name,
            platform: d.platform || "TUYA",
            platformDeviceId: d.platformDeviceId,
            deviceType: d.deviceType || "OTHER",
            location: d.location || null,
            status: d.status || "ONLINE",
            lastSeenAt: new Date(),
            currentState: d.currentState || null,
            metadata: d.metadata || null,
          },
          update: {
            status: d.status || "ONLINE",
            lastSeenAt: new Date(),
            currentState: d.currentState || undefined,
          },
        });
        results.push(dev.id);
      }
      result = { synced: results.length, ids: results };
      break;
    }
    case "system-metrics": {
      const metrics = Array.isArray(data) ? data : [data];
      const created = [];
      for (const m of metrics) {
        const metric = await prisma.systemMetric.create({
          data: {
            metric: m.name || m.metric || "agent_cycle",
            value: m.value ?? 0,
            unit: m.unit || "count",
            tags: { source: m.source || "local-agent", ...(m.metadata || {}) },
          },
        });
        created.push(metric.id);
      }
      result = { synced: created.length, ids: created };
      break;
    }
    case "session-reports": {
      result = await prisma.sessionReport.create({
        data: {
          sessionDate: data.sessionDate || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
          summary: data.summary || "",
          filesChanged: data.filesChanged || null,
          commits: data.commits || null,
          decisions: data.decisions || null,
          blockers: data.blockers || null,
          nextSteps: data.nextSteps || null,
          tokenCost: data.tokenCost ?? null,
          durationMin: data.durationMin ?? null,
          agentModel: data.agentModel || null,
        },
      });
      break;
    }
    case "notifications": {
      // v10.0.60 · Wave A part 3 · Pre-fix dead Promise.resolve.
      // Local-agent notification events route to AuditEvent so the
      // /system/diagnostics dashboard can render the timeline; the
      // brain doesn't need a dedicated notification model.
      result = await prisma.auditEvent.create({
        data: {
          actor: "sync:nour-os-local",
          eventType: "notification",
          detail: String(data.title || data.message || "notification"),
          payload: data,
        },
      });
      break;
    }
    case "email-triage": {
      const items = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [data];
      result = await processGmailItems(items);
      break;
    }
    default:
      throw new ServiceError(`Unknown module: ${module}`, 400);
  }

  // Log every sync event — zero data loss
  await prisma.localSyncLog.create({
    data: {
      module,
      action: "sync_push",
      count: 1,
      details: `Synced ${module} from local NOUR OS`,
    },
  }).catch(() => {}); // Never fail the main sync

  // Update runner heartbeat so Command Deck shows "Agent: Online"
  await prisma.runnerNode.upsert({
    where: { nodeKey: "local-agent" },
    create: { nodeKey: "local-agent", label: "Local Agent", status: "READY", lastHeartbeatAt: new Date() },
    update: { status: "READY", lastHeartbeatAt: new Date() },
  }).catch(() => {}); // Non-critical

  return { module, result };
});

/**
 * GET /api/sync/nour-os — Return current brain state for local OS to pull.
 * Auth: x-sync-key or Bearer token (handled by syncHandler).
 */
export const GET = syncHandler(async () => {
  const [missions, driftAlerts, openLoops, todayScore, commitments, recentInsights, recentPatterns, latestFinancial] = await Promise.all([
    prisma.mission.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, title: true, domain: true, priority: true, successMetric: true },
      orderBy: { priority: "desc" },
      take: 10,
    }),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
          deletedAt: null,
        },
        select: { key: true, content: true, metadata: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      })
      .then((rows) => {
        const unresolved = rows.filter((e) => {
          const meta = (e.metadata ?? {}) as Record<string, unknown>;
          return !meta.ackedAt;
        });
        return unresolved.slice(0, 10).map((e) => {
          const meta = (e.metadata ?? {}) as Record<string, unknown>;
          return {
            id: e.key,
            ruleName: e.content,
            severity: meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "alert" : "warning",
            message: typeof meta.body === "string" ? meta.body : "",
            date: new Date(e.createdAt).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
          };
        });
      })
      .catch(() => [] as Array<{ id: string; ruleName: string; severity: string; message: string; date: string }>),
    // Apr 18: OpenLoop retired → Task queue (same shape).
    prisma.task
      .findMany({
        where: { status: { in: ["INBOX", "READY", "DOING"] } },
        orderBy: [{ autoPriority: "desc" }, { createdAt: "desc" }],
        take: 15,
        select: {
          id: true,
          title: true,
          autoPriority: true,
          autoPriorityExplanation: true,
          mission: { select: { domain: true } },
        },
      })
      .then((rows) =>
        rows.map((t) => ({
          id: t.id,
          title: t.title,
          priority:
            (t.autoPriority ?? 50) >= 80 ? "critical"
            : (t.autoPriority ?? 50) >= 60 ? "high"
            : (t.autoPriority ?? 50) >= 40 ? "medium"
            : "low",
          domain: t.mission?.domain ?? "general",
          source: t.autoPriorityExplanation ?? "unknown",
        })),
      ),
    // v10.0.60 · Wave A part 3 · todayScore via legacy-shim. Local
    // PowerShell agent's pull sync now sees real engagement signal.
    (async () => {
      const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
      const all = await recentScoreSnapshots(1);
      return all[0] ?? null;
    })(),
    prisma.commitment.findMany({
      where: { status: "active", deletedAt: null },
      select: { id: true, description: true, deadline: true, domain: true, toWhom: true },
      take: 10,
    }),
    prisma.executionInsight.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
      select: { insightType: true, title: true, createdAt: true },
      take: 10,
    }),
    prisma.patternDetection.findMany({
      orderBy: { createdAt: "desc" },
      select: { patternName: true, triggerDesc: true, evidence: true, date: true },
      take: 5,
    }),
    prisma.financialSnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true, businessRevenue: true, ownerTakeHome: true, totalDebt: true, netWorthEstimate: true },
    }),
  ]);

  return {
    missions,
    driftAlerts,
    openLoops,
    todayScore,
    commitments,
    recentInsights,
    recentPatterns,
    latestFinancial,
    timestamp: new Date().toISOString(),
  };
});
