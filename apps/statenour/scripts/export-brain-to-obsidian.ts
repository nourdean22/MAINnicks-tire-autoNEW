/**
 * Export Statenour Brain Data → Obsidian Vault
 *
 * Queries active life goals, missions, reflections, and memories from the
 * Statenour database and writes them as structured markdown files in the Obsidian Vault.
 *
 * Run: pnpm tsx scripts/export-brain-to-obsidian.ts [--memory-mode=rollup|individual]
 */

import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { getObsidianEngineConfig, readEngineStatus, writeEngineStatus } from "../lib/obsidian/engine-config";
import { ObsidianEngineStatus, EngineIssue } from "../lib/obsidian/types";
import {
  createNotePathClaimer,
  hasIdenticalNewestConflict,
  parseFrontmatter,
  planNoteWrite,
  pruneConflictDir,
  sanitizeFilename,
} from "../lib/obsidian/note-writer";
import {
  exportShortfall,
  findStalePageFiles,
  pageIdsByCategory,
  rollupPageFilename,
} from "../lib/obsidian/memory-rollup";

// Parse CLI arguments
const args = process.argv.slice(2);
let memoryMode: "rollup" | "individual" = "rollup";
const modeArg = args.find(a => a.startsWith("--memory-mode="));
if (modeArg) {
  const val = modeArg.split("=")[1];
  if (val === "individual" || val === "rollup") {
    memoryMode = val;
  }
}

const engineConfig = getObsidianEngineConfig();
const vaultPath = engineConfig.vaultPath;

interface ConflictRecord {
  title: string;
  file: string;
  conflictFile: string;
}

const exportConflicts: ConflictRecord[] = [];
let exportedGoals = 0;
let exportedMissions = 0;
let exportedReflections = 0;
/** One path per record per run; see createNotePathClaimer. */
const claimNotePath = createNotePathClaimer();
let exportedMemories = 0;
let exportFailed = 0;

// How many timestamped conflict copies to retain per note title
const CONFLICT_KEEP_PER_NOTE = 10;

// Safe Note Writer with Conflict Protection
// (write/skip/conflict decision lives in lib/obsidian/note-writer.ts)
function safeWriteNote(
  filePath: string,
  metadata: Record<string, any>,
  body: string
): boolean {
  try {
    const existingRaw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
    const plan = planNoteWrite(existingRaw, metadata, body);

    if (plan.kind === "skip") {
      // Already converged — rewriting would only churn OneDrive and retrigger the watch daemon
      return true;
    }

    if (plan.kind === "conflict") {
      // Sync Conflict! Write copy under Statenour/Quarantine/Conflicts/
      const conflictDir = path.join(vaultPath, "Statenour", "Quarantine", "Conflicts");
      if (!fs.existsSync(conflictDir)) {
        fs.mkdirSync(conflictDir, { recursive: true });
      }

      const sanitizedTitle = sanitizeFilename(metadata.title || path.basename(filePath, ".md"));
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      const conflictFilename = `${sanitizedTitle}.conflict-${timestamp}.md`;

      if (hasIdenticalNewestConflict(conflictDir, sanitizedTitle, plan.content)) {
        console.warn(`  ⚠️  [Conflict] "${sanitizedTitle}" is still modified locally; identical staged copy already in Quarantine/Conflicts/ — not re-stamping.`);
      } else {
        fs.writeFileSync(path.join(conflictDir, conflictFilename), plan.content, "utf-8");
        exportConflicts.push({
          title: metadata.title || sanitizedTitle,
          file: filePath,
          conflictFile: conflictFilename
        });
        console.warn(`  ⚠️  [Conflict] "${sanitizedTitle}" was modified locally in Obsidian. Staged version written to Quarantine/Conflicts/`);
      }
      return false;
    }

    fs.writeFileSync(filePath, plan.content, "utf-8");
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to write note: ${filePath}`, err);
    exportFailed++;
    return false;
  }
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  EXPORT STATENOUR BRAIN → OBSIDIAN VAULT");
  console.log("═══════════════════════════════════════════════════════════");

  if (!fs.existsSync(vaultPath)) {
    console.error(`❌ Vault directory not found at: ${vaultPath}`);
    process.exit(1);
  }

  // Create target Statenour folder in Obsidian Vault
  const targetDir = path.join(vaultPath, "Statenour");
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir);
  }

  // Create subfolders
  const goalsDir = path.join(targetDir, "Goals");
  if (!fs.existsSync(goalsDir)) fs.mkdirSync(goalsDir);

  const missionsDir = path.join(targetDir, "Missions");
  if (!fs.existsSync(missionsDir)) fs.mkdirSync(missionsDir);

  const reflectionsDir = path.join(targetDir, "Reflections");
  if (!fs.existsSync(reflectionsDir)) fs.mkdirSync(reflectionsDir);

  const memoriesDir = path.join(targetDir, "Memories");
  if (!fs.existsSync(memoriesDir)) fs.mkdirSync(memoriesDir);

  // Archive legacy rollup files instead of deleting
  const archiveDir = path.join(targetDir, "Archive", "Legacy Exports");
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const legacyGoalsFile = path.join(targetDir, "Life Goals.md");
  if (fs.existsSync(legacyGoalsFile)) {
    try {
      fs.renameSync(legacyGoalsFile, path.join(archiveDir, "Life Goals.md"));
      console.log("  🧹 Archived legacy Life Goals.md to Statenour/Archive/Legacy Exports/");
    } catch {
      try { fs.unlinkSync(legacyGoalsFile); } catch {}
    }
  }
  const legacyMissionsFile = path.join(targetDir, "Active Missions.md");
  if (fs.existsSync(legacyMissionsFile)) {
    try {
      fs.renameSync(legacyMissionsFile, path.join(archiveDir, "Active Missions.md"));
      console.log("  🧹 Archived legacy Active Missions.md to Statenour/Archive/Legacy Exports/");
    } catch {
      try { fs.unlinkSync(legacyMissionsFile); } catch {}
    }
  }

  console.log(`  Exporting data into: ${targetDir}`);
  console.log(`  Memory Mode: ${memoryMode}`);
  console.log("");

  // 1. Export Active Life Goals
  console.log("  Processing: Life Goals...");
  try {
    const goals = await prisma.lifeGoal.findMany({
      where: { deletedAt: null },
      // Deterministic order: on a title collision the oldest keeps the plain name.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    for (const goal of goals) {
      const sanitizedTitle = sanitizeFilename(goal.title);

      const metadata = {
        title: goal.title,
        type: "goal",
        category: goal.domain,
        status: goal.status,
        horizon: goal.horizon,
        source: "statenour",
        statenour_model: "LifeGoal",
        statenour_id: goal.id,
        sync_direction: "bidirectional",
      };

      let body = `# 🎯 ${goal.title}\n\n`;
      if (goal.why) {
        body += `${goal.why}\n\n`;
      }
      body += `- **Horizon:** ${goal.horizon || "None"}\n`;
      body += `- **Metric:** ${goal.metric} (${goal.targetValue} ${goal.unit || ""})\n`;
      body += `- **Current Value:** ${goal.currentValue} (${goal.progress}%)\n`;
      body += `- **Deadline:** ${goal.deadline ? new Date(goal.deadline).toLocaleDateString() : "None"}\n`;
      body += `- **Status:** ${goal.status}\n`;
      body += `- **Created At:** ${goal.createdAt.toLocaleDateString()}\n\n`;

      if (goal.planData) {
        body += `## Plan Data\n\`\`\`json\n${JSON.stringify(goal.planData, null, 2)}\n\`\`\`\n\n`;
      }

      const success = safeWriteNote(claimNotePath(goalsDir, sanitizedTitle, goal.id), metadata, body);
      if (success) exportedGoals++;
    }
    console.log(`    └─ ✅ ${exportedGoals} individual life goals written to Statenour/Goals/`);
  } catch (err) {
    console.error("    └─ ❌ Failed to export Life Goals:", err);
    exportFailed++;
  }

  // 2. Export Active Missions
  console.log("  Processing: Active Missions...");
  try {
    const missions = await prisma.mission.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    for (const mission of missions) {
      const sanitizedTitle = sanitizeFilename(mission.title);

      const metadata = {
        title: mission.title,
        type: "mission",
        category: mission.canonicalDomain || mission.domain.toLowerCase(),
        status: mission.status.toLowerCase(),
        source: "statenour",
        statenour_model: "Mission",
        statenour_id: mission.id,
        sync_direction: "bidirectional",
      };

      let body = `# 📂 ${mission.title}\n\n`;
      body += `- **Domain:** ${mission.canonicalDomain || mission.domain}\n`;
      body += `- **Status:** ${mission.status}\n`;
      body += `- **Priority:** ${mission.priority}\n`;
      body += `- **ROI Score:** ${mission.roiScore}\n`;
      body += `- **Neglect Cost:** ${mission.neglectCost}\n`;
      body += `- **Success Metric:** ${mission.successMetric || "None"}\n`;
      body += `- **Deadline:** ${mission.deadline ? new Date(mission.deadline).toLocaleDateString() : "None"}\n`;
      body += `- **Created At:** ${mission.createdAt.toLocaleDateString()}\n\n`;

      if (mission.weeklyReviewNote) {
        body += `## Weekly Review Note\n\n${mission.weeklyReviewNote}\n\n`;
      }

      if (mission.planData) {
        body += `## Plan Data\n\`\`\`json\n${JSON.stringify(mission.planData, null, 2)}\n\`\`\`\n\n`;
      }

      const success = safeWriteNote(claimNotePath(missionsDir, sanitizedTitle, mission.id), metadata, body);
      if (success) exportedMissions++;
    }
    console.log(`    └─ ✅ ${exportedMissions} individual missions written to Statenour/Missions/`);
  } catch (err) {
    console.error("    └─ ❌ Failed to export Missions:", err);
    exportFailed++;
  }

  // 3. Export Reflections
  console.log("  Processing: Reflections...");
  try {
    const reflections = await prisma.reflection.findMany({
      where: { deletedAt: null },
      take: 50,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    for (const ref of reflections) {
      const dateStr = ref.createdAt.toISOString().split("T")[0];
      const timeStr = ref.createdAt.toTimeString().split(" ")[0].replace(/:/g, "-");
      const baseName = `${dateStr}_${timeStr}_reflection`;

      const metadata = {
        title: `Reflection ${dateStr} ${ref.createdAt.toTimeString().split(" ")[0]}`,
        type: "reflection",
        category: ref.category,
        status: ref.acknowledged ? "acknowledged" : "pending",
        source: "statenour",
        statenour_model: "Reflection",
        statenour_id: ref.id,
        sync_direction: "bidirectional",
      };

      let body = `# 💭 Statenour Reflection (${ref.scope})\n\n`;
      body += `- **Date:** ${ref.createdAt.toLocaleString()}\n`;
      body += `- **Category:** ${ref.category}\n`;
      body += `- **Confidence:** ${ref.confidence}\n`;
      body += `- **Actionable:** ${ref.actionable ? "Yes" : "No"}\n`;
      body += `- **Acknowledged:** ${ref.acknowledged ? "Yes" : "No"}\n\n`;
      body += `## Insight\n\n${ref.insight}\n\n`;
      body += `## Evidence\n\n${ref.evidence}\n`;

      const success = safeWriteNote(claimNotePath(reflectionsDir, baseName, ref.id), metadata, body);
      if (success) exportedReflections++;
    }
    console.log(`    └─ ✅ ${exportedReflections} reflections written to Statenour/Reflections/`);
  } catch (err) {
    console.error("    └─ ❌ Failed to export Reflections:", err);
    exportFailed++;
  }

  // 4. Export Brain Memories
  console.log("  Processing: Brain Memories...");
  try {
    const memoryWhere = {
      deletedAt: null,
      NOT: {
        OR: [
          { key: { startsWith: "obsidian_" } },
          { category: "morning_brief_audio" },
          { category: "suggestion_hypothesis" },
          { category: "ARCHIVE_DOCUMENT" },
          { category: "GMAIL_THREAD" },
          { category: "GMAIL_OUTGOING" },
          { category: "archive_document" },
          { category: "gmail_thread" },
          { category: "gmail_outgoing" },
        ],
      },
    };

    // Live memories the filter above selects. Every one of them must reach a
    // note (checked after the write loop); a shortfall fails the run.
    const liveCount = await prisma.brainMemory.count({ where: memoryWhere });

    if (memoryMode === "rollup") {
      // Rollup is a READING surface; export-brain-archive.ts owns the backup.
      // No memory is dropped for size: ids are scanned narrow (id + category,
      // oldest first), split into pages of ROLLUP_PAGE_SIZE per category, and
      // full payloads are fetched one page at a time so memory stays bounded.
      // Oldest-first fixed pages mean a new memory only changes its category's
      // last page; earlier pages stay byte-identical and are skipped.
      const candidates = await prisma.brainMemory.findMany({
        where: memoryWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, category: true },
      });
      const pagesByCategory = pageIdsByCategory(candidates);
      const intendedFiles = new Set<string>();
      let pageCount = 0;

      for (const [catName, pages] of pagesByCategory) {
        for (let i = 0; i < pages.length; i++) {
          const pageNumber = i + 1;
          const pageMemories = await prisma.brainMemory.findMany({
            where: { id: { in: pages[i] } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          });
          const filename = rollupPageFilename(catName, pageNumber);
          intendedFiles.add(filename);
          pageCount++;

          const metadata = {
            title: pageNumber === 1 ? `Brain Memories Rollup: ${catName}` : `Brain Memories Rollup: ${catName} part ${pageNumber}`,
            type: "memory_rollup",
            category: catName,
            page: pageNumber,
            source: "statenour",
            sync_direction: "none",
          };

          // No "Last Synced" line in the body: the body must be deterministic for
          // unchanged data or every run rewrites every rollup (frontmatter
          // last_synced_at carries the sync time)
          let body = pageNumber === 1
            ? `# 🧠 Brain Memories: ${catName}\n\n`
            : `# 🧠 Brain Memories: ${catName} (part ${pageNumber})\n\n`;

          for (const mem of pageMemories) {
            body += `## Key: ${mem.key}\n`;
            body += `- **Created:** ${mem.createdAt.toLocaleString()}\n`;
            body += `- **Confidence:** ${mem.confidence}\n\n`;
            body += `### Content:\n\`\`\`\n${mem.content}\n\`\`\`\n\n`;

            if (mem.metadata) {
              body += `#### Metadata:\n\`\`\`json\n${JSON.stringify(mem.metadata, null, 2)}\n\`\`\`\n\n`;
            }
            body += `---\n\n`;
          }

          // Count only memories that really reached the vault (a conflict or a failed write does not).
          if (safeWriteNote(path.join(memoriesDir, filename), metadata, body)) {
            exportedMemories += pageMemories.length;
          }
        }
      }
      console.log(`    └─ ✅ ${exportedMemories} memories in ${pageCount} rollup notes across ${pagesByCategory.size} categories`);

      // Pages the data no longer fills (a category shrank). Only on a clean run,
      // and only files named like our pages AND carrying our rollup frontmatter.
      if (exportShortfall(liveCount, exportedMemories) === 0 && exportFailed === 0) {
        let removed = 0;
        for (const stale of findStalePageFiles(fs.readdirSync(memoriesDir), intendedFiles)) {
          const full = path.join(memoriesDir, stale);
          try {
            if (parseFrontmatter(fs.readFileSync(full, "utf-8")).metadata.type !== "memory_rollup") continue;
            fs.unlinkSync(full);
            removed++;
          } catch {
            // locked or raced: it stays for the next run
          }
        }
        if (removed > 0) console.log(`    └─ 🧹 removed ${removed} stale rollup page(s)`);
      }
    } else {
      const memories = await prisma.brainMemory.findMany({
        where: memoryWhere,
        // Secondary id sort keeps the rendered order stable when createdAt
        // ties — an order flip would read as a content change and rewrite.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });

      // Group memories by category
      const grouped: Record<string, typeof memories> = {};
      for (const mem of memories) {
        if (!grouped[mem.category]) {
          grouped[mem.category] = [];
        }
        grouped[mem.category].push(mem);
      }

      // Individual Mode: Export each memory as an individual markdown file
      for (const category of Object.keys(grouped)) {
        const catMemories = grouped[category];
        const cleanCatName = category.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
        const categorySubdir = path.join(memoriesDir, cleanCatName);
        if (!fs.existsSync(categorySubdir)) {
          fs.mkdirSync(categorySubdir, { recursive: true });
        }

        for (const mem of catMemories) {
          const sanitizedKey = sanitizeFilename(mem.key);

          const metadata = {
            title: mem.key,
            type: "memory",
            category: category,
            source: "statenour",
            statenour_model: "BrainMemory",
            statenour_id: mem.id,
            sync_direction: "bidirectional",
          };

          let body = `# 🧠 Brain Memory: ${mem.key}\n\n`;
          body += `${mem.content}\n\n`;
          
          if (mem.metadata) {
            body += `## Metadata\n\`\`\`json\n${JSON.stringify(mem.metadata, null, 2)}\n\`\`\`\n`;
          }

          const success = safeWriteNote(claimNotePath(categorySubdir, sanitizedKey, mem.id), metadata, body);
          if (success) exportedMemories++;
        }
      }
      console.log(`    └─ ✅ ${exportedMemories} individual memory notes written to Statenour/Memories/`);
    }

    // Exported-vs-live: a shortfall is a failure, never a pass. Counts only.
    const shortfall = exportShortfall(liveCount, exportedMemories);
    if (shortfall > 0) {
      console.error(`    └─ ❌ Memory shortfall: ${exportedMemories} exported of ${liveCount} live (${shortfall} missing)`);
      exportFailed++;
    } else {
      console.log(`    └─ ✅ Memory coverage: ${exportedMemories} exported of ${liveCount} live`);
    }
  } catch (err) {
    console.error("    └─ ❌ Failed to export Brain Memories:", err);
    exportFailed++;
  }

  // Conflict retention: cap staged copies at CONFLICT_KEEP_PER_NOTE per note
  // title (runs every export so a pre-existing backlog also drains)
  try {
    const conflictDir = path.join(vaultPath, "Statenour", "Quarantine", "Conflicts");
    const pruned = pruneConflictDir(conflictDir, CONFLICT_KEEP_PER_NOTE);
    if (pruned.deleted > 0) {
      console.log(`  🧹 Conflict retention: deleted ${pruned.deleted} old conflict copies (kept newest ${pruned.kept}).`);
    }
  } catch (pruneErr) {
    console.error("  ⚠️ Conflict retention pruning failed:", pruneErr);
  }

  // Write updated status file after each export run
  try {
    const existingStatus = readEngineStatus();
    
    // Count export successes, warnings, and conflicts
    const exportWarnings: EngineIssue[] = [];
    if (exportConflicts.length > 0) {
      for (const conf of exportConflicts) {
        exportWarnings.push({
          type: "WARN",
          message: `Sync conflict detected for note: "${conf.title}". A conflict file was written to Statenour/Quarantine/Conflicts/${conf.conflictFile}.`,
          file: conf.file,
          detected_at: new Date().toISOString(),
          suggested_fix: "Compare the conflict file with the note, merge changes, and delete the conflict file."
        });
      }
    }

    const hasFailures = exportFailed > 0 || (existingStatus ? existingStatus.health === "error" : false);
    const health = hasFailures ? "error" : (exportConflicts.length > 0 || (existingStatus ? existingStatus.health === "degraded" : false) ? "degraded" : "healthy");

    const statusPayload: ObsidianEngineStatus = {
      health,
      lastRunAt: new Date().toISOString(),
      lastDoctorRunAt: existingStatus ? existingStatus.lastDoctorRunAt : null,
      lastIngestRunAt: existingStatus ? existingStatus.lastIngestRunAt : null,
      lastExportRunAt: new Date().toISOString(),
      stats: {
        totalNotes: existingStatus ? existingStatus.stats.totalNotes : (exportedGoals + exportedMissions + exportedReflections + exportedMemories),
        processed: exportedGoals + exportedMissions + exportedReflections + exportedMemories,
        synced: exportedGoals + exportedMissions + exportedReflections + exportedMemories - exportConflicts.length,
        skipped: existingStatus ? existingStatus.stats.skipped : 0,
        failed: exportFailed,
        quarantined: existingStatus ? existingStatus.stats.quarantined : 0,
        warnings: exportWarnings.length + (existingStatus ? existingStatus.stats.warnings : 0),
        failures: exportFailed + (existingStatus ? existingStatus.stats.failures : 0),
      },
      issues: [
        ...(existingStatus ? existingStatus.issues.filter(issue => !issue.message.includes("conflict")) : []),
        ...exportWarnings
      ],
      quarantinedFiles: existingStatus ? existingStatus.quarantinedFiles : [],
      config: {
        vaultPath,
        icloudShortcutsPath: engineConfig.icloudShortcutsPath,
        syncMode: engineConfig.syncMode,
        restUrl: engineConfig.restUrl
      }
    };

    await writeEngineStatus(statusPayload);
  } catch (writeErr) {
    console.error("  ⚠️ Failed to write engine status file:", writeErr);
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🎉 Export Complete! All active Statenour OS data is in");
  console.log("  your Obsidian Vault under the 'Statenour/' folder.");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Export failed:", err);
  process.exit(1);
});
