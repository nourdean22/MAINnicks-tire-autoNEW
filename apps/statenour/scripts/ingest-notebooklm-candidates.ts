import fs from "node:fs";
import path from "node:path";
import { BRAIN_CATEGORIES } from "../lib/brain/categories";
import { getEmbedding } from "../lib/ai/provider";
import { cosineSimilarity } from "../lib/brain/embedding-utils";
import {
  buildNotebookLmCandidate,
  parseNotebookLmMarkdown,
  type NotebookLmExtractedItem,
} from "../lib/knowledge/adapters/notebooklm";
import { persistKnowledgeCandidate } from "../lib/knowledge/candidate-store";
import { prisma } from "../lib/prisma";

interface SourceChunk {
  chunk: string;
  embedding: number[];
}

interface CliOptions {
  slug: string;
  file?: string;
  createTasks: boolean;
  createDecisions: boolean;
  dryRun: boolean;
  allowHighStakesActions: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    slug: "",
    createTasks: false,
    createDecisions: false,
    dryRun: false,
    allowHighStakesActions: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--slug") options.slug = argv[++index] ?? "";
    else if (arg === "--file") options.file = argv[++index];
    else if (arg === "--create-tasks") options.createTasks = true;
    else if (arg === "--create-decisions") options.createDecisions = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--allow-high-stakes-actions") options.allowHighStakesActions = true;
  }
  if (!options.slug.trim()) throw new Error("--slug is required.");
  return options;
}

function chunkText(text: string, chunkSize = 1_200, overlap = 200): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n\n+/)) {
    if (`${current}\n\n${paragraph}`.trim().length <= chunkSize) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= chunkSize) {
      current = paragraph;
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > chunkSize) {
      chunks.push(remaining.slice(0, chunkSize));
      remaining = remaining.slice(chunkSize - overlap);
    }
    current = remaining;
  }
  if (current) chunks.push(current);
  return chunks;
}

function readDomain(manifestPath: string): string {
  if (!fs.existsSync(manifestPath)) return "general";
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { domain?: unknown };
    return typeof value.domain === "string" && value.domain.trim() ? value.domain.trim().toLowerCase() : "general";
  } catch {
    return "general";
  }
}

function collectFiles(packDir: string, specificFile?: string): string[] {
  if (specificFile) {
    const resolved = path.resolve(specificFile);
    if (!fs.existsSync(resolved)) throw new Error(`NotebookLM output file not found: ${resolved}`);
    return [resolved];
  }

  const files = new Set<string>();
  const outputDir = path.join(packDir, "notebooklm-output");
  if (fs.existsSync(outputDir)) {
    for (const filename of fs.readdirSync(outputDir)) {
      if (/\.(md|txt)$/i.test(filename)) files.add(path.join(outputDir, filename));
    }
  }
  for (const filename of ["03_CLAIMS.md", "04_CONTRADICTIONS.md", "05_ACTION_PLAN.md"]) {
    const candidate = path.join(packDir, filename);
    if (fs.existsSync(candidate) && fs.readFileSync(candidate, "utf8").includes("- ")) files.add(candidate);
  }
  return [...files].sort();
}

async function sourceEmbeddings(sourcePath: string, cachePath: string): Promise<SourceChunk[]> {
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8")) as SourceChunk[];
      if (Array.isArray(cached) && cached.every((item) => item.chunk && Array.isArray(item.embedding))) return cached;
    } catch {
      // Rebuild malformed or stale cache.
    }
  }
  if (!fs.existsSync(sourcePath)) return [];

  const built: SourceChunk[] = [];
  for (const chunk of chunkText(fs.readFileSync(sourcePath, "utf8"))) {
    try {
      const embedding = await getEmbedding(chunk);
      if (embedding.length > 0) built.push({ chunk, embedding });
    } catch (error) {
      console.warn("[NotebookLM] source chunk embedding failed:", error instanceof Error ? error.message : String(error));
    }
  }
  if (built.length > 0) fs.writeFileSync(cachePath, JSON.stringify(built, null, 2), "utf8");
  return built;
}

async function ground(item: NotebookLmExtractedItem, sources: SourceChunk[]): Promise<{
  score: number;
  bestMatchChunk?: string;
}> {
  const groundable = item.category === BRAIN_CATEGORIES.RESEARCH_CLAIM ||
    item.category === BRAIN_CATEGORIES.RESEARCH_CONTRADICTION;
  if (!groundable || sources.length === 0) return { score: groundable ? 0 : 0.8 };

  try {
    const vector = await getEmbedding(item.text);
    let score = 0;
    let bestMatchChunk: string | undefined;
    for (const source of sources) {
      const similarity = cosineSimilarity(vector, source.embedding);
      if (similarity > score) {
        score = similarity;
        bestMatchChunk = source.chunk;
      }
    }
    return { score: Math.round(score * 1_000) / 1_000, bestMatchChunk };
  } catch (error) {
    console.warn("[NotebookLM] claim grounding failed:", error instanceof Error ? error.message : String(error));
    return { score: 0 };
  }
}

async function resolveMissionId(domain: string): Promise<string | null> {
  const mission = await prisma.mission.findFirst({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      OR: [
        { canonicalDomain: domain.toUpperCase() },
        { title: { contains: domain, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  return mission?.id ?? null;
}

async function createApprovedTask(text: string, missionId: string): Promise<boolean> {
  const existing = await prisma.task.findFirst({
    where: { title: text, missionId, deletedAt: null },
    select: { id: true },
  });
  if (existing) return false;
  await prisma.task.create({
    data: {
      title: text,
      missionId,
      status: "INBOX",
      nextPhysicalAction: text,
      effort: "M15",
      roiScore: 50,
      frictionScore: 50,
      energyRequired: "MEDIUM",
      context: "DESK",
      finishCondition: "Complete the operator-approved research action.",
      createdBy: "research_lab",
    },
  });
  return true;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const monorepoRoot = path.resolve(__dirname, "../../..");
  const packDir = path.join(monorepoRoot, "research-packs", options.slug);
  if (!fs.existsSync(packDir)) throw new Error(`Research pack not found: ${packDir}`);

  const domain = readDomain(path.join(packDir, "manifest.json"));
  const highStakes = ["health", "finance", "legal"].includes(domain);
  const files = collectFiles(packDir, options.file);
  if (files.length === 0) {
    console.log(`[NotebookLM] No output found for ${options.slug}.`);
    return;
  }

  const sourcePath = path.join(packDir, "notebooklm-upload", "sources.md");
  const cachePath = path.join(packDir, ".sources-embeddings.json");
  const sources = await sourceEmbeddings(sourcePath, cachePath);
  const items: NotebookLmExtractedItem[] = [];
  for (const file of files) {
    const relative = path.relative(monorepoRoot, file).replaceAll(path.sep, "/");
    let defaultCategory = BRAIN_CATEGORIES.RESEARCH_CLAIM;
    const lower = path.basename(file).toLowerCase();
    if (lower.includes("contradiction") || lower.includes("debate")) defaultCategory = BRAIN_CATEGORIES.RESEARCH_CONTRADICTION;
    else if (lower.includes("action") || lower.includes("plan") || lower.includes("task")) defaultCategory = BRAIN_CATEGORIES.RESEARCH_ACTION;
    else if (lower.includes("question")) defaultCategory = BRAIN_CATEGORIES.RESEARCH_QUESTION;
    items.push(...parseNotebookLmMarkdown(fs.readFileSync(file, "utf8"), relative, defaultCategory));
  }

  const missionId = options.createTasks && !options.dryRun ? await resolveMissionId(domain) : null;
  const summary = { parsed: items.length, accepted: 0, queued: 0, rejected: 0, tasksCreated: 0, failures: 0 };

  for (const item of items) {
    try {
      const grounding = await ground(item, sources);
      const operatorConfirmedAction = options.createTasks && (!highStakes || options.allowHighStakesActions);
      const candidate = buildNotebookLmCandidate({
        ...item,
        slug: options.slug,
        domain,
        verificationScore: grounding.score,
        bestMatchChunk: grounding.bestMatchChunk,
        operatorConfirmedAction,
      });

      if (options.dryRun) {
        console.log(JSON.stringify({ candidate }, null, 2));
        continue;
      }

      const result = await persistKnowledgeCandidate(candidate, {
        category: item.category,
        key: `notebooklm_${candidate.contentHash.slice(0, 24)}`,
      });
      if (result.gate.decision === "reject") summary.rejected += 1;
      else if (result.queuedForReview) summary.queued += 1;
      else summary.accepted += 1;

      if (
        options.createTasks &&
        result.gate.actionEligible &&
        missionId &&
        (!highStakes || options.allowHighStakesActions)
      ) {
        if (await createApprovedTask(item.text, missionId)) summary.tasksCreated += 1;
      }

      if (options.createDecisions && result.gate.actionEligible) {
        console.warn("[NotebookLM] --create-decisions is retained for compatibility but decisions require review in the Brain Review tab.");
      }
    } catch (error) {
      summary.failures += 1;
      console.error("[NotebookLM] item failed:", error instanceof Error ? error.message : String(error));
    }
  }

  console.log("[NotebookLM] governed ingestion summary", summary);
  if (summary.failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[NotebookLM] ingestion failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
