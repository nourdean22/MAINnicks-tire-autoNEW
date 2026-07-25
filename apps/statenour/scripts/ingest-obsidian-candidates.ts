import fs from "node:fs";
import path from "node:path";
import { BRAIN_CATEGORIES, isKnownCategory } from "../lib/brain/categories";
import {
  buildObsidianCandidate,
  parseObsidianFrontmatter,
} from "../lib/knowledge/adapters/obsidian";
import { persistKnowledgeCandidate } from "../lib/knowledge/candidate-store";
import { getObsidianEngineConfig, readEngineStatus, writeEngineStatus } from "../lib/obsidian/engine-config";
import { dirHasIgnoreMarker } from "../lib/obsidian/ignore";
import type { ObsidianEngineStatus, QuarantinedFileInfo } from "../lib/obsidian/types";
import { prisma } from "../lib/prisma";

interface ScanTarget {
  name: string;
  root: string;
  prefix: string;
  accepts: (filename: string) => boolean;
}

function walk(root: string, accepts: (filename: string) => boolean): string[] {
  if (!fs.existsSync(root)) return [];
  // A folder that declares itself non-inbox (machine exports like the NOURCITY
  // graphify digest folder) is invisible to ingest: nothing in it may be
  // quarantined OR fed to the knowledge gate. Before this check, 106 digests
  // were swept to Quarantine per sync and 5 whose filenames happened to match
  // inferCategory() were re-ingested as candidates on every regeneration.
  if (dirHasIgnoreMarker(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if ([".obsidian", ".git", "node_modules", "Statenour"].includes(entry.name)) continue;
      files.push(...walk(path.join(root, entry.name), accepts));
    } else if (accepts(entry.name)) {
      files.push(path.join(root, entry.name));
    }
  }
  return files;
}

function inferCategory(filename: string): { category: string | null; title: string } {
  const lower = filename.toLowerCase();
  let title = filename.replace(/\.(md|txt)$/i, "");
  if (/(goals|weekly|ceo review|dashboard)/.test(lower)) return { category: BRAIN_CATEGORIES.PLANNING, title: `CEO Planning: ${title}` };
  if (/(recovery|body|health)/.test(lower)) return { category: BRAIN_CATEGORIES.PHYSICAL, title: `Health & Body: ${title}` };
  if (/(shop|business|money|revenue)/.test(lower)) return { category: BRAIN_CATEGORIES.BUSINESS, title: `Business & Finance: ${title}` };
  if (/(mind|discipline|mental)/.test(lower)) return { category: BRAIN_CATEGORIES.DISCIPLINE, title: `Mindset & Discipline: ${title}` };
  if (/(faith|character|spiritual)/.test(lower)) return { category: BRAIN_CATEGORIES.SPIRITUAL, title: `Faith & Character: ${title}` };
  if (/(rules|system|canon)/.test(lower)) return { category: BRAIN_CATEGORIES.AI_CONFIG, title: `Operating Canon: ${title}` };
  return { category: null, title };
}

function stableKey(filename: string, prefix: string): string {
  return `${prefix}${filename.replace(/\.(md|txt)$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

function quarantine(filePath: string, vaultRoot: string): QuarantinedFileInfo {
  const filename = path.basename(filePath);
  const quarantineDir = path.join(vaultRoot, "Statenour", "Quarantine");
  fs.mkdirSync(quarantineDir, { recursive: true });
  const destination = path.join(quarantineDir, filename);
  if (path.resolve(filePath) !== path.resolve(destination)) fs.renameSync(filePath, destination);
  return {
    filename,
    relativePath: path.join("Statenour", "Quarantine", filename),
    reason: "Missing or invalid category and no safe filename classification.",
    detected_at: new Date().toISOString(),
    suggested_fix: "Add valid YAML frontmatter with category and move the note back to an ingest folder.",
  };
}

function statusBase(config: ReturnType<typeof getObsidianEngineConfig>): ObsidianEngineStatus {
  return readEngineStatus() ?? {
    health: "degraded",
    lastRunAt: null,
    lastDoctorRunAt: null,
    lastIngestRunAt: null,
    lastExportRunAt: null,
    daemonHeartbeatAt: null,
    lastSuccessfulSyncAt: null,
    runState: "idle",
    lastRunSteps: null,
    stats: { totalNotes: 0, processed: 0, synced: 0, skipped: 0, failed: 0, quarantined: 0, warnings: 0, failures: 0 },
    issues: [],
    quarantinedFiles: [],
    config: {
      vaultPath: config.vaultPath,
      icloudShortcutsPath: config.icloudShortcutsPath,
      syncMode: config.syncMode,
      restUrl: config.restUrl,
    },
  };
}

async function main(): Promise<void> {
  const config = getObsidianEngineConfig();
  const targets: ScanTarget[] = [
    {
      name: "Obsidian Vault",
      root: config.vaultPath,
      prefix: "obsidian_",
      accepts: (filename) => filename.endsWith(".md") && filename !== "README.md",
    },
    {
      name: "iCloud Shortcuts Folder",
      root: config.icloudShortcutsPath,
      prefix: "icloud_shortcut_",
      accepts: (filename) => /\.(md|txt)$/i.test(filename) && filename !== "README.md",
    },
  ];

  const counters = { processed: 0, synced: 0, queued: 0, skipped: 0, failed: 0, quarantined: 0 };
  const quarantinedFiles: QuarantinedFileInfo[] = [];

  for (const target of targets) {
    for (const filePath of walk(target.root, target.accepts)) {
      counters.processed += 1;
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        if (!raw.trim()) {
          counters.skipped += 1;
          continue;
        }
        const parsed = parseObsidianFrontmatter(raw);
        const syncDirection = typeof parsed.metadata.sync_direction === "string"
          ? parsed.metadata.sync_direction.toLowerCase()
          : null;
        if (syncDirection && !["obsidian_to_statenour", "bidirectional"].includes(syncDirection)) {
          counters.skipped += 1;
          continue;
        }

        const inferred = inferCategory(path.basename(filePath));
        const explicitCategory = typeof parsed.metadata.category === "string" ? parsed.metadata.category.trim() : "";
        const category = explicitCategory || inferred.category;
        if (!category || !isKnownCategory(category)) {
          quarantinedFiles.push(quarantine(filePath, config.vaultPath));
          counters.quarantined += 1;
          continue;
        }

        const title = typeof parsed.metadata.title === "string" && parsed.metadata.title.trim()
          ? parsed.metadata.title.trim()
          : inferred.title;
        const relativePath = path.relative(target.root, filePath).replaceAll(path.sep, "/");
        const candidate = buildObsidianCandidate({
          content: parsed.content,
          title,
          category,
          sourceId: `${target.prefix}${relativePath}`,
          sourceUri: relativePath,
          metadata: parsed.metadata,
          categoryWasExplicit: Boolean(explicitCategory),
          sourceName: target.name,
          modifiedAt: fs.statSync(filePath).mtime,
        });

        const key = stableKey(relativePath, target.prefix);
        const existing = await prisma.brainMemory.findFirst({
          where: {
            OR: [
              { category, key },
              {
                category: BRAIN_CATEGORIES.RESEARCH_PACK,
                key: `candidate_${candidate.id.slice(3)}`,
                deletedAt: null,
              },
            ],
          },
          select: { content: true },
        });
        if (existing?.content === candidate.content) {
          counters.skipped += 1;
          continue;
        }

        const result = await persistKnowledgeCandidate(candidate, { category, key });
        if (result.gate.decision === "reject") counters.failed += 1;
        else if (result.queuedForReview) counters.queued += 1;
        else counters.synced += 1;
      } catch (error) {
        counters.failed += 1;
        console.error(`[Obsidian] failed ${filePath}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  const now = new Date().toISOString();
  const status = statusBase(config);
  status.lastRunAt = now;
  status.lastIngestRunAt = now;
  status.health = counters.failed > 0 ? "error" : counters.quarantined > 0 || counters.queued > 0 ? "degraded" : "healthy";
  status.stats = {
    ...status.stats,
    totalNotes: counters.processed,
    processed: counters.processed,
    synced: counters.synced,
    skipped: counters.skipped,
    failed: counters.failed,
    quarantined: counters.quarantined,
    warnings: counters.queued + counters.quarantined,
    failures: counters.failed,
  };
  status.quarantinedFiles = quarantinedFiles;
  await writeEngineStatus(status);

  console.log("[Obsidian] governed ingestion summary", counters);
  if (counters.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[Obsidian] ingestion failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
