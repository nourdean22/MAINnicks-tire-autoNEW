/**
 * Ingest NOURCITY-ARCHIVES/Direct-Ingest → BrainMemory
 *
 * Reads all .md and .txt files from the Direct-Ingest drop zone
 * and upserts them to the Statenour BrainMemory table under category="archive_document".
 *
 * Run: pnpm tsx scripts/ingest-archives-direct.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { brainMemory } from "../lib/brain/memory-manager";

const DIRECT_INGEST_DIR = "C:\\Users\\nourd\\NOURCITY-ARCHIVES\\Direct-Ingest";
const CHUNK_SIZE = 4000;

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  INGEST ARCHIVES (DIRECT) → BRAIN");
  console.log("═══════════════════════════════════════════════════════════");

  if (!fs.existsSync(DIRECT_INGEST_DIR)) {
    console.log(`❌ Directory not found: ${DIRECT_INGEST_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DIRECT_INGEST_DIR).filter(f => f.endsWith(".md") || f.endsWith(".txt"));
  console.log(`Found ${files.length} text/markdown files in Drop Zone.`);

  let totalProcessed = 0;
  let totalChunks = 0;
  let totalFailed = 0;

  for (const file of files) {
    totalProcessed++;
    const filePath = path.join(DIRECT_INGEST_DIR, file);
    const fullContent = fs.readFileSync(filePath, "utf8");

    // Chunking logic to prevent exploding the embedding limits
    // OpenAI text-embedding-3-small limit is ~8191 tokens (~32k chars), we chunk at 15k
    let chunks = [];
    if (fullContent.length > CHUNK_SIZE) {
        for (let i = 0; i < fullContent.length; i += CHUNK_SIZE) {
            chunks.push(fullContent.slice(i, i + CHUNK_SIZE));
        }
    } else {
        chunks.push(fullContent);
    }

    console.log(`  [Processing] ${file} (${chunks.length} chunks)`);

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const key = `archive_${file}_chunk${i}`;

        // Check if already processed to allow resuming
        const existingRecord = await prisma.brainMemory.findFirst({
            where: { category: "archive_document", key },
        });
        
        if (existingRecord) {
            console.log(`    └─ ⏭️ Skipping chunk ${i} (already ingested)`);
            totalChunks++;
            continue;
        }

        let retries = 0;
        const maxRetries = 5;
        let success = false;

        while (retries < maxRetries && !success) {
            try {
                await brainMemory.remember(
                    "archive_document",
                    key,
                    chunk,
                    "skill_ingestion",
                    {
                        origin: "local_archives",
                        filename: file,
                        chunk_index: i,
                        total_chunks: chunks.length,
                        syncedAt: new Date().toISOString(),
                    }
                );

                // Confirm it immediately to prevent expiration
                const record = await prisma.brainMemory.findFirst({
                    where: { category: "archive_document", key },
                });
                if (record) {
                    await brainMemory.confirm(record.id);
                }
                totalChunks++;
                success = true;

                // Rate limit to prevent provider saturation
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (e: any) {
                retries++;
                const isRateLimit = e.message?.toLowerCase().includes("rate") || e.message?.includes("429");
                const waitTime = isRateLimit ? 10000 * retries : 2000 * retries; // Wait longer for rate limits
                console.error(`    └─ ⚠️ Error on chunk ${i} (attempt ${retries}): ${e.message}. Waiting ${waitTime}ms...`);
                
                if (retries >= maxRetries) {
                    console.error(`    └─ ❌ Failed on chunk ${i} after ${maxRetries} retries.`);
                    totalFailed++;
                } else {
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
    }
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  🎉 Archive Ingestion complete: ${totalProcessed} files processed.`);
  console.log(`    - Chunks synced: ${totalChunks}`);
  console.log(`    - Failed chunks: ${totalFailed}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Archives Ingestion failed:", err);
  process.exit(1);
});
