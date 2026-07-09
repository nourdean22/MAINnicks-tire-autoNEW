import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

const NOUR_OS_ROOT = path.resolve(process.cwd(), "../..");
const APP_ROOT = process.cwd(); // statenour-os app root

/**
 * Local files inside statenour-os that should be included in the knowledge digest.
 * These are read relative to APP_ROOT (process.cwd()) instead of NOUR_OS_ROOT.
 */
const LOCAL_PRIORITY_FILES = [
  // Tier 0: Comprehensive dossier (697 lines, synthesized from all archives)
  { path: "lib/ai/nour-knowledge-base.md", maxLen: 6000, tier: 0 },
  // Tier 1: Operator Biography & Context Backfill (distilled from historical chat/notes logs)
  { path: "docs/OPERATOR-BIOGRAPHY.md", maxLen: 8000, tier: 1 },
];

/**
 * The 25 highest-value knowledge files, ranked by importance to the AI.
 * These get compiled into a single intelligence digest.
 * Skip raw transcripts (463 files) — they've been distilled into processed/.
 */
const PRIORITY_FILES = [
  // Tier 1: Core identity + current state (read in full)
  { path: "knowledge/context/master-context.md", maxLen: 3000, tier: 1 },
  { path: "knowledge/context/active-projects.md", maxLen: 2000, tier: 1 },
  { path: "knowledge/context/open-loops.md", maxLen: 2000, tier: 1 },
  { path: "knowledge/context/people-map.md", maxLen: 1500, tier: 1 },

  // Tier 2: Patterns + behavioral intelligence (critical for drift detection)
  { path: "mastery/patterns/destructive-patterns.md", maxLen: 2000, tier: 2 },
  { path: "mastery/patterns/constructive-patterns.md", maxLen: 1500, tier: 2 },
  { path: "mastery/patterns/drift-detection-rules.md", maxLen: 1500, tier: 2 },
  { path: "mastery/patterns/interventions.md", maxLen: 1500, tier: 2 },

  // Tier 3: Mastery system (domain scores + skill gaps)
  { path: "knowledge/mastery/mastery-map.md", maxLen: 2000, tier: 3 },
  { path: "knowledge/mastery/skill-gaps.md", maxLen: 1000, tier: 3 },
  { path: "knowledge/mastery/deliberate-practice.md", maxLen: 1000, tier: 3 },

  // Tier 4: Accountability + wisdom
  { path: "mastery/accountability/the-standard.md", maxLen: 1000, tier: 4 },
  { path: "mastery/accountability/commitments-tracker.md", maxLen: 1500, tier: 4 },
  { path: "mastery/wisdom/principles.md", maxLen: 1500, tier: 4 },
  { path: "mastery/wisdom/lessons-learned-database.md", maxLen: 1500, tier: 4 },

  // Tier 5: Vault intelligence (hardened from 9,745 records)
  { path: "brain/50_vault/DRIFT_MAP.md", maxLen: 1200, tier: 5 },
  { path: "brain/50_vault/WIN_PATTERNS.md", maxLen: 1200, tier: 5 },
  { path: "brain/50_vault/LEVERAGE_MAP.md", maxLen: 1200, tier: 5 },
  { path: "brain/50_vault/DECISION_PRESSURE.md", maxLen: 800, tier: 5 },
  { path: "brain/50_vault/NEXT_ACTIONS.md", maxLen: 800, tier: 5 },
  { path: "brain/50_vault/TOP_INSIGHTS.md", maxLen: 800, tier: 5 },
  { path: "brain/50_vault/COMMAND_ENGINE.md", maxLen: 800, tier: 5 },

  // Tier 6: Domain-specific intelligence
  { path: "mastery/financial/financial-snapshot.md", maxLen: 800, tier: 6 },
  { path: "mastery/mental/adhd-operating-manual.md", maxLen: 1000, tier: 6 },
  { path: "mastery/strategy/competitive-position.md", maxLen: 800, tier: 6 },

  // Tier 7: Processed extractions (distilled from 463 conversations)
  { path: "knowledge/processed/patterns/patterns-extracted.md", maxLen: 1000, tier: 7 },
  { path: "knowledge/processed/lessons/lessons-extracted.md", maxLen: 1000, tier: 7 },
  { path: "knowledge/processed/decisions/decisions-extracted.md", maxLen: 800, tier: 7 },
  { path: "knowledge/processed/commitments/commitments-extracted.md", maxLen: 800, tier: 7 },
];

function readFile(relativePath: string, maxLen: number, root: string = NOUR_OS_ROOT): string {
  try {
    const content = fs.readFileSync(path.join(root, relativePath), "utf-8");
    // Strip markdown headers and excess whitespace for density
    return content
      .replace(/^#{1,3}\s+/gm, "## ")  // Normalize headers
      .replace(/\n{3,}/g, "\n\n")       // Collapse blank lines
      .replace(/^[-*]\s+\[.\]\s*/gm, "- ")  // Simplify checkboxes
      .substring(0, maxLen)
      .trim();
  } catch (err) {
    /* intentionally ignored — expected in Vercel where files don't exist */
    void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.knowledge-compiler", err, { fn: "readFile", path: relativePath }, "warn")).catch((e) => console.error(e));
    return "";
  }
}

/**
 * Compile all priority knowledge files into a single intelligence digest.
 * Returns a structured string optimized for the AI system prompt.
 */
export function compileKnowledgeDigest(): string {
  const sections: string[] = [];
  let totalChars = 0;
  let filesLoaded = 0;

  const tiers: Record<number, string[]> = {};

  // Load local files (inside statenour-os app)
  for (const file of LOCAL_PRIORITY_FILES) {
    const content = readFile(file.path, file.maxLen, APP_ROOT);
    if (!content) continue;

    if (!tiers[file.tier]) tiers[file.tier] = [];
    tiers[file.tier].push(content);
    totalChars += content.length;
    filesLoaded++;
  }

  // Load monorepo-level files (NOUR-OS root)
  for (const file of PRIORITY_FILES) {
    const content = readFile(file.path, file.maxLen);
    if (!content) continue;

    if (!tiers[file.tier]) tiers[file.tier] = [];
    tiers[file.tier].push(content);
    totalChars += content.length;
    filesLoaded++;
  }

  const tierLabels: Record<number, string> = {
    0: "COMPREHENSIVE DOSSIER (synthesized from all archives)",
    1: "CORE IDENTITY & STATE",
    2: "BEHAVIORAL PATTERNS & DRIFT",
    3: "MASTERY SYSTEM",
    4: "ACCOUNTABILITY & WISDOM",
    5: "VAULT INTELLIGENCE (9,745 hardened records)",
    6: "DOMAIN INTELLIGENCE",
    7: "EXTRACTED FROM 463 CONVERSATIONS",
  };

  for (const [tier, contents] of Object.entries(tiers).sort()) {
    const label = tierLabels[Number(tier)] || `TIER ${tier}`;
    sections.push(`\n### ${label}\n${contents.join("\n\n---\n\n")}`);
  }

  sections.unshift(`[Knowledge digest: ${filesLoaded} files, ${Math.round(totalChars / 1024)}KB compiled from 517 source files]`);

  return sections.join("\n");
}

/**
 * Store compiled digest in DB for fast retrieval (avoids re-reading files every prompt).
 * Call this from a cron job or on-demand.
 */
export async function refreshKnowledgeDigest(): Promise<{ charCount: number; filesLoaded: number }> {
  const digest = compileKnowledgeDigest();

  // Store as a special AuditEvent so it persists across deploys
  await prisma.auditEvent.create({
    data: {
      actor: "system",
      eventType: "knowledge_digest_compiled",
      detail: digest.substring(0, 100),
      payload: { digest, compiledAt: new Date().toISOString() },
    },
  });

  return {
    charCount: digest.length,
    filesLoaded: PRIORITY_FILES.length,
  };
}

/**
 * Get the latest compiled digest from DB.
 * Falls back to live compilation if no cached version exists.
 */
export async function getKnowledgeDigest(): Promise<string> {
  // Try cached version first (faster, works on Vercel where files don't exist)
  try {
    const cached = await prisma.auditEvent.findFirst({
      where: { eventType: "knowledge_digest_compiled" },
      orderBy: { createdAt: "desc" },
    });

    if (cached?.payload) {
      const meta = cached.payload as Record<string, string>;
      if (meta.digest) return meta.digest;
    }
  } catch (err) {
    // DB might not have this yet, or connection error
    logError("ai.knowledge-compiler", err, { fn: "getKnowledgeDigest" });
  }

  // Fall back to live compilation (only works locally where files exist)
  return compileKnowledgeDigest();
}

