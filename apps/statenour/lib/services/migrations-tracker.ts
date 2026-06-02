/**
 * lib/services/migrations-tracker.ts · straggler-pages REST→tRPC slice
 * (2026-05-22).
 *
 * Lifted verbatim from app/api/system/migrations/route.ts so the legacy
 * REST endpoint AND the new `system.migrationsTracker` tRPC procedure
 * call the same function · drift between consumers structurally
 * impossible. The route logic (static MIGRATIONS registry + source-tree
 * scanner + feature-flag board) was inline in the handler until this
 * slice; it is moved here byte-for-byte and the route now delegates.
 *
 * `buildMigrationsTracker` returns the same `MigrationsPayload` the
 * /system/migrations surface already renders.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  getAllFlags,
  summarizeFlags,
  type ResolvedFlag,
  type FlagSummary,
} from "@/lib/feature-flags";

// ─────────────────────────────────────────────────────────────────
// Static registry — one entry per docs/migrations/*.md
// ─────────────────────────────────────────────────────────────────

export type MigrationStatus = "in-progress" | "stalled" | "completed";

export interface Migration {
  /** Slug matches docs/migrations/<slug>.md (without .md). */
  slug: string;
  name: string;
  startedAt: string;
  strategy: string;
  status: MigrationStatus;
  /** Optional · computed scan-based progress (see scanProgress). */
  progressKind?: "trpc-surfaces" | "categories-codemod";
  nextMilestone: string;
}

const MIGRATIONS: Migration[] = [
  {
    slug: "J-trpc-migration",
    name: "tRPC migration (REST → tRPC)",
    startedAt: "2026-05-18",
    strategy: "Strangler fig · coexistence · gradual surface-by-surface",
    status: "in-progress",
    progressKind: "trpc-surfaces",
    nextMilestone:
      "Migrate /chat, /voice, remaining /system/* surfaces · piggyback on H+ waves",
  },
  {
    slug: "m2-persona-wiring",
    name: "M.2 persona wiring (runMultiAgent ← personas)",
    startedAt: "2026-05-18",
    strategy:
      "Coexistence · inline sub-agents keep working · personas add structure",
    // Phase U (2026-05-18 PM) · in-progress → COMPLETED
    // All 4 reasoning sub-pipelines now flow through typed personas:
    //   R · engine.ts runMultiAgent uses research-analyst + contrarian-critic
    //   S.1 · per-step classifyStepIntent() per plan line
    //   T · deep-research worker uses RESEARCH_PLANNER + RESEARCH_SYNTHESIZER
    //   U · pretask-fanout uses research-analyst + contrarian-critic + execution-planner
    // N.6 scorer now feeds from EVERY reasoning sub-pipeline · per-persona
    // verdicts compute across the entire stack.
    status: "completed",
    nextMilestone:
      "(MIGRATION COMPLETE · M.2 library now consumed by all 4 reasoning sub-pipelines · N.6 scorer feeds from all of them · no remaining placeholder personaKey usage)",
  },
];

// ─────────────────────────────────────────────────────────────────
// Source-tree scanner
// ─────────────────────────────────────────────────────────────────

export interface ScanResult {
  legacyFiles: number;
  legacyOccurrences: number;
  migratedFiles: number;
  migratedOccurrences: number;
  totalSurfaces: number;
  migratedPct: number;
}

/**
 * Walks the source tree and counts pattern occurrences. Used to
 * produce honest % complete on the tRPC migration.
 *
 * Skips: node_modules, .next, .git, dist, build, archive dirs.
 */
async function scanTree(
  root: string,
  patterns: { legacy: RegExp; migrated: RegExp },
): Promise<ScanResult> {
  const counts = {
    legacyFiles: 0,
    legacyOccurrences: 0,
    migratedFiles: 0,
    migratedOccurrences: 0,
  };

  const SKIP_DIRS = new Set([
    "node_modules",
    ".next",
    ".git",
    "dist",
    "build",
    "_archive",
    "archive",
    ".turbo",
    "coverage",
    ".vercel",
  ]);
  const VALID_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!VALID_EXTS.has(ext)) continue;

      let content = "";
      try {
        content = await fs.readFile(fullPath, "utf8");
      } catch {
        continue;
      }

      const legacyMatches = content.match(patterns.legacy);
      const migratedMatches = content.match(patterns.migrated);

      if (legacyMatches?.length) {
        counts.legacyFiles++;
        counts.legacyOccurrences += legacyMatches.length;
      }
      if (migratedMatches?.length) {
        counts.migratedFiles++;
        counts.migratedOccurrences += migratedMatches.length;
      }
    }
  }

  await walk(root);

  const totalSurfaces = counts.legacyFiles + counts.migratedFiles;
  const migratedPct =
    totalSurfaces === 0
      ? 0
      : Math.round((counts.migratedFiles / totalSurfaces) * 100);

  return { ...counts, totalSurfaces, migratedPct };
}

export interface MigrationProgress {
  scanned: boolean;
  result?: ScanResult;
  note?: string;
}

async function computeProgress(
  kind: Migration["progressKind"],
): Promise<MigrationProgress> {
  if (kind !== "trpc-surfaces") return { scanned: false };

  // Source tree roots that contain client-side data fetches.
  // We scan the app/ and components/ trees · lib/ is server-side.
  const root = process.cwd();
  const roots = [path.join(root, "app"), path.join(root, "components")];

  const aggregate: ScanResult = {
    legacyFiles: 0,
    legacyOccurrences: 0,
    migratedFiles: 0,
    migratedOccurrences: 0,
    totalSurfaces: 0,
    migratedPct: 0,
  };

  for (const r of roots) {
    const partial = await scanTree(r, {
      legacy: /useAuthedFetch\b/g,
      migrated: /\btrpc\.(nick|operator)\./g,
    });
    aggregate.legacyFiles += partial.legacyFiles;
    aggregate.legacyOccurrences += partial.legacyOccurrences;
    aggregate.migratedFiles += partial.migratedFiles;
    aggregate.migratedOccurrences += partial.migratedOccurrences;
  }

  aggregate.totalSurfaces = aggregate.legacyFiles + aggregate.migratedFiles;
  aggregate.migratedPct =
    aggregate.totalSurfaces === 0
      ? 0
      : Math.round((aggregate.migratedFiles / aggregate.totalSurfaces) * 100);

  return { scanned: true, result: aggregate };
}

// ─────────────────────────────────────────────────────────────────
// Payload builder
// ─────────────────────────────────────────────────────────────────

export interface MigrationView extends Migration {
  progress: MigrationProgress;
}

export interface MigrationsPayload {
  generatedAt: string;
  migrations: MigrationView[];
  flags: {
    list: ResolvedFlag[];
    summary: FlagSummary;
  };
  summary: {
    totalMigrations: number;
    inProgress: number;
    stalled: number;
    completed: number;
  };
}

/** The live migration tracker payload · static registry + scanned
 *  source-tree progress + the feature-flag board. */
export async function buildMigrationsTracker(): Promise<MigrationsPayload> {
  const migrations: MigrationView[] = await Promise.all(
    MIGRATIONS.map(async (m) => ({
      ...m,
      progress: await computeProgress(m.progressKind),
    })),
  );

  const flagsList = getAllFlags();
  const flagSummary = summarizeFlags(flagsList);

  return {
    generatedAt: new Date().toISOString(),
    migrations,
    flags: { list: flagsList, summary: flagSummary },
    summary: {
      totalMigrations: migrations.length,
      inProgress: migrations.filter((m) => m.status === "in-progress").length,
      stalled: migrations.filter((m) => m.status === "stalled").length,
      completed: migrations.filter((m) => m.status === "completed").length,
    },
  };
}
