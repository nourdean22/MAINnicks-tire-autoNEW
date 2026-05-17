import { assessDriftState } from "@/lib/scoring/drift";
import { getDormantCustomers, listCustomers } from "@/lib/services/customers";
import { getUrgentLeads, listLeads } from "@/lib/services/leads";
import { getMissionRanking, listMissions } from "@/lib/services/missions";
import { listPersonalLogs } from "@/lib/services/personal";
import { listTasks } from "@/lib/services/tasks";
import { daysSince } from "@/lib/utils/datetime";
import { cached } from "@/lib/utils/cache";

function buildPersonalWinTarget(log: Awaited<ReturnType<typeof listPersonalLogs>>[number] | undefined) {
  if (!log) {
    return "Log the day and lock tomorrow's first move before shutdown.";
  }

  if (!log.workoutCompleted) {
    return "Protect one workout block before the day closes.";
  }

  if (!log.socialFamilyAction) {
    return "Complete one deliberate family or social touchpoint tonight.";
  }

  if (log.deepWorkBlocks < 2) {
    return "Protect two uninterrupted deep-work blocks before noon.";
  }

  return "Close the day by defining tomorrow's first physical action.";
}

function buildAvoidThing(level: string, staleTaskCount: number) {
  if (level === "HIGH") {
    return "Avoid any new intake until one overdue task is finished end-to-end.";
  }

  if (staleTaskCount > 0) {
    return "Avoid opening another low-value admin lane before one stale task moves.";
  }

  return "Avoid drifting into maintenance work before the primary mission advances.";
}

export async function getDailyCommandBrief() {
  return cached("dashboard_brief", 30, fetchDailyCommandBrief);
}

async function fetchDailyCommandBrief() {
  const [missionRanking, missions, tasks, urgentLeads, dormantCustomers, leads, customers, personalLogs] =
    await Promise.all([
      getMissionRanking(),
      listMissions(),
      listTasks(),
      getUrgentLeads(),
      getDormantCustomers(4),
      listLeads(),
      listCustomers(),
      listPersonalLogs()
    ]);

  const topTasks = tasks
    .filter((task) => !["DONE", "ARCHIVED"].includes(task.status))
    .slice(0, 3);
  const openExecutionCount = tasks.filter((task) => ["READY", "DOING"].includes(task.status)).length;
  const staleTaskCount = tasks.filter((task) => task.stale).length;
  const recentCompletionCount = tasks.filter((task) => task.status === "DONE" && (daysSince(task.updatedAt) || 99) <= 3).length;
  const latestLog = personalLogs[0];
  const driftState = assessDriftState({
    recentCompletionCount,
    readyDoingCount: openExecutionCount,
    staleTaskCount,
    driftIncidents: latestLog?.driftIncidents || 0
  });

  return {
    generatedAt: new Date().toISOString(),
    primaryMission: missionRanking.primaryMission,
    secondaryMission: missionRanking.secondaryMission,
    rankedMissions: missionRanking.rankedMissions,
    topTasks,
    urgentLeads,
    dormantCustomers,
    personalWinTarget: buildPersonalWinTarget(latestLog),
    avoidThis: buildAvoidThing(driftState.level, staleTaskCount),
    driftState,
    counts: {
      activeMissions: missions.filter((mission: { status: string }) => mission.status === "ACTIVE").length,
      openTasks: tasks.filter((task: { status: string }) => !["DONE", "ARCHIVED"].includes(task.status)).length,
      urgentLeads: leads.filter((lead: { effectiveUrgency: string }) => lead.effectiveUrgency === "HIGH").length,
      atRiskCustomers: customers.filter((customer: { effectiveRiskStatus: string }) => customer.effectiveRiskStatus !== "HEALTHY").length
    }
  };
}
