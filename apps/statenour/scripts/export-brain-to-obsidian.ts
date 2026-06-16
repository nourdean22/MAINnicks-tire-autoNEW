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

interface GoalShape {
  title: string;
  horizon?: string;
  description?: string;
  status?: string;
  createdAt: Date;
}

interface MissionShape {
  title: string;
  description?: string;
  status?: string;
  targetDate?: string | Date;
  createdAt: Date;
}

interface ReflectionShape {
  content: string;
  kind?: string;
  createdAt: Date;
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
  const memoriesDir = path.join(targetDir, "Memories");
  if (!fs.existsSync(memoriesDir)) fs.mkdirSync(memoriesDir);

  const reflectionsDir = path.join(targetDir, "Reflections");
  if (!fs.existsSync(reflectionsDir)) fs.mkdirSync(reflectionsDir);

  console.log(`  Exporting data into: ${targetDir}`);
  console.log("");

  // 1. Export Active Life Goals
  console.log("  Processing: Life Goals...");
  try {
    const goals = (await prisma.lifeGoal.findMany({
      where: { deletedAt: null },
      orderBy: { horizon: "asc" },
    })) as unknown as GoalShape[];

    let goalsMarkdown = `# 🎯 Statenour Active Life Goals\n\n`;
    goalsMarkdown += `*Last Synced: ${new Date().toLocaleString()}*\n\n`;

    if (goals.length > 0) {
      let currentHorizon = "";
      for (const goal of goals) {
        // Group by horizon if present
        const horizon = goal.horizon || "General";
        if (horizon !== currentHorizon) {
          currentHorizon = horizon;
          goalsMarkdown += `## Horizon: ${currentHorizon}\n\n`;
        }
        goalsMarkdown += `### ${goal.title}\n`;
        if (goal.description) {
          goalsMarkdown += `${goal.description}\n\n`;
        }
        goalsMarkdown += `- **Status:** ${goal.status || "Active"}\n`;
        goalsMarkdown += `- **Created At:** ${goal.createdAt.toLocaleDateString()}\n\n`;
      }
    } else {
      goalsMarkdown += `*No active goals found in Statenour.*\n`;
    }

    fs.writeFileSync(path.join(targetDir, "Life Goals.md"), goalsMarkdown, "utf-8");
    console.log("    └─ ✅ Life Goals.md written");
  } catch (err) {
    console.error("    └─ ❌ Failed to export Life Goals:", err);
  }

  // 2. Export Active Missions
  console.log("  Processing: Active Missions...");
  try {
    const missions = (await prisma.mission.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
    })) as unknown as MissionShape[];

    let missionsMarkdown = `# 📂 Statenour Active Missions\n\n`;
    missionsMarkdown += `*Last Synced: ${new Date().toLocaleString()}*\n\n`;

    if (missions.length > 0) {
      for (const mission of missions) {
        missionsMarkdown += `## ${mission.title}\n\n`;
        if (mission.description) {
          missionsMarkdown += `${mission.description}\n\n`;
        }
        missionsMarkdown += `- **Status:** ${mission.status || "In Progress"}\n`;
        missionsMarkdown += `- **Target Date:** ${mission.targetDate ? new Date(mission.targetDate).toLocaleDateString() : "None"}\n`;
        missionsMarkdown += `- **Created:** ${mission.createdAt.toLocaleDateString()}\n\n`;
      }
    } else {
      missionsMarkdown += `*No active missions found in Statenour.*\n`;
    }

    fs.writeFileSync(path.join(targetDir, "Active Missions.md"), missionsMarkdown, "utf-8");
    console.log("    └─ ✅ Active Missions.md written");
  } catch (err) {
    console.error("    └─ ❌ Failed to export Active Missions:", err);
  }

  // 3. Export Reflections
  console.log("  Processing: Reflections...");
  try {
    const reflections = (await prisma.reflection.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
    })) as unknown as ReflectionShape[];

    let exportedReflections = 0;
    for (const ref of reflections) {
      const dateStr = ref.createdAt.toISOString().split("T")[0];
      const timeStr = ref.createdAt.toTimeString().split(" ")[0].replace(/:/g, "-");
      const filename = `${dateStr}_${timeStr}_reflection.md`;

      const kind = ref.kind || "General";
      let refMarkdown = `# 💭 Statenour Reflection (${kind})\n\n`;
      refMarkdown += `- **Date:** ${ref.createdAt.toLocaleString()}\n`;
      refMarkdown += `- **Kind:** ${kind}\n\n`;
      refMarkdown += `## Content\n\n${ref.content}\n`;

      fs.writeFileSync(path.join(reflectionsDir, filename), refMarkdown, "utf-8");
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
