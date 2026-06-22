/**
 * Statenour Research Lab — Ingest NotebookLM Output CLI
 *
 * CLI Usage:
 *   pnpm tsx scripts/ingest-notebooklm-output.ts --slug "nicks-tire-local-seo-domination" [--file C:\path\to\claims.md] [--create-tasks] [--create-decisions] [--dry-run] [--allow-high-stakes-actions]
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { brainMemory } from "../lib/brain/memory-manager";
import { BRAIN_CATEGORIES } from "../lib/brain/categories";
import { getEmbedding } from "../lib/ai/provider";
import { cosineSimilarity } from "../lib/brain/embedding-utils";

// Parse CLI Args
const args = process.argv.slice(2);
let slug = "";
let specificFilePath = "";
let createTasks = false;
let createDecisions = false;
let dryRun = false;
let allowHighStakesActions = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--slug" && args[i + 1]) {
    slug = args[i + 1];
    i++;
  } else if (arg === "--file" && args[i + 1]) {
    specificFilePath = args[i + 1];
    i++;
  } else if (arg === "--create-tasks") {
    createTasks = true;
  } else if (arg === "--create-decisions") {
    createDecisions = true;
  } else if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "--allow-high-stakes-actions") {
    allowHighStakesActions = true;
  }
}

if (!slug) {
  console.error("❌ Error: --slug is a required parameter.");
  process.exit(1);
}

const monorepoRoot = path.join(__dirname, "..", "..", "..");
const packDir = path.join(monorepoRoot, "research-packs", slug);
const uploadSourcesPath = path.join(packDir, "notebooklm-upload", "sources.md");
const embeddingsCachePath = path.join(packDir, ".sources-embeddings.json");
const manifestJsonPath = path.join(packDir, "manifest.json");

if (!fs.existsSync(packDir)) {
  console.error(`❌ Error: Research pack directory not found at: ${packDir}`);
  process.exit(1);
}

// Read domain from manifest.json
let domain = "general";
if (fs.existsSync(manifestJsonPath)) {
  try {
    const manifestObj = JSON.parse(fs.readFileSync(manifestJsonPath, "utf-8"));
    domain = manifestObj.domain || "general";
  } catch {}
}

const isHighStakes = ["health", "finance", "legal"].includes(domain);

// Helper to chunk text for vector grounding
function chunkText(text: string, chunkSize = 1200, overlap = 200): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if ((currentChunk + "\n\n" + para).length <= chunkSize) {
      currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      if (para.length > chunkSize) {
        let remaining = para;
        while (remaining.length > chunkSize) {
          chunks.push(remaining.substring(0, chunkSize));
          remaining = remaining.substring(chunkSize - overlap);
        }
        currentChunk = remaining;
      } else {
        currentChunk = para;
      }
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

// Generate or load chunk embeddings cache
async function getOrBuildSourcesEmbeddings(): Promise<{ chunk: string; embedding: number[] }[]> {
  if (fs.existsSync(embeddingsCachePath)) {
    console.log(`[Grounding] Loading cached source embeddings from: .sources-embeddings.json`);
    try {
      return JSON.parse(fs.readFileSync(embeddingsCachePath, "utf-8"));
    } catch (err) {
      console.warn(`  ⚠️ Warning: Failed to parse embeddings cache, rebuilding...`);
    }
  }

  if (!fs.existsSync(uploadSourcesPath)) {
    console.warn(`  ⚠️ Warning: Upload sources file not found at ${uploadSourcesPath}. Grounding will be skipped.`);
    return [];
  }

  console.log(`[Grounding] Cache not found. Generating source embeddings (chunking sources)...`);
  const sourcesContent = fs.readFileSync(uploadSourcesPath, "utf-8");
  const chunks = chunkText(sourcesContent);
  console.log(`  └─ Split sources into ${chunks.length} chunks.`);

  const list: { chunk: string; embedding: number[] }[] = [];
  let successCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    process.stdout.write(`  └─ Embedding chunk ${i + 1}/${chunks.length}...\r`);
    try {
      const emb = await getEmbedding(chunk);
      if (emb && emb.length > 0) {
        list.push({ chunk, embedding: emb });
        successCount++;
      }
      // Small rate limit delay
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      console.error(`\n  ❌ Failed to embed chunk ${i + 1}:`, err);
    }
  }
  console.log(`\n  └─ Successfully embedded ${successCount}/${chunks.length} chunks.`);

  if (list.length > 0) {
    try {
      fs.writeFileSync(embeddingsCachePath, JSON.stringify(list, null, 2), "utf-8");
      console.log(`  └─ Saved source embeddings cache.`);
    } catch (err) {
      console.error("  ❌ Failed to write embeddings cache file:", err);
    }
  }

  return list;
}

interface ExtractedItem {
  text: string;
  category: string;
  citation?: string;
}

// Smart Markdown parser for NotebookLM output
function parseNotebookLMOutput(content: string, defaultCategory = BRAIN_CATEGORIES.RESEARCH_CLAIM): ExtractedItem[] {
  const lines = content.split(/\r?\n/);
  const items: ExtractedItem[] = [];
  let currentCategory = defaultCategory;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect header sections to adjust category context
    if (trimmed.startsWith("#")) {
      const lowerHeader = trimmed.toLowerCase();
      if (lowerHeader.includes("claim") || lowerHeader.includes("finding")) {
        currentCategory = BRAIN_CATEGORIES.RESEARCH_CLAIM;
      } else if (lowerHeader.includes("contradict") || lowerHeader.includes("counter") || lowerHeader.includes("debate")) {
        currentCategory = BRAIN_CATEGORIES.RESEARCH_CONTRADICTION;
      } else if (lowerHeader.includes("action") || lowerHeader.includes("plan") || lowerHeader.includes("task") || lowerHeader.includes("todo")) {
        currentCategory = BRAIN_CATEGORIES.RESEARCH_ACTION;
      } else if (lowerHeader.includes("question")) {
        currentCategory = BRAIN_CATEGORIES.RESEARCH_QUESTION;
      }
      continue;
    }

    // Match list items
    const listMatch = trimmed.match(/^(?:-\s*\[\s*\]|-\s*|\*\s*|\d+\.\s*)(.+)$/);
    if (listMatch) {
      let text = listMatch[1].trim();
      if (!text) continue;

      // Extract Citations like (Source 1), [Sources: sources.md], etc.
      let citation: string | undefined;
      const citationMatch = text.match(/[\(\[]\s*sources?:?\s*([^\)\]]+)[\)\]]\s*$/i);
      if (citationMatch) {
        citation = citationMatch[1].trim();
        text = text.substring(0, text.length - citationMatch[0].length).trim();
      }

      items.push({
        text,
        category: currentCategory,
        citation,
      });
    }
  }

  return items;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  INGEST NOTEBOOKLM OUTPUT → GROUNDING & BRAINMEMORY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Pack Slug:  ${slug}`);
  console.log(`  Domain:     ${domain}`);
  console.log(`  Tasks:      ${createTasks ? "ENABLED" : "DISABLED"}`);
  console.log(`  Decisions:  ${createDecisions ? "ENABLED" : "DISABLED"}`);
  console.log(`  Dry Run:    ${dryRun ? "YES" : "NO"}`);
  console.log(`  HighStakes: ${allowHighStakesActions ? "ALLOWED" : "RESTRICTED"}`);
  console.log("═══════════════════════════════════════════════════════════");

  // Determine output files to read
  const filesToRead: string[] = [];
  if (specificFilePath) {
    const resolvedPath = path.resolve(specificFilePath);
    if (fs.existsSync(resolvedPath)) {
      filesToRead.push(resolvedPath);
    } else {
      console.error(`❌ Error: Specified file path does not exist: ${specificFilePath}`);
      process.exit(1);
    }
  } else {
    // Standard directories search
    const outputDir = path.join(packDir, "notebooklm-output");
    if (fs.existsSync(outputDir)) {
      const dirFiles = fs.readdirSync(outputDir);
      for (const file of dirFiles) {
        if (file.endsWith(".md") || file.endsWith(".txt")) {
          filesToRead.push(path.join(outputDir, file));
        }
      }
    }
    
    // Check if the pack files themselves have content pasted
    const claimsPath = path.join(packDir, "03_CLAIMS.md");
    const contradictionsPath = path.join(packDir, "04_CONTRADICTIONS.md");
    const actionPlanPath = path.join(packDir, "05_ACTION_PLAN.md");

    if (fs.existsSync(claimsPath) && fs.readFileSync(claimsPath, "utf-8").includes("- ")) {
      filesToRead.push(claimsPath);
    }
    if (fs.existsSync(contradictionsPath) && fs.readFileSync(contradictionsPath, "utf-8").includes("- ")) {
      filesToRead.push(contradictionsPath);
    }
    if (fs.existsSync(actionPlanPath) && fs.readFileSync(actionPlanPath, "utf-8").includes("- ")) {
      filesToRead.push(actionPlanPath);
    }
  }

  if (filesToRead.length === 0) {
    console.log("⚠️ No NotebookLM output files found to ingest.");
    console.log(`Place markdown outputs inside: research-packs/${slug}/notebooklm-output/`);
    process.exit(0);
  }

  // Gather Source embeddings cache
  const cachedSources = await getOrBuildSourcesEmbeddings();

  console.log(`[Ingest] Processing ${filesToRead.length} output files...`);
  const allItems: ExtractedItem[] = [];

  for (const filePath of filesToRead) {
    console.log(`  └─ Reading file: ${path.basename(filePath)}`);
    const content = fs.readFileSync(filePath, "utf-8");
    
    // Determine default category based on filename
    let defaultCat = BRAIN_CATEGORIES.RESEARCH_CLAIM;
    const lowerName = path.basename(filePath).toLowerCase();
    if (lowerName.includes("contradiction") || lowerName.includes("debate")) {
      defaultCat = BRAIN_CATEGORIES.RESEARCH_CONTRADICTION;
    } else if (lowerName.includes("action") || lowerName.includes("plan") || lowerName.includes("task") || lowerName.includes("todo")) {
      defaultCat = BRAIN_CATEGORIES.RESEARCH_ACTION;
    } else if (lowerName.includes("question")) {
      defaultCat = BRAIN_CATEGORIES.RESEARCH_QUESTION;
    }

    const parsed = parseNotebookLMOutput(content, defaultCat);
    allItems.push(...parsed);
  }

  console.log(`  └─ Parsed ${allItems.length} total items.`);

  let ingestedCount = 0;
  let flaggedCount = 0;

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
      if (mission) matchedMissionId = mission.id;
    } catch {}
  }

  // High-stakes safety block
  let blockHighStakes = false;
  if (isHighStakes && !allowHighStakesActions && (createTasks || createDecisions)) {
    console.warn(`  ⚠️ WARNING: Task/Decision creation is BLOCKED for high-stakes domain "${domain}".`);
    console.warn(`  Pass --allow-high-stakes-actions to explicitly authorize creation.`);
    blockHighStakes = true;
  }

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    console.log(`\n[Item ${i + 1}/${allItems.length}] Category: ${item.category}`);
    console.log(`  Content: "${item.text.slice(0, 100)}${item.text.length > 100 ? "..." : ""}"`);
    if (item.citation) console.log(`  Citation: ${item.citation}`);

    let verificationScore = 1.0;
    let requiresVerification = false;
    let verificationStatus = "source_supported";
    let bestMatchChunk = "";

    // Perform Hallucination Guard semantic grounding check (Rule 6 + Rule 7)
    const isGroundable = item.category === BRAIN_CATEGORIES.RESEARCH_CLAIM || item.category === BRAIN_CATEGORIES.RESEARCH_CONTRADICTION;
    if (cachedSources.length > 0 && isGroundable) {
      process.stdout.write(`  └─ Grounding claim against source files...`);
      try {
        const claimVec = await getEmbedding(item.text);
        if (claimVec && claimVec.length > 0) {
          let maxSim = 0;
          for (const src of cachedSources) {
            const sim = cosineSimilarity(claimVec, src.embedding);
            if (sim > maxSim) {
              maxSim = sim;
              bestMatchChunk = src.chunk;
            }
          }
          verificationScore = Math.round(maxSim * 100) / 100;
          
          // Tiered semantic verification (Rule 7)
          if (verificationScore >= 0.80) {
            verificationStatus = "source_supported";
            requiresVerification = false;
          } else if (verificationScore >= 0.55) {
            verificationStatus = "weak_support";
            requiresVerification = true;
          } else {
            verificationStatus = "requires_source_verification";
            requiresVerification = true;
          }

          console.log(` Done. Score: ${verificationScore} [${verificationStatus.toUpperCase()}]`);
        } else {
          console.log(` Skipped (embedding unavailable).`);
          requiresVerification = true;
          verificationStatus = "requires_source_verification";
          verificationScore = 0.0;
        }
      } catch (err) {
        console.log(` Error.`);
        console.error("  ❌ Embedding failed during grounding check:", err);
        requiresVerification = true;
        verificationStatus = "requires_source_verification";
        verificationScore = 0.0;
      }
    } else {
      console.log(`  └─ Skipping grounding check (no sources, or not claim/contradiction).`);
      // NotebookLM output is not source truth - defaults to verification needed if not groundable
      if (isGroundable) {
        requiresVerification = true;
        verificationStatus = "requires_source_verification";
      }
    }

    // Generate deterministic key to prevent duplicate items on re-runs
    const hash = crypto.createHash("sha1").update(item.text).digest("hex").slice(0, 8);
    const key = `research_${slug}_${item.category.replace("research_", "")}_${hash}`;

    const metadata = {
      slug,
      source: "notebooklm_output", // Rule 6 - Tag NotebookLM source
      citation: item.citation || undefined,
      requiresSourceVerification: requiresVerification,
      verification_status: verificationStatus, // Rule 7 - Tiered status
      verificationScore,
      bestMatchChunk: requiresVerification && bestMatchChunk ? bestMatchChunk.slice(0, 300) : undefined,
      requires_professional_review: isHighStakes ? true : undefined, // Rule 8 - Safety Review
      ingestedAt: new Date().toISOString(),
    };

    // Deduplication check: verify memory row doesn't already exist
    let alreadyExists = false;
    try {
      const existing = await prisma.brainMemory.findUnique({
        where: { category_key: { category: item.category, key } }
      });
      if (existing) {
        alreadyExists = true;
        console.log(`  [Skip] Memory key ${key} already exists in DB.`);
      }
    } catch {}

    if (!alreadyExists) {
      if (dryRun) {
        console.log(`  [Dry Run] Would remember memory: category=${item.category}, key=${key}, metadata=`, metadata);
        ingestedCount++;
        if (requiresVerification) flaggedCount++;
      } else {
        try {
          await brainMemory.remember(
            item.category,
            key,
            item.text,
            "notebooklm_output",
            metadata
          );
          ingestedCount++;
          if (requiresVerification) flaggedCount++;
          console.log(`  └─ ✅ Ingested memory key: ${key}`);
        } catch (err) {
          console.error(`  ❌ Failed to save memory to database:`, err);
        }
      }
    }

    // Optional task creation
    if (createTasks && item.category === BRAIN_CATEGORIES.RESEARCH_ACTION && !blockHighStakes) {
      if (dryRun) {
        console.log(`  [Dry Run] Would create Task: "${item.text}"`);
      } else if (matchedMissionId) {
        try {
          const taskExists = await prisma.task.findFirst({
            where: { title: item.text, missionId: matchedMissionId, deletedAt: null }
          });
          if (taskExists) {
            console.log(`  [Skip] Task already exists: "${item.text}"`);
          } else {
            await prisma.task.create({
              data: {
                title: item.text,
                missionId: matchedMissionId,
                status: "INBOX",
                nextPhysicalAction: item.text,
                effort: "M15",
                roiScore: 50,
                frictionScore: 50,
                energyRequired: "MEDIUM",
                context: "DESK",
                finishCondition: "Extracted from research",
                createdBy: "research_lab"
              }
            });
            console.log(`  └─ ✅ Created task: "${item.text}"`);
          }
        } catch (err) {
          console.error("  ❌ Failed to create task:", err);
        }
      }
    }

    // Optional decision creation
    if (createDecisions && item.category === BRAIN_CATEGORIES.RESEARCH_ACTION && !blockHighStakes) {
      const isDecision = item.text.toLowerCase().includes("decision") || item.text.toLowerCase().includes("choose") || item.text.toLowerCase().includes("select");
      if (isDecision) {
        if (dryRun) {
          console.log(`  [Dry Run] Would create MasteryDecision: "${item.text}"`);
        } else {
          try {
            await prisma.masteryDecision.create({
              data: {
                date: new Date().toISOString().split("T")[0],
                title: item.text,
                domain,
                context: `Extracted from NotebookLM output pack: ${slug}`,
                createdBy: "research_lab"
              }
            });
            console.log(`  └─ ✅ Created MasteryDecision: "${item.text}"`);
          } catch (err) {
            console.error("  ❌ Failed to create decision:", err);
          }
        }
      }
    }
  }

  // Update status
  if (!dryRun) {
    try {
      const runtimeDir = path.join(monorepoRoot, "apps", "statenour", ".runtime");
      const statusPath = path.join(runtimeDir, "research-lab-status.json");
      if (fs.existsSync(statusPath)) {
        const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
        status.lastIngest = new Date().toISOString();
        status.packsAwaitingNotebookLMReview = status.packsAwaitingNotebookLMReview.filter((s: string) => s !== slug);
        status.packsAwaitingActionExtraction = status.packsAwaitingActionExtraction.filter((s: string) => s !== slug);
        fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf-8");
      }
    } catch {}
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  🎉 INGESTION RUN SUMMARY ${dryRun ? "(DRY RUN)" : ""}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Total Items Parsed:      ${allItems.length}`);
  console.log(`  Successfully Ingested:  ${ingestedCount}`);
  console.log(`  Flagged Hallucinations: ${flaggedCount}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Output Ingestion failed:", err);
  process.exit(1);
});
