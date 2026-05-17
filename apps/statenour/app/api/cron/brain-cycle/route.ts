import { cronHandler } from "@/lib/utils/http";
import { brainMemory } from "@/lib/brain/memory-manager";
import { automationEngine } from "@/lib/brain/automation-engine";
import { computeDriftScore } from "@/lib/brain/drift-detector";
import { analyzeCameraData } from "@/lib/brain/camera-intelligence";
import { runAutonomousActions } from "@/lib/brain/autonomous-engine";
import { proactiveAlerts, runBrainCycle } from "@/lib/brain/pipeline-controller";
import { logStrategicTriggers } from "@/lib/services/strategic-triggers";
import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { publish as publishBus } from "@/lib/db/brain-bus";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/brain-cycle");

export const maxDuration = 60;

/**
 * GET /api/cron/brain-cycle — The brain's analysis loop
 * 1. Analyze recent device states for patterns
 * 2. Check for anomalies
 * 3. Run memory decay
 * 4. Evaluate automation rules
 * 5. Execute approved actions
 * Schedule: hourly (or triggered by device sync)
 */
export const GET = cronHandler(async () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // 1. Analyze device states — detect patterns
  const recentEvents = await prisma.deviceEvent.findMany({
    where: { createdAt: { gte: oneHourAgo } },
    include: { device: { select: { name: true, deviceType: true, platform: true } } },
    orderBy: { timestamp: "desc" },
    take: 100,
  });

  let patternsDetected = 0;

  // Group events by device to detect patterns
  const eventsByDevice: Record<string, typeof recentEvents> = {};
  for (const event of recentEvents) {
    const key = event.deviceId;
    if (!eventsByDevice[key]) eventsByDevice[key] = [];
    eventsByDevice[key].push(event);
  }

  for (const [deviceId, events] of Object.entries(eventsByDevice)) {
    const device = events[0]?.device;
    if (!device) continue;

    // Pattern: frequent motion on camera
    if (events.filter((e) => e.event === "motion_detected").length > 5) {
      await brainMemory.remember(
        "device_behavior",
        `frequent_motion_${deviceId}_${new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })}`,
        `Frequent motion detected on ${device.name}: ${events.length} events in the last hour`,
        "device_analysis",
        { deviceId, eventCount: events.length, deviceType: device.deviceType }
      );
      patternsDetected++;
    }

    // Pattern: device went offline
    const offlineEvents = events.filter((e) => e.event === "status_changed" && (e.data as any)?.to === "OFFLINE");
    if (offlineEvents.length > 0) {
      await brainMemory.remember(
        "anomaly",
        `device_offline_${deviceId}`,
        `${device.name} went offline`,
        "device_analysis",
        { deviceId, platform: device.platform }
      );
      patternsDetected++;
    }
  }

  // 2. Check behavior patterns (live signals)
  // Apr 19 · DailyScore retired. Detect patterns from identity-
  // snapshot history (low brain maturity) + DAILY-task streak breaks
  // (workout-skip detection).
  const historyRows = await prisma.brainMemory
    .findMany({
      where: {
        category: "identity_snapshot",
        key: { startsWith: "history:" },
        updatedAt: { gte: daysAgo(7) },
      },
      select: { content: true },
    })
    .catch(() => [] as Array<{ content: string }>);

  if (historyRows.length >= 3) {
    const maturityAvgs: number[] = [];
    for (const row of historyRows) {
      try {
        const snap = JSON.parse(row.content) as { axes: Record<string, { value: number; manual: number | null }> };
        const axes = Object.values(snap.axes ?? {});
        if (axes.length === 0) continue;
        maturityAvgs.push(axes.reduce((s, a) => s + (a.manual ?? a.value), 0) / axes.length);
      } catch {
        // skip
      }
    }
    if (maturityAvgs.length >= 3) {
      const avgMaturity = maturityAvgs.reduce((a, b) => a + b, 0) / maturityAvgs.length;
      if (avgMaturity < 45) {
        await brainMemory.remember(
          "pattern",
          "low_brain_maturity_trend",
          `Brain-maturity average below 45 for ${maturityAvgs.length} days (${avgMaturity.toFixed(1)}/100)`,
          "behavior_tracking"
        );
        patternsDetected++;
      }
    }
  }

  // Workout-skip detection — DAILY workout task with cold streak
  // v10.0.45 — added `deletedAt: null` filter. Pre-fix soft-deleted
  // workout tasks could match → triggered false "workout skip" brain
  // memories. Soft-delete sweep landed in v9.1.18 but missed this
  // findFirst.
  const workoutTask = await prisma.task.findFirst({
    where: {
      loopKind: "DAILY",
      deletedAt: null,
      OR: [
        { title: { contains: "workout", mode: "insensitive" } },
        { title: { contains: "gym", mode: "insensitive" } },
        { title: { contains: "exercise", mode: "insensitive" } },
      ],
    },
    orderBy: { lastCompletedAt: "desc" },
    select: { lastCompletedAt: true, streakCount: true, title: true },
  }).catch(() => null);
  if (workoutTask?.lastCompletedAt) {
    const daysSince = (Date.now() - workoutTask.lastCompletedAt.getTime()) / 86400_000;
    if (daysSince >= 3) {
      await brainMemory.remember(
        "pattern",
        "workout_skip_streak",
        `Workout habit (${workoutTask.title}) not checked off in ${Math.floor(daysSince)} days (streak was ${workoutTask.streakCount})`,
        "behavior_tracking"
      );
      patternsDetected++;
    }
  }

  // ── NOTE ── Apr 17 separation pass: Business-pattern analysis
  // (Job / Lead / Customer / Quote / QuoteItem queries) was retired.
  // Shop data lives in nickstire.org/admin; autonicks is personal OS
  // only. Oversight cards pull from nickstire's public API.
  const businessInsights = 0;

  // 4. Memory decay
  const decayed = await brainMemory.decay();

  // 4b. Compute composite drift score
  const driftResult = await computeDriftScore().catch(() => null);

  // 5. Evaluate automation rules
  const context = await automationEngine.getContext();
  const firedRules = await automationEngine.evaluate(context);

  // 6. Execute approved actions
  const actionResults = await automationEngine.execute(firedRules);

  // ── Camera Intelligence ──────────────────────────────────────
  const cameraResult = await analyzeCameraData().catch((err) => {
    log.error("camera_analysis_failed", { err: err instanceof Error ? err.message : String(err) });
    return { alerts: 0, metrics: 0, insights: 0 };
  });

  // ── Autonomous Actions ───────────────────────────────────────
  const autonomousResult = await runAutonomousActions().catch((err) => {
    log.error("autonomous_actions_failed", { err: err instanceof Error ? err.message : String(err) });
    return { executed: 0, errors: 0 };
  });

  // ── Cross-Domain Intelligence (the brain's thinking loop) ─────
  const crossRefResult = await runBrainCycle().catch((err) => {
    log.error("cross_reference_failed", { err: err instanceof Error ? err.message : String(err) });
    return { alerts: [] as string[], patterns: [] as string[], synced: false };
  });

  // ── Proactive Alerts (Nick monitors without being asked) ──────
  const proactiveResult = await proactiveAlerts().catch((err) => {
    log.error("proactive_alerts_failed", { err: err instanceof Error ? err.message : String(err) });
    return { alerts: [] as string[] };
  });

  // ── Strategic Trigger Feedback Loop ──────────────────────────
  // Runs 25 Greene-law trigger rules against live state. Fired
  // triggers are persisted as SituationLog rows (deduped per 24h)
  // with their matched lawId. This is how the StrategicLaw layer
  // builds a usage history — before this wiring it was dead code
  // (187/189 laws never referenced).
  const lawFeedback = await logStrategicTriggers().catch((err) => {
    log.error("strategic_triggers_failed", { err: err instanceof Error ? err.message : String(err) });
    return { fired: 0, logged: 0, skipped: 0 };
  });

  const summary = {
    eventsAnalyzed: recentEvents.length,
    patternsDetected,
    businessInsights,
    memoriesDecayed: decayed,
    driftScore: driftResult?.overallScore ?? null,
    driftSignals: driftResult?.signals.length ?? 0,
    automationRulesFired: firedRules.length,
    actionResults: actionResults.map((r) => ({
      rule: r.ruleName,
      success: r.success,
      actions: r.actions.length,
    })),
    camera: cameraResult,
    autonomous: autonomousResult,
    proactiveAlerts: proactiveResult,
    crossReference: crossRefResult,
    lawFeedback,
  };

  // v8.5 BATCH 32 — publish a brain-bus event so downstream
  // subscribers (embedding warmer, Telegram bot, future analytics)
  // can react without polling the cron log. Fire-and-forget — never
  // blocks the cron's main return.
  void publishBus("brain_cycle_complete", summary).catch((err) => {
    log.warn("bus_publish_failed", { err: err instanceof Error ? err.message : String(err) });
  });

  return summary;
});
