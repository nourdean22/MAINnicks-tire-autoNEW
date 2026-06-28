import { prisma } from "../lib/prisma";

import { calculateDailyScore } from "../lib/services/personal";
import { rankMissions } from "../lib/scoring/mission-ranking";
import { scoreTaskPriority } from "../lib/scoring/task-priority";
import { addDays, subDays } from "../lib/utils/datetime";
import { seedSources } from "./seeds/seed-sources";

async function main() {
  await seedSources(prisma);
  await prisma.taskEvent.deleteMany();
  await prisma.task.deleteMany();
  await prisma.personalDailyLog.deleteMany();
  await prisma.mission.deleteMany();

  const missions = await prisma.$transaction([
    prisma.mission.create({
      data: {
        title: "Nick's Tire Revenue Recovery",
        domain: "BUSINESS",
        status: "ACTIVE",
        priority: 10,
        roiScore: 94,
        neglectCost: 92,
        successMetric: "Recover $18k in dormant customer revenue this month.",
        deadline: addDays(new Date(), 5),
        weeklyReviewNote: "Protect reactivation calls before noon."
      }
    }),
    prisma.mission.create({
      data: {
        title: "STATENOUR OS MVP Launch",
        domain: "CONTENT",
        status: "ACTIVE",
        priority: 9,
        roiScore: 86,
        neglectCost: 73,
        successMetric: "Ship the first live operating console.",
        deadline: addDays(new Date(), 10),
        weeklyReviewNote: "Keep the UI dense and operational."
      }
    }),
    prisma.mission.create({
      data: {
        title: "Physical Baseline Recovery",
        domain: "HEALTH",
        status: "ACTIVE",
        priority: 7,
        roiScore: 68,
        neglectCost: 81,
        successMetric: "Hit 5 workouts and average 7 hours of sleep.",
        deadline: addDays(new Date(), 14)
      }
    })
  ]);

  const missionRanking = rankMissions(missions);
  const missionMap = new Map(missionRanking.rankedMissions.map((mission) => [mission.id, mission]));

  const tasks = [
    {
      id: "seed-task-dormant-vip-calls",
      title: "Call dormant VIP customers from the last 180 days",
      missionId: missions[0].id,
      status: "READY" as const,
      nextPhysicalAction: "Open the dormant VIP call list and dial the first 5 names.",
      effort: "H1" as const,
      roiScore: 92,
      frictionScore: 28,
      energyRequired: "MEDIUM" as const,
      context: "PHONE" as const,
      dueDate: addDays(new Date(), 1),
      finishCondition: "Five calls logged with notes and next steps."
    },
    {
      id: "seed-task-lost-quote-texts",
      title: "Write the first three follow-up texts for lost quotes",
      missionId: missions[0].id,
      status: "DOING" as const,
      nextPhysicalAction: "Draft the first text message and personalize the service hook.",
      effort: "M30" as const,
      roiScore: 81,
      frictionScore: 22,
      energyRequired: "LOW" as const,
      context: "DESK" as const,
      dueDate: addDays(new Date(), 2),
      finishCondition: "Three follow-up texts approved and ready to send."
    },
    {
      id: "seed-task-dashboard-structure",
      title: "Finalize the dashboard route structure",
      missionId: missions[1].id,
      status: "READY" as const,
      nextPhysicalAction: "Create the remaining App Router pages and link them in navigation.",
      effort: "H1" as const,
      roiScore: 84,
      frictionScore: 48,
      energyRequired: "HIGH" as const,
      context: "DESK" as const,
      dueDate: addDays(new Date(), 1),
      finishCondition: "All MVP pages render with live data."
    },
    {
      id: "seed-task-api-tests",
      title: "Backfill API tests for daily brief and weekly profit",
      missionId: missions[1].id,
      status: "INBOX" as const,
      nextPhysicalAction: "Write the route test harness and stub the service functions.",
      effort: "M30" as const,
      roiScore: 72,
      frictionScore: 35,
      energyRequired: "MEDIUM" as const,
      context: "DESK" as const,
      dueDate: addDays(new Date(), 3),
      finishCondition: "Both required route handlers have passing tests."
    },
    {
      id: "seed-task-training-block",
      title: "Book Wednesday training block",
      missionId: missions[2].id,
      status: "READY" as const,
      nextPhysicalAction: "Add the workout session to the calendar and set a reminder.",
      effort: "M15" as const,
      roiScore: 64,
      frictionScore: 18,
      energyRequired: "LOW" as const,
      context: "PHONE" as const,
      dueDate: addDays(new Date(), 2),
      finishCondition: "Workout is scheduled with a hard start time."
    },
    {
      id: "seed-task-clear-stale-spreadsheet",
      title: "Clear the stale brake-quote spreadsheet",
      missionId: missions[0].id,
      status: "READY" as const,
      nextPhysicalAction: "Review the overdue quote rows and archive the dead ones.",
      effort: "M30" as const,
      roiScore: 58,
      frictionScore: 62,
      energyRequired: "LOW" as const,
      context: "DESK" as const,
      dueDate: subDays(new Date(), 2),
      finishCondition: "Spreadsheet trimmed to active opportunities only.",
      lastTouchedAt: subDays(new Date(), 8)
    }
  ];

  for (const task of tasks) {
    const automation = scoreTaskPriority(task, missionMap);
    await prisma.task.create({
      data: {
        ...task,
        autoPriority: automation.score,
        autoPriorityExplanation: automation.explanation,
        lastTouchedAt: task.lastTouchedAt || subDays(new Date(), 1)
      }
    });
  }



  const personalLogs = [
    {
      logDate: subDays(new Date(), 2),
      sleepHours: 6.5,
      energyScore: 6,
      moodScore: 7,
      workoutCompleted: false,
      deepWorkBlocks: 2,
      revenueMoves: 2,
      driftIncidents: 1,
      distractionFlag: false,
      socialFamilyAction: true,
      tomorrowConstraint: "Open the call list by 9:00 AM."
    },
    {
      logDate: subDays(new Date(), 1),
      sleepHours: 5.8,
      energyScore: 5,
      moodScore: 6,
      workoutCompleted: false,
      deepWorkBlocks: 1,
      revenueMoves: 1,
      driftIncidents: 3,
      distractionFlag: true,
      socialFamilyAction: false,
      tomorrowConstraint: "No social scroll before primary mission block."
    },
    {
      logDate: new Date(),
      sleepHours: 7.2,
      energyScore: 7,
      moodScore: 7,
      workoutCompleted: true,
      deepWorkBlocks: 3,
      revenueMoves: 2,
      driftIncidents: 0,
      distractionFlag: false,
      socialFamilyAction: false,
      tomorrowConstraint: "Ship the preview deployment."
    }
  ];

  for (const log of personalLogs) {
    await prisma.personalDailyLog.create({
      data: {
        ...log,
        dailyScore: calculateDailyScore(log)
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
