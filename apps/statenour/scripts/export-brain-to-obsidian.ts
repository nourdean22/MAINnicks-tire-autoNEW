/**
 * Export Statenour Brain Data → Obsidian Vault · 2026-06-16
 *
 * Queries active life goals, missions, reflections, and memories from the
 * Statenour database and writes them as structured markdown files in the Obsidian Vault.
 *
 * Run: pnpm tsx scripts/export-brain-to-obsidian.ts
 */

import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";

// Helper to sanitize filename by removing illegal Windows/Linux characters
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "")
    .trim();
}

// Helper to build frontmatter YAML string
function buildFrontmatter(metadata: Record<string, any>): string {
  let yaml = "---\n";
  for (const [key, val] of Object.entries(metadata)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      yaml += `${key}: [${val.map(v => typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : v).join(", ")}]\n`;
    } else if (typeof val === "object") {
      yaml += `${key}: ${JSON.stringify(val)}\n`;
    } else if (typeof val === "string") {
      yaml += `${key}: "${val.replace(/"/g, '\\"')}"\n`;
    } else {
      yaml += `${key}: ${val}\n`;
    }
  }
  yaml += "---\n";
  return yaml;
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  EXPORT STATENOUR BRAIN → OBSIDIAN VAULT");
  console.log("═══════════════════════════════════════════════════════════");

  const vaultPath = "C:\\Users\\nourd\\OneDrive\\Documents\\Obsidian Vault";
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

  // Remove legacy rollup files to prevent duplicate information
  const legacyGoalsFile = path.join(targetDir, "Life Goals.md");
  if (fs.existsSync(legacyGoalsFile)) {
    try {
      fs.unlinkSync(legacyGoalsFile);
      console.log("  🧹 Removed legacy Life Goals.md");
    } catch {}
  }
  const legacyMissionsFile = path.join(targetDir, "Active Missions.md");
  if (fs.existsSync(legacyMissionsFile)) {
    try {
      fs.unlinkSync(legacyMissionsFile);
      console.log("  🧹 Removed legacy Active Missions.md");
    } catch {}
  }

  console.log(`  Exporting data into: ${targetDir}`);
  console.log("");

  // 1. Export Active Life Goals
  console.log("  Processing: Life Goals...");
  try {
    const goals = await prisma.lifeGoal.findMany({
      where: { deletedAt: null },
    });

    let exportedGoals = 0;
    for (const goal of goals) {
      const sanitizedTitle = sanitizeFilename(goal.title);
      const filename = `${sanitizedTitle}.md`;

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
        last_synced_at: new Date().toISOString(),
      };

      let content = buildFrontmatter(metadata);
      content += `# 🎯 ${goal.title}\n\n`;
      if (goal.why) {
        content += `${goal.why}\n\n`;
      }
      content += `- **Horizon:** ${goal.horizon || "None"}\n`;
      content += `- **Metric:** ${goal.metric} (${goal.targetValue} ${goal.unit || ""})\n`;
      content += `- **Current Value:** ${goal.currentValue} (${goal.progress}%)\n`;
      content += `- **Deadline:** ${goal.deadline ? new Date(goal.deadline).toLocaleDateString() : "None"}\n`;
      content += `- **Status:** ${goal.status}\n`;
      content += `- **Created At:** ${goal.createdAt.toLocaleDateString()}\n\n`;

      if (goal.planData) {
        content += `## Plan Data\n\`\`\`json\n${JSON.stringify(goal.planData, null, 2)}\n\`\`\`\n\n`;
      }

      fs.writeFileSync(path.join(goalsDir, filename), content, "utf-8");
      exportedGoals++;
    }
    console.log(`    └─ ✅ ${exportedGoals} individual life goals written to Statenour/Goals/`);
  } catch (err) {
    console.error("    └─ ❌ Failed to export Life Goals:", err);
  }

  // 2. Export Active Missions
  console.log("  Processing: Active Missions...");
  try {
    const missions = await prisma.mission.findMany({
      where: { deletedAt: null },
    });

    let exportedMissions = 0;
    for (const mission of missions) {
      const sanitizedTitle = sanitizeFilename(mission.title);
      const filename = `${sanitizedTitle}.md`;

      const metadata = {
        title: mission.title,
        type: "mission",
        category: mission.canonicalDomain || mission.domain.toLowerCase(),
        status: mission.status.toLowerCase(),
        source: "statenour",
        statenour_model: "Mission",
        statenour_id: mission.id,
        sync_direction: "bidirectional",
        last_synced_at: new Date().toISOString(),
      };

      let content = buildFrontmatter(metadata);
      content += `# 📂 ${mission.title}\n\n`;
      content += `- **Domain:** ${mission.canonicalDomain || mission.domain}\n`;
      content += `- **Status:** ${mission.status}\n`;
      content += `- **Priority:** ${mission.priority}\n`;
      content += `- **ROI Score:** ${mission.roiScore}\n`;
      content += `- **Neglect Cost:** ${mission.neglectCost}\n`;
      content += `- **Success Metric:** ${mission.successMetric || "None"}\n`;
      content += `- **Deadline:** ${mission.deadline ? new Date(mission.deadline).toLocaleDateString() : "None"}\n`;
      content += `- **Created At:** ${mission.createdAt.toLocaleDateString()}\n\n`;

      if (mission.weeklyReviewNote) {
        content += `## Weekly Review Note\n\n${mission.weeklyReviewNote}\n\n`;
      }

      if (mission.planData) {
        content += `## Plan Data\n\`\`\`json\n${JSON.stringify(mission.planData, null, 2)}\n\`\`\`\n\n`;
      }

      fs.writeFileSync(path.join(missionsDir, filename), content, "utf-8");
      exportedMissions++;
    }
    console.log(`    └─ ✅ ${exportedMissions} individual missions written to Statenour/Missions/`);
  } catch (err) {
    console.error("    └─ ❌ Failed to export Missions:", err);
  }

  // 3. Export Reflections
  console.log("  Processing: Reflections...");
  try {
    const reflections = await prisma.reflection.findMany({
      where: { deletedAt: null },
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    let exportedReflections = 0;
    for (const ref of reflections) {
      const dateStr = ref.createdAt.toISOString().split("T")[0];
      const timeStr = ref.createdAt.toTimeString().split(" ")[0].replace(/:/g, "-");
      const filename = `${dateStr}_${timeStr}_reflection.md`;

      const metadata = {
        title: `Reflection ${dateStr} ${ref.createdAt.toTimeString().split(" ")[0]}`,
        type: "reflection",
        category: ref.category,
        status: ref.acknowledged ? "acknowledged" : "pending",
        source: "statenour",
        statenour_model: "Reflection",
        statenour_id: ref.id,
        sync_direction: "bidirectional",
        last_synced_at: new Date().toISOString(),
      };

      let content = buildFrontmatter(metadata);
      content += `# 💭 Statenour Reflection (${ref.scope})\n\n`;
      content += `- **Date:** ${ref.createdAt.toLocaleString()}\n`;
      content += `- **Category:** ${ref.category}\n`;
      content += `- **Confidence:** ${ref.confidence}\n`;
      content += `- **Actionable:** ${ref.actionable ? "Yes" : "No"}\n`;
      content += `- **Acknowledged:** ${ref.acknowledged ? "Yes" : "No"}\n\n`;
      content += `## Insight\n\n${ref.insight}\n\n`;
      content += `## Evidence\n\n${ref.evidence}\n`;

      fs.writeFileSync(path.join(reflectionsDir, filename), content, "utf-8");
      exportedReflections++;
    }
    console.log(`    └─ ✅ ${exportedReflections} reflections written to Statenour/Reflections/`);
  } catch (err) {
    console.error("    └─ ❌ Failed to export Reflections:", err);
  }

  // 4. Export Brain Memories (excluding obsidian imports and system artifacts)
  console.log("  Processing: Brain Memories...");
  try {
    const memories = await prisma.brainMemory.findMany({
      where: {
        deletedAt: null,
        NOT: {
          OR: [
            { key: { startsWith: "obsidian_" } },
            { category: "morning_brief_audio" },
            { category: "suggestion_hypothesis" }
          ]
        }
      },
      orderBy: { createdAt: "desc" }
    });

    // Group memories by category
    const grouped: Record<string, typeof memories> = {};
    for (const mem of memories) {
      if (!grouped[mem.category]) {
        grouped[mem.category] = [];
      }
      grouped[mem.category].push(mem);
    }

    let exportedMemories = 0;
    for (const category of Object.keys(grouped)) {
      const catMemories = grouped[category];
      
      // Sanitize category name for filename
      const cleanCatName = category.toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
      const filename = `${cleanCatName}.md`;

      let catMarkdown = `# 🧠 Brain Memories: ${cleanCatName}\n\n`;
      catMarkdown += `*Last Synced: ${new Date().toLocaleString()}*\n\n`;

      for (const mem of catMemories) {
        catMarkdown += `## Key: ${mem.key}\n`;
        catMarkdown += `- **Created:** ${mem.createdAt.toLocaleString()}\n`;
        catMarkdown += `- **Confidence:** ${mem.confidence}\n\n`;
        catMarkdown += `### Content:\n\`\`\`\n${mem.content}\n\`\`\`\n\n`;
        
        // Metadata formatting
        if (mem.metadata) {
          catMarkdown += `#### Metadata:\n\`\`\`json\n${JSON.stringify(mem.metadata, null, 2)}\n\`\`\`\n\n`;
        }
        
        catMarkdown += `---\n\n`;
        exportedMemories++;
      }

      fs.writeFileSync(path.join(memoriesDir, filename), catMarkdown, "utf-8");
    }
    console.log(`    └─ ✅ Synced all active memories into ${Object.keys(grouped).length} category markdown logs`);
  } catch (err) {
    console.error("    └─ ❌ Failed to export Brain Memories:", err);
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
