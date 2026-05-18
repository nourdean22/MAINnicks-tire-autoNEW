/**
 * GET /api/system/migrations · Phase Q.3 · 2026-05-18 PM.
 *
 * Live migration tracker. Reads:
 *   1. Static MIGRATIONS_REGISTRY (one entry per migration in
 *      docs/migrations/) · the things we said we'd do
 *   2. Scanned counts from the live source tree · the actual state
 *
 * Combining the two gives an honest "% complete" per migration.
 * Replaces the previous "trust the commit message" model where the
 * J tRPC migration's progress lived only in the commit body and
 * AGENT_V2 cutover plan lived only in MEMORY.
 *
 * Surfaces at /system/migrations · operator can see at a glance
 * which migrations are stalled vs progressing.
 *
 * Auth: owner only.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { apiHandler } from "@/lib/utils/http";
import { getAllFlags, summarizeFlags, type ResolvedFlag, type FlagSummary } from "@/lib/feature-flags";

// ─────────────────────────────────────────────────────────────────
// Static registry — one entry per docs/migrations/*.md
// ─────────────────────────────────────────────────────────────────

type MigrationStatus = "in-progress" | "stalled" | "completed";

interface Migration {
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
    nextMilestone: "Migrate /chat, /voice, /system/* surfaces · piggyback on H+ waves",
  },
  {
    slug: "agent-v1-to-v2",
    name: "AGENT_V1 → AGENT_V2 (prompt builder)",
    startedAt: "2026-05-07",
    strategy: "Strangler fig with env flag (AGENT_V2=true)",
    status: "in-progress",
    nextMilestone: "Phase 1 canary (10% of turns) · pending judge-eval comparator + parity dashboard",
  },
  {
    slug: "m2-persona-wiring",
    name: "M.2 persona wiring (runMultiAgent ← personas)",
    startedAt: "2026-05-18",
    strategy: "Coexistence · inline sub-agents keep working · personas add structure",
    // Phase R (2026-05-18 PM) · stalled → in-progress
    // First call-site wired · engine.ts runMultiAgent now passes
    // research-analyst + contrarian-critic. N.6 scorer now sees real
    // persona keys instead of step_N/what/why placeholders.
    status: "in-progress",
    nextMilestone: "Wire smart-tier runRouter sub-pipeline · also adopt execution-planner persona for plan-derived multi-agent steps with non-trivial actions",
  },
];

// ─────────────────────────────────────────────────────────────────
// Source-tree scanner
// ─────────────────────────────────────────────────────────────────

interface ScanResult {
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
async function scanTree(root: string, patterns: { legacy: RegExp; migrated: RegExp }): Promise<ScanResult> {
  const counts = {
    legacyFiles: 0,
    legacyOccurrences: 0,
    migratedFiles: 0,
    migratedOccurrences: 0,
  };

  const SKIP_DIRS = new Set([
    "node_modules", ".next", ".git", "dist", "build",
    "_archive", "archive", ".turbo", "coverage", ".vercel",
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
  const migratedPct = totalSurfaces === 0 ? 0 : Math.round((counts.migratedFiles / totalSurfaces) * 100);

  return { ...counts, totalSurfaces, migratedPct };
}

interface MigrationProgress {
  scanned: boolean;
  result?: ScanResult;
  note?: string;
}

async function computeProgress(kind: Migration["progressKind"]): Promise<MigrationProgress> {
  if (kind !== "trpc-surfaces") return { scanned: false };

  // Source tree roots that contain client-side data fetches.
  // We scan the app/ and components/ trees · lib/ is server-side.
  const root = process.cwd();
  const roots = [
    path.join(root, "app"),
    path.join(root, "components"),
  ];

  const aggregate: ScanResult = {
    legacyFiles: 0, legacyOccurrences: 0,
    migratedFiles: 0, migratedOccurrences: 0,
    totalSurfaces: 0, migratedPct: 0,
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
  aggregate.migratedPct = aggregate.totalSurfaces === 0
    ? 0
    : Math.round((aggregate.migratedFiles / aggregate.totalSurfaces) * 100);

  return { scanned: true, result: aggregate };
}

// ─────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────

interface MigrationView extends Migration {
  progress: MigrationProgress;
}

interface MigrationsPayload {
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async (): Promise<MigrationsPayload> => {
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
  },
  { auth: "owner" },
);
