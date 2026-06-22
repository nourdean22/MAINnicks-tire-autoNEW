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
import { getObsidianEngineConfig, readEngineStatus, writeEngineStatus } from "../lib/obsidian/engine-config";
import { ObsidianEngineStatus, QuarantinedFileInfo } from "../lib/obsidian/types";

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

  const engineConfig = getObsidianEngineConfig();

  const scanTargets = [
    {
      name: "Obsidian Vault",
      path: engineConfig.vaultPath,
      prefix: "obsidian_",
      filter: (f: string) => f.endsWith(".md") && f !== "README.md",
    },
    {
      name: "iCloud Shortcuts Folder",
      path: engineConfig.icloudShortcutsPath,
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

  // Helper to parse YAML frontmatter without external dependencies
  const parseFrontmatter = (fileContent: string) => {
    const result = {
      metadata: {} as Record<string, any>,
      content: fileContent,
    };

    const normalized = fileContent.trim();
    if (!normalized.startsWith("---")) {
      return result;
    }

    const lines = normalized.split(/\r?\n/);
    if (lines[0] !== "---") {
      return result;
    }

    let closingIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        closingIndex = i;
        break;
      }
    }

    if (closingIndex === -1) {
      return result;
    }

    const yamlLines = lines.slice(1, closingIndex);
    const metadata: Record<string, any> = {};

    for (const line of yamlLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;

      const rawKey = trimmed.substring(0, colonIdx).trim();
      let rawVal = trimmed.substring(colonIdx + 1).trim();

      // Strip trailing comments safely
      let commentIdx = -1;
      let inDoubleQuote = false;
      let inSingleQuote = false;
      for (let charIdx = 0; charIdx < rawVal.length; charIdx++) {
        const char = rawVal[charIdx];
        if (char === '"' && !inSingleQuote) {
          inDoubleQuote = !inDoubleQuote;
        } else if (char === "'" && !inDoubleQuote) {
          inSingleQuote = !inSingleQuote;
        } else if (char === '#' && !inDoubleQuote && !inSingleQuote) {
          commentIdx = charIdx;
          break;
        }
      }
      if (commentIdx !== -1) {
        rawVal = rawVal.substring(0, commentIdx).trim();
      }

      if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
        rawVal = rawVal.substring(1, rawVal.length - 1);
      }

      let value: any = rawVal;
      if (rawKey === "tags") {
        if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
          value = rawVal
            .substring(1, rawVal.length - 1)
            .split(",")
            .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
        } else {
          value = rawVal.split(",").map((t) => t.trim()).filter(Boolean);
        }
      } else if (rawVal === "true") {
        value = true;
      } else if (rawVal === "false") {
        value = false;
      } else if (!isNaN(Number(rawVal)) && rawVal !== "") {
        value = Number(rawVal);
      }

      metadata[rawKey] = value;
    }

    result.metadata = metadata;
    result.content = lines.slice(closingIndex + 1).join("\n").trim();
    return result;
  };

  // Helper to map files to categories
  const getCategoryAndTitle = (filename: string) => {
    const name = filename.toLowerCase();
    let category = null; // Default to null for strict validation/quarantine
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
  let totalSkipped = 0;
  let totalQuarantined = 0;
  let totalFailed = 0;

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
      const rawContent = fs.readFileSync(filePath, "utf-8");

      if (!rawContent.trim()) {
        console.log(`  Skipping empty file: ${file}`);
        totalSkipped++;
        continue;
      }

      // Parse YAML frontmatter
      const parsed = parseFrontmatter(rawContent);

      // Gate by sync_direction if present in frontmatter
      const syncDirection = typeof parsed.metadata.sync_direction === "string" 
        ? parsed.metadata.sync_direction.toLowerCase() 
        : null;
      if (syncDirection && syncDirection !== "obsidian_to_statenour" && syncDirection !== "bidirectional") {
        console.log(`  [Skip] "${file}" has sync_direction: "${syncDirection}" (not bidirectional or obsidian_to_statenour).`);
        totalSkipped++;
        continue;
      }

      const { category: filenameCategory, title: filenameTitle } = getCategoryAndTitle(file);
      const category = parsed.metadata.category || filenameCategory;
      const title = parsed.metadata.title || filenameTitle;

      // Strict validation / Quarantine
      if (!category) {
        console.log(`  ⚠️ [Quarantine] "${file}" has no category and does not match filename heuristics.`);
        totalQuarantined++;
        if (target.name === "Obsidian Vault" && fs.existsSync(target.path)) {
          const quarantineDir = path.join(target.path, "Statenour", "Quarantine");
          if (!fs.existsSync(quarantineDir)) {
            fs.mkdirSync(quarantineDir, { recursive: true });
          }
          const destPath = path.join(quarantineDir, file);
          if (filePath !== destPath) {
            try {
              fs.renameSync(filePath, destPath);
              console.log(`    └─ Moved to quarantine: ${destPath}`);
            } catch (renameErr) {
              console.error(`    └─ Failed to move file to quarantine:`, renameErr);
            }
          }
        }
        continue;
      }

      const key = toKey(file, target.prefix);

      // Prefix with title for search clarity
      const fullContent = `[${title}]\n${parsed.content}`;

      // Deduplication check: skip if identical content is already stored
      const existing = await prisma.brainMemory.findFirst({
        where: { category, key },
        select: { content: true },
      });

      if (existing && existing.content === fullContent) {
        console.log(`  [Skip] "${file}" is already synced and unchanged.`);
        totalSkipped++;
        continue;
      }

      console.log(`  [Processing] ${file}`);
      console.log(`    └─ Path:       ${filePath}`);
      console.log(`    └─ Target Key: ${key}`);
      console.log(`    └─ Category:   ${category}`);
      console.log(`    └─ Size:       ${fullContent.length} chars`);

      try {
        // Map all key metadata fields
        const metadataPayload: Record<string, any> = {
          origin: target.name.toLowerCase().replace(/ /g, "-"),
          filename: file,
          title,
          syncedAt: new Date().toISOString(),
        };

        const keysToExtract = [
          "type",
          "status",
          "horizon",
          "priority",
          "confidence",
          "review_due",
          "sync_direction",
          "statenour_id",
          "statenour_model",
          "tags",
        ];

        for (const mKey of keysToExtract) {
          if (parsed.metadata[mKey] !== undefined) {
            metadataPayload[mKey] = parsed.metadata[mKey];
          }
        }

        // Ingest note using the native memory-manager (handles embeddings generation via OpenAI)
        await brainMemory.remember(
          category,
          key,
          fullContent,
          "skill_ingestion",
          metadataPayload
        );

        // Lock confidence to 1.0 (prevents decay) unless confidence is set in frontmatter
        const record = await prisma.brainMemory.findFirst({
          where: { category, key },
        });

        if (record) {
          const yamlConfidence = typeof parsed.metadata.confidence === "number" 
            ? parsed.metadata.confidence 
            : null;
          if (yamlConfidence !== null) {
            await prisma.brainMemory.update({
              where: { id: record.id },
              data: {
                confidence: yamlConfidence,
                expiresAt: null, // Keep permanent since it comes from the vault
              },
            });
            console.log(`    └─ Set custom confidence: ${yamlConfidence}`);
          } else {
            await brainMemory.confirm(record.id);
          }
        }

        console.log(`    └─ ✅ Success`);
        totalSynced++;
      } catch (err) {
        console.error(`    └─ ❌ Failed to ingest ${file}:`, err);
        totalFailed++;
      }
    }
    console.log("");
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  🎉 Ingestion complete: ${totalSynced}/${totalProcessed} new/modified notes synced.`);
  console.log(`    - Skipped: ${totalSkipped}`);
  console.log(`    - Quarantined: ${totalQuarantined}`);
  console.log(`    - Failed: ${totalFailed}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  // Write updated status file
  try {
    const existingStatus = readEngineStatus();
    const hasFailures = totalFailed > 0 || (existingStatus ? existingStatus.health === "error" : false);
    const health = hasFailures ? "error" : (totalQuarantined > 0 || (existingStatus ? existingStatus.health === "degraded" : false) ? "degraded" : "healthy");

    const statusPayload: ObsidianEngineStatus = {
      health,
      lastRunAt: new Date().toISOString(),
      lastDoctorRunAt: existingStatus ? existingStatus.lastDoctorRunAt : null,
      lastIngestRunAt: new Date().toISOString(),
      lastExportRunAt: existingStatus ? existingStatus.lastExportRunAt : null,
      stats: {
        totalNotes: existingStatus ? existingStatus.stats.totalNotes : totalProcessed,
        processed: totalProcessed,
        synced: totalSynced,
        skipped: totalSkipped,
        failed: totalFailed,
        quarantined: totalQuarantined,
        warnings: existingStatus ? existingStatus.stats.warnings : 0,
        failures: totalFailed + (existingStatus ? existingStatus.stats.failures : 0),
      },
      issues: existingStatus ? existingStatus.issues : [],
      quarantinedFiles: existingStatus ? existingStatus.quarantinedFiles : [],
      config: {
        vaultPath: engineConfig.vaultPath,
        icloudShortcutsPath: engineConfig.icloudShortcutsPath,
        syncMode: engineConfig.syncMode,
        restUrl: engineConfig.restUrl
      }
    };

    // Scan Quarantine folder during ingest to make sure quarantinedFiles is always accurate
    const quarantinedFilesList: QuarantinedFileInfo[] = [];
    const quarantineDir = path.join(engineConfig.vaultPath, "Statenour", "Quarantine");
    if (fs.existsSync(quarantineDir)) {
      try {
        const qFiles = fs.readdirSync(quarantineDir).filter(f => f.endsWith(".md") || f.endsWith(".txt"));
        for (const qFile of qFiles) {
          quarantinedFilesList.push({
            filename: qFile,
            relativePath: path.join("Statenour", "Quarantine", qFile),
            reason: "Missing category frontmatter property or failing metadata heuristics during ingestion.",
            detected_at: new Date().toISOString(),
            suggested_fix: "Add valid YAML frontmatter containing 'category: <category>' to this note and move it back to 01_Inbox/ or 10_Statenour/."
          });
        }
      } catch {}
    }
    statusPayload.quarantinedFiles = quarantinedFilesList;
    statusPayload.stats.quarantined = quarantinedFilesList.length;

    writeEngineStatus(statusPayload);
  } catch (writeErr) {
    console.error("  ⚠️ Failed to write engine status file:", writeErr);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Notes Ingestion failed:", err);
  process.exit(1);
});
