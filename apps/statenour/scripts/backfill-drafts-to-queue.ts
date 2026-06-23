// Backfill legacy content drafts from BrainMemory to SocialPublishQueue
//
// Run: pnpm tsx scripts/backfill-drafts-to-queue.ts

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { randomUUID } from "node:crypto";

const createId = () => randomUUID().replace(/-/g, "").slice(0, 24);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("localhost")) {
    console.error("✗ DATABASE_URL is missing or points at localhost. Configure .env.local first.");
    process.exit(2);
  }

  const adapter = new PrismaNeon({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  try {
    const legacyDrafts = await prisma.brainMemory.findMany({
      where: {
        category: "content_draft",
        deletedAt: null,
      },
    });

    console.log(`Found ${legacyDrafts.length} active legacy content drafts in BrainMemory.`);
    if (legacyDrafts.length === 0) {
      console.log("No backfill needed.");
      return;
    }

    let successCount = 0;
    for (const row of legacyDrafts) {
      const meta = (row.metadata ?? {}) as Record<string, any>;
      
      // Parse ID from key (e.g. "draft_12345" -> "12345")
      let id = row.key.startsWith("draft_") ? row.key.slice(6) : row.key;
      // If id is not a valid length or format, generate a new one
      if (id.length < 10) {
        id = createId();
      }

      console.log(`Backfilling legacy draft [${row.key}] -> queue ID [${id}] ...`);

      // Create new publish queue item
      await prisma.socialPublishQueue.upsert({
        where: { id },
        create: {
          id,
          content: row.content,
          status: meta.status || "pending",
          imageUrl: meta.imageUrl || null,
          platforms: meta.suggestedPlatforms || [],
          scheduledFor: meta.scheduledFor ? new Date(meta.scheduledFor) : null,
          publishedAt: meta.publishedAt ? new Date(meta.publishedAt) : null,
          publishUrls: meta.publishUrls || [],
          kind: meta.kind || "post",
          source: meta.source || row.source || "manual",
          sourceMetadata: meta.sourceMetadata || {},
          approvedAt: meta.approvedAt ? new Date(meta.approvedAt) : null,
          rejectedAt: meta.rejectedAt ? new Date(meta.rejectedAt) : null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        update: {
          content: row.content,
          status: meta.status || "pending",
          imageUrl: meta.imageUrl || null,
          platforms: meta.suggestedPlatforms || [],
          scheduledFor: meta.scheduledFor ? new Date(meta.scheduledFor) : null,
          publishedAt: meta.publishedAt ? new Date(meta.publishedAt) : null,
          publishUrls: meta.publishUrls || [],
          kind: meta.kind || "post",
          source: meta.source || row.source || "manual",
          sourceMetadata: meta.sourceMetadata || {},
          approvedAt: meta.approvedAt ? new Date(meta.approvedAt) : null,
          rejectedAt: meta.rejectedAt ? new Date(meta.rejectedAt) : null,
          updatedAt: row.updatedAt,
        },
      });

      // Soft delete legacy BrainMemory row
      await prisma.brainMemory.update({
        where: { id: row.id },
        data: {
          deletedAt: new Date(),
        },
      });

      successCount++;
    }

    console.log(`\nSuccessfully backfilled ${successCount} drafts to SocialPublishQueue.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
