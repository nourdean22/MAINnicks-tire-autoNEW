/**
 * Creative memory — Genome Wave 1, slice 3.
 *
 * Persists campaign genomes with their creative fingerprints and answers ONE
 * question for generation flows: "what has this account already run?" — so
 * the concept tournament automatically steers away from repeats instead of
 * relying on the operator to paste a recency list.
 *
 * Degrades gracefully until the operator applies drizzle/0085 (the runner
 * can mark migrations tracked without executing them — 0083/0084 both hit
 * that trap): a missing table logs a warning and memory features return
 * empty, but generation itself never fails because memory is cold.
 */
import { createLogger } from "../lib/logger";
import {
  fingerprintFromGenome,
  genomeFromReelBrief,
  type CreativeGenome,
} from "../../client/src/lib/creativeGenome";

const log = createLogger("services:creative-memory");

export interface SaveGenomeInput {
  genome: CreativeGenome;
  campaignAsk: string;
  source: "direct" | "tournament";
}

export async function saveGenome(input: SaveGenomeInput): Promise<{ id: string } | null> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return null;
    const { creativeGenomes } = await import("../../drizzle/schema");
    const { randomUUID } = await import("crypto");
    const id = `genome_${randomUUID()}`;
    await d.insert(creativeGenomes).values({
      id,
      objective: input.genome.objective,
      territory: input.genome.creativeTerritory,
      campaignAsk: input.campaignAsk.slice(0, 4000),
      fingerprint: fingerprintFromGenome(input.genome),
      genomeJson: JSON.stringify(input.genome),
      source: input.source,
    });
    log.info("genome persisted", { id, territory: input.genome.creativeTerritory, source: input.source });
    return { id };
  } catch (err) {
    // Table may not exist yet (0085 pending hand-apply) — memory is an
    // enhancement, never a generation blocker.
    log.warn("genome persistence unavailable — continuing without memory", {
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return null;
  }
}

export interface StoredGenome {
  id: string;
  territory: string;
  objective: string;
  fingerprint: string;
  createdAt: Date;
  genome: CreativeGenome | null;
}

export async function listGenomes(limit = 20): Promise<StoredGenome[]> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return [];
    const { creativeGenomes } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    const rows = await d.select().from(creativeGenomes).orderBy(desc(creativeGenomes.createdAt)).limit(limit);
    return rows.map((r: typeof rows[number]) => {
      let genome: CreativeGenome | null = null;
      try { genome = JSON.parse(r.genomeJson) as CreativeGenome; } catch { /* keep null */ }
      return { id: r.id, territory: r.territory, objective: r.objective, fingerprint: r.fingerprint, createdAt: r.createdAt, genome };
    });
  } catch (err) {
    log.warn("genome listing unavailable", { err: err instanceof Error ? err.message.slice(0, 160) : String(err) });
    return [];
  }
}

/**
 * Recent creative fingerprints for repetition control, merged from BOTH
 * memories: stored genomes AND published inventory reels (bridged into genome
 * space), so day one — before any genome is stored — the tournament already
 * knows what the account has posted.
 */
export async function recentCreativeFingerprints(limit = 10): Promise<string[]> {
  const out: string[] = [];

  const stored = await listGenomes(limit);
  out.push(...stored.map((g) => g.fingerprint));

  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (d) {
      const { socialContentInventory } = await import("../../drizzle/schema");
      const { desc, eq, and } = await import("drizzle-orm");
      const rows = await d
        .select()
        .from(socialContentInventory)
        .where(and(eq(socialContentInventory.status, "published"), eq(socialContentInventory.contentType, "reel")))
        .orderBy(desc(socialContentInventory.createdAt))
        .limit(limit);
      for (const r of rows) {
        try {
          const brief = JSON.parse(r.briefJson ?? "{}");
          if (brief?.topic) out.push(fingerprintFromGenome(genomeFromReelBrief(brief)));
        } catch { /* unparseable brief — skip */ }
      }
    }
  } catch (err) {
    log.warn("published-content fingerprints unavailable", {
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
  }

  // Dedupe, cap — a short distinct list steers better than a long noisy one.
  return [...new Set(out)].slice(0, limit);
}
