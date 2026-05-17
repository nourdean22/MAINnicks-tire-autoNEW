/**
 * scripts/embed-skills.ts · v10.0.432
 *
 * Generate vector embeddings for all 1,423 skills + write them to
 * the vector_embeddings table with sourceType="skill". Each skill's
 * embedding is the cosine-distance signature used by the chat
 * recall layer (v10.0.433) to surface "skills relevant to your
 * current message".
 *
 * Embedding text · `${name}\n${description}\n${tags}\n${en_summary}`
 * where en_summary is the English translation from skills-
 * translations.json (v10.0.431). Multi-language coverage means a
 * Chinese-only skill still matches an English query about its
 * subject area.
 *
 * Idempotent · runs through all skills · skips ones that already
 * have an embedding (resume support if the run dies). The skills
 * registry isn't a DB table, so the sourceId is the skill name
 * (which is unique).
 *
 * Run: pnpm tsx scripts/embed-skills.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface SkillEntry {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  source?: string;
  risk?: string;
  path: string;
}

interface RegistryFile { skills: SkillEntry[] }
interface TranslationsFile { translations: Record<string, { en: string }> }

async function main() {
  // Dynamic imports AFTER env load · same pattern as translate-skills.
  const provMod = await import("@/lib/ai/provider");
  const prismaMod = await import("@/lib/prisma");
  const getEmbedding = provMod.getEmbedding;
  const prisma = prismaMod.prisma;

  const regPath = resolve(process.cwd(), "data", "skills-registry.json");
  const transPath = resolve(process.cwd(), "data", "skills-translations.json");
  if (!existsSync(regPath)) {
    console.error("✗ data/skills-registry.json missing");
    process.exit(1);
  }
  const reg = JSON.parse(readFileSync(regPath, "utf8")) as RegistryFile;
  const trans: TranslationsFile = existsSync(transPath)
    ? JSON.parse(readFileSync(transPath, "utf8"))
    : { translations: {} };

  console.log(`=== embedding ${reg.skills.length} skills ===\n`);

  // Pull existing embeddings · skip skills that already have one
  const existing = await prisma.vectorEmbedding.findMany({
    where: { sourceType: "skill" },
    select: { sourceId: true },
  });
  const haveEmbedding = new Set(existing.map((r) => r.sourceId));
  console.log(`  ${haveEmbedding.size} skills already embedded · skipping those\n`);

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const t0 = Date.now();

  for (const s of reg.skills) {
    if (haveEmbedding.has(s.name)) {
      skipped++;
      continue;
    }
    const en = trans.translations[s.name]?.en ?? "";
    const tags = Array.isArray(s.tags) ? s.tags.join(" ") : "";
    const probeText = [
      s.name,
      s.description,
      tags,
      en, // English summary if available · helps non-English skills match English queries
    ].filter(Boolean).join("\n").slice(0, 4000);

    try {
      const vec = await getEmbedding(probeText);
      if (!Array.isArray(vec) || vec.length === 0) {
        failed++;
        continue;
      }
      await prisma.vectorEmbedding.create({
        data: {
          sourceType: "skill",
          sourceId: s.name,
          content: probeText.slice(0, 1000),
          embedding: JSON.stringify(vec),
          embedding_dim: vec.length,
          model: "default",
        },
      });
      success++;
      if (success % 50 === 0) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`  ${success} embedded · ${failed} failed · ${elapsed}s elapsed`);
      }
    } catch (err) {
      failed++;
      if (failed <= 5) {
        console.warn(`  ${s.name} · ${err instanceof Error ? err.message.slice(0, 80) : err}`);
      }
    }
  }

  const total = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n  ${success} new · ${skipped} skipped · ${failed} failed · ${total}s total`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
