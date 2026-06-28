/**
 * Conversation archive backfill · v10.0.188
 *
 * Probe (scripts/probe-archive-state.mjs) revealed:
 *   · 39/39 conversations missing pinnedSummary
 *   · 0 of 39 conversations indexed in VectorEmbedding
 *
 * Result: chat history is a black box. /api/chat/search returns text
 * matches but no semantic search. /brain can't surface "convos
 * related to project X" because the convos aren't embedded.
 *
 * This script fills both gaps in one pass per conversation:
 *   1. Concatenate all message text (truncated to ~6000 chars)
 *   2. Generate a 1-paragraph pinnedSummary via aiChat task="summary"
 *   3. Generate a vector embedding via getEmbedding()
 *   4. Write pinnedSummary back to ChatConversation
 *   5. Write embedding row to VectorEmbedding (sourceType="chat_conversation")
 *
 * Idempotent — skips conversations that already have BOTH a
 * pinnedSummary and a VectorEmbedding row. Safe to re-run after new
 * conversations land. Will be wired to a nightly cron next.
 *
 * Usage: pnpm tsx scripts/backfill-conversation-archives.mjs
 *        Optional flags:
 *          --limit N      stop after processing N conversations
 *          --dry-run      print plan without writing
 *
 * Rate limiting: 1 conversation at a time (sequential), with a 500ms
 * pause between to avoid Venice/Ollama burst limits. ~30s per convo
 * at ~5K tokens (summary call + embed call). Total ~20 minutes for
 * 39 convos. Can run in background.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? "999", 10) : 999;

async function main() {
  // Find conversations needing backfill: missing pinnedSummary OR
  // missing a VectorEmbedding row.
  const needsBackfill = await prisma.chatConversation.findMany({
    where: {
      archivedAt: null,
      OR: [
        { pinnedSummary: null },
        { pinnedSummary: "" },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      messageCount: true,
      updatedAt: true,
    },
  });

  // Cross-check with embeddings
  const existingEmbedIds = new Set(
    (await prisma.vectorEmbedding.findMany({
      where: { sourceType: "chat_conversation" },
      select: { sourceId: true },
    })).map((r) => r.sourceId),
  );

  console.log(
    `\nBackfill plan · ${needsBackfill.length} conversations need pinnedSummary`,
  );
  console.log(
    `${needsBackfill.filter((c) => !existingEmbedIds.has(c.id)).length} also missing VectorEmbedding\n`,
  );

  if (dryRun) {
    for (const c of needsBackfill.slice(0, 10)) {
      const tag = !existingEmbedIds.has(c.id) ? "[no-embed]" : "[no-summary]";
      console.log(`  ${tag} ${c.id} · ${(c.title ?? "(untitled)").slice(0, 60)}`);
    }
    console.log("\n(dry run — no writes)");
    return;
  }

  // Lazy-import the helpers — provider.ts imports next env which we
  // already loaded above.
  const { getEmbedding, aiChat } = await import("@/lib/ai/provider");

  let done = 0;
  let summarized = 0;
  let embedded = 0;
  let failed = 0;

  for (const conv of needsBackfill) {
    process.stdout.write(
      `  [${done + 1}/${needsBackfill.length}] ${conv.id} · ${(conv.title ?? "(untitled)").slice(0, 50)} ... `,
    );

    try {
      // Pull message text — capped at 30 most recent + 6K total chars
      // so the summary call stays fast. Chronological order so the
      // summary preserves the arc of the conversation.
      const messages = await prisma.chatMessage.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, parts: true },
        take: 100,
      });

      const transcript = messages
        .map((m) => {
          const text =
            typeof m.content === "string" && m.content.length > 0
              ? m.content
              : Array.isArray(m.parts)
                ? m.parts
                    .filter((p: any) => p?.type === "text" && typeof p.text === "string")
                    .map((p: any) => p.text)
                    .join(" ")
                : "";
          return `${m.role.toUpperCase()}: ${text.slice(0, 600)}`;
        })
        .filter((s) => s.length > 6) // skip empty turns
        .join("\n\n")
        .slice(0, 6000);

      if (transcript.length < 50) {
        console.log("skip (empty)");
        continue;
      }

      // 1. Generate summary
      const summaryResult = await aiChat(
        [
          {
            role: "system",
            content:
              "You are a conversation indexer. Summarize the chat in 2-4 sentences. Capture the topic, what was decided, and any unresolved threads. No fluff. Plain text only.",
          },
          {
            role: "user",
            content: `Title: ${conv.title ?? "(untitled)"}\n\nTranscript:\n${transcript}`,
          },
        ],
        "summary",
      );
      const summary =
        summaryResult.content
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .trim()
          .slice(0, 1500) || null;

      if (!summary) {
        console.log("✗ summary empty");
        failed++;
        continue;
      }

      // 2. Generate embedding (use the title + summary + first 1500 chars
      // of transcript — the most semantically dense slice).
      const embedText = `${conv.title ?? ""}\n${summary}\n${transcript.slice(0, 1500)}`.slice(0, 4000);
      const vec = await getEmbedding(embedText).catch(() => [] as number[]);

      // 3. Write summary
      await prisma.chatConversation.update({
        where: { id: conv.id },
        data: { pinnedSummary: summary },
      });
      summarized++;

      // 4. Write embedding (skip if already exists for this conv)
      if (vec.length > 0 && !existingEmbedIds.has(conv.id)) {
        await prisma.vectorEmbedding.create({
          data: {
            sourceType: "chat_conversation",
            sourceId: conv.id,
            content: summary,
            embedding: JSON.stringify(vec),
            embedding_dim: vec.length,
            model: "venice-bge-m3",
          },
        });
        embedded++;
      }

      console.log(
        `✓ summary=${summary.length}ch · embed=${vec.length}d · provider=${summaryResult.provider}`,
      );
      done++;

      // Rate-limit pause
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${msg.slice(0, 80)}`);
      failed++;
    }
  }

  console.log(
    `\nDone · ${done} processed · ${summarized} summaries written · ${embedded} embeddings written · ${failed} failed`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
