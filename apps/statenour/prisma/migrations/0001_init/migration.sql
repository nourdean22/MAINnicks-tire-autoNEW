CREATE TYPE "MissionDomain" AS ENUM ('BUSINESS', 'PERSONAL', 'HEALTH', 'CONTENT', 'FINANCE');
CREATE TYPE "MissionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETE', 'KILLED');
CREATE TYPE "TaskStatus" AS ENUM ('INBOX', 'READY', 'DOING', 'WAITING', 'DONE', 'ARCHIVED');
CREATE TYPE "EffortBand" AS ENUM ('M5', 'M15', 'M30', 'H1', 'H2PLUS');
CREATE TYPE "EnergyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "TaskContext" AS ENUM ('DESK', 'PHONE', 'SHOP', 'CAR', 'HOME', 'ANYWHERE');
CREATE TYPE "CustomerRiskStatus" AS ENUM ('HEALTHY', 'AT_RISK', 'DORMANT', 'LOST');
CREATE TYPE "LtvBand" AS ENUM ('LOW', 'MID', 'HIGH', 'VIP');
CREATE TYPE "CustomerFollowUpStage" AS ENUM ('NONE', 'QUEUED', 'SENT', 'RESPONDED', 'BOOKED');
CREATE TYPE "CustomerSegment" AS ENUM ('TIRE', 'REPAIR', 'FLEET', 'PRICE_SHOPPER', 'VIP', 'OTHER');
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE', 'INSTAGRAM', 'PHONE', 'WALK_IN', 'REFERRAL', 'ADS', 'OTHER');
CREATE TYPE "LeadType" AS ENUM ('TIRES', 'BRAKES', 'DIAGNOSTIC', 'OIL', 'REPAIR', 'OTHER');
CREATE TYPE "LeadUrgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'BOOKED', 'LOST', 'DEAD');
CREATE TYPE "ServiceCategory" AS ENUM ('TIRES', 'BRAKES', 'DIAGNOSTIC', 'OIL', 'ALIGNMENT', 'SUSPENSION', 'GENERAL_REPAIR', 'OTHER');

CREATE TABLE "Mission" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "domain" "MissionDomain" NOT NULL,
  "status" "MissionStatus" NOT NULL DEFAULT 'ACTIVE',
  "priority" INTEGER NOT NULL,
  "roiScore" INTEGER NOT NULL,
  "neglectCost" INTEGER NOT NULL,
  "successMetric" TEXT,
  "deadline" TIMESTAMP(3),
  "weeklyReviewNote" TEXT,
  "manualRankOverride" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "status" "TaskStatus" NOT NULL DEFAULT 'INBOX',
  "nextPhysicalAction" TEXT NOT NULL,
  "effort" "EffortBand" NOT NULL,
  "roiScore" INTEGER NOT NULL,
  "frictionScore" INTEGER NOT NULL,
  "energyRequired" "EnergyLevel" NOT NULL,
  "context" "TaskContext" NOT NULL,
  "delegatable" BOOLEAN NOT NULL DEFAULT false,
  "waitingOn" TEXT,
  "dueDate" TIMESTAMP(3),
  "lastTouchedAt" TIMESTAMP(3),
  "driftRisk" INTEGER NOT NULL DEFAULT 0,
  "autoPriority" INTEGER,
  "manualPriorityOverride" INTEGER,
  "autoPriorityExplanation" TEXT,
  "finishCondition" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "vehicle" TEXT,
  "lastVisitDate" TIMESTAMP(3),
  "totalSpend" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "visitCount" INTEGER NOT NULL DEFAULT 0,
  "lastService" TEXT,
  "predictedNextService" TEXT,
  "riskStatus" "CustomerRiskStatus" NOT NULL DEFAULT 'HEALTHY',
  "manualRiskOverride" "CustomerRiskStatus",
  "ltvBand" "LtvBand" NOT NULL DEFAULT 'LOW',
  "reviewRequested" BOOLEAN NOT NULL DEFAULT false,
  "reviewCompleted" BOOLEAN NOT NULL DEFAULT false,
  "followUpStage" "CustomerFollowUpStage" NOT NULL DEFAULT 'NONE',
  "segment" "CustomerSegment" NOT NULL DEFAULT 'OTHER',
  "notes" TEXT,
  "source" TEXT,
  "outreachDraftOverride" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Lead" (
  "id" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "source" "LeadSource" NOT NULL,
  "leadType" "LeadType" NOT NULL DEFAULT 'OTHER',
  "manualLeadTypeOverride" "LeadType",
  "inquiryText" TEXT NOT NULL,
  "urgency" "LeadUrgency" NOT NULL DEFAULT 'MEDIUM',
  "manualUrgencyOverride" "LeadUrgency",
  "valueEstimate" INTEGER,
  "manualValueEstimateOverride" INTEGER,
  "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
  "lastContactAt" TIMESTAMP(3),
  "followUpDueAt" TIMESTAMP(3),
  "objectionType" TEXT,
  "assignedTo" TEXT,
  "outcome" TEXT,
  "bookingValue" INTEGER,
  "timeToResponseMinutes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Job" (
  "id" TEXT NOT NULL,
  "customerId" TEXT,
  "leadId" TEXT,
  "jobDate" TIMESTAMP(3) NOT NULL,
  "serviceCategory" "ServiceCategory" NOT NULL,
  "laborRevenue" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "partsRevenue" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "totalRevenue" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "partsCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "laborCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "estimatedGrossProfit" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "technician" TEXT,
  "timeIn" TIMESTAMP(3),
  "timeOut" TIMESTAMP(3),
  "paymentType" TEXT,
  "reviewRequestSent" BOOLEAN NOT NULL DEFAULT false,
  "upsellOpportunity" BOOLEAN NOT NULL DEFAULT false,
  "repeatVisitExpected" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonalDailyLog" (
  "id" TEXT NOT NULL,
  "logDate" DATE NOT NULL,
  "sleepHours" DECIMAL(4,1),
  "energyScore" INTEGER,
  "moodScore" INTEGER,
  "workoutCompleted" BOOLEAN NOT NULL DEFAULT false,
  "supplements" TEXT,
  "deepWorkBlocks" INTEGER NOT NULL DEFAULT 0,
  "revenueMoves" INTEGER NOT NULL DEFAULT 0,
  "driftIncidents" INTEGER NOT NULL DEFAULT 0,
  "distractionFlag" BOOLEAN NOT NULL DEFAULT false,
  "socialFamilyAction" BOOLEAN NOT NULL DEFAULT false,
  "dailyScore" INTEGER,
  "notes" TEXT,
  "tomorrowConstraint" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalDailyLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonalDailyLog_logDate_key" ON "PersonalDailyLog"("logDate");
CREATE INDEX "Mission_status_priority_deadline_idx" ON "Mission"("status", "priority", "deadline");
CREATE INDEX "Task_missionId_status_dueDate_idx" ON "Task"("missionId", "status", "dueDate");
CREATE INDEX "Task_autoPriority_lastTouchedAt_idx" ON "Task"("autoPriority", "lastTouchedAt");
CREATE INDEX "Customer_lastVisitDate_riskStatus_idx" ON "Customer"("lastVisitDate", "riskStatus");
CREATE INDEX "Customer_ltvBand_followUpStage_segment_idx" ON "Customer"("ltvBand", "followUpStage", "segment");
CREATE INDEX "Lead_status_followUpDueAt_idx" ON "Lead"("status", "followUpDueAt");
CREATE INDEX "Lead_urgency_leadType_idx" ON "Lead"("urgency", "leadType");
CREATE INDEX "Job_jobDate_serviceCategory_idx" ON "Job"("jobDate", "serviceCategory");
CREATE INDEX "Job_customerId_leadId_idx" ON "Job"("customerId", "leadId");
CREATE INDEX "PersonalDailyLog_logDate_idx" ON "PersonalDailyLog"("logDate");

ALTER TABLE "Task" ADD CONSTRAINT "Task_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
