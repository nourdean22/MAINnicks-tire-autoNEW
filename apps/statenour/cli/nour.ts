#!/usr/bin/env npx tsx
/**
 * NOUR OS CLI — Command Center Terminal Interface
 * Usage: npx tsx cli/nour.ts <command> [args]
 * Commands: status, drift, streaks, score, loop, commit
 */
import { prisma } from "../lib/prisma";
import readline from "readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

function today() {
  return new Date();
}

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// === COMMANDS ===

async function cmdStatus() {
  const [dailyLog, alerts, openLoops, activeCommitments, snapshots] = await Promise.all([
    prisma.personalDailyLog.findFirst({
      orderBy: { logDate: "desc" },
    }),
    prisma.brainMemory.findMany({
      where: {
        category: "coach_event",
        key: { startsWith: "coach:drift-recovery:" },
        deletedAt: null,
      },
      select: { metadata: true },
    }).then((rows) =>
      rows.filter((r) => {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        return !meta.ackedAt;
      }).length
    ).catch(() => 0),
    prisma.task.count({
      where: { status: { in: ["INBOX", "READY", "DOING", "WAITING"] }, loopKind: "ONCE" },
    }),
    prisma.task.count({
      where: { status: { in: ["INBOX", "READY", "DOING", "WAITING"] }, loopKind: "PROMISE" },
    }),
    prisma.systemSnapshot.findFirst({
      orderBy: { generatedAt: "desc" },
    })
  ]);

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║         NOUR OS — STATUS             ║");
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`  📅 Today:           ${today().toLocaleDateString("en-US", { weekday: 'short', month: 'short', day: 'numeric' })}`);
  console.log(`  📊 Last Score:      ${dailyLog?.dailyScore ? `${dailyLog.dailyScore}/10 (Energy: ${dailyLog.energyScore})` : "NOT LOGGED"}`);
  console.log(`  🚨 Drift Alerts:    ${alerts > 0 ? `\x1b[31m${alerts} ACTIVE\x1b[0m` : "\x1b[32mCLEAR ✓\x1b[0m"}`);
  console.log(`  🔄 Open Loops:      ${openLoops}`);
  console.log(`  🤝 Commitments:     ${activeCommitments} active`);
  console.log(`  📋 System State:    ${snapshots?.startupStatus || "UNKNOWN"}`);
  console.log(`  🌐 Dashboard:       http://localhost:3001`);
  console.log("");
  process.exit(0);
}

async function cmdDrift() {
  const alerts = await prisma.brainMemory.findMany({
    where: {
      category: "coach_event",
      key: { startsWith: "coach:drift-recovery:" },
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { key: true, content: true, metadata: true, createdAt: true },
  }).then((rows) => {
    const unresolved = rows.filter((e) => {
      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      return !meta.ackedAt;
    });
    return unresolved.map((e) => {
      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      return {
        id: e.key,
        ruleName: e.content,
        message: typeof meta.body === "string" ? meta.body : "",
        severity: meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "alert" : "warning",
        date: new Date(e.createdAt).toLocaleDateString(),
      };
    });
  }).catch(() => []);

  if (alerts.length === 0) {
    console.log("\n✅ \x1b[32mNo active drift alerts. System is clear.\x1b[0m\n");
  } else {
    console.log(`\n🚨 \x1b[31m${alerts.length} ACTIVE DRIFT ALERTS:\x1b[0m\n`);
    for (const a of alerts) {
      const icon = a.severity === "critical" ? "🔴" : a.severity === "alert" ? "🟡" : "⚪";
      console.log(`  ${icon} [${a.severity.toUpperCase()}] ${a.ruleName}`);
      console.log(`     ${a.message}`);
      console.log(`     Triggered: ${a.date}\n`);
    }
  }
  process.exit(0);
}

async function cmdStreaks() {
  const dailyTasks = await prisma.task.findMany({
    where: { loopKind: "DAILY", deletedAt: null },
    orderBy: { streakCount: "desc" },
  });

  console.log("\n📈 HABIT STREAKS:\n");
  for (const t of dailyTasks) {
    const streak = t.streakCount;
    const bar = "█".repeat(Math.min(streak, 20)) + "░".repeat(Math.max(0, 20 - streak));
    console.log(`  \x1b[33m${bar}\x1b[0m ${streak}d  ${t.title}`);
  }
  console.log("");
  process.exit(0);
}

async function cmdScore() {
  console.log("\n📝 DAILY SCORE — " + today().toLocaleDateString() + "\n");

  const energy = await ask("  Energy (1-10): ");
  const mood = await ask("  Mood (1-10): ");
  const workout = await ask("  Workout? (y/n): ");
  const focus = await ask("  Deep Work Blocks (num): ");
  const overall = await ask("  Overall score (1-10): ");

  const overallNum = parseInt(overall) || 5;

  await prisma.personalDailyLog.upsert({
    where: { logDate: startOfDay() },
    update: {
      energyScore: parseInt(energy) || 5,
      moodScore: parseInt(mood) || 5,
      workoutCompleted: workout?.toLowerCase() === "y",
      deepWorkBlocks: parseInt(focus) || 0,
      dailyScore: overallNum,
    },
    create: {
      logDate: startOfDay(),
      energyScore: parseInt(energy) || 5,
      moodScore: parseInt(mood) || 5,
      workoutCompleted: workout?.toLowerCase() === "y",
      deepWorkBlocks: parseInt(focus) || 0,
      dailyScore: overallNum,
    }
  });

  console.log(`\n✅ Score saved: ${overallNum}/10\n`);
  process.exit(0);
}

async function cmdLoop(title: string) {
  if (!title) {
    console.error("Usage: nour loop \"title of the open loop\"");
    process.exit(1);
  }

  // Find a fallback mission for INBOX tasks. Usually "NOUR OS" or similar.
  // Using findFirst to get any active mission to attach the task to.
  const mission = await prisma.mission.findFirst({ where: { status: "ACTIVE" } });
  
  if (!mission) {
    console.error("❌ No active missions found in DB to attach the task to.");
    process.exit(1);
  }

  await prisma.task.create({
    data: {
      title,
      missionId: mission.id,
      status: "INBOX",
      loopKind: "ONCE",
      nextPhysicalAction: "Triage",
      effort: "M15",
      roiScore: 50,
      frictionScore: 50,
      energyRequired: "MEDIUM",
      context: "ANYWHERE",
      finishCondition: "Triage complete",
      createdBy: "cli",
    }
  });

  console.log(`✅ \x1b[32mOpen loop added:\x1b[0m "${title}"`);
  process.exit(0);
}

async function cmdCommit(desc: string) {
  if (!desc) {
    console.error("Usage: nour commit \"description of commitment\"");
    process.exit(1);
  }

  const mission = await prisma.mission.findFirst({ where: { status: "ACTIVE" } });
  
  if (!mission) {
    console.error("❌ No active missions found in DB to attach the task to.");
    process.exit(1);
  }

  await prisma.task.create({
    data: {
      title: desc,
      missionId: mission.id,
      status: "INBOX",
      loopKind: "PROMISE",
      promiseTo: "self",
      nextPhysicalAction: "Triage",
      effort: "M15",
      roiScore: 80,
      frictionScore: 50,
      energyRequired: "MEDIUM",
      context: "ANYWHERE",
      finishCondition: "Commitment fulfilled",
      createdBy: "cli",
    }
  });

  console.log(`✅ \x1b[32mCommitment logged:\x1b[0m "${desc}"`);
  process.exit(0);
}

// === MAIN ===
const [, , cmd, ...args] = process.argv;
const arg = args.join(" ");

async function main() {
  switch (cmd) {
    case "status": await cmdStatus(); break;
    case "drift": await cmdDrift(); break;
    case "streaks": await cmdStreaks(); break;
    case "score": await cmdScore(); break;
    case "loop": await cmdLoop(arg); break;
    case "commit": await cmdCommit(arg); break;
    default:
      console.log(`
NOUR OS CLI — Command Center Interface

Usage: npx tsx cli/nour.ts <command> [args]

Commands:
  status              Quick dashboard (score, alerts, loops)
  drift               Show active drift alerts
  streaks             Show current habit streaks
  score               Submit today's daily score (interactive)
  loop "title"        Add an open loop (INBOX task)
  commit "text"       Log a new commitment (PROMISE task)

Dashboard: http://localhost:3001
`);
      process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
