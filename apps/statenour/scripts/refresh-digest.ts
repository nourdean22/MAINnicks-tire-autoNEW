/**
 * Refresh compiled knowledge digest in DB · 2026-06-15
 *
 * Runs the compilation of priority files and caches the output in the DB
 * AuditEvent table so that Vercel/Railway instances can load it instantly.
 *
 * Run: pnpm tsx scripts/refresh-digest.ts
 */

import { refreshKnowledgeDigest } from "@/lib/ai/knowledge-compiler";
import { prisma } from "@/lib/prisma";

async function main() {
  console.log("  Compiling and caching knowledge digest to DB...");
  const res = await refreshKnowledgeDigest();
  console.log(`  ✅ Cached! Loaded files count: ${res.filesLoaded}. Digest size: ${res.charCount} characters.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Failed to refresh knowledge digest:", err);
  process.exit(1);
});
