/**
 * scripts/audit-skill-embeddings.ts · AG-45 (2026-07-09)
 *
 * READ-ONLY drift audit between data/skills-registry.json and the
 * vector_embeddings table (sourceType="skill", sourceId=skill name).
 * Skill recall only surfaces EMBEDDED skills — a registry entry
 * without an embedding is invisible to the recall layer, and an
 * embedding without a registry entry is a ghost that can still match
 * queries.
 *
 * ⚠️ OPERATOR CONTEXT · this script only READS, but it reads whatever
 * DATABASE_URL points at. Run it deliberately (typically against prod
 * via railway run, since prod is where recall lives). It never writes;
 * fixing drift is scripts/embed-skills.ts (missing) or a manual
 * DELETE (orphans) — both operator-only actions.
 *
 * Run:  pnpm tsx scripts/audit-skill-embeddings.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface RegistryFile {
  generatedAt?: string;
  skills: Array<{ name: string; description?: string }>;
}

async function main() {
  const regPath = resolve(process.cwd(), "data", "skills-registry.json");
  if (!existsSync(regPath)) {
    console.error(`no registry at ${regPath} — run scripts/build-skill-registry.ts first`);
    process.exit(1);
  }
  const reg = JSON.parse(readFileSync(regPath, "utf8")) as RegistryFile;
  const registryNames = new Set(reg.skills.map((s) => s.name));

  const { prisma } = await import("../lib/prisma");
  const rows = await prisma.vectorEmbedding.findMany({
    where: { sourceType: "skill" },
    select: { sourceId: true },
  });
  const embeddedNames = new Set(rows.map((r) => r.sourceId));

  const missing = [...registryNames].filter((n) => !embeddedNames.has(n)).sort();
  const orphaned = [...embeddedNames].filter((n) => !registryNames.has(n)).sort();

  console.log(`=== skill embedding audit ===`);
  console.log(`registry:   ${registryNames.size} skills (generated ${reg.generatedAt ?? "unknown"})`);
  console.log(`embeddings: ${embeddedNames.size} rows (sourceType=skill)\n`);

  console.log(`MISSING embeddings (in registry · recall can't find them): ${missing.length}`);
  for (const n of missing.slice(0, 40)) console.log(`  - ${n}`);
  if (missing.length > 40) console.log(`  … and ${missing.length - 40} more`);

  console.log(`\nORPHANED embeddings (no registry entry · ghost matches): ${orphaned.length}`);
  for (const n of orphaned.slice(0, 40)) console.log(`  - ${n}`);
  if (orphaned.length > 40) console.log(`  … and ${orphaned.length - 40} more`);

  console.log(
    `\nverdict: ${missing.length === 0 && orphaned.length === 0
      ? "IN SYNC ✓"
      : `${missing.length} to embed (scripts/embed-skills.ts · operator-only) · ${orphaned.length} to review`}`,
  );

  await prisma.$disconnect();
  // Non-zero exit on drift so CI / a checklist can gate on it.
  process.exit(missing.length + orphaned.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error("audit failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
