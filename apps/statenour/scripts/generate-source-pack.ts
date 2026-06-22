/**
 * Statenour Research Lab — NotebookLM Source Pack Generator CLI
 *
 * CLI Usage:
 *   pnpm tsx scripts/generate-source-pack.ts --topic "Nick's Tire local SEO domination" --domain business --depth standard
 *   pnpm tsx scripts/generate-source-pack.ts --topic "Ollama GLM-5.2 provider routing" --domain ai_system --include-repo --source https://ollama.com/blog/llama3
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { getObsidianEngineConfig } from "../lib/obsidian/engine-config";
import { scrapeUrl, isFirecrawlConfigured } from "../lib/integrations/firecrawl";
import { ResearchDomain, ResearchSource, ResearchSourceType, ResearchPack } from "../lib/research/types";

// Parse CLI Args
const args = process.argv.slice(2);
let topic = "";
let domain: ResearchDomain = "general";
let purpose = "";
let depth: "quick" | "standard" | "deep" = "standard";
const sourcesList: string[] = [];
let includeRepo = false;
let includeObsidian = false;
let includeStatenour = false;
let outputPath = "";
let maxSources = 10;
let noScrape = false;
let force = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--topic" && args[i + 1]) {
    topic = args[i + 1];
    i++;
  } else if (arg === "--domain" && args[i + 1]) {
    domain = args[i + 1] as ResearchDomain;
    i++;
  } else if (arg === "--purpose" && args[i + 1]) {
    purpose = args[i + 1];
    i++;
  } else if (arg === "--depth" && args[i + 1]) {
    depth = args[i + 1] as "quick" | "standard" | "deep";
    i++;
  } else if (arg === "--source" && args[i + 1]) {
    sourcesList.push(args[i + 1]);
    i++;
  } else if (arg === "--include-repo") {
    includeRepo = true;
  } else if (arg === "--include-obsidian") {
    includeObsidian = true;
  } else if (arg === "--include-statenour") {
    includeStatenour = true;
  } else if (arg === "--output" && args[i + 1]) {
    outputPath = args[i + 1];
    i++;
  } else if (arg === "--max-sources" && args[i + 1]) {
    maxSources = parseInt(args[i + 1], 10);
    i++;
  } else if (arg === "--no-scrape") {
    noScrape = true;
  } else if (arg === "--force") {
    force = true;
  }
}

if (!topic) {
  console.error("❌ Error: --topic is a required parameter.");
  process.exit(1);
}

// Generate Slug
const slug = topic
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

// Resolve output path with environment overrides
const monorepoRoot = path.join(__dirname, "..", "..", "..");
const envOutputDir = process.env.RESEARCH_PACK_OUTPUT_DIR;
const envMirrorDir = process.env.RESEARCH_PACK_DRIVE_MIRROR_DIR;

const resolvedOutputDir = outputPath
  ? path.resolve(outputPath)
  : envOutputDir
    ? path.join(path.resolve(envOutputDir), slug)
    : path.join(monorepoRoot, "research-packs", slug);

// Duplicate check guardrail
if (fs.existsSync(resolvedOutputDir) && !force) {
  console.error(`❌ Error: Pack directory already exists at: ${resolvedOutputDir}`);
  console.error(`Use --force to overwrite existing pack.`);
  process.exit(1);
}

function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// Heuristic quality scoring based on domain and type
function scoreSource(
  sourceType: ResearchSourceType,
  title: string,
  content: string,
  urlOrPath?: string
) {
  let authority = 70;
  let relevance = 70;
  let recency = 80;
  let bias = 50;
  let actionability = 60;

  // Domain/Path heuristic rules
  if (urlOrPath) {
    const lower = urlOrPath.toLowerCase();
    
    // Academic/Official
    if (lower.includes(".gov") || lower.includes(".edu") || lower.includes("ncbi.nlm.nih.gov") || lower.includes("arxiv.org")) {
      authority = domain === "health" ? 98 : 90;
      bias = 10;
      actionability = domain === "health" ? 50 : 35;
    }
    // Documentation / Repo / Known Tech
    else if (lower.includes("github.com") || lower.includes("nextjs.org") || lower.includes("prisma.io") || lower.includes("react.dev")) {
      authority = domain === "ai_system" ? 95 : 80;
      bias = 15;
      actionability = domain === "ai_system" ? 90 : 70;
    }
    // Google Maps/Local Business Signals
    else if (lower.includes("google.com/maps") || lower.includes("business.google") || lower.includes("yelp.com")) {
      authority = domain === "business" ? 90 : 70;
      bias = 40;
      actionability = 85;
    }
  }

  // Source Type heuristics
  if (sourceType === "database_record" || sourceType === "obsidian_note" || sourceType === "repo_file") {
    authority = 90; // High internal reliability
    bias = 25;      // Low commercial marketing bias
    actionability = 85; // High operational leverage
  }

  // Keywords relevance matches
  const keywords = topic.toLowerCase().split(/\s+/).filter(k => k.length > 3);
  let matchCount = 0;
  const searchContent = (title + " " + content).toLowerCase();
  for (const kw of keywords) {
    const regex = new RegExp(kw, "g");
    const matches = searchContent.match(regex);
    if (matches) matchCount += matches.length;
  }
  relevance = Math.min(50 + matchCount * 5, 100);

  return {
    authorityScore: authority,
    relevanceScore: relevance,
    recencyScore: recency,
    biasScore: bias,
    actionabilityScore: actionability,
  };
}

// Cleanses content by stripping imports/exports and redundant layout formatting
function distillContent(content: string, type: ResearchSourceType, title: string): string {
  if (type === "repo_file" && (title.endsWith(".ts") || title.endsWith(".tsx") || title.endsWith(".js") || title.endsWith(".jsx"))) {
    // Strip JavaScript/TypeScript imports and exports
    return content
      .split(/\r?\n/)
      .filter(line => {
        const trimmed = line.trim();
        return (
          !trimmed.startsWith("import ") &&
          !trimmed.startsWith("import {") &&
          !trimmed.startsWith("import*") &&
          !trimmed.startsWith("export {") &&
          !trimmed.startsWith("export *")
        );
      })
      .join("\n")
      .trim();
  }
  return content.trim();
}

// Heartbeat tracker updates .runtime/research-lab-status.json
function updateRuntimeStatus(packSlug: string) {
  const runtimeDir = path.join(monorepoRoot, "apps", "statenour", ".runtime");
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true });
  }
  const statusPath = path.join(runtimeDir, "research-lab-status.json");
  let status = {
    lastPackGenerated: "",
    packCount: 0,
    lastIngest: null as string | null,
    failedPacks: 0,
    packsAwaitingNotebookLMReview: [] as string[],
    packsAwaitingActionExtraction: [] as string[],
  };

  if (fs.existsSync(statusPath)) {
    try {
      status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    } catch {}
  }

  status.lastPackGenerated = packSlug;
  if (!status.packsAwaitingNotebookLMReview.includes(packSlug)) {
    status.packsAwaitingNotebookLMReview.push(packSlug);
  }
  
  // Count research-packs dirs
  const packsDir = path.join(monorepoRoot, "research-packs");
  if (fs.existsSync(packsDir)) {
    try {
      status.packCount = fs.readdirSync(packsDir).filter(f => {
        return fs.statSync(path.join(packsDir, f)).isDirectory();
      }).length;
    } catch {}
  }

  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf-8");
}

function copyRecursiveSync(src: string, dest: string) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats && stats.isDirectory();
  if (isDirectory) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  STATENOUR RESEARCH LAB — SOURCE PACK GENERATOR");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Topic:       ${topic}`);
  console.log(`  Domain:      ${domain}`);
  console.log(`  Depth:       ${depth}`);
  console.log(`  Output Dir:  ${resolvedOutputDir}`);
  console.log("═══════════════════════════════════════════════════════════");

  const sources: ResearchSource[] = [];
  const engineConfig = getObsidianEngineConfig();
  const keywords = topic.toLowerCase().split(/\s+/).filter(k => k.length > 3);

  // 1. Gather Custom Sources (URLs and files)
  for (const src of sourcesList) {
    if (sources.length >= maxSources) {
      console.log(`[Source] Cap reached (${maxSources}). Skipping source: ${src}`);
      continue;
    }

    if (src.startsWith("http://") || src.startsWith("https://")) {
      if (noScrape) {
        console.log(`[Source] Scraping disabled (--no-scrape). Adding placeholder for URL: ${src}`);
        sources.push({
          id: `web_${Math.random().toString(36).substr(2, 9)}`,
          title: `Web Source (Scraping Disabled): ${src}`,
          type: "url",
          url: src,
          content: "",
          capturedAt: new Date().toISOString(),
          contentHash: "",
          scrapeStatus: "failed_missing_key",
          authorityScore: 0,
          recencyScore: 0,
          relevanceScore: 0,
          biasScore: 50,
          actionabilityScore: 0
        });
        continue;
      }

      console.log(`[Source] Scraping URL via Firecrawl: ${src}`);
      if (!isFirecrawlConfigured()) {
        console.warn("  ⚠️ WARNING: FIRECRAWL_API_KEY is not set. Web scraping failed (missing key).");
        sources.push({
          id: `web_${Math.random().toString(36).substr(2, 9)}`,
          title: `Web Source (Missing API Key): ${src}`,
          type: "url",
          url: src,
          content: "",
          capturedAt: new Date().toISOString(),
          contentHash: "",
          scrapeStatus: "failed_missing_key",
          authorityScore: 0,
          recencyScore: 0,
          relevanceScore: 0,
          biasScore: 50,
          actionabilityScore: 0
        });
        continue;
      }

      try {
        const scrapeResult = await scrapeUrl(src);
        if (scrapeResult.markdown) {
          const title = scrapeResult.title || `Web Scrape: ${src}`;
          const content = scrapeResult.markdown;
          const scores = scoreSource("url", title, content, src);
          sources.push({
            id: `web_${Math.random().toString(36).substr(2, 9)}`,
            title,
            type: "url",
            url: src,
            content,
            summary: scrapeResult.description || undefined,
            capturedAt: new Date().toISOString(),
            contentHash: computeHash(content),
            scrapeStatus: "success",
            ...scores
          });
          console.log(`  └─ ✅ Scraped successfully. (${content.length} chars)`);
        } else {
          throw new Error("Empty content returned from scrape");
        }
      } catch (err) {
        console.error(`  ❌ Failed to scrape URL:`, err);
        sources.push({
          id: `web_${Math.random().toString(36).substr(2, 9)}`,
          title: `Web Source (Scrape Failed): ${src}`,
          type: "url",
          url: src,
          content: "",
          capturedAt: new Date().toISOString(),
          contentHash: "",
          scrapeStatus: "failed",
          authorityScore: 0,
          recencyScore: 0,
          relevanceScore: 0,
          biasScore: 50,
          actionabilityScore: 0
        });
      }
    } else {
      // Local file source
      const resolvedPath = path.resolve(src);
      if (fs.existsSync(resolvedPath)) {
        console.log(`[Source] Reading local file: ${src}`);
        const fileContent = fs.readFileSync(resolvedPath, "utf-8");
        const title = path.basename(src);
        const scores = scoreSource("manual", title, fileContent, resolvedPath);
        sources.push({
          id: `file_${Math.random().toString(36).substr(2, 9)}`,
          title,
          type: "manual",
          path: resolvedPath,
          content: fileContent,
          capturedAt: new Date().toISOString(),
          contentHash: computeHash(fileContent),
          scrapeStatus: "success",
          ...scores
        });
        console.log(`  └─ ✅ Loaded file. (${fileContent.length} chars)`);
      } else {
        console.warn(`  ⚠️ WARNING: Source path does not exist: ${src}`);
      }
    }
  }

  // 2. Query Statenour database BrainMemory
  if (includeStatenour && sources.length < maxSources) {
    console.log("[Source] Querying Statenour BrainMemory database...");
    try {
      const dbMemories = await prisma.brainMemory.findMany({
        where: {
          deletedAt: null,
          OR: [
            { category: domain },
            { content: { contains: keywords[0] || topic } }
          ]
        },
        take: Math.min(maxSources - sources.length, depth === "quick" ? 10 : depth === "standard" ? 30 : 60),
      });

      for (const mem of dbMemories) {
        const title = `Brain Memory: ${mem.key} (${mem.category})`;
        const scores = scoreSource("database_record", title, mem.content);
        sources.push({
          id: `db_${mem.id}`,
          title,
          type: "database_record",
          content: mem.content,
          capturedAt: new Date().toISOString(),
          contentHash: computeHash(mem.content),
          scrapeStatus: "success",
          ...scores
        });
      }
      console.log(`  └─ ✅ Loaded ${dbMemories.length} memories.`);
    } catch (err) {
      console.error("  ❌ Database query failed:", err);
    }
  }

  // 3. Search Obsidian Vault Notes
  if (includeObsidian && fs.existsSync(engineConfig.vaultPath) && sources.length < maxSources) {
    console.log(`[Source] Scanning Obsidian Vault at: ${engineConfig.vaultPath}...`);
    const foundNotes: string[] = [];
    
    function scanDir(dir: string) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          if (item !== ".obsidian" && item !== "node_modules" && item !== ".git" && item !== "Statenour") {
            scanDir(fullPath);
          }
        } else if (item.endsWith(".md")) {
          // Check keywords matching filename or content
          const contentLower = fs.readFileSync(fullPath, "utf-8").toLowerCase();
          const filenameLower = item.toLowerCase();
          const matches = keywords.some(k => filenameLower.includes(k) || contentLower.includes(k));
          if (matches) {
            foundNotes.push(fullPath);
          }
        }
      }
    }

    scanDir(engineConfig.vaultPath);
    const limit = Math.min(maxSources - sources.length, depth === "quick" ? 5 : depth === "standard" ? 15 : 30);
    const notesToProcess = foundNotes.slice(0, limit);

    for (const note of notesToProcess) {
      const content = fs.readFileSync(note, "utf-8");
      const title = path.basename(note);
      const scores = scoreSource("obsidian_note", title, content, note);
      sources.push({
        id: `obsidian_${Math.random().toString(36).substr(2, 9)}`,
        title: `Obsidian Note: ${title}`,
        type: "obsidian_note",
        path: note,
        content,
        capturedAt: new Date().toISOString(),
        contentHash: computeHash(content),
        scrapeStatus: "success",
        ...scores
      });
    }
    console.log(`  └─ ✅ Loaded ${notesToProcess.length} relevant notes.`);
  }

  // 4. Search Monorepo Files
  if (includeRepo && sources.length < maxSources) {
    console.log("[Source] Scanning repository codebase files...");
    const matchedFiles: string[] = [];
    const searchDirs = ["apps/statenour/app", "apps/statenour/lib", "packages/utils"];

    function scanRepoDir(dir: string) {
      const absPath = path.join(monorepoRoot, dir);
      if (!fs.existsSync(absPath)) return;
      const items = fs.readdirSync(absPath);
      for (const item of items) {
        const fullPath = path.join(absPath, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanRepoDir(path.join(dir, item));
        } else if (item.endsWith(".ts") || item.endsWith(".tsx") || item.endsWith(".md")) {
          const contentLower = fs.readFileSync(fullPath, "utf-8").toLowerCase();
          const matches = keywords.some(k => item.toLowerCase().includes(k) || contentLower.includes(k));
          if (matches) {
            matchedFiles.push(fullPath);
          }
        }
      }
    }

    searchDirs.forEach(scanRepoDir);
    const limit = Math.min(maxSources - sources.length, depth === "quick" ? 3 : depth === "standard" ? 10 : 20);
    const filesToProcess = matchedFiles.slice(0, limit);

    for (const file of filesToProcess) {
      const content = fs.readFileSync(file, "utf-8");
      const title = path.basename(file);
      const scores = scoreSource("repo_file", title, content, file);
      sources.push({
        id: `repo_${Math.random().toString(36).substr(2, 9)}`,
        title: `Repo Code: ${title}`,
        type: "repo_file",
        path: file,
        content,
        capturedAt: new Date().toISOString(),
        contentHash: computeHash(content),
        scrapeStatus: "success",
        ...scores
      });
    }
    console.log(`  └─ ✅ Loaded ${filesToProcess.length} repo files.`);
  }

  if (sources.length === 0) {
    console.log("⚠️ No source materials gathered. Writing empty manifest pack.");
  }

  // Distill source contents (stripping boilerplate)
  const distilledSources = sources.map(src => ({
    ...src,
    content: distillContent(src.content, src.type, src.title)
  }));

  // Create Output Directory
  fs.mkdirSync(resolvedOutputDir, { recursive: true });
  fs.mkdirSync(path.join(resolvedOutputDir, "notebooklm-upload"), { recursive: true });

  // Generate Manifest pack details
  const manifestContent = `---
title: "Research Pack: ${topic}"
type: research_pack
category: ${domain}
status: active
created_at: ${new Date().toISOString().split("T")[0]}
source_count: ${distilledSources.length}
confidence: 0.85
sync_direction: obsidian_to_statenour
---

# Research Pack: ${topic}

## Core Question
${purpose || `Analyze the strategic dynamics and actions required for: ${topic}`}

## Executive Summary
This pack consolidates internal database memories, repository configurations, Obsidian notes, and crawled external URLs to establish a grounded workspace context.

## Sources Included
${distilledSources.map((src, i) => `${i + 1}. [${src.title}](${src.path || src.url || "Local"}) - Type: ${src.type} (Quality: ${Math.round((src.authorityScore! + src.relevanceScore! + src.actionabilityScore!) / 3)}%)`).join("\n")}

## Recommended Actions
* Feed this pack directly to NotebookLM to extract specific contradictions, claims, and actions.
* Ingest the compiled outputs back into Statenour memory ledger once complete.
`;

  // Write Manifest
  fs.writeFileSync(path.join(resolvedOutputDir, "00_MANIFEST.md"), manifestContent, "utf-8");

  // Write Briefing template
  const briefingContent = `# Briefing: ${topic}
Generated: ${new Date().toLocaleDateString()}
Domain: ${domain}

## Overview
Synthesized context regarding the active topic. Focus on the core objective and the strategic variables involved.

## Contextual Gaps
Identify missing details to prompt the operator during review.
`;
  fs.writeFileSync(path.join(resolvedOutputDir, "01_BRIEFING.md"), briefingContent, "utf-8");

  // Write Source Index
  const sourceIndexContent = `# Source Index
This file indexes the files prepared for RAG uploading.

${distilledSources.map((src, i) => `### Source ${i + 1}: ${src.title}
* **Type**: ${src.type}
* **Scores**: Authority: ${src.authorityScore}, Relevance: ${src.relevanceScore}, Actionability: ${src.actionabilityScore}
* **Size**: ${src.content.length} characters
`).join("\n")}
`;
  fs.writeFileSync(path.join(resolvedOutputDir, "02_SOURCE_INDEX.md"), sourceIndexContent, "utf-8");

  // Write Claims & Contradictions & Action Plan placeholders
  fs.writeFileSync(path.join(resolvedOutputDir, "03_CLAIMS.md"), "# Extracted Claims\n\n*(Populated during NotebookLM output ingestion)*\n", "utf-8");
  fs.writeFileSync(path.join(resolvedOutputDir, "04_CONTRADICTIONS.md"), "# Contradictions & Counterpoints\n\n*(Expose weak assumptions or conflicting guidelines here)*\n", "utf-8");
  fs.writeFileSync(path.join(resolvedOutputDir, "05_ACTION_PLAN.md"), "# Strategic Action Plan\n\n*(Tasks, decisions, and system rules)*\n", "utf-8");

  // Write NotebookLM Guide (Adversarial Operator Critique)
  const guideContent = `# NotebookLM Prompting & Critique Guide

Use these copy-paste prompts inside your NotebookLM console to digest and challenge the source files.

---

## Prompt 1: Briefing & Claims extraction
\`\`\`text
Analyze the uploaded sources only.
Produce a comprehensive briefing document outlining the core themes and the strongest 10 claims made across the material. Cite the source names for every claim.
\`\`\`

## Prompt 2: Adversarial Operator Critique (Debate)
\`\`\`text
Run a debate between two operators analyzing this topic:
1. SKEPTICAL OPERATOR: Focuses on execution risks, cash flow constraints, down-side traps, resource dilution, and structural friction.
2. OPTIMISTIC OPERATOR: Focuses on speed, compounding outcomes, returns on capital, leverage, and scale.
Detail their arguments, identify contradictions in the sources, and highlight weak evidence.
\`\`\`

## Prompt 3: Action Extraction
\`\`\`text
Generate a tactical action plan based on these sources. Rank the action items by estimated return on investment (ROI). Cite specific files for each recommended task.
\`\`\`
`;
  fs.writeFileSync(path.join(resolvedOutputDir, "06_NOTEBOOKLM_GUIDE.md"), guideContent, "utf-8");

  // Write Upload Pack items
  const uploadReadme = `# NotebookLM Upload Instructions
Upload the files in this directory directly into your NotebookLM notebook.

* **sources.md**: Aggregates all compiled source documents.
* **claims.md**: Pre-existing claims and context ledger.
* **questions.md**: Core questions needing resolution.
* **action-context.md**: Operating constraints.
`;
  fs.writeFileSync(path.join(resolvedOutputDir, "notebooklm-upload", "00_UPLOAD_ME_FIRST.md"), uploadReadme, "utf-8");

  // Aggregate sources to sources.md
  let sourcesMd = `# Gathered Source Documents\n\n`;
  for (const src of distilledSources) {
    sourcesMd += `## SOURCE: ${src.title}\n`;
    if (src.url) sourcesMd += `* **URL**: ${src.url}\n`;
    if (src.path) sourcesMd += `* **Path**: ${src.path}\n`;
    sourcesMd += `* **Type**: ${src.type}\n`;
    sourcesMd += `\n---\n\n${src.content}\n\n==================================================\n\n`;
  }
  fs.writeFileSync(path.join(resolvedOutputDir, "notebooklm-upload", "sources.md"), sourcesMd, "utf-8");

  // Claims/Questions/Actions Upload configs
  fs.writeFileSync(
    path.join(resolvedOutputDir, "notebooklm-upload", "claims.md"),
    `# Claims Context\n\nDomain: ${domain}\nTopic: ${topic}\nPurpose: ${purpose}\n`,
    "utf-8"
  );
  fs.writeFileSync(
    path.join(resolvedOutputDir, "notebooklm-upload", "questions.md"),
    `# Core Research Questions\n\n1. What is the highest leverage strategy to execute regarding: ${topic}?\n2. What are the key bottlenecks?\n`,
    "utf-8"
  );
  fs.writeFileSync(
    path.join(resolvedOutputDir, "notebooklm-upload", "action-context.md"),
    `# Action Constraints\n\n* Domain: ${domain.toUpperCase()}\n* Depth level requested: ${depth.toUpperCase()}\n`,
    "utf-8"
  );

  // Generate machine-readable manifest.json (Rule 9 integrity + redaction)
  const manifestJson = {
    id: `pack_${slug}`,
    slug,
    title: topic,
    domain,
    purpose: purpose || `Analyze the strategic dynamics and actions required for: ${topic}`,
    coreQuestion: purpose || `Analyze: ${topic}`,
    sources: distilledSources.map(s => ({
      id: s.id,
      title: s.title,
      type: s.type,
      url: s.url,
      path: s.path ? s.path.replace(new RegExp(monorepoRoot.replace(/\\/g, '\\\\'), 'g'), '[REDACTED_LOCAL_PATH]') : undefined,
      capturedAt: s.capturedAt,
      contentHash: s.contentHash,
      scrapeStatus: s.scrapeStatus,
      authorityScore: s.authorityScore,
      recencyScore: s.recencyScore,
      relevanceScore: s.relevanceScore,
      actionabilityScore: s.actionabilityScore
    })),
    packHash: computeHash(distilledSources.map(s => s.contentHash).join("")),
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(resolvedOutputDir, "manifest.json"), JSON.stringify(manifestJson, null, 2), "utf-8");

  // Mirror directory check (Rule 4)
  if (envMirrorDir) {
    const resolvedMirrorDir = path.join(path.resolve(envMirrorDir), slug);
    try {
      console.log(`[Drive] Mirroring pack output to: ${resolvedMirrorDir}`);
      copyRecursiveSync(resolvedOutputDir, resolvedMirrorDir);
      console.log(`  └─ ✅ Mirror sync complete.`);
    } catch (err) {
      console.warn(`  ⚠️ WARNING: Failed to copy pack to Drive mirror directory:`, err);
    }
  } else {
    console.warn("  ⚠️ WARNING: RESEARCH_PACK_DRIVE_MIRROR_DIR is not set. Google Drive sync skipped.");
  }

  // Update runtime status
  updateRuntimeStatus(slug);

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  🎉 SOURCE PACK GENERATED SUCCESSFULLY!`);
  console.log(`  └─ Location: ${resolvedOutputDir}`);
  console.log(`  └─ Pack Slug: ${slug}`);
  console.log(`  └─ Sources:   ${distilledSources.length} items compiled.`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  👉 Upload files inside 'notebooklm-upload/' to NotebookLM.`);
  console.log("═══════════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Source Pack Generation failed:", err);
  process.exit(1);
});
