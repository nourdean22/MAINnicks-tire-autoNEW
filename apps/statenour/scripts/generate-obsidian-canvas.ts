/**
 * Generate Statenour Brain Canvas (.canvas)
 *
 * Queries active missions and tasks from the Statenour database and generates
 * a visual Kanban-style board in your Obsidian Vault.
 *
 * Run: pnpm tsx scripts/generate-obsidian-canvas.ts
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { getObsidianEngineConfig } from "../lib/obsidian/engine-config";

// Helper to sanitize filename by removing illegal Windows/Linux characters
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").trim();
}

function generateUniqueId(): string {
  return crypto.randomBytes(8).toString("hex");
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  GENERATE OBSIDIAN CANVAS: STATENOUR BRAIN");
  console.log("═══════════════════════════════════════════════════════════");

  const config = getObsidianEngineConfig();
  const vaultPath = config.vaultPath;

  if (!fs.existsSync(vaultPath)) {
    console.error(`❌ Vault directory not found at: ${vaultPath}`);
    process.exit(1);
  }

  const canvasPath = path.join(vaultPath, "Statenour", "Statenour Brain.canvas");
  const targetDir = path.dirname(canvasPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  console.log(`  Querying active missions and tasks...`);
  
  // Get active missions
  const missions = await prisma.mission.findMany({
    where: { deletedAt: null },
    orderBy: { priority: "desc" },
  });

  // Get active tasks (non-completed, non-archived)
  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: {
        notIn: ["DONE", "ARCHIVED"],
      },
    },
    orderBy: {
      autoPriority: "desc",
    },
  });

  console.log(`  Found ${missions.length} active missions and ${tasks.length} pending tasks.`);

  const nodes: any[] = [];
  const edges: any[] = [];

  // Group tasks by missionId
  const tasksByMission = new Map<string, typeof tasks>();
  const orphanedTasks: typeof tasks = [];

  for (const task of tasks) {
    if (task.missionId) {
      if (!tasksByMission.has(task.missionId)) {
        tasksByMission.set(task.missionId, []);
      }
      tasksByMission.get(task.missionId)!.push(task);
    } else {
      orphanedTasks.push(task);
    }
  }

  // Visual layout config
  const colWidth = 350;
  const colSpacing = 80;
  const headerHeight = 120;
  const cardHeight = 110;
  const cardSpacing = 40;

  let currentX = 100;
  const startY = 100;

  // Add the central title card
  const titleNodeId = generateUniqueId();
  nodes.push({
    id: titleNodeId,
    type: "text",
    x: currentX,
    y: startY - 200,
    width: colWidth * 2,
    height: 120,
    text: `# 🧠 Statenour Brain Overview\n*Generated on: ${new Date().toLocaleString()}*\n\nDouble-click headers to open the mission document. Connected cards show active tasks grouped by domain and priority.`,
    color: "6", // Purple
  });

  // 1. Position columns for each active Mission
  for (const mission of missions) {
    const missionTasks = tasksByMission.get(mission.id) || [];
    
    // Mission node (file link to Obsidian note)
    const missionNodeId = generateUniqueId();
    const sanitizedTitle = sanitizeFilename(mission.title);
    const relativeFilePath = `Statenour/Missions/${sanitizedTitle}.md`;

    // Map domains to standard Obsidian Canvas colors
    // "1" (Red), "2" (Orange), "3" (Yellow), "4" (Green), "5" (Cyan), "6" (Purple)
    let colorPreset = "5"; // Cyan default (operations/work)
    if (mission.canonicalDomain === "health" || mission.domain.toLowerCase() === "health") {
      colorPreset = "4"; // Green for health/recovery
    } else if (mission.canonicalDomain === "personal" || mission.domain.toLowerCase() === "personal") {
      colorPreset = "6"; // Purple for personal OS / mastery
    } else if (mission.canonicalDomain === "shop" || mission.domain.toLowerCase() === "shop") {
      colorPreset = "2"; // Orange for shop operations
    }

    nodes.push({
      id: missionNodeId,
      type: "file",
      file: relativeFilePath,
      x: currentX,
      y: startY,
      width: colWidth,
      height: headerHeight,
      color: colorPreset,
    });

    // Draw edge from title to mission header
    edges.push({
      id: generateUniqueId(),
      fromNode: titleNodeId,
      fromSide: "bottom",
      toNode: missionNodeId,
      toSide: "top",
    });

    let currentY = startY + headerHeight + colSpacing;

    // 2. Position tasks under the Mission
    for (const task of missionTasks) {
      const taskNodeId = generateUniqueId();
      
      // Determine task status indicator and card color
      let statusIndicator = "📥"; // Inbox
      let taskColor = "3"; // Yellow for general / ready
      if (task.status === "DOING") {
        statusIndicator = "⚡";
        taskColor = "2"; // Orange for focus
      } else if (task.status === "READY") {
        statusIndicator = "🟢";
        taskColor = "4"; // Green for ready to execute
      }

      const taskText = `### ${statusIndicator} ${task.title}\n` +
        `- **Priority:** ${task.manualPriorityOverride ?? task.autoPriority ?? "None"}\n` +
        (task.dueDate ? `- **Due:** ${new Date(task.dueDate).toLocaleDateString()}\n` : "") +
        (task.energyRequired ? `- **Energy:** ${task.energyRequired}\n` : "");

      nodes.push({
        id: taskNodeId,
        type: "text",
        x: currentX,
        y: currentY,
        width: colWidth,
        height: cardHeight,
        text: taskText,
        color: taskColor,
      });

      // Connect task to its parent mission node
      edges.push({
        id: generateUniqueId(),
        fromNode: missionNodeId,
        fromSide: "bottom",
        toNode: taskNodeId,
        toSide: "top",
      });

      currentY += cardHeight + cardSpacing;
    }

    // Move to next column
    currentX += colWidth + colSpacing;
  }

  // 3. Handle orphaned tasks (Inbox/unassigned)
  if (orphanedTasks.length > 0) {
    const inboxNodeId = generateUniqueId();
    nodes.push({
      id: inboxNodeId,
      type: "text",
      x: currentX,
      y: startY,
      width: colWidth,
      height: headerHeight,
      text: "# 📥 General Inbox\n*Unassigned active tasks*",
      color: "1", // Red
    });

    edges.push({
      id: generateUniqueId(),
      fromNode: titleNodeId,
      fromSide: "bottom",
      toNode: inboxNodeId,
      toSide: "top",
    });

    let currentY = startY + headerHeight + colSpacing;
    for (const task of orphanedTasks) {
      const taskNodeId = generateUniqueId();
      const taskText = `### 📥 ${task.title}\n- **Priority:** ${task.autoPriority ?? "None"}`;

      nodes.push({
        id: taskNodeId,
        type: "text",
        x: currentX,
        y: currentY,
        width: colWidth,
        height: cardHeight,
        text: taskText,
        color: "1", // Red for inbox items
      });

      edges.push({
        id: generateUniqueId(),
        fromNode: inboxNodeId,
        fromSide: "bottom",
        toNode: taskNodeId,
        toSide: "top",
      });

      currentY += cardHeight + cardSpacing;
    }
  }

  // Write canvas structure
  const canvasContent = {
    nodes,
    edges,
  };

  fs.writeFileSync(canvasPath, JSON.stringify(canvasContent, null, 2), "utf-8");
  console.log(`\n  ✅ Successfully created Obsidian Canvas at:`);
  console.log(`     ${canvasPath}`);
  console.log(`     Nodes: ${nodes.length} | Edges: ${edges.length}`);
  console.log("");
}

main()
  .catch((err) => {
    console.error("❌ Failed to generate canvas:", err);
    process.exit(1);
  });
