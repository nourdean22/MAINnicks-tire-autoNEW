#!/usr/bin/env tsx
/**
 * One-shot cleanup · deletes the test conversations my preview_eval
 * calls created while debugging image gen (v10.0.477-479). Match shapes
 * are very specific test prompts · won't touch real user conversations.
 *
 * Run · pnpm tsx scripts/cleanup-test-img-convs.ts
 */

import { prisma } from "@/lib/prisma";

const TEST_PROMPT_FRAGMENTS = [
  "gold tire on black billboard quality",
  "a simple gold tire on black background",
  "vintage gold tire on black billboard",
  "make me a picture of a vintage tire shop",
  "story 9:16 vintage car portrait",
];

async function main() {
  // Find conversations whose user-role messages contain ANY of the test
  // prompt fragments. Get the conversation IDs, then cascade-delete the
  // conversations (Prisma's onDelete: Cascade on ChatMessage handles the
  // message rows).
  const matches = await prisma.chatMessage.findMany({
    where: {
      role: "user",
      OR: TEST_PROMPT_FRAGMENTS.map((frag) => ({
        content: { contains: frag, mode: "insensitive" as const },
      })),
    },
    select: { conversationId: true, content: true },
  });

  const convIds = [...new Set(matches.map((m) => m.conversationId).filter(Boolean) as string[])];
  console.log(`Found ${matches.length} test messages across ${convIds.length} conversations`);
  for (const m of matches.slice(0, 10)) {
    console.log(`  · "${m.content?.slice(0, 70)}…"`);
  }

  if (convIds.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const deleted = await prisma.chatConversation.deleteMany({
    where: { id: { in: convIds } },
  });
  console.log(`✓ Deleted ${deleted.count} conversations + their messages (cascade).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
