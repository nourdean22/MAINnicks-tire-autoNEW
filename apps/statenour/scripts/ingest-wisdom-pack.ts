/**
 * v10.0.524 · Generic wisdom-pack ingest loader.
 *
 * Reads any JSON file at data/wisdom/*.json with the schema:
 *   {
 *     pack: string,
 *     source_credit: string,
 *     entries: [{
 *       text: string,
 *       topic: string,
 *       confidence: number,   // 0..1
 *       context?: string,
 *       tags?: string[]
 *     }, ...]
 *   }
 *
 * Upserts each entry into BrainMemory(category="wisdom") with:
 *   · key      = `wisdom_${pack}_${index}`
 *   · content  = text
 *   · metadata = { origin: pack, context, tags, topic, version, source_credit }
 *
 * Idempotent · re-running just refreshes the rows. Skips entries
 * with confidence < 0.5 (placeholder threshold for paraphrased
 * material — operator can tune).
 *
 * Run: `pnpm tsx scripts/ingest-wisdom-pack.ts [pack-name]`
 *      With no arg: ingest all *.json in data/wisdom/.
 *      With arg `naval-ravikant`: ingest just that pack.
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface WisdomEntry {
  text: string;
  topic: string;
  confidence: number;
  context?: string;
  tags?: string[];
}

interface WisdomPack {
  pack: string;
  source_credit?: string;
  entries: WisdomEntry[];
}

async function main() {
  const filter = process.argv[2] ?? null;
  const wisdomDir = resolve(process.cwd(), "data", "wisdom");
  const files = await readdir(wisdomDir).catch(() => [] as string[]);
  const targets = files
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !filter || f === `${filter}.json`);

  if (targets.length === 0) {
    console.error(
      `No wisdom packs found at ${wisdomDir}${filter ? ` matching ${filter}` : ""}.`,
    );
    process.exit(1);
  }

  let totalIngested = 0;
  let totalSkipped = 0;

  for (const filename of targets) {
    const filePath = resolve(wisdomDir, filename);
    const raw = await readFile(filePath, "utf8");
    let pack: WisdomPack;
    try {
      pack = JSON.parse(raw) as WisdomPack;
    } catch (err) {
      console.error(
        `[!] Failed to parse ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (!Array.isArray(pack.entries) || !pack.pack) {
      console.error(`[!] Invalid pack shape in ${filename} · skipping.`);
      continue;
    }

    let ingestedHere = 0;
    let skippedHere = 0;
    for (let i = 0; i < pack.entries.length; i++) {
      const entry = pack.entries[i];
      if (typeof entry?.text !== "string" || entry.text.length < 20) {
        skippedHere++;
        continue;
      }
      if (entry.confidence < 0.5) {
        skippedHere++;
        continue;
      }
      const key = `wisdom_${pack.pack}_${String(i).padStart(3, "0")}`;
      try {
        await prisma.brainMemory.upsert({
          where: { category_key: { category: BRAIN_CATEGORIES.WISDOM, key } },
          create: {
            category: BRAIN_CATEGORIES.WISDOM,
            key,
            content: entry.text,
            confidence: entry.confidence,
            source: `pack:${pack.pack}`,
            metadata: {
              origin: pack.pack,
              source_credit: pack.source_credit ?? null,
              topic: entry.topic,
              tags: entry.tags ?? [],
              context: entry.context ?? null,
              version: "v10.0.524",
            } as unknown as Parameters<typeof prisma.brainMemory.upsert>[0]["create"]["metadata"],
          },
          update: {
            content: entry.text,
            confidence: entry.confidence,
            metadata: {
              origin: pack.pack,
              source_credit: pack.source_credit ?? null,
              topic: entry.topic,
              tags: entry.tags ?? [],
              context: entry.context ?? null,
              version: "v10.0.524",
            } as unknown as Parameters<typeof prisma.brainMemory.upsert>[0]["update"]["metadata"],
          },
        });
        ingestedHere++;
      } catch (err) {
        console.error(
          `[!] Failed to upsert ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
        skippedHere++;
      }
    }
    console.log(
      `[ok] ${pack.pack} · ingested ${ingestedHere}/${pack.entries.length} (skipped ${skippedHere})`,
    );
    totalIngested += ingestedHere;
    totalSkipped += skippedHere;
  }

  console.log(
    `\n[done] total ingested: ${totalIngested} · skipped: ${totalSkipped}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[!] Fatal:", err);
  process.exit(1);
});
