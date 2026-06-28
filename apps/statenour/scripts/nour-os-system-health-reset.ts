import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import Module from "node:module";
import { resolve as pathResolve } from "node:path";
const NOOP_PATH = pathResolve(process.cwd(), "scripts", ".server-only-noop.js");
const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return NOOP_PATH;
  return origResolve.call(this, request, ...args);
};

import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";

const prisma = new PrismaClient();

const MODE = process.argv.includes("--apply") ? "apply" : "dry-run";
const NOW = new Date();
const MS_72H = 72 * 60 * 60 * 1000;
const STALE_CUTOFF = new Date(NOW.getTime() - MS_72H);

const KEEP_TITLES = [
  "Subaru radiator replacement",
  "GBP-to-Instagram review automation",
  "Take MiraLAX tonight",
  "Add fiber powder back to daily intake",
  "Save final text templates into CRM",
  "Review all three texts for tone/brevity/compliance",
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function matchesKeepList(title: string): string | null {
  const n = normalize(title);
  for (const kt of KEEP_TITLES) {
    const nk = normalize(kt);
    if (n === nk || n.includes(nk) || nk.includes(n)) return kt;
  }
  return null;
}

function classifyForMission(title: string): "shop" | "health" | "personal" | null {
  const t = title.toLowerCase();
  if (/lead|invoice|crm|customer|booking|review|gbp|instagram|shop|tire|appointment/.test(t)) return "shop";
  if (/weight|scale|fiber|miralax|workout|body|gym|sleep|health/.test(t)) return "health";
  if (/journal|commitment|template|text|cleanup|os|personal|admin/.test(t)) return "personal";
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set. Aborting.");
    process.exit(1);
  }

  let host = "(unknown)";
  try { host = new URL(url).host; } catch { host = url.slice(0, 40) + "..."; }
  console.log(`\n[nour-os-reset] Mode: ${MODE.toUpperCase()} | DB: ${host}\n`);

  // Dynamically import canonical services
  const { createMission } = await import("../lib/services/missions");
  const { createTask, updateTask } = await import("../lib/services/tasks");
  const { resolveInboxMissionId } = await import("../lib/services/missions");

  // ── PHASE 0: AUDIT CURRENT STATE ──────────────────────────────────────
  const allMissions = await prisma.mission.findMany({
    include: {
      tasks: {
        where: {
          deletedAt: null,
          status: { notIn: ["DONE", "ARCHIVED"] },
        },
      },
    },
    orderBy: { priority: "asc" },
  });

  const activeMissions = allMissions.filter((m) => !m.deletedAt);
  const deletedMissions = allMissions.filter((m) => m.deletedAt);

  const allTasks = await prisma.task.findMany({
    where: { deletedAt: null },
    include: { mission: { select: { id: true, title: true, deletedAt: true, domain: true } } },
    orderBy: { createdAt: "desc" },
  });

  const activeTasks = allTasks.filter((t) => !["DONE", "ARCHIVED"].includes(t.status));
  const doneTasks = allTasks.filter((t) => t.status === "DONE");
  const archivedTasksReport = allTasks.filter((t) => t.status === "ARCHIVED");

  // Categorizations
  const dailyLoops = activeTasks.filter((t) => t.loopKind === "DAILY");
  const weeklyLoops = activeTasks.filter((t) => t.loopKind === "WEEKLY");
  const promises = activeTasks.filter((t) => t.loopKind === "PROMISE" || t.promiseTo || t.personId);
  const onceTasks = activeTasks.filter((t) => t.loopKind === "ONCE" && !t.promiseTo && !t.personId);

  // Auto-keep check (72h / DOING)
  const autoKept = activeTasks.filter((t) => {
    if (matchesKeepList(t.title)) return false;
    if (t.loopKind === "DAILY" || t.loopKind === "WEEKLY") return false;
    if (t.status === "DOING") return true;
    if (t.lastTouchedAt && t.lastTouchedAt >= STALE_CUTOFF) return true;
    return false;
  });

  // Keep matches count
  const keepMatchesReport = KEEP_TITLES.map((kt) => {
    const match = activeTasks.find((t) => matchesKeepList(t.title) === kt);
    return { keepTitle: kt, taskId: match?.id ?? null, taskTitle: match?.title ?? null, found: !!match };
  });

  const keepIds = new Set([
    ...keepMatchesReport.filter((k) => k.taskId).map((k) => k.taskId!),
    ...autoKept.map((t) => t.id),
    ...dailyLoops.map((t) => t.id),
    ...weeklyLoops.map((t) => t.id),
  ]);

  // Debris detection
  const debris = activeTasks.filter((t) => {
    if (matchesKeepList(t.title)) return false;
    if (keepIds.has(t.id)) return false;
    if (t.loopKind === "DAILY" || t.loopKind === "WEEKLY") return false;
    if (t.personId) return false;
    if (t.status === "DOING") return false;
    if (t.lastTouchedAt && t.lastTouchedAt >= STALE_CUTOFF) return false;
    return true;
  });

  // Orphans detection
  const orphans = activeTasks.filter((t) => t.mission.deletedAt !== null);

  // Duplicate loops detection
  const dailyByNorm = new Map<string, typeof dailyLoops>();
  for (const t of dailyLoops) {
    const n = normalize(t.title);
    if (!dailyByNorm.has(n)) dailyByNorm.set(n, []);
    dailyByNorm.get(n)!.push(t);
  }
  const dailyDupes = [...dailyByNorm.entries()].filter(([, arr]) => arr.length > 1);

  const weeklyByNorm = new Map<string, typeof weeklyLoops>();
  for (const t of weeklyLoops) {
    const n = normalize(t.title);
    if (!weeklyByNorm.has(n)) weeklyByNorm.set(n, []);
    weeklyByNorm.get(n)!.push(t);
  }
  const weeklyDupes = [...weeklyByNorm.entries()].filter(([, arr]) => arr.length > 1);

  // Latest weight gap
  const latestBody = await prisma.bodyTracking.findFirst({ orderBy: { date: "desc" } });
  const gapDays = latestBody
    ? Math.floor((NOW.getTime() - new Date(latestBody.date + "T00:00:00Z").getTime()) / (24 * 60 * 60 * 1000))
    : null;

  // Mission report list
  const missionReport = activeMissions.map((m) => ({
    id: m.id,
    title: m.title,
    domain: m.domain,
    canonicalDomain: (m as any).canonicalDomain ?? null,
    systemKind: (m as any).systemKind ?? null,
    status: m.status,
    openTaskCount: m.tasks.length,
    isGeneralAnchor: (m as any).systemKind === "GENERAL",
    deletedAt: m.deletedAt,
  }));

  // Print initial state audit
  console.log("=== DRY-RUN STATE AUDIT ===");
  console.log(`  Active missions: ${activeMissions.length}`);
  console.log(`  Active tasks: ${activeTasks.length}`);
  console.log(`  Debris tasks: ${debris.length}`);
  console.log(`  Orphan tasks: ${orphans.length}`);
  console.log(`  Daily loops: ${dailyLoops.length} (Duplicates: ${dailyDupes.length})`);
  console.log(`  Weekly loops: ${weeklyLoops.length} (Duplicates: ${weeklyDupes.length})`);
  console.log(`  Latest body tracking entry: ${latestBody?.date ?? "None"} (Gap: ${gapDays ?? "N/A"} days)`);

  const mutations: string[] = [];
  const createdMissions: any[] = [];
  const reusedMissions: any[] = [];
  const createdTasks: any[] = [];
  const archivedTasks: any[] = [];
  const relinkedOrphans: any[] = [];
  const dailyLoopsRepaired: any[] = [];

  if (MODE === "apply") {
    console.log("\n=== EXECUTING MUTATIONS ===");

    // ── PHASE 2: ENSURE TARGET MISSIONS EXIST ───────────────────────────
    const targetMissions = [
      { key: "shop", title: "Shop Operations", domain: "BUSINESS", canonicalDomain: "business" },
      { key: "health", title: "Health", domain: "HEALTH", canonicalDomain: "health" },
      { key: "personal", title: "Personal OS", domain: "PERSONAL", canonicalDomain: "personal" },
    ];

    const missionMap = new Map<string, string>(); // key -> id

    for (const tm of targetMissions) {
      let mission = activeMissions.find(
        (m) =>
          (normalize(m.title) === normalize(tm.title) ||
            (m.domain === tm.domain && (m as any).canonicalDomain === tm.canonicalDomain)) &&
          (m as any).systemKind !== "GENERAL"
      );

      if (mission) {
        console.log(`  Reusing existing mission: "${mission.title}" [${mission.id}]`);
        reusedMissions.push({ key: tm.key, id: mission.id, title: mission.title });
        missionMap.set(tm.key, mission.id);

        if ((mission as any).canonicalDomain !== tm.canonicalDomain) {
          await prisma.mission.update({
            where: { id: mission.id },
            data: { canonicalDomain: tm.canonicalDomain },
          });
          mutations.push(`Set canonicalDomain of mission "${mission.title}" to "${tm.canonicalDomain}"`);
        }
      } else {
        console.log(`  Creating new mission: "${tm.title}"`);
        const created = await createMission({
          title: tm.title,
          domain: tm.domain,
          status: "ACTIVE",
          priority: 5,
          roiScore: 50,
          neglectCost: 50,
        });

        await prisma.mission.update({
          where: { id: created.id },
          data: { canonicalDomain: tm.canonicalDomain, systemKind: null },
        });

        createdMissions.push({ key: tm.key, id: created.id, title: tm.title });
        missionMap.set(tm.key, created.id);
        mutations.push(`Created mission "${tm.title}" [${created.id}] (canonicalDomain: ${tm.canonicalDomain})`);
      }
    }

    const shopOpsMissionId = missionMap.get("shop")!;
    const healthMissionId = missionMap.get("health")!;
    const personalOSMissionId = missionMap.get("personal")!;

    // ── PHASE 1: ENSURE KEEP-LIST ITEMS EXIST ───────────────────────────
    for (const kt of KEEP_TITLES) {
      const match = activeTasks.find((t) => matchesKeepList(t.title) === kt);
      if (match) {
        console.log(`  Keep item already active: "${match.title}" [${match.id}]`);

        let targetId = personalOSMissionId;
        if (kt.includes("review automation") || kt.includes("Save final text") || kt.includes("Review all three texts")) {
          targetId = shopOpsMissionId;
        } else if (kt.includes("MiraLAX") || kt.includes("fiber powder")) {
          targetId = healthMissionId;
        }

        if (match.missionId !== targetId) {
          await updateTask(match.id, { missionId: targetId });
          mutations.push(`Relinked keep task "${match.title}" to correct mission [${targetId}]`);
        }
      } else {
        console.log(`  Creating keep item: "${kt}"`);
        let targetId = personalOSMissionId;
        let payload: any = {
          title: kt,
          loopKind: "ONCE",
          status: "READY",
        };

        if (kt.includes("review automation")) {
          targetId = shopOpsMissionId;
        } else if (kt.includes("Save final text") || kt.includes("Review all three texts")) {
          targetId = shopOpsMissionId;
          const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
          payload.dueDate = tomorrow;
        } else if (kt.includes("MiraLAX") || kt.includes("fiber powder")) {
          targetId = healthMissionId;
        }

        payload.missionId = targetId;
        const created = await createTask(payload);
        createdTasks.push({ id: created.id, title: kt });
        mutations.push(`Created keep task "${kt}" [${created.id}] in mission ${targetId}`);
      }
    }

    // ── PHASE 3: ARCHIVE STALE COMMITMENT DEBRIS ────────────────────────
    for (const t of debris) {
      console.log(`  Archiving stale debris task: "${t.title}" [${t.id}]`);
      await updateTask(t.id, {
        status: "ARCHIVED",
        completionNote: "Nour OS system health reset — stale conversational debris archived",
      });
      archivedTasks.push({ id: t.id, title: t.title });
      mutations.push(`Archived task "${t.title}" [${t.id}]`);
    }

    // ── PHASE 4: ENSURE / REPAIR THE FIVE DAILY LOOPS ────────────────────
    // Soft-delete any existing "Fiber powder in Fairlife" loops
    await prisma.task.updateMany({
      where: {
        title: { contains: "Fiber powder in Fairlife", mode: "insensitive" },
        deletedAt: null,
      },
      data: {
        deletedAt: NOW,
        status: "ARCHIVED",
      },
    });
    mutations.push("Soft-deleted all instances of DAILY loop \"Fiber powder in Fairlife\"");

    const targetDailyLoops = [
      {
        title: "Weigh in + log body",
        missionId: healthMissionId,
        context: "HOME",
        energyRequired: "LOW",
        effort: "M5",
        nextPhysicalAction: "Step on scale and log today's weight.",
        finishCondition: "Weight logged for today.",
        roiScore: 70,
        frictionScore: 15,
        driftRisk: 10,
      },
      {
        title: "Check + contact urgent leads",
        missionId: shopOpsMissionId,
        context: "SHOP",
        energyRequired: "MEDIUM",
        effort: "M15",
        nextPhysicalAction: "Open urgent leads and contact anything time-sensitive.",
        finishCondition: "Urgent leads checked and contacted or marked not urgent.",
        roiScore: 90,
        frictionScore: 30,
        driftRisk: 20,
      },
      {
        title: "Follow up on invoices pending >3 days",
        missionId: shopOpsMissionId,
        context: "SHOP",
        energyRequired: "MEDIUM",
        effort: "M15",
        nextPhysicalAction: "Review invoices pending more than 3 days and send follow-up.",
        finishCondition: "All >3 day pending invoices reviewed or followed up.",
        roiScore: 85,
        frictionScore: 35,
        driftRisk: 15,
      },
      {
        title: "5-min journal",
        missionId: personalOSMissionId,
        context: "HOME",
        energyRequired: "LOW",
        effort: "M5",
        nextPhysicalAction: "Write five minutes: what happened, what mattered, what to do tomorrow.",
        finishCondition: "Journal entry saved.",
        roiScore: 60,
        frictionScore: 15,
        driftRisk: 25,
      },
    ];

    for (const dl of targetDailyLoops) {
      const existing = activeTasks.filter(
        (t) => normalize(t.title) === normalize(dl.title) && t.loopKind === "DAILY"
      );

      if (existing.length > 0) {
        existing.sort((a, b) => {
          if (a.streakCount !== b.streakCount) return b.streakCount - a.streakCount;
          const aTime = a.lastCompletedAt ? a.lastCompletedAt.getTime() : 0;
          const bTime = b.lastCompletedAt ? b.lastCompletedAt.getTime() : 0;
          return bTime - aTime;
        });

        const primary = existing[0];
        console.log(`  Primary daily loop kept: "${primary.title}" [${primary.id}] (streak: ${primary.streakCount})`);

        const updatePayload: any = {};
        if (primary.missionId !== dl.missionId) updatePayload.missionId = dl.missionId;
        if (primary.context !== dl.context) updatePayload.context = dl.context;
        if (primary.energyRequired !== dl.energyRequired) updatePayload.energyRequired = dl.energyRequired;
        if (primary.effort !== dl.effort) updatePayload.effort = dl.effort;
        if (primary.nextPhysicalAction !== dl.nextPhysicalAction) updatePayload.nextPhysicalAction = dl.nextPhysicalAction;
        if (primary.finishCondition !== dl.finishCondition) updatePayload.finishCondition = dl.finishCondition;

        const todayStr = NOW.toISOString().slice(0, 10);
        const lastCompletedStr = primary.lastCompletedAt?.toISOString().slice(0, 10);
        const isCheckedToday = lastCompletedStr === todayStr;

        if (primary.status !== "READY" && !isCheckedToday) {
          updatePayload.status = "READY";
        }

        if (Object.keys(updatePayload).length > 0) {
          await updateTask(primary.id, updatePayload);
          dailyLoopsRepaired.push({ id: primary.id, title: primary.title, changes: updatePayload });
          mutations.push(`Repaired daily loop "${primary.title}" [${primary.id}] with changes: ${JSON.stringify(updatePayload)}`);
        }

        for (let i = 1; i < existing.length; i++) {
          const dupe = existing[i];
          console.log(`  Archiving duplicate daily loop: "${dupe.title}" [${dupe.id}]`);
          await updateTask(dupe.id, {
            status: "ARCHIVED",
            completionNote: `Deduplicated — kept version ${primary.id} with better history`,
          });
          archivedTasks.push({ id: dupe.id, title: dupe.title });
          mutations.push(`Archived duplicate DAILY loop "${dupe.title}" [${dupe.id}]`);
        }
      } else {
        console.log(`  Creating missing daily loop: "${dl.title}"`);
        const created = await createTask({
          ...dl,
          loopKind: "DAILY",
          status: "READY",
        });
        createdTasks.push({ id: created.id, title: dl.title });
        mutations.push(`Created DAILY loop "${dl.title}" [${created.id}]`);
      }
    }

    // ── PHASE 5: BODY TRACKING RESTART ───────────────────────────────────
    const dateStr = new Date(NOW.getTime() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const existingRow = await prisma.bodyTracking.findUnique({ where: { date: dateStr } });

    console.log(`  Upserting BodyTracking for date: ${dateStr}`);
    await prisma.bodyTracking.upsert({
      where: { date: dateStr },
      create: {
        date: dateStr,
        notes: "Body tracking restart: last known weight 199 lb on 2026-06-05; 22-day blind spot flagged.",
      },
      update: {
        notes: existingRow?.notes
          ? `${existingRow.notes}\n\nBody tracking restart: last known weight 199 lb on 2026-06-05; 22-day blind spot flagged.`
          : "Body tracking restart: last known weight 199 lb on 2026-06-05; 22-day blind spot flagged.",
      },
    });
    mutations.push(`Upserted BodyTracking row for ${dateStr} with restart logs`);

    // ── PHASE 6: STALE TEXT TEMPLATE TASKS ───────────────────────────────
    const textTasks = activeTasks.filter((t) =>
      /save final text templates|review all three texts/i.test(t.title)
    );
    for (const t of textTasks) {
      const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
      const changes: any = {
        dueDate: tomorrow,
        missionId: shopOpsMissionId,
      };
      if (t.status !== "DOING") {
        changes.status = "READY";
      }
      await updateTask(t.id, changes);
      mutations.push(`Rescheduled text task "${t.title}" [${t.id}] to tomorrow`);
    }

    // ── PHASE 7: RELINK ORPHANS ──────────────────────────────────────────
    for (const t of orphans) {
      const cls = classifyForMission(t.title);
      let targetId = await resolveInboxMissionId();
      if (cls === "shop") targetId = shopOpsMissionId;
      else if (cls === "health") targetId = healthMissionId;
      else if (cls === "personal") targetId = personalOSMissionId;

      console.log(`  Relinking orphan task: "${t.title}" [${t.id}] -> mission [${targetId}]`);
      await updateTask(t.id, { missionId: targetId });
      relinkedOrphans.push({ id: t.id, title: t.title, from: t.missionId, to: targetId });
      mutations.push(`Relinking orphan task "${t.title}" [${t.id}] from deleted mission [${t.missionId}] to active [${targetId}]`);
    }

    console.log("\n✅ Mutating transactions complete.");
  } else {
    console.log("\n📋 DRY-RUN: No mutations applied. Run with --apply to write to the database.");
  }

  // ── SAVE DETAILED TRANSACTION REPORT ────────────────────────────────
  const reportsDir = path.resolve(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const ts = NOW.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join(reportsDir, `nour-os-reset-apply-${ts}.json`);

  const finalReport = {
    timestamp: NOW.toISOString(),
    mode: MODE,
    db: host,
    missionsCreated: createdMissions,
    missionsReused: reusedMissions,
    tasksCreated: createdTasks,
    tasksArchived: archivedTasks,
    tasksRepaired: dailyLoopsRepaired,
    orphansRelinked: relinkedOrphans,
    mutations: mutations,
  };

  fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2), "utf-8");
  console.log(`\nReport saved to: ${reportPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FATAL ERROR EXECUTING RESET:", err);
  prisma.$disconnect().finally(() => process.exit(1));
});
