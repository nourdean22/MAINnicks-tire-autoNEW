/**
 * Ingest Obsidian Vault & iCloud Notes (Recursive) → BrainMemory · 2026-06-16
 *
 * Recursively reads markdown and text files from both the Obsidian Vault folder
 * and the iCloud Shortcuts directory, classifies them into categories,
 * and upserts them to the Statenour BrainMemory table.
 *
 * Run: pnpm tsx scripts/ingest-obsidian-vault.ts
 */

import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { BRAIN_CATEGORIES } from "../lib/brain/categories";
import { brainMemory } from "../lib/brain/memory-manager";

// Helper to recursively find files in a directory matching a filter
function getFilesRecursive(dir: string, filter: (f: string) => boolean): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      // Skip system or ignored folders
      if (file !== ".obsidian" && file !== "node_modules" && file !== ".git") {
        results = results.concat(getFilesRecursive(filePath, filter));
      }
    } else if (filter(file)) {
      results.push(filePath);
    }
  }
  return results;
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  INGEST LOCAL NOTES (OBSIDIAN & ICLOUD) → BRAIN");
  console.log("═══════════════════════════════════════════════════════════");

  const scanTargets = [
    {
      name: "Obsidian Vault",
      path: "C:\\Users\\nourd\\OneDrive\\Documents\\Obsidian Vault",
      prefix: "obsidian_",
      filter: (f: string) => f.endsWith(".md") && f !== "README.md",
    },
    {
      name: "iCloud Shortcuts Folder",
      path: "C:\\Users\\nourd\\iCloudDrive\\iCloud~is~workflow~my~workflows",
      prefix: "icloud_shortcut_",
      filter: (f: string) => (f.endsWith(".md") || f.endsWith(".txt")) && f !== "README.md",
    },
  ];

  // Helper to clean file names into unique DB keys
  const toKey = (filename: string, prefix: string) => {
    return (
      prefix +
      filename
        .replace(/\.(md|txt)$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    );
  };

  // Helper to map files to categories
  const getCategoryAndTitle = (filename: string) => {
    const name = filename.toLowerCase();
    let category = BRAIN_CATEGORIES.PERSONAL_DEVELOPMENT;
    let title = filename.replace(/\.(md|txt)$/, "");

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

  let totalProcessed = 0;
  let totalSynced = 0;

  for (const target of scanTargets) {
    console.log(`Checking ${target.name} at: ${target.path}...`);
    if (!fs.existsSync(target.path)) {
      console.log(`  ⚠️ Path does not exist or is inactive, skipping.`);
      console.log("");
      continue;
    }

    const filePaths = getFilesRecursive(target.path, target.filter);
    console.log(`  Found ${filePaths.length} notes recursively.`);
    console.log("");

    for (const filePath of filePaths) {
      totalProcessed++;
      const file = path.basename(filePath);
      let content = fs.readFileSync(filePath, "utf-8").trim();

      if (!content) {
        console.log(`  Skipping empty file: ${file}`);
        continue;
      }

      const { category, title } = getCategoryAndTitle(file);
      const key = toKey(file, target.prefix);

      // Clean up content: strip markdown frontmatter if present (lines between first --- and second ---)
      if (content.startsWith("---")) {
        const parts = content.split("---");
        if (parts.length >= 3) {
          content = parts.slice(2).join("---").trim();
        }
      }

      // Prefix with title for search clarity
      const fullContent = `[${title}]\n${content}`;

      // Deduplication check: skip if identical content is already stored
      const existing = await prisma.brainMemory.findFirst({
        where: { category, key },
        select: { content: true },
      });

      if (existing && existing.content === fullContent) {
        console.log(`  [Skip] "${file}" is already synced and unchanged.`);
        continue;
      }

      console.log(`  [Processing] ${file}`);
      console.log(`    └─ Path:       ${filePath}`);
      console.log(`    └─ Target Key: ${key}`);
      console.log(`    └─ Category:   ${category}`);
      console.log(`    └─ Size:       ${fullContent.length} chars`);

      try {
        // Ingest note using the native memory-manager (handles embeddings generation via OpenAI)
        await brainMemory.remember(
          category,
          key,
          fullContent,
          "skill_ingestion",
          {
            origin: target.name.toLowerCase().replace(/ /g, "-"),
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
        totalSynced++;
      } catch (err) {
        console.error(`    └─ ❌ Failed to ingest ${file}:`, err);
      }
    }
    console.log("");
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  🎉 Ingestion complete: ${totalSynced}/${totalProcessed} new/modified notes synced.`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Notes Ingestion failed:", err);
  process.exit(1);
});
