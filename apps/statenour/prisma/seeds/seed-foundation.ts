/**
 * Foundation Seed — Real data from Nour's actual backlog
 * Seeds missions, tasks, commitments, and daily scores.
 * Run: npx tsx prisma/seeds/seed-foundation.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log("Seeding foundation data...");

  // ─── MISSIONS ──────────────────────────
  const missions = [
    { id: "m-shop-ops", title: "Nick's Tire Daily Operations", domain: "BUSINESS" as const, priority: 1, roiScore: 10, neglectCost: 10, successMetric: "Revenue target hit, all callbacks done" },
    { id: "m-nour-os", title: "NOUR OS Development", domain: "BUSINESS" as const, priority: 2, roiScore: 8, neglectCost: 6, successMetric: "System fully operational, all pages functional" },
    { id: "m-marketing", title: "Marketing & Growth", domain: "CONTENT" as const, priority: 3, roiScore: 7, neglectCost: 5, successMetric: "Consistent posting, lead gen active" },
    { id: "m-health", title: "Health & Discipline", domain: "HEALTH" as const, priority: 4, roiScore: 9, neglectCost: 8, successMetric: "Daily score 5/5, walk done, breathing practice" },
    { id: "m-finance", title: "Financial Control", domain: "FINANCE" as const, priority: 5, roiScore: 7, neglectCost: 7, successMetric: "Monthly take-home defined, expenses tracked" },
    { id: "m-personal", title: "Personal Development", domain: "PERSONAL" as const, priority: 6, roiScore: 6, neglectCost: 4, successMetric: "Journal done, Spanish practice, weekly review" },
  ];

  for (const m of missions) {
    await prisma.mission.upsert({
      where: { id: m.id },
      create: m,
      update: { title: m.title, priority: m.priority },
    });
  }
  console.log(`Missions: ${missions.length} upserted`);

  // ─── TASKS ──────────────────────────
  const tasks = [
    { title: "Follow up estimate 1613 — HUGGINS CINA — 2011 Honda CRV", missionId: "m-shop-ops", nextPhysicalAction: "Call (216) xxx-xxxx, lead with value, reference brake safety", effort: "M15" as const, roiScore: 10, frictionScore: 3, energyRequired: "MEDIUM" as const, context: "PHONE" as const, dueDate: new Date("2026-03-30"), finishCondition: "Customer approves or explicitly declines" },
    { title: "Verify nickstire.org loads from external network", missionId: "m-shop-ops", nextPhysicalAction: "Open nickstire.org on phone data (not wifi), check all main pages load", effort: "M5" as const, roiScore: 9, frictionScore: 1, energyRequired: "LOW" as const, context: "PHONE" as const, dueDate: new Date("2026-03-30"), finishCondition: "All public pages return 200, no 403s" },
    { title: "Fill tire page — flat repair $15-25, used tires, 215/60R16 inventory", missionId: "m-marketing", nextPhysicalAction: "Write 3 paragraphs of tire service content with pricing", effort: "M30" as const, roiScore: 7, frictionScore: 4, energyRequired: "MEDIUM" as const, context: "DESK" as const, dueDate: new Date("2026-03-31"), finishCondition: "Tire page has real content and pricing" },
    { title: "Post on Instagram — before/after job photo", missionId: "m-marketing", nextPhysicalAction: "Take photo of next completed job, write caption, post", effort: "M15" as const, roiScore: 6, frictionScore: 2, energyRequired: "LOW" as const, context: "SHOP" as const, dueDate: new Date("2026-03-30"), finishCondition: "Post is live on Instagram" },
    { title: "Start local NOUR OS agent on Windows PC", missionId: "m-nour-os", nextPhysicalAction: "Open terminal, cd to agent directory, run start script", effort: "M15" as const, roiScore: 8, frictionScore: 3, energyRequired: "LOW" as const, context: "DESK" as const, dueDate: new Date("2026-03-31"), finishCondition: "Agent shows green in system status" },
    { title: "Set TELEGRAM_CHAT_ID + BOT_TOKEN on Railway", missionId: "m-nour-os", nextPhysicalAction: "Create Telegram bot via BotFather, get chat ID, add to Railway env vars", effort: "M15" as const, roiScore: 7, frictionScore: 2, energyRequired: "LOW" as const, context: "DESK" as const, dueDate: new Date("2026-04-01"), finishCondition: "Telegram alerts fire on new leads" },
    { title: "Check Google Ads dashboard — CPL and lead count", missionId: "m-shop-ops", nextPhysicalAction: "Open Google Ads, check last 7 days CPL, pause underperforming campaigns", effort: "M15" as const, roiScore: 8, frictionScore: 2, energyRequired: "LOW" as const, context: "DESK" as const, dueDate: new Date("2026-03-30"), finishCondition: "Know this week's CPL and total spend" },
    { title: "30-minute walk — nasal breathing only", missionId: "m-health", nextPhysicalAction: "Put on shoes, walk around the block, breathe only through nose", effort: "M30" as const, roiScore: 8, frictionScore: 2, energyRequired: "LOW" as const, context: "ANYWHERE" as const, dueDate: new Date("2026-03-30"), finishCondition: "30 minutes of nasal-only walking complete" },
    { title: "Journal entry — 3 sentences max", missionId: "m-personal", nextPhysicalAction: "Open notes app, write 3 sentences about today", effort: "M5" as const, roiScore: 5, frictionScore: 1, energyRequired: "LOW" as const, context: "ANYWHERE" as const, dueDate: new Date("2026-03-30"), finishCondition: "3 sentences written" },
    { title: "Weekly review — score last week 1-10, set top 3 priorities", missionId: "m-personal", nextPhysicalAction: "Open NOUR OS, reflect on last week, score it, define 3 priorities", effort: "M30" as const, roiScore: 7, frictionScore: 3, energyRequired: "MEDIUM" as const, context: "DESK" as const, dueDate: new Date("2026-03-30"), finishCondition: "Score written, 3 priorities defined" },
    { title: "Define monthly take-home pay target", missionId: "m-finance", nextPhysicalAction: "Calculate: revenue - expenses - reinvestment = take-home goal", effort: "M30" as const, roiScore: 8, frictionScore: 4, energyRequired: "MEDIUM" as const, context: "DESK" as const, dueDate: new Date("2026-04-01"), finishCondition: "Monthly target number defined and written down" },
    { title: "Order NFC review cards — 10 cards, $100-150", missionId: "m-marketing", nextPhysicalAction: "Search Amazon/Etsy for NFC Google review cards, order 10", effort: "M15" as const, roiScore: 6, frictionScore: 2, energyRequired: "LOW" as const, context: "DESK" as const, dueDate: new Date("2026-04-05"), finishCondition: "Order placed and confirmed" },
    { title: "Fix NAP citations — BBB, Birdeye, Yelp, Facebook still show old name", missionId: "m-marketing", nextPhysicalAction: "Go to each site, update business name/address/phone to Nick's Tire", effort: "H1" as const, roiScore: 7, frictionScore: 5, energyRequired: "MEDIUM" as const, context: "DESK" as const, dueDate: new Date("2026-04-07"), finishCondition: "All major citations show Nick's Tire & Auto" },
    { title: "Get bloodwork — testosterone, thyroid, vitamin D, metabolic panel", missionId: "m-health", nextPhysicalAction: "Call doctor, schedule blood draw appointment", effort: "M15" as const, roiScore: 7, frictionScore: 3, energyRequired: "LOW" as const, context: "PHONE" as const, dueDate: new Date("2026-04-15"), finishCondition: "Appointment scheduled or blood drawn" },
  ];

  let taskCount = 0;
  for (const t of tasks) {
    const existing = await prisma.task.findFirst({ where: { title: t.title } });
    if (!existing) {
      await prisma.task.create({ data: { ...t, status: "READY" } });
      taskCount++;
    }
  }
  console.log(`Tasks: ${taskCount} created (${tasks.length - taskCount} already existed)`);

  // ─── DAILY SCORES — last 8 days, all zeros ──────
  let scoreCount = 0;
  for (let i = 7; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const existing = await prisma.dailyScore.findUnique({ where: { date: dateStr } });
    if (!existing) {
      await prisma.dailyScore.create({
        data: {
          date: dateStr,
          workoutDone: false,
          journalDone: false,
          overallScore: 0,
        },
      });
      scoreCount++;
    }
  }
  console.log(`Daily scores: ${scoreCount} created`);

  // ─── COMMITMENTS ──────────────────────
  const commitments = [
    { description: "Post on Instagram daily", domain: "business", dateMade: "2026-03-28" },
    { description: "Walk 30 min every day — nasal breathing only", domain: "health", dateMade: "2026-03-28" },
    { description: "Complete 5 daily non-negotiables", domain: "personal", dateMade: "2026-03-28" },
    { description: "Fixed wake time 7:00 AM", domain: "personal", dateMade: "2026-03-28" },
    { description: "Night shutdown by 10:30 PM", domain: "personal", dateMade: "2026-03-28" },
    { description: "Nasal breathing 24/7 — mouth tape at night", domain: "health", dateMade: "2026-03-28" },
    { description: "No social media or YouTube before noon", domain: "personal", dateMade: "2026-03-28" },
    { description: "Spanish — 10 min/day", domain: "personal", dateMade: "2026-03-28" },
  ];

  let commitCount = 0;
  for (const c of commitments) {
    const existing = await prisma.commitment.findFirst({ where: { description: c.description } });
    if (!existing) {
      await prisma.commitment.create({ data: { ...c, toWhom: "self", status: "active" } });
      commitCount++;
    }
  }
  console.log(`Commitments: ${commitCount} created`);

  // ─── SUMMARY ──────────────────────
  const totalTasks = await prisma.task.count();
  const totalScores = await prisma.dailyScore.count();
  const totalCommitments = await prisma.commitment.count();
  const totalLaws = await prisma.strategicLaw.count();

  console.log("\n═══ FOUNDATION SEED COMPLETE ═══");
  console.log(`Tasks: ${totalTasks}`);
  console.log(`Daily Scores: ${totalScores}`);
  console.log(`Commitments: ${totalCommitments}`);
  console.log(`Strategic Laws: ${totalLaws}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
