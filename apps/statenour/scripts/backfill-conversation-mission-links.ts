/**
 * Phase 2 archive backfill - link embedded chat conversations to missions.
 *
 * Idempotent:
 *   - creates missing mission embeddings once (sourceType="mission")
 *   - auto-links unlinked conversations at cosine >= 0.75
 *   - queues ambiguous top matches from 0.55 to 0.75 as BrainMemory review rows
 *
 * Usage:
 *   pnpm tsx scripts/backfill-conversation-mission-links.ts
 *   pnpm tsx scripts/backfill-conversation-mission-links.ts --dry-run
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { runConversationMissionLinkBackfill } from "@/lib/db/conversation-mission-linker";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number.parseInt(args[limitIdx + 1] ?? "", 10) : undefined;

async function main() {
  const report = await runConversationMissionLinkBackfill({
    dryRun,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  console.log("\nConversation mission link backfill");
  console.log(`  conversations: ${report.conversations}`);
  console.log(`  active missions: ${report.missions}`);
  console.log(`  mission embeddings created: ${report.missionEmbeddingsCreated}`);
  console.log(`  already linked: ${report.alreadyLinked}`);
  console.log(`  auto-linked >=0.75: ${report.autoLinked}`);
  console.log(`  queued for review 0.55-0.75: ${report.queuedForReview}`);
  console.log(`  below 0.55: ${report.belowReviewThreshold}`);
  console.log(`  skipped no conversation embedding: ${report.skippedNoEmbedding}`);
  if (dryRun) console.log("  dry run: no writes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
