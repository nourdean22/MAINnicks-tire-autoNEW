/**
 * scripts/smoke-brain-feedback-layers.ts · v10.0.412
 *
 * End-to-end smoke for the v10.0.397-410 wave · runs every new
 * brain-feedback layer against the LIVE database and reports
 * pass/fail with sample results.
 *
 * Why this exists · pre-push gates verify code shape (typecheck,
 * lint, unit tests with mocked DB). They don't catch:
 *   · "endpoint exists but returns garbage when hit on real data"
 *   · "function works but the DB shape changed underneath it"
 *   · "wisdom corpus is so well-curated none of these heuristics
 *      surface anything · operator never sees the panel"
 *
 * The smoke validates the user-visible contract: each layer
 * SHOULD or SHOULD NOT surface signal given the operator's actual
 * brain state, and we tell the operator what they'll see.
 *
 * Run · pnpm tsx scripts/smoke-brain-feedback-layers.ts
 * Reads · DATABASE_URL from .env.local
 * Writes · nothing · pure read-side validation
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { prisma } from "@/lib/prisma";
import {
  getRecentJudgments,
  analyzeJudgments,
} from "@/lib/brain/improve-agent";
import {
  findStaleCandidates,
  findRedundantPairs,
  findLowTrustCandidates,
} from "@/lib/brain/wisdom-evolution";
import { computeWisdomViolations } from "@/lib/brain/wisdom-violations";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";

interface SmokeResult {
  layer: string;
  pass: boolean;
  signal: number;
  sample?: string;
  durationMs: number;
  error?: string;
}

async function smokeImproveAgent(): Promise<SmokeResult> {
  const t0 = Date.now();
  try {
    const judgments = await getRecentJudgments(7);
    const hypotheses = analyzeJudgments(judgments);
    return {
      layer: "improve-agent",
      pass: true,
      signal: hypotheses.length,
      sample:
        hypotheses[0]
          ? `${hypotheses[0].axis} · ${(hypotheses[0].failureRate * 100).toFixed(0)}% failing (${hypotheses[0].failingCount}/${hypotheses[0].totalCount}) · ${hypotheses[0].proposedRuleChange.slice(0, 80)}`
          : `clean · ${judgments.length} judgments analyzed, no axis above 15% threshold`,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      layer: "improve-agent",
      pass: false,
      signal: 0,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      durationMs: Date.now() - t0,
    };
  }
}

async function smokeWisdomEvolution(): Promise<SmokeResult[]> {
  const out: SmokeResult[] = [];

  for (const [name, fn] of [
    ["evolution-stale", findStaleCandidates],
    ["evolution-redundant", findRedundantPairs],
    ["evolution-low-trust", findLowTrustCandidates],
  ] as const) {
    const t0 = Date.now();
    try {
      const result = await fn();
      const first = result[0];
      let sample = "no candidates · clean";
      if (first) {
        if (first.type === "redundant") {
          sample = `${first.keepKey} ↔ ${first.mergeKey} · cosine ${first.similarity}`;
        } else if (first.type === "stale") {
          sample = `${first.key} · ${first.daysSinceLastSeen}d cold · conf ${first.confidence.toFixed(2)}`;
        } else {
          sample = `${first.key} · conf ${first.confidence.toFixed(2)}`;
        }
      }
      out.push({
        layer: name,
        pass: true,
        signal: result.length,
        sample,
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      out.push({
        layer: name,
        pass: false,
        signal: 0,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        durationMs: Date.now() - t0,
      });
    }
  }
  return out;
}

async function smokeWisdomViolations(): Promise<SmokeResult> {
  const t0 = Date.now();
  try {
    const violations = await computeWisdomViolations({ daysBack: 7, limit: 5 });
    return {
      layer: "wisdom-violations",
      pass: true,
      signal: violations.length,
      sample:
        violations[0]
          ? `${violations[0].key} · ${Math.round((violations[0].violationRate ?? 0) * 100)}% violation rate · ${violations[0].matches.length} match(es)`
          : "no violations · acting in alignment",
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      layer: "wisdom-violations",
      pass: false,
      signal: 0,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      durationMs: Date.now() - t0,
    };
  }
}

async function smokeWisdomGraph(): Promise<SmokeResult> {
  const t0 = Date.now();
  try {
    // Pick a high-confidence wisdom with an embedding · simulate the
    // /api/brain/wisdom/[id]/related call without hitting HTTP.
    const anchor = await prisma.brainMemory.findFirst({
      where: { category: "wisdom", deletedAt: null, confidence: { gte: 0.8 } },
      orderBy: { lastSeen: "desc" },
      select: { id: true, key: true },
    });
    if (!anchor) {
      return {
        layer: "wisdom-graph",
        pass: true,
        signal: 0,
        sample: "no wisdoms above 0.8 confidence · skipped",
        durationMs: Date.now() - t0,
      };
    }

    const anchorEmbed = await prisma.vectorEmbedding.findFirst({
      where: { sourceType: "brain_memory", sourceId: anchor.id },
      select: { embedding: true },
    });
    if (!anchorEmbed) {
      return {
        layer: "wisdom-graph",
        pass: true,
        signal: 0,
        sample: `anchor ${anchor.key} has no embedding · skipped`,
        durationMs: Date.now() - t0,
      };
    }

    const allWisdoms = await prisma.brainMemory.findMany({
      where: {
        category: "wisdom",
        deletedAt: null,
        id: { not: anchor.id },
        confidence: { gte: 0.5 },
      },
      select: { id: true, key: true },
    });
    const embeds = await prisma.vectorEmbedding.findMany({
      where: {
        sourceType: "brain_memory",
        sourceId: { in: allWisdoms.map((w) => w.id) },
      },
      select: { sourceId: true, embedding: true },
      take: 200,
    });

    const anchorVec = JSON.parse(anchorEmbed.embedding) as number[];
    const wisdomKeyById = new Map(allWisdoms.map((w) => [w.id, w.key]));
    const scored: { key: string; sim: number }[] = [];
    for (const e of embeds) {
      try {
        const v = JSON.parse(e.embedding) as number[];
        if (v.length !== anchorVec.length) continue;
        const sim = cosineSimilarity(anchorVec, v);
        if (sim < 0.4) continue;
        scored.push({ key: wisdomKeyById.get(e.sourceId) ?? e.sourceId, sim });
      } catch {
        // skip
      }
    }
    scored.sort((a, b) => b.sim - a.sim);
    const top = scored.slice(0, 5);

    return {
      layer: "wisdom-graph",
      pass: true,
      signal: top.length,
      sample:
        top[0]
          ? `anchor=${anchor.key} · top neighbor=${top[0].key} · sim ${top[0].sim.toFixed(3)}`
          : `anchor=${anchor.key} · no neighbors above 0.40`,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      layer: "wisdom-graph",
      pass: false,
      signal: 0,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      durationMs: Date.now() - t0,
    };
  }
}

async function main() {
  console.log("=== brain feedback layers · smoke v10.0.412 ===\n");

  const t0 = Date.now();
  const [improve, evolution, violations, graph] = await Promise.all([
    smokeImproveAgent(),
    smokeWisdomEvolution(),
    smokeWisdomViolations(),
    smokeWisdomGraph(),
  ]);

  const all: SmokeResult[] = [improve, ...evolution, violations, graph];
  const failures = all.filter((r) => !r.pass);

  for (const r of all) {
    const tag = r.pass ? "✓" : "✗";
    const status = r.pass
      ? r.signal === 0 ? "(no signal)" : `(${r.signal} surfaced)`
      : `FAIL: ${r.error}`;
    console.log(
      `  ${tag} ${r.layer.padEnd(22)} ${String(r.durationMs).padStart(5)}ms · ${status}`,
    );
    if (r.sample) console.log(`      ${r.sample}`);
  }

  console.log(`\n  ${all.length - failures.length}/${all.length} layers passed · ${Date.now() - t0}ms total`);

  await prisma.$disconnect();
  if (failures.length > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("FAIL:", e);
  await prisma.$disconnect();
  process.exit(1);
});
