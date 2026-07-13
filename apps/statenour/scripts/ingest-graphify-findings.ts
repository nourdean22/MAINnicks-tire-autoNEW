import "dotenv/config"; // load apps/statenour/.env so DATABASE_URL is set before prisma imports
import fs from "node:fs";
import path from "node:path";
import { BRAIN_CATEGORIES } from "../lib/brain/categories";
import {
  GraphifyManifestSchema,
  buildGraphifyCandidate,
} from "../lib/knowledge/adapters/graphify";
import { persistKnowledgeCandidate } from "../lib/knowledge/candidate-store";
import { resolveInsideRoot } from "../lib/knowledge/path-safety";
import { prisma } from "../lib/prisma";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const monorepoRoot = path.resolve(__dirname, "../../..");
  const graphifyRoot = path.join(monorepoRoot, "graphify-out");
  const manifestPath = resolveInsideRoot(
    graphifyRoot,
    argument("--manifest") ?? "manifest.json",
  );
  const dryRun = process.argv.includes("--dry-run");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Graphify manifest not found: ${manifestPath}. Generate a fresh bounded manifest from the current graph before ingestion.`,
    );
  }

  const manifest = GraphifyManifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  const expectedCommit = process.env.BUILD_COMMIT?.trim();
  if (expectedCommit && !expectedCommit.startsWith(manifest.sourceCommit) && !manifest.sourceCommit.startsWith(expectedCommit)) {
    throw new Error(
      `Graphify manifest commit ${manifest.sourceCommit} does not match BUILD_COMMIT ${expectedCommit}. Refusing stale ingestion.`,
    );
  }

  const summary = { findings: manifest.findings.length, queued: 0, rejected: 0, failures: 0 };
  for (const finding of manifest.findings) {
    try {
      const candidate = buildGraphifyCandidate(manifest, finding);
      if (dryRun) {
        console.log(JSON.stringify(candidate, null, 2));
        continue;
      }
      const result = await persistKnowledgeCandidate(candidate, {
        category: BRAIN_CATEGORIES.TECH,
        key: `graphify_${candidate.contentHash.slice(0, 24)}`,
      });
      if (result.gate.decision === "reject") summary.rejected += 1;
      else if (result.queuedForReview) summary.queued += 1;
    } catch (error) {
      summary.failures += 1;
      console.error(`[Graphify] finding ${finding.id} failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  console.log("[Graphify] governed delta summary", summary);
  if (summary.failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[Graphify] ingestion failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
