import { PrismaClient } from "@prisma/client";

import { calculateDailyScore } from "@/lib/scoring/daily-score";
import { calculateLtvBand, scanDormantCustomers } from "@/lib/scoring/dormant-customers";
import { parseLeadIntake } from "@/lib/scoring/lead-parser";
import { rankMissions } from "@/lib/scoring/mission-ranking";
import { scoreTaskPriority } from "@/lib/scoring/task-priority";
import { addDays, subDays } from "@/lib/utils/datetime";

const prisma = new PrismaClient();

async function main() {
  await prisma.job.deleteMany();
  await prisma.task.deleteMany();
  await prisma.personalDailyLog.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.customer.deleteMany();
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

  const customerInputs = [
    {
      fullName: "Marcus Hill",
      phone: "555-0140",
      email: "marcus@example.com",
      vehicle: "2020 Ford F-150",
      lastVisitDate: subDays(new Date(), 214),
      totalSpend: 4200,
      visitCount: 7,
      lastService: "All-terrain tire set",
      predictedNextService: "rotation and alignment",
      followUpStage: "QUEUED" as const,
      segment: "VIP" as const,
      notes: "Usually approves work quickly once contacted.",
      source: "Shop counter"
    },
    {
      fullName: "Dana Brooks",
      phone: "555-0174",
      vehicle: "2018 Honda Accord",
      lastVisitDate: subDays(new Date(), 121),
      totalSpend: 980,
      visitCount: 3,
      lastService: "Brake job",
      predictedNextService: "fluid service",
      followUpStage: "NONE" as const,
      segment: "REPAIR" as const,
      source: "Website"
    },
    {
      fullName: "Eddie Fleet Services",
      phone: "555-0166",
      lastVisitDate: subDays(new Date(), 392),
      totalSpend: 6900,
      visitCount: 10,
      lastService: "Fleet tire rotation",
      predictedNextService: "fleet inspection",
      followUpStage: "SENT" as const,
      segment: "FLEET" as const,
      source: "Referral"
    }
  ];

  for (const input of customerInputs) {
    const ltvBand = calculateLtvBand(input.totalSpend, input.visitCount);
    const automation = scanDormantCustomers([
      {
        id: "seed",
        fullName: input.fullName,
        lastVisitDate: input.lastVisitDate,
        totalSpend: input.totalSpend,
        visitCount: input.visitCount,
        lastService: input.lastService,
        predictedNextService: input.predictedNextService,
        ltvBand
      }
    ])[0];

    await prisma.customer.create({
      data: {
        ...input,
        ltvBand,
        riskStatus: automation.automatedRiskStatus
      }
    });
  }

  const leadInputs = [
    {
      fullName: "Sarah Wells",
      source: "PHONE" as const,
      inquiryText: "Need brakes today, they are grinding hard and I do not feel safe driving.",
      status: "NEW" as const
    },
    {
      fullName: "Jordan Pierce",
      source: "INSTAGRAM" as const,
      inquiryText: "Looking for a quote on 35 inch tires for my truck next week.",
      status: "CONTACTED" as const
    },
    {
      fullName: "Mike Dawson",
      source: "WEBSITE" as const,
      inquiryText: "Check engine light came on and the car shakes on startup.",
      status: "NEW" as const
    }
  ];

  const createdLeads = [];
  for (const input of leadInputs) {
    const parser = parseLeadIntake(input.inquiryText);
    const lead = await prisma.lead.create({
      data: {
        ...input,
        leadType: parser.leadType,
        urgency: parser.urgency,
        valueEstimate: parser.valueEstimate,
        followUpDueAt: addDays(new Date(), parser.urgency === "HIGH" ? 1 : 3)
      }
    });

    createdLeads.push(lead);
  }

  const customers = await prisma.customer.findMany();

  const jobInputs = [
    {
      customerId: customers[0].id,
      leadId: createdLeads[0].id,
      jobDate: subDays(new Date(), 1),
      serviceCategory: "BRAKES" as const,
      laborRevenue: 520,
      partsRevenue: 430,
      partsCost: 260,
      laborCost: 180,
      technician: "Luis",
      paymentType: "Card",
      reviewRequestSent: true,
      upsellOpportunity: true
    },
    {
      customerId: customers[1].id,
      leadId: createdLeads[2].id,
      jobDate: subDays(new Date(), 3),
      serviceCategory: "DIAGNOSTIC" as const,
      laborRevenue: 180,
      partsRevenue: 0,
      partsCost: 0,
      laborCost: 70,
      technician: "Mo",
      paymentType: "Cash",
      reviewRequestSent: false,
      repeatVisitExpected: true
    },
    {
      customerId: customers[0].id,
      jobDate: subDays(new Date(), 5),
      serviceCategory: "TIRES" as const,
      laborRevenue: 240,
      partsRevenue: 1180,
      partsCost: 760,
      laborCost: 140,
      technician: "Luis",
      paymentType: "Card",
      reviewRequestSent: true
    },
    {
      customerId: customers[2].id,
      jobDate: subDays(new Date(), 6),
      serviceCategory: "ALIGNMENT" as const,
      laborRevenue: 140,
      partsRevenue: 0,
      partsCost: 0,
      laborCost: 60,
      technician: "Ana",
      paymentType: "Invoice",
      reviewRequestSent: false
    }
  ];

  for (const input of jobInputs) {
    const totalRevenue = input.laborRevenue + input.partsRevenue;
    const estimatedGrossProfit = totalRevenue - (input.partsCost + input.laborCost);

    await prisma.job.create({
      data: {
        ...input,
        totalRevenue,
        estimatedGrossProfit
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
