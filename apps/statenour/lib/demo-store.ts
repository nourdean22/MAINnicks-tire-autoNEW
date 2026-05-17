import { randomUUID } from "node:crypto";

import { calculateLtvBand, scanDormantCustomers } from "@/lib/scoring/dormant-customers";
import { parseLeadIntake } from "@/lib/scoring/lead-parser";
import { rankMissions } from "@/lib/scoring/mission-ranking";
import { scoreTaskPriority } from "@/lib/scoring/task-priority";
import { addDays, subDays } from "@/lib/utils/datetime";
import { clamp } from "@/lib/utils/format";

// Apr 18: DailyScore module retired. Inline the old scoring fn so the
// demo surface still produces plausible numbers for seeded logs.
function calculateDailyScore(input: {
  sleepHours?: number | null;
  energyScore?: number | null;
  moodScore?: number | null;
  workoutCompleted: boolean;
  deepWorkBlocks: number;
  revenueMoves: number;
  driftIncidents: number;
  distractionFlag: boolean;
  socialFamilyAction: boolean;
}): number {
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

export type DemoMission = {
  id: string;
  title: string;
  domain: string;
  status: string;
  priority: number;
  roiScore: number;
  neglectCost: number;
  successMetric: string | null;
  deadline: Date | null;
  weeklyReviewNote: string | null;
  manualRankOverride: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoTask = {
  id: string;
  title: string;
  missionId: string;
  status: string;
  nextPhysicalAction: string;
  effort: string;
  roiScore: number;
  frictionScore: number;
  energyRequired: string;
  context: string;
  delegatable: boolean;
  waitingOn: string | null;
  dueDate: Date | null;
  lastTouchedAt: Date | null;
  driftRisk: number;
  autoPriority: number | null;
  manualPriorityOverride: number | null;
  autoPriorityExplanation: string | null;
  finishCondition: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoCustomer = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  vehicle: string | null;
  lastVisitDate: Date | null;
  totalSpend: number;
  visitCount: number;
  lastService: string | null;
  predictedNextService: string | null;
  riskStatus: string;
  manualRiskOverride: string | null;
  ltvBand: string;
  reviewRequested: boolean;
  reviewCompleted: boolean;
  followUpStage: string;
  segment: string;
  notes: string | null;
  source: string | null;
  outreachDraftOverride: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoLead = {
  id: string;
  fullName: string;
  source: string;
  leadType: string;
  manualLeadTypeOverride: string | null;
  inquiryText: string;
  urgency: string;
  manualUrgencyOverride: string | null;
  valueEstimate: number | null;
  manualValueEstimateOverride: number | null;
  status: string;
  lastContactAt: Date | null;
  followUpDueAt: Date | null;
  objectionType: string | null;
  assignedTo: string | null;
  outcome: string | null;
  bookingValue: number | null;
  timeToResponseMinutes: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoJob = {
  id: string;
  customerId: string | null;
  leadId: string | null;
  jobDate: Date;
  serviceCategory: string;
  laborRevenue: number;
  partsRevenue: number;
  totalRevenue: number;
  partsCost: number;
  laborCost: number;
  estimatedGrossProfit: number;
  technician: string | null;
  timeIn: Date | null;
  timeOut: Date | null;
  paymentType: string | null;
  reviewRequestSent: boolean;
  upsellOpportunity: boolean;
  repeatVisitExpected: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoPersonalDailyLog = {
  id: string;
  logDate: Date;
  sleepHours: number | null;
  energyScore: number | null;
  moodScore: number | null;
  workoutCompleted: boolean;
  supplements: string | null;
  deepWorkBlocks: number;
  revenueMoves: number;
  driftIncidents: number;
  distractionFlag: boolean;
  socialFamilyAction: boolean;
  dailyScore: number | null;
  notes: string | null;
  tomorrowConstraint: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DemoState = {
  missions: DemoMission[];
  tasks: DemoTask[];
  customers: DemoCustomer[];
  leads: DemoLead[];
  jobs: DemoJob[];
  personalLogs: DemoPersonalDailyLog[];
};

declare global {
  var __statenourDemoState: DemoState | undefined;
}

function createDemoState(now = new Date()): DemoState {
  const missions: DemoMission[] = [
    {
      id: "demo-mission-revenue-recovery",
      title: "Nick's Tire Revenue Recovery",
      domain: "BUSINESS",
      status: "ACTIVE",
      priority: 10,
      roiScore: 94,
      neglectCost: 92,
      successMetric: "Recover $18k in dormant customer revenue this month.",
      deadline: addDays(now, 5),
      weeklyReviewNote: "Protect reactivation calls before noon.",
      manualRankOverride: null,
      createdAt: subDays(now, 14),
      updatedAt: subDays(now, 1)
    },
    {
      id: "demo-mission-os-mvp",
      title: "STATENOUR OS MVP Launch",
      domain: "CONTENT",
      status: "ACTIVE",
      priority: 9,
      roiScore: 86,
      neglectCost: 73,
      successMetric: "Ship the first live operating console.",
      deadline: addDays(now, 10),
      weeklyReviewNote: "Keep the UI dense and operational.",
      manualRankOverride: null,
      createdAt: subDays(now, 10),
      updatedAt: subDays(now, 1)
    },
    {
      id: "demo-mission-physical-baseline",
      title: "Physical Baseline Recovery",
      domain: "HEALTH",
      status: "PAUSED",
      priority: 7,
      roiScore: 68,
      neglectCost: 81,
      successMetric: "Hit 5 workouts and average 7 hours of sleep.",
      deadline: addDays(now, 14),
      weeklyReviewNote: null,
      manualRankOverride: null,
      createdAt: subDays(now, 9),
      updatedAt: subDays(now, 3)
    }
  ];

  const missionRanking = rankMissions(missions);
  const missionMap = new Map(missionRanking.rankedMissions.map((mission) => [mission.id, mission]));

  const tasks: DemoTask[] = [
    {
      id: "demo-task-dormant-vip-calls",
      title: "Call dormant VIP customers from the last 180 days",
      missionId: missions[0].id,
      status: "READY",
      nextPhysicalAction: "Open the dormant VIP call list and dial the first 5 names.",
      effort: "H1",
      roiScore: 92,
      frictionScore: 28,
      energyRequired: "MEDIUM",
      context: "PHONE",
      delegatable: false,
      waitingOn: null,
      dueDate: addDays(now, 1),
      lastTouchedAt: subDays(now, 1),
      driftRisk: 12,
      manualPriorityOverride: null,
      finishCondition: "Five calls logged with notes and next steps.",
      createdAt: subDays(now, 7),
      updatedAt: subDays(now, 1),
      autoPriority: null,
      autoPriorityExplanation: null
    },
    {
      id: "demo-task-lost-quote-texts",
      title: "Write the first three follow-up texts for lost quotes",
      missionId: missions[0].id,
      status: "DOING",
      nextPhysicalAction: "Draft the first text message and personalize the service hook.",
      effort: "M30",
      roiScore: 81,
      frictionScore: 22,
      energyRequired: "LOW",
      context: "DESK",
      delegatable: false,
      waitingOn: null,
      dueDate: addDays(now, 2),
      lastTouchedAt: subDays(now, 1),
      driftRisk: 8,
      manualPriorityOverride: null,
      finishCondition: "Three follow-up texts approved and ready to send.",
      createdAt: subDays(now, 6),
      updatedAt: subDays(now, 1),
      autoPriority: null,
      autoPriorityExplanation: null
    },
    {
      id: "demo-task-dashboard-structure",
      title: "Finalize the dashboard route structure",
      missionId: missions[1].id,
      status: "READY",
      nextPhysicalAction: "Create the remaining App Router pages and link them in navigation.",
      effort: "H1",
      roiScore: 84,
      frictionScore: 48,
      energyRequired: "HIGH",
      context: "DESK",
      delegatable: false,
      waitingOn: null,
      dueDate: addDays(now, 1),
      lastTouchedAt: subDays(now, 2),
      driftRisk: 18,
      manualPriorityOverride: null,
      finishCondition: "All MVP pages render with live data.",
      createdAt: subDays(now, 5),
      updatedAt: subDays(now, 2),
      autoPriority: null,
      autoPriorityExplanation: null
    },
    {
      id: "demo-task-api-tests",
      title: "Backfill API tests for daily brief and weekly profit",
      missionId: missions[1].id,
      status: "INBOX",
      nextPhysicalAction: "Write the route test harness and stub the service functions.",
      effort: "M30",
      roiScore: 72,
      frictionScore: 35,
      energyRequired: "MEDIUM",
      context: "DESK",
      delegatable: false,
      waitingOn: null,
      dueDate: addDays(now, 3),
      lastTouchedAt: subDays(now, 4),
      driftRisk: 20,
      manualPriorityOverride: null,
      finishCondition: "Both required route handlers have passing tests.",
      createdAt: subDays(now, 4),
      updatedAt: subDays(now, 3),
      autoPriority: null,
      autoPriorityExplanation: null
    },
    {
      id: "demo-task-training-block",
      title: "Book Wednesday training block",
      missionId: missions[2].id,
      status: "READY",
      nextPhysicalAction: "Add the workout session to the calendar and set a reminder.",
      effort: "M15",
      roiScore: 64,
      frictionScore: 18,
      energyRequired: "LOW",
      context: "PHONE",
      delegatable: false,
      waitingOn: null,
      dueDate: addDays(now, 2),
      lastTouchedAt: subDays(now, 3),
      driftRisk: 16,
      manualPriorityOverride: null,
      finishCondition: "Workout is scheduled with a hard start time.",
      createdAt: subDays(now, 4),
      updatedAt: subDays(now, 2),
      autoPriority: null,
      autoPriorityExplanation: null
    },
    {
      id: "demo-task-clear-stale-spreadsheet",
      title: "Clear the stale brake-quote spreadsheet",
      missionId: missions[0].id,
      status: "READY",
      nextPhysicalAction: "Review the overdue quote rows and archive the dead ones.",
      effort: "M30",
      roiScore: 58,
      frictionScore: 62,
      energyRequired: "LOW",
      context: "DESK",
      delegatable: false,
      waitingOn: null,
      dueDate: subDays(now, 2),
      lastTouchedAt: subDays(now, 8),
      driftRisk: 58,
      manualPriorityOverride: null,
      finishCondition: "Spreadsheet trimmed to active opportunities only.",
      createdAt: subDays(now, 11),
      updatedAt: subDays(now, 8),
      autoPriority: null,
      autoPriorityExplanation: null
    },
    {
      id: "demo-task-close-yesterday-loop",
      title: "Close the callback list from yesterday",
      missionId: missions[0].id,
      status: "DONE",
      nextPhysicalAction: "Review call notes and mark completed follow-ups done.",
      effort: "M15",
      roiScore: 76,
      frictionScore: 24,
      energyRequired: "LOW",
      context: "PHONE",
      delegatable: false,
      waitingOn: null,
      dueDate: subDays(now, 1),
      lastTouchedAt: subDays(now, 1),
      driftRisk: 5,
      manualPriorityOverride: null,
      finishCondition: "All callbacks logged and queued correctly.",
      createdAt: subDays(now, 3),
      updatedAt: subDays(now, 1),
      autoPriority: 0,
      autoPriorityExplanation: "Completed task."
    }
  ].map((task) => {
    if (["DONE", "ARCHIVED"].includes(task.status)) {
      return task;
    }

    const automation = scoreTaskPriority(task, missionMap);

    return {
      ...task,
      autoPriority: automation.score,
      autoPriorityExplanation: automation.explanation
    };
  });

  const customers: DemoCustomer[] = [
    {
      id: "demo-customer-marcus-hill",
      fullName: "Marcus Hill",
      phone: "555-0140",
      email: "marcus@example.com",
      vehicle: "2020 Ford F-150",
      lastVisitDate: subDays(now, 214),
      totalSpend: 4200,
      visitCount: 7,
      lastService: "All-terrain tire set",
      predictedNextService: "Rotation and alignment",
      manualRiskOverride: null,
      reviewRequested: true,
      reviewCompleted: true,
      followUpStage: "QUEUED",
      segment: "VIP",
      notes: "Usually approves work quickly once contacted.",
      source: "Shop counter",
      outreachDraftOverride: null,
      ltvBand: "VIP",
      riskStatus: "HEALTHY",
      createdAt: subDays(now, 120),
      updatedAt: subDays(now, 4)
    },
    {
      id: "demo-customer-dana-brooks",
      fullName: "Dana Brooks",
      phone: "555-0174",
      email: null,
      vehicle: "2018 Honda Accord",
      lastVisitDate: subDays(now, 121),
      totalSpend: 980,
      visitCount: 3,
      lastService: "Brake job",
      predictedNextService: "Fluid service",
      manualRiskOverride: null,
      reviewRequested: false,
      reviewCompleted: false,
      followUpStage: "NONE",
      segment: "REPAIR",
      notes: null,
      source: "Website",
      outreachDraftOverride: null,
      ltvBand: "MID",
      riskStatus: "HEALTHY",
      createdAt: subDays(now, 90),
      updatedAt: subDays(now, 6)
    },
    {
      id: "demo-customer-eddie-fleet",
      fullName: "Eddie Fleet Services",
      phone: "555-0166",
      email: "ops@eddiefleet.example.com",
      vehicle: "Mixed fleet",
      lastVisitDate: subDays(now, 392),
      totalSpend: 6900,
      visitCount: 10,
      lastService: "Fleet tire rotation",
      predictedNextService: "Fleet inspection",
      manualRiskOverride: null,
      reviewRequested: false,
      reviewCompleted: false,
      followUpStage: "SENT",
      segment: "FLEET",
      notes: "Decision maker prefers concise scheduling text.",
      source: "Referral",
      outreachDraftOverride:
        "Eddie, your fleet rotation cadence is overdue. I can hold two inspection slots this week if you want the fastest path back on schedule.",
      ltvBand: "VIP",
      riskStatus: "HEALTHY",
      createdAt: subDays(now, 160),
      updatedAt: subDays(now, 7)
    }
  ].map((customer) => {
    const ltvBand = calculateLtvBand(customer.totalSpend, customer.visitCount);
    const automation = scanDormantCustomers([
      {
        id: customer.id,
        fullName: customer.fullName,
        lastVisitDate: customer.lastVisitDate,
        totalSpend: customer.totalSpend,
        visitCount: customer.visitCount,
        lastService: customer.lastService,
        predictedNextService: customer.predictedNextService,
        manualRiskOverride: customer.manualRiskOverride,
        outreachDraftOverride: customer.outreachDraftOverride,
        ltvBand
      }
    ])[0];

    return {
      ...customer,
      ltvBand,
      riskStatus: automation.automatedRiskStatus
    };
  });

  const leads: DemoLead[] = (
    [
      {
        id: "demo-lead-sarah-wells",
        fullName: "Sarah Wells",
        source: "PHONE",
        inquiryText: "Need brakes today, they are grinding hard and I do not feel safe driving.",
        status: "NEW",
        createdAt: subDays(now, 1),
        updatedAt: subDays(now, 1)
      },
      {
        id: "demo-lead-jordan-pierce",
        fullName: "Jordan Pierce",
        source: "INSTAGRAM",
        inquiryText: "Looking for a quote on 35 inch tires for my truck next week.",
        status: "CONTACTED",
        createdAt: subDays(now, 2),
        updatedAt: subDays(now, 2)
      },
      {
        id: "demo-lead-mike-dawson",
        fullName: "Mike Dawson",
        source: "WEBSITE",
        inquiryText: "Check engine light came on and the car shakes on startup.",
        status: "NEW",
        createdAt: subDays(now, 3),
        updatedAt: subDays(now, 2)
      }
    ] as Array<Pick<DemoLead, "id" | "fullName" | "source" | "inquiryText" | "status" | "createdAt" | "updatedAt">>
  ).map((lead): DemoLead => {
    const parser = parseLeadIntake(lead.inquiryText);
    const dueOffset = parser.urgency === "HIGH" ? 1 : parser.urgency === "LOW" ? 5 : 3;

    return {
      ...lead,
      leadType: parser.leadType,
      manualLeadTypeOverride: null,
      urgency: parser.urgency,
      manualUrgencyOverride: null,
      valueEstimate: parser.valueEstimate,
      manualValueEstimateOverride: null,
      lastContactAt: null,
      followUpDueAt: addDays(now, dueOffset),
      objectionType: null,
      assignedTo: "Nourd",
      outcome: null,
      bookingValue: null,
      timeToResponseMinutes: parser.urgency === "HIGH" ? 12 : 45
    };
  });

  const jobs: DemoJob[] = [
    {
      id: "demo-job-brakes-sarah",
      customerId: customers[0].id,
      leadId: leads[0].id,
      jobDate: subDays(now, 1),
      serviceCategory: "BRAKES",
      laborRevenue: 520,
      partsRevenue: 430,
      partsCost: 260,
      laborCost: 180,
      technician: "Luis",
      paymentType: "Card",
      reviewRequestSent: true,
      upsellOpportunity: true,
      repeatVisitExpected: false,
      timeIn: null,
      timeOut: null,
      notes: null,
      totalRevenue: 950,
      estimatedGrossProfit: 510,
      createdAt: subDays(now, 1),
      updatedAt: subDays(now, 1)
    },
    {
      id: "demo-job-diagnostic-mike",
      customerId: customers[1].id,
      leadId: leads[2].id,
      jobDate: subDays(now, 3),
      serviceCategory: "DIAGNOSTIC",
      laborRevenue: 180,
      partsRevenue: 0,
      partsCost: 0,
      laborCost: 70,
      technician: "Mo",
      paymentType: "Cash",
      reviewRequestSent: false,
      upsellOpportunity: false,
      repeatVisitExpected: true,
      timeIn: null,
      timeOut: null,
      notes: null,
      totalRevenue: 180,
      estimatedGrossProfit: 110,
      createdAt: subDays(now, 3),
      updatedAt: subDays(now, 3)
    },
    {
      id: "demo-job-tires-marcus",
      customerId: customers[0].id,
      leadId: null,
      jobDate: subDays(now, 5),
      serviceCategory: "TIRES",
      laborRevenue: 240,
      partsRevenue: 1180,
      partsCost: 760,
      laborCost: 140,
      technician: "Luis",
      paymentType: "Card",
      reviewRequestSent: true,
      upsellOpportunity: false,
      repeatVisitExpected: false,
      timeIn: null,
      timeOut: null,
      notes: null,
      totalRevenue: 1420,
      estimatedGrossProfit: 520,
      createdAt: subDays(now, 5),
      updatedAt: subDays(now, 5)
    },
    {
      id: "demo-job-alignment-fleet",
      customerId: customers[2].id,
      leadId: null,
      jobDate: subDays(now, 6),
      serviceCategory: "ALIGNMENT",
      laborRevenue: 140,
      partsRevenue: 0,
      partsCost: 0,
      laborCost: 60,
      technician: "Ana",
      paymentType: "Invoice",
      reviewRequestSent: false,
      upsellOpportunity: false,
      repeatVisitExpected: false,
      timeIn: null,
      timeOut: null,
      notes: null,
      totalRevenue: 140,
      estimatedGrossProfit: 80,
      createdAt: subDays(now, 6),
      updatedAt: subDays(now, 6)
    }
  ];

  const personalLogs: DemoPersonalDailyLog[] = [
    {
      id: "demo-log-1",
      logDate: subDays(now, 3),
      sleepHours: 6.5,
      energyScore: 6,
      moodScore: 7,
      workoutCompleted: false,
      supplements: null,
      deepWorkBlocks: 2,
      revenueMoves: 2,
      driftIncidents: 1,
      distractionFlag: false,
      socialFamilyAction: true,
      notes: null,
      tomorrowConstraint: "Open the call list by 9:00 AM.",
      dailyScore: null,
      createdAt: subDays(now, 3),
      updatedAt: subDays(now, 3)
    },
    {
      id: "demo-log-2",
      logDate: subDays(now, 2),
      sleepHours: 5.8,
      energyScore: 5,
      moodScore: 6,
      workoutCompleted: false,
      supplements: null,
      deepWorkBlocks: 1,
      revenueMoves: 1,
      driftIncidents: 3,
      distractionFlag: true,
      socialFamilyAction: false,
      notes: null,
      tomorrowConstraint: "No social scroll before primary mission block.",
      dailyScore: null,
      createdAt: subDays(now, 2),
      updatedAt: subDays(now, 2)
    },
    {
      id: "demo-log-3",
      logDate: subDays(now, 1),
      sleepHours: 7.2,
      energyScore: 7,
      moodScore: 7,
      workoutCompleted: true,
      supplements: null,
      deepWorkBlocks: 3,
      revenueMoves: 2,
      driftIncidents: 0,
      distractionFlag: false,
      socialFamilyAction: false,
      notes: null,
      tomorrowConstraint: "Ship the preview deployment.",
      dailyScore: null,
      createdAt: subDays(now, 1),
      updatedAt: subDays(now, 1)
    }
  ].map((log) => ({
    ...log,
    dailyScore: calculateDailyScore(log)
  }));

  return {
    missions,
    tasks,
    customers,
    leads,
    jobs,
    personalLogs
  };
}

export function getDemoState() {
  if (!globalThis.__statenourDemoState) {
    globalThis.__statenourDemoState = createDemoState();
  }

  return globalThis.__statenourDemoState;
}

export function makeDemoId(prefix: string) {
  return `demo-${prefix}-${randomUUID().slice(0, 8)}`;
}
