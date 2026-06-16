/**
 * Ingest Obsidian Vault Notes → BrainMemory · 2026-06-16
 *
 * Reads markdown files from the local Obsidian Vault folder,
 * classifies them into categories, and upserts them to the BrainMemory table.
 *
 * Run: pnpm tsx scripts/ingest-obsidian-vault.ts
 */

import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { brainMemory } from "@/lib/brain/memory-manager";

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  INGEST OBSIDIAN VAULT NOTES → BRAIN");
  console.log("═══════════════════════════════════════════════════════════");

  const vaultPath = "C:\\Users\\nourd\\OneDrive\\Documents\\Obsidian Vault";
  if (!fs.existsSync(vaultPath)) {
    console.error(`❌ Vault directory not found at: ${vaultPath}`);
    process.exit(1);
  }

  // Helper to clean file names into unique DB keys
  const toKey = (filename: string) => {
    return (
      "obsidian_" +
      filename
        .replace(/\.md$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    );
  };

  // Helper to map files to categories
  const getCategoryAndTitle = (filename: string) => {
    const name = filename.toLowerCase();
    let category = BRAIN_CATEGORIES.PERSONAL_DEVELOPMENT;
    let title = filename.replace(/\.md$/, "");

    if (
      name.includes("goals") ||
      name.includes("weekly") ||
      name.includes("ceo review") ||
      name.includes("dashboard")
    ) {
      category = BRAIN_CATEGORIES.PLANNING;
      title = `CEO Planning: ${title}`;
    } else if (
      name.includes("recovery") ||
      name.includes("body") ||
      name.includes("health")
    ) {
      category = BRAIN_CATEGORIES.PHYSICAL;
      title = `Health & Body: ${title}`;
    } else if (
      name.includes("shop") ||
      name.includes("business") ||
      name.includes("money") ||
      name.includes("revenue")
    ) {
      category = BRAIN_CATEGORIES.BUSINESS;
      title = `Business & Finance: ${title}`;
    } else if (
      name.includes("mind") ||
      name.includes("discipline") ||
      name.includes("mental")
    ) {
      category = BRAIN_CATEGORIES.DISCIPLINE;
      title = `Mindset & Discipline: ${title}`;
    } else if (
      name.includes("faith") ||
      name.includes("character") ||
      name.includes("spiritual")
    ) {
      category = BRAIN_CATEGORIES.SPIRITUAL;
      title = `Faith & Character: ${title}`;
    } else if (
      name.includes("rules") ||
      name.includes("system") ||
      name.includes("canon")
    ) {
      category = BRAIN_CATEGORIES.AI_CONFIG;
      title = `Operating Canon: ${title}`;
    }

    return { category, title };
  };

  // Read all markdown files from the vault
  const files = fs
    .readdirSync(vaultPath)
    .filter((f) => f.endsWith(".md") && f !== "README.md");

  console.log(`  Found ${files.length} markdown notes to process...`);
  console.log("");

  let successCount = 0;

  for (const file of files) {
    const filePath = path.join(vaultPath, file);
    let content = fs.readFileSync(filePath, "utf-8").trim();

    if (!content) {
      console.log(`  Skipping empty file: ${file}`);
      continue;
    }

    const { category, title } = getCategoryAndTitle(file);
    const key = toKey(file);

    // Clean up content: strip markdown frontmatter if present (lines between first --- and second ---)
    if (content.startsWith("---")) {
      const parts = content.split("---");
      if (parts.length >= 3) {
        content = parts.slice(2).join("---").trim();
      }
    }

    // Prefix with title for search clarity
    const fullContent = `[${title}]\n${content}`;

    console.log(`  Processing: ${file}`);
    console.log(`    └─ Category: ${category}`);
    console.log(`    └─ Key: ${key}`);
    console.log(`    └─ Size: ${fullContent.length} chars`);

    try {
      // Ingest note using the native memory-manager (handles embeddings generation via OpenAI)
      await brainMemory.remember(
        category,
        key,
        fullContent,
        "skill_ingestion",
        {
          origin: "obsidian-vault",
          filename: file,
          title,
          syncedAt: new Date().toISOString(),
        }
      );

      // Lock confidence to 1.0 (prevents decay)
      const record = await prisma.brainMemory.findFirst({
        where: { category, key },
      });
      if (record) {
        await brainMemory.confirm(record.id);
      }

      console.log(`    └─ ✅ Success`);
      successCount++;
    } catch (err) {
      console.error(`    └─ ❌ Failed to ingest ${file}:`, err);
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  🎉 Ingestion complete: ${successCount}/${files.length} notes synced.`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Obsidian Ingestion failed:", err);
  process.exit(1);
});
