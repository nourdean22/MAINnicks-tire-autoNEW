/**
 * One-shot diagnosis · Bay 5 Revive hallucination · v10.0.160
 *
 * User reported Nick claimed "added the suggested tasks · Total tasks
 * now: 15" but Bay 5 Revive shows 0 tasks. messageId from the screenshot
 * React props: cmopt9mkl000404l5qfz1g4rj. This script pulls the chain:
 *
 *   1. Find the ChatMessage row + traceId
 *   2. Find every AgentTrace for that traceId (envelope contract)
 *   3. Print envelope.toolsCalled[] — was a "create-task" / "addTasks"
 *      tool actually fired? Did it succeed?
 *   4. Find Bay 5 Revive mission + count its tasks
 *   5. Find any tasks created in the same time window — were they
 *      misrouted to a different mission?
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const MESSAGE_ID = "cmopt9mkl000404l5qfz1g4rj";

async function main() {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    console.log("\n═══ STEP 1 · ChatMessage ═══");
    const msg = await prisma.chatMessage
      .findUnique({
        where: { id: MESSAGE_ID },
        select: {
          id: true,
          conversationId: true,
          role: true,
          content: true,
          provider: true,
          model: true,
          createdAt: true,
        },
      })
      .catch((e) => {
        console.log("findUnique threw:", e instanceof Error ? e.message : e);
        return null;
      });
    if (!msg) {
      console.log("  ❌ ChatMessage not found");
      return;
    }
    console.log(`  id:          ${msg.id}`);
    console.log(`  conversation: ${msg.conversationId}`);
    console.log(`  role:        ${msg.role}`);
    console.log(`  createdAt:   ${msg.createdAt.toISOString()}`);
    console.log(`  provider:    ${msg.provider ?? "—"} · model: ${msg.model ?? "—"}`);
    console.log(
      `  content[:200]: ${msg.content.slice(0, 200).replace(/\n/g, "\\n")}`,
    );

    // Find AgentTrace by conversationId in metadata + time window. Chat
    // route writes conversationId into trace metadata so we can pivot
    // even when the message itself doesn't carry a traceId column.
    const window = 5 * 60_000;
    const candidateTraces = await prisma.agentTrace.findMany({
      where: {
        source: "chat",
        startedAt: {
          gte: new Date(msg.createdAt.getTime() - window),
          lte: new Date(msg.createdAt.getTime() + window),
        },
      },
      orderBy: { startedAt: "asc" },
    });
    const matchingTrace = candidateTraces.find((t) => {
      const md = t.metadata as { conversationId?: string } | null;
      return md?.conversationId === msg.conversationId;
    });
    const traceId = matchingTrace?.traceId ?? null;
    console.log(`  traceId:     ${traceId ?? "<not matched in window>"}`);

    console.log("\n═══ STEP 2 · AgentTrace + envelope ═══");
    if (traceId) {
      const traces = await prisma.agentTrace.findMany({
        where: { traceId },
        orderBy: { startedAt: "asc" },
      });
      if (traces.length === 0) {
        console.log("  ⚠️  no trace rows for this traceId");
      }
      for (const t of traces) {
        console.log(`\n  · ${t.label} (${t.source})`);
        console.log(`    duration: ${t.durationMs}ms · cost: ${t.costCents ?? 0}¢ · toolCalls: ${t.toolCalls}`);
        const envMd = t.metadata as { envelope?: Record<string, unknown> } | null;
        const env = envMd?.envelope;
        if (env) {
          console.log(`    envelope:`);
          if (env.policyId) console.log(`      policyId: ${env.policyId}`);
          if (env.reason) console.log(`      reason:   ${env.reason}`);
          const tools = env.toolsCalled as Array<{ name: string; ok: boolean; durationMs: number }> | undefined;
          if (tools && tools.length > 0) {
            console.log(`      toolsCalled (${tools.length}):`);
            for (const tool of tools) {
              console.log(
                `        ${tool.ok ? "✅" : "❌"} ${tool.name} (${tool.durationMs}ms)`,
              );
            }
          } else {
            console.log(`      toolsCalled: none — Nick wrote text but called no tools`);
          }
          const facts = env.factsAssumed as string[] | undefined;
          if (facts && facts.length > 0) {
            console.log(`      facts (${facts.length}):`);
            for (const f of facts) console.log(`        · ${f}`);
          }
        } else {
          console.log(`    envelope: <not present — pre-v10.0.151 trace>`);
        }
      }
    }

    console.log("\n═══ STEP 3 · Bay 5 Revive mission + tasks ═══");
    const bay5 = await prisma.mission.findFirst({
      where: {
        title: { contains: "Bay 5", mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true, title: true, status: true, createdAt: true },
    });
    if (!bay5) {
      console.log("  ⚠️  no mission with 'Bay 5' in title");
    } else {
      console.log(`  mission: ${bay5.id} "${bay5.title}" (${bay5.status})`);
      const taskCount = await prisma.task.count({
        where: { missionId: bay5.id, deletedAt: null },
      });
      console.log(`  task count: ${taskCount}`);
      const recent = await prisma.task.findMany({
        where: { missionId: bay5.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, title: true, createdAt: true, createdBy: true },
      });
      if (recent.length > 0) {
        console.log(`  recent tasks:`);
        for (const t of recent) {
          console.log(
            `    · ${t.title.slice(0, 60)} (${t.createdAt.toISOString()}) by=${t.createdBy ?? "—"}`,
          );
        }
      }
    }

    console.log("\n═══ STEP 4 · Tasks created near the chat turn (±5m) ═══");
    const tasksNearby = await prisma.task.findMany({
      where: {
        createdAt: {
          gte: new Date(msg.createdAt.getTime() - window),
          lte: new Date(msg.createdAt.getTime() + window),
        },
        deletedAt: null,
      },
      include: { mission: { select: { title: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (tasksNearby.length === 0) {
      console.log("  ⚠️  NO tasks created in this window — Nick fabricated the action");
    } else {
      console.log(`  ${tasksNearby.length} task(s) created in window:`);
      for (const t of tasksNearby) {
        console.log(
          `    · ${t.title.slice(0, 50)} → mission "${t.mission?.title ?? "<orphan>"}"`,
        );
      }
    }

    console.log("\n═══ STEP 5 · Tools the AI knows about for task creation ═══");
    // Quick grep equivalent — list tool names in the registry containing "task"
    // by reading the toolDefinitions module. Done via a library query rather
    // than file scan to match what's actually wired into Nick's chat path.
    const toolEvents = await prisma.brainMemory
      .findMany({
        where: {
          category: "tool_invocation",
          createdAt: { gte: new Date(msg.createdAt.getTime() - window) },
        },
        orderBy: { createdAt: "asc" },
        take: 20,
        select: { content: true, createdAt: true },
      })
      .catch(() => []);
    if (toolEvents.length > 0) {
      console.log(`  ${toolEvents.length} tool invocation memory rows in window`);
      for (const e of toolEvents) {
        console.log(`    · ${e.content.slice(0, 90)}`);
      }
    } else {
      console.log("  no tool_invocation rows in window");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
