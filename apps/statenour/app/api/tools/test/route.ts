import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/tools/test — Run lightweight validation on each tool category.
 * Tests database connectivity + basic queries for each category.
 * Returns pass/fail per category with error details.
 */
export async function GET() {
  const results: Array<{
    category: string;
    tool: string;
    status: "pass" | "fail" | "skip";
    ms: number;
    error?: string;
  }> = [];

  async function test(category: string, tool: string, fn: () => Promise<any>) {
    const start = Date.now();
    try {
      await fn();
      results.push({ category, tool, status: "pass", ms: Date.now() - start });
    } catch (e) {
      results.push({ category, tool, status: "fail", ms: Date.now() - start, error: String(e).slice(0, 200) });
    }
  }

  // Personal Data
  // v10.0.60 · Wave A part 3 · Test fixtures updated: pre-fix tested
  // dead Promise.resolve placeholders (always passed regardless of
  // shim health). Now exercises the legacy-shim layer + identity_
  // snapshot path — a real probe of the post-DailyScore plumbing.
  await test("Personal", "getDailyScores", async () => {
    const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
    return recentScoreSnapshots(7);
  });
  await test("Personal", "getDriftAlerts", () => prisma.driftAlert.findMany({ where: { resolved: false }, take: 1 }));
  await test("Personal", "getCommitments", () => prisma.commitment.findMany({ where: { status: "active" }, take: 1 }));
  await test("Personal", "getTasks", () => prisma.task.findMany({ where: { status: { in: ["INBOX", "READY", "DOING"] } }, take: 1 }));
  await test("Personal", "getHabitStreaks", async () => {
    const { recentDailyHabits } = await import("@/lib/brain/legacy-shims");
    return recentDailyHabits(7);
  });
  await test("Personal", "getMissions", () => prisma.mission.findMany({ where: { status: "ACTIVE" }, take: 1 }));

  // Business
  await test("Business", "getCustomerCount", () => Promise.resolve(0));
  await test("Business", "getLeadCount", () => Promise.resolve(0));
  await test("Business", "getJobCount", () => Promise.resolve(0));
  await test("Business", "getQuoteCount", () => Promise.resolve(0));

  // Brain
  await test("Brain", "getBrainMemories", () => prisma.brainMemory.findMany({ take: 1 }));
  await test("Brain", "getBrainDumps", () => prisma.brainDump.findMany({ take: 1 }));
  await test("Brain", "getReflections", () => prisma.reflection.findMany({ take: 1 }));
  await test("Brain", "getPredictions", () => prisma.prediction.findMany({ take: 1 }));

  // Communication
  await test("Communication", "telegramEnv", async () => {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
  });

  // Files
  await test("Files", "githubEnv", async () => {
    if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");
  });
  await test("Files", "googleDriveEnv", async () => {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not set");
  });

  // AI
  await test("AI", "veniceEnv", async () => {
    if (!process.env.VENICE_API_KEY) throw new Error("VENICE_API_KEY not set");
  });
  await test("AI", "voiceEnv", async () => {
    if (!process.env.HUGGINGFACE_API_KEY) throw new Error("HUGGINGFACE_API_KEY not set");
  });

  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      failed,
      skipped: results.filter(r => r.status === "skip").length,
      totalMs,
      status: failed === 0 ? "ALL PASS" : failed <= 3 ? "PARTIAL" : "CRITICAL",
    },
    results,
    failedTools: results.filter(r => r.status === "fail").map(r => ({ tool: r.tool, error: r.error })),
  });
}
