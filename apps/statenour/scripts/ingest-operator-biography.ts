/**
 * Ingest Operator Biography & Context → BrainMemory · 2026-06-15
 *
 * Reads the canonical docs/OPERATOR-BIOGRAPHY.md, splits it by section,
 * and upserts each section into the BrainMemory table. This registers
 * the operator context so the searchColdMemory tool can query it.
 *
 * Run: pnpm tsx scripts/ingest-operator-biography.ts
 */

import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { brainMemory } from "@/lib/brain/memory-manager";

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  INGEST OPERATOR BIOGRAPHY → BRAIN");
  console.log("═══════════════════════════════════════════════════════════");

  const bioPath = path.resolve(process.cwd(), "docs/OPERATOR-BIOGRAPHY.md");
  if (!fs.existsSync(bioPath)) {
    console.error(`❌ Biography file not found at: ${bioPath}`);
    process.exit(1);
  }

  const bioContent = fs.readFileSync(bioPath, "utf-8");
  console.log("  Loaded docs/OPERATOR-BIOGRAPHY.md");

  // Split by "## " headers
  const sections = bioContent.split(/(?=\n##\s+)/);

  const mappings = [
    {
      headerMatch: /1\.\s+Demographics/i,
      category: BRAIN_CATEGORIES.QUALITATIVE_IDENTITY,
      key: "operator_biography_demographics",
      title: "Operator Demographics",
    },
    {
      headerMatch: /2\.\s+Interests/i,
      category: BRAIN_CATEGORIES.PREFERENCE,
      key: "operator_biography_preferences",
      title: "Operator Interests & Preferences",
    },
    {
      headerMatch: /3\.\s+Relationships/i,
      category: BRAIN_CATEGORIES.RELATIONSHIPS,
      key: "operator_biography_relationships",
      title: "Operator Relationships",
    },
    {
      headerMatch: /4\.\s+Dated\s+Events/i,
      category: BRAIN_CATEGORIES.PLANNING,
      key: "operator_biography_plans",
      title: "Operator Dated Events, Projects & Plans",
    },
    {
      headerMatch: /5\.\s+Instructions/i,
      category: BRAIN_CATEGORIES.AI_CONFIG,
      key: "operator_biography_instructions",
      title: "Operator System Rules & Instructions",
    },
  ];

  let ingestedCount = 0;

  for (const map of mappings) {
    const section = sections.find((s) => map.headerMatch.test(s));
    if (!section) {
      console.warn(`  ⚠️ Could not find section matching: ${map.headerMatch}`);
      continue;
    }

    // Clean up content: normalize headers, trim
    let content = section.trim();
    // Strip the top header to keep it clean
    content = content.replace(/^##\s+.*\n/, "").trim();
    // Normalize lines
    content = content
      .replace(/^[-*]\s+\[.\]\s*/gm, "- ") // simplify checkboxes
      .replace(/\n{3,}/g, "\n\n"); // collapse blank lines

    // Prefix with title for search clarity
    const fullContent = `[${map.title}]\n${content}`;

    console.log(`  Processing: ${map.title} (${fullContent.length} chars)`);

    // Ingest into BrainMemory using the manager (handles embedding creation)
    await brainMemory.remember(
      map.category,
      map.key,
      fullContent,
      "skill_ingestion",
      {
        origin: "operator-biography",
        title: map.title,
        ingestedAt: new Date().toISOString(),
      }
    );

    // Reinforce / confirm it so it has 1.0 confidence and doesn't decay
    const record = await prisma.brainMemory.findFirst({
      where: { category: map.category, key: map.key },
    });
    if (record) {
      await brainMemory.confirm(record.id);
    }

    console.log(`  ✅ Ingested: ${map.title}`);
    ingestedCount++;
  }

  console.log("");
  console.log(`  🎉 Ingestion complete: ${ingestedCount} sections ingested.`);
  console.log("  Each section is now embedded and searchable via searchColdMemory.");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Biography Ingestion failed:", err);
  process.exit(1);
});
