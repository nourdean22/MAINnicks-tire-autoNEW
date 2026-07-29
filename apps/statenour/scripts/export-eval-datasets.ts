/**
 * Eval-dataset exporter (WP-21, 2026-07-29 · audit-#12 keeper).
 *
 * Turns REAL production judgments into versioned eval material —
 * "Nick improves through evidence, not vibes":
 *
 *   · intelligence_outcomes rows the operator DISMISSED or judged
 *     not-useful (outcomesNeedingReview) → recommendation-quality cases
 *   · contradictions (open) → memory-integrity cases
 *
 * LOCAL + NO-SEND by design: writes JSONL under eval-datasets/
 * (gitignored). Braintrust upload stays a deliberate manual step —
 * the braintrust dep is live (braintrust-wrap.ts) but nothing leaves
 * the machine from this script. Each line carries the metadata fields
 * the register row prescribes: app, feature, source, exported_at.
 *
 * Run:  set -a && . ./.env.local && set +a
 *       pnpm exec tsx scripts/export-eval-datasets.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma";

const OUT_DIR = join(process.cwd(), "eval-datasets");
const exportedAt = new Date().toISOString();

interface EvalCase {
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

async function outcomeCases(): Promise<EvalCase[]> {
  const rows = await prisma.intelligenceOutcome.findMany({
    where: { OR: [{ decision: "dismissed" }, { outcomeUseful: false }] },
    orderBy: { shownAt: "desc" },
    take: 500,
    select: {
      id: true,
      kind: true,
      sourceEngine: true,
      summary: true,
      decision: true,
      outcomeUseful: true,
      shownAt: true,
    },
  });
  return rows.map((r) => ({
    input: { kind: r.kind, recommendation: r.summary },
    expected: {
      operatorVerdict: r.decision ?? "undecided",
      useful: r.outcomeUseful,
      note: "operator rejected or judged not useful — a good engine would not have surfaced this as-is",
    },
    metadata: {
      app: "statenour",
      feature: "recommendation-quality",
      source: `intelligence_outcomes:${r.id}`,
      source_engine: r.sourceEngine,
      shown_at: r.shownAt.toISOString(),
      exported_at: exportedAt,
      synthetic: false,
    },
  }));
}

async function contradictionCases(): Promise<EvalCase[]> {
  const rows = await prisma.contradiction.findMany({
    where: { resolved: false },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, claim: true, reality: true, severity: true, createdAt: true },
  });
  return rows.map((r) => ({
    input: { statedClaim: r.claim },
    expected: {
      reality: r.reality,
      shouldFlag: true,
      note: "recall/claims layer should surface the contradiction, not repeat the stale claim",
    },
    metadata: {
      app: "statenour",
      feature: "memory-integrity",
      source: `contradictions:${r.id}`,
      severity: r.severity,
      created_at: r.createdAt.toISOString(),
      exported_at: exportedAt,
      synthetic: false,
    },
  }));
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const [outcomes, contradictions] = await Promise.all([outcomeCases(), contradictionCases()]);

  const write = (name: string, cases: EvalCase[]) => {
    const file = join(OUT_DIR, `${name}.jsonl`);
    writeFileSync(file, cases.map((c) => JSON.stringify(c)).join("\n") + (cases.length ? "\n" : ""));
    console.log(`  ${name}: ${cases.length} case(s) → ${file}`);
  };

  console.log("eval-dataset export · local only, nothing uploaded");
  write("recommendation-quality", outcomes);
  write("memory-integrity", contradictions);
  console.log(
    outcomes.length + contradictions.length === 0
      ? "  (zero real cases yet — the ledgers are young; re-run as verdicts accrue)"
      : "  Braintrust upload is a DELIBERATE manual step — nothing was sent.",
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("export failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
