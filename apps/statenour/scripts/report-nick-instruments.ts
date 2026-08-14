#!/usr/bin/env tsx
/**
 * Nick instrument report — the CALLER the BDN-301/302 read models lacked.
 *
 * SELF-AUDIT FINDING (2026-08-14) that produced this file:
 * `summarizePersonaByLane` and `summarizeEstimativeCompliance` shipped
 * with no production caller. Pure, tested, and impossible to run — the
 * BUILT-TESTED-UNWIRED shape the same session criticised in claims.ts.
 * A measurement that cannot be invoked measures nothing.
 *
 * READ-ONLY. Reads stored BrainMemory rows and prints. No writes, no
 * model calls, no generation spend.
 *
 *   pnpm tsx scripts/report-nick-instruments.ts
 *
 * WHAT IT REPORTS
 *   1. persona-by-lane census over `reply_judgment` rows
 *   2. estimative-language compliance over recent assistant messages —
 *      i.e. is the BDN-302 likelihood/confidence split actually landing?
 *
 * EXPECT ZEROS EARLY. Both instruments are new; a zero here is
 * "unmeasured", not "bad". Each prints its own disclosures rather than
 * letting an empty result read as a clean bill of health.
 */

import { prisma } from "@/lib/prisma";
import {
  summarizePersonaByLane,
  type JudgmentRow,
} from "@/lib/observability/persona-lane-census";
import { summarizeEstimativeCompliance } from "@/lib/ai/vnext/truth/estimative";

async function personaByLane() {
  console.log("── 1 · persona by lane (BDN-301)\n");

  const rows = await prisma.brainMemory.findMany({
    where: { category: "reply_judgment", deletedAt: null },
    select: { metadata: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const judgments: JudgmentRow[] = [];
  for (const r of rows) {
    const m = r.metadata as null | {
      judgedBy?: unknown;
      rubric?: Record<string, unknown>;
      taskClass?: unknown;
    };
    if (!m || typeof m.judgedBy !== "string") continue;
    const rubric = m.rubric ?? {};
    judgments.push({
      judgedBy: m.judgedBy,
      // Nothing writes taskClass today — that is exactly why the census
      // refuses to call an all-unknown comparison comparable.
      taskClass: typeof m.taskClass === "string" ? m.taskClass : "unknown",
      scores: {
        accuracy: Number(rubric.accuracy),
        actionability: Number(rubric.actionability),
        brevity: Number(rubric.brevity),
        tone: Number(rubric.tone),
        evidence: Number(rubric.evidence),
      },
    });
  }

  const census = summarizePersonaByLane(judgments);
  console.log(`   rows: ${census.totalRows} · lanes: ${census.lanes.join(", ") || "(none)"}`);
  console.log(`   mix divergence: ${census.mixDivergence}`);
  for (const cell of census.cells) {
    const means = Object.entries(cell.means)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(
      `   ${cell.lane} / ${cell.taskClass}  n=${cell.n}${cell.underpowered ? " (underpowered)" : ""}  ${means}`,
    );
  }
  for (const c of census.comparisons) {
    console.log(
      `   spread ${c.axis}: ${c.spread}  ${c.comparable ? "COMPARABLE" : "not comparable — do not rank"}`,
    );
  }
  for (const d of census.disclosures) console.log(`   ! ${d}`);
}

async function estimativeCompliance() {
  console.log("\n── 2 · estimative-language compliance (BDN-302)\n");

  const msgs = await prisma.chatMessage.findMany({
    where: { role: "assistant" },
    select: { content: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const texts = msgs.map((m) => m.content ?? "").filter(Boolean);
  const s = summarizeEstimativeCompliance(texts);
  const pct = (n: number) => (s.total ? `${Math.round((n / s.total) * 100)}%` : "n/a");

  console.log(`   replies examined: ${s.total}`);
  console.log(`   with a scoreable likelihood: ${s.withLikelihood} (${pct(s.withLikelihood)})`);
  console.log(`   with a confidence level:     ${s.withConfidence} (${pct(s.withConfidence)})`);
  console.log(`   carrying the compact tag:    ${s.tagged} (${pct(s.tagged)})`);
  console.log(`   BARE HEDGES (pre-BDN-302):   ${s.bareHedges} (${pct(s.bareHedges)})`);
  if (s.total === 0) {
    console.log("   ! No assistant messages found — unmeasured, not compliant.");
  } else if (s.withLikelihood === 0) {
    console.log(
      "   ! Zero scoreable likelihoods. Either the split rule is not landing,\n" +
        "     or these replies are all factual (which needs no band). Read the\n" +
        "     bare-hedge count beside this before concluding anything.",
    );
  }
}

async function main() {
  console.log("Nick instrument report · READ-ONLY · no model calls\n");
  await personaByLane();
  await estimativeCompliance();
  console.log("\ndone.");
}

main()
  .catch((e) => {
    console.error("report failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
