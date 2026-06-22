/**
 * Statenour Research Lab — Ingest Research Pack CLI
 *
 * CLI Usage:
 *   pnpm tsx scripts/ingest-research-pack.ts --slug "nicks-tire-local-seo-domination" [--create-tasks] [--create-decisions] [--dry-run] [--allow-high-stakes-actions]
 */

import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { brainMemory } from "../lib/brain/memory-manager";
import { BRAIN_CATEGORIES } from "../lib/brain/categories";

const args = process.argv.slice(2);
let slug = "";
let createTasks = false;
let createDecisions = false;
let dryRun = false;
let allowHighStakesActions = false;
let force = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--slug" && args[i + 1]) {
    slug = args[i + 1];
    i++;
  } else if (arg === "--create-tasks") {
    createTasks = true;
  } else if (arg === "--create-decisions") {
    createDecisions = true;
  } else if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "--allow-high-stakes-actions") {
    allowHighStakesActions = true;
  } else if (arg === "--force") {
    force = true;
  }
}

if (!slug) {
  console.error("❌ Error: --slug is a required parameter.");
  process.exit(1);
}

const monorepoRoot = path.join(__dirname, "..", "..", "..");
const packDir = path.join(monorepoRoot, "research-packs", slug);
const manifestPath = path.join(packDir, "00_MANIFEST.md");
const manifestJsonPath = path.join(packDir, "manifest.json");
const actionPlanPath = path.join(packDir, "05_ACTION_PLAN.md");

if (!fs.existsSync(manifestPath)) {
  console.error(`❌ Error: Manifest file not found at: ${manifestPath}`);
  process.exit(1);
}

// Parse YAML frontmatter
function parseFrontmatter(fileContent: string) {
  const result = {
    metadata: {} as Record<string, any>,
    content: fileContent,
  };
  const normalized = fileContent.trim();
  if (!normalized.startsWith("---")) return result;
  const lines = normalized.split(/\r?\n/);
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) return result;
  const yamlLines = lines.slice(1, closingIndex);
  const metadata = {} as Record<string, any>;
  for (const line of yamlLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const rawKey = trimmed.substring(0, colonIdx).trim();
    let rawVal = trimmed.substring(colonIdx + 1).trim();
    if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
      rawVal = rawVal.substring(1, rawVal.length - 1);
    }
    metadata[rawKey] = rawVal;
  }
  result.metadata = metadata;
  result.content = lines.slice(closingIndex + 1).join("\n").trim();
  return result;
}

// Simple markdown task list parser
function parseActionPlanTasks(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const tasks: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- [ ]")) {
      const taskText = trimmed.substring(5).trim();
      if (taskText) tasks.push(taskText);
    } else if (trimmed.startsWith("- ") && !trimmed.startsWith("- [x]")) {
      const taskText = trimmed.substring(2).trim();
      if (taskText && !taskText.includes(":") && taskText.length > 5) tasks.push(taskText);
    }
  }
  return tasks;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  INGEST RESEARCH PACK → BRAINMEMORY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Pack Slug:   ${slug}`);
  console.log(`  Tasks:       ${createTasks ? "ENABLED" : "DISABLED"}`);
  console.log(`  Decisions:   ${createDecisions ? "ENABLED" : "DISABLED"}`);
  console.log(`  Dry Run:     ${dryRun ? "YES" : "NO"}`);
  console.log(`  High Stakes: ${allowHighStakesActions ? "ALLOWED" : "RESTRICTED"}`);
  console.log("═══════════════════════════════════════════════════════════");

  const manifestContent = fs.readFileSync(manifestPath, "utf-8");
  const parsed = parseFrontmatter(manifestContent);
  const meta = parsed.metadata;

  const domain = meta.category || "general";
  const title = meta.title || `Research Pack: ${slug}`;
  const key = `pack_${slug}`;

  // Read packHash from manifest.json
  let packHash = "";
  if (fs.existsSync(manifestJsonPath)) {
    try {
      const manifestObj = JSON.parse(fs.readFileSync(manifestJsonPath, "utf-8"));
      packHash = manifestObj.packHash || "";
    } catch {}
  }

  // Deduplication check
  if (!force) {
    try {
      const existingPack = await prisma.brainMemory.findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.RESEARCH_PACK, key } },
      });
      if (existingPack) {
        const existingMeta = (existingPack.metadata as Record<string, any>) || {};
        if (existingMeta.packHash === packHash && packHash) {
          console.log(`[Skip] Research pack "${slug}" already exists with the same content (hash matches: ${packHash}).`);
          process.exit(0);
        }
      }
    } catch (err) {
      console.warn("  ⚠️ Warning: Duplicate check failed to query DB:", err);
    }
  }

  // Health/legal/financial Safety Check
  const isHighStakes = ["health", "finance", "legal"].includes(domain);

  // Ingest Research Pack memory
  console.log(`[Ingest] Storing research pack manifest in BrainMemory...`);
  const metadata = {
    slug,
    domain,
    sourceCount: Number(meta.source_count) || 0,
    confidence: Number(meta.confidence) || 0.85,
    packHash,
    requires_professional_review: isHighStakes ? true : undefined,
    ingestedAt: new Date().toISOString()
  };

  if (dryRun) {
    console.log(`  [Dry Run] Would remember memory: category=${BRAIN_CATEGORIES.RESEARCH_PACK}, key=${key}, metadata=`, metadata);
  } else {
    await brainMemory.remember(
      BRAIN_CATEGORIES.RESEARCH_PACK,
      key,
      manifestContent,
      "research_lab_ingest",
      metadata
    );
    console.log(`  └─ ✅ Manifest saved to key: ${key}`);
  }

  // Resolve default mission for domain (if task creation is needed)
  let matchedMissionId = "";
  if ((createTasks || createDecisions) && !dryRun) {
    try {
      const mission = await prisma.mission.findFirst({
        where: {
          deletedAt: null,
          status: "ACTIVE",
          OR: [
            { canonicalDomain: domain.toUpperCase() },
            { title: { contains: domain, mode: "insensitive" } }
          ]
        }
      });
      if (mission) {
        matchedMissionId = mission.id;
        console.log(`  └─ Found default mission: "${mission.title}" (${mission.id})`);
      } else {
        const fallback = await prisma.mission.findFirst({
          where: { deletedAt: null, status: "ACTIVE" }
        });
        if (fallback) {
          matchedMissionId = fallback.id;
          console.log(`  └─ No exact match. Fallback to active mission: "${fallback.title}" (${fallback.id})`);
        }
      }
    } catch (err) {
      console.error("  ⚠️ Warning: Failed to query active missions:", err);
    }
  }

  // Parse Action items
  const tasks = parseActionPlanTasks(actionPlanPath);
  console.log(`[Ingest] Found ${tasks.length} recommended actions in action plan.`);

  // High-stakes safety block
  if (isHighStakes && !allowHighStakesActions && (createTasks || createDecisions)) {
    console.warn(`  ⚠️ WARNING: Creating tasks or decisions is BLOCKED for high-stakes domain "${domain}".`);
    console.warn(`  Use --allow-high-stakes-actions to explicitly confirm and execute.`);
    createTasks = false;
    createDecisions = false;
  }

  if (createTasks && tasks.length > 0) {
    if (dryRun) {
      for (const tText of tasks) {
        console.log(`  [Dry Run] Would create Task: "${tText}" for mission domain ${domain.toUpperCase()}`);
      }
    } else if (!matchedMissionId) {
      console.error("❌ Error: Cannot create tasks because no active mission is available in the database.");
    } else {
      console.log(`[Ingest] Creating ${tasks.length} tasks in the database...`);
      for (const tText of tasks) {
        try {
          const existing = await prisma.task.findFirst({
            where: {
              deletedAt: null,
              title: tText,
              missionId: matchedMissionId
            }
          });

          if (existing) {
            console.log(`  [Skip] Task already exists: "${tText}"`);
            continue;
          }

          await prisma.task.create({
            data: {
              title: tText,
              missionId: matchedMissionId,
              status: "INBOX",
              nextPhysicalAction: tText,
              effort: "M15",
              roiScore: 50,
              frictionScore: 50,
              energyRequired: "MEDIUM",
              context: "DESK",
              finishCondition: "Complete research task",
              createdBy: "research_lab"
            }
          });
          console.log(`  └─ Created: "${tText}"`);
        } catch (err) {
          console.error(`  ❌ Failed to create task "${tText}":`, err);
        }
      }
    }
  }

  if (createDecisions && tasks.length > 0) {
    const decisionTasks = tasks.filter(t => t.toLowerCase().includes("decision") || t.toLowerCase().includes("choose") || t.toLowerCase().includes("select"));
    
    if (dryRun) {
      for (const dText of decisionTasks) {
        console.log(`  [Dry Run] Would create MasteryDecision: "${dText}" under domain ${domain}`);
      }
    } else {
      console.log(`[Ingest] Creating decision items...`);
      for (const dText of decisionTasks) {
        try {
          await prisma.masteryDecision.create({
            data: {
              date: new Date().toISOString().split("T")[0],
              title: dText,
              domain,
              context: `Extracted from research pack: ${slug}`,
              createdBy: "research_lab"
            }
          });
          console.log(`  └─ Created MasteryDecision: "${dText}"`);
        } catch (err) {
          console.error(`  ❌ Failed to create decision "${dText}":`, err);
        }
      }
    }
  }

  // Update status file
  if (!dryRun) {
    try {
      const runtimeDir = path.join(monorepoRoot, "apps", "statenour", ".runtime");
      const statusPath = path.join(runtimeDir, "research-lab-status.json");
      if (fs.existsSync(statusPath)) {
        const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
        status.lastIngest = new Date().toISOString();
        status.packsAwaitingNotebookLMReview = status.packsAwaitingNotebookLMReview.filter((s: string) => s !== slug);
        if (!status.packsAwaitingActionExtraction.includes(slug)) {
          status.packsAwaitingActionExtraction.push(slug);
        }
        fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf-8");
      }
    } catch {}
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  🎉 RESEARCH PACK INGEST COMPLETED! ${dryRun ? "(DRY RUN)" : ""}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Research Pack Ingestion failed:", err);
  process.exit(1);
});
