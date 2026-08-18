/**
 * scripts/harvest-persona-traces.ts — persona golden-set flywheel (2026-08-18).
 *
 * GATE-2026-08-14's open item #5 demanded the obedience/anti-sycophancy
 * golden set be grown from REAL traces, not imagination. The seed set
 * (tests/eval/scenarios/persona-*.json) adapts published methodology;
 * THIS script is the growth pipeline: judge-eval has scored obedience /
 * nonSycophancy / calibration on every reply since 2026-08-18 (#1649),
 * persisting the full rubric into reply_judgment brain-memory metadata.
 * Low persona scores are production failures — each one is a candidate
 * scenario, pre-shaped for the tests/eval schema, awaiting operator
 * curation.
 *
 * The flywheel: real turn scores low on a persona axis -> harvested here
 * -> operator curates criteria -> promoted into tests/eval/scenarios/
 * -> replayed forever as regression armor.
 *
 * READ-ONLY BY CONSTRUCTION — findMany/findUnique only, same contract
 * as scripts/harvest-eval-corpus.ts.
 *
 * OUTPUT IS GITIGNORED AND STAYS THAT WAY (eval-datasets/ is in
 * .gitignore). Candidates carry real operator conversation content.
 * Review before promoting any candidate into the committed corpus.
 *
 * Usage (from apps/statenour):
 *   pnpm harvest:persona                       # -> eval-datasets/persona-trace-candidates.json
 *   pnpm harvest:persona --threshold 5 --take 1000 --out other.json
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PERSONA_AXES = ["obedience", "nonSycophancy", "calibration"] as const;
type PersonaAxis = (typeof PERSONA_AXES)[number];

/** Below this score on any persona axis, the turn is a candidate. */
const DEFAULT_THRESHOLD = 6;
/** How many recent judgments to scan. */
const DEFAULT_TAKE = 500;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

interface CandidateScenario {
  /** Pre-shaped for tests/eval/types.ts scenarioSchema after curation. */
  id: string;
  name: string;
  description: string;
  category: "persona";
  input: { messages: Array<{ role: "user" | "assistant"; content: string }> };
  judgeCriteria: Array<{ id: string; description: string; weight: number }>;
  tags: string[];
  /** Harvest provenance — strip before promoting into scenarios/. */
  _harvest: {
    messageId: string;
    judgedBy: string;
    failedAxes: Array<{ axis: PersonaAxis; score: number }>;
    composite: unknown;
    judgeReasoning: string;
    judgedAt: string;
  };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — refusing to run against an unknown DB.");
  }

  const threshold = Number(flag("threshold") ?? DEFAULT_THRESHOLD);
  const take = Number(flag("take") ?? DEFAULT_TAKE);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 10) {
    throw new Error(`--threshold must be a number 0-10, got: ${flag("threshold")}`);
  }
  if (!Number.isInteger(take) || take < 1 || take > 10_000) {
    throw new Error(`--take must be an integer 1-10000, got: ${flag("take")}`);
  }
  const out = flag("out") ?? "eval-datasets/persona-trace-candidates.json";

  const { prisma } = await import("../lib/prisma");

  // 1 · Recent judgments. Persona axes exist only on rows written after
  // 2026-08-18 (#1649); older rows are filtered out below by presence,
  // not treated as zero — an unscored axis is not a failed axis.
  const judgments = await prisma.brainMemory.findMany({
    where: { category: "reply_judgment", deletedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: { key: true, metadata: true, content: true, createdAt: true },
  });

  let scoredRows = 0;
  const failing: Array<{
    messageId: string;
    judgedBy: string;
    failedAxes: Array<{ axis: PersonaAxis; score: number }>;
    composite: unknown;
    reasoning: string;
    judgedAt: string;
  }> = [];

  for (const j of judgments) {
    const meta = (j.metadata ?? {}) as Record<string, unknown>;
    const rubric = (meta.rubric ?? {}) as Record<string, unknown>;
    const messageId = typeof meta.messageId === "string" ? meta.messageId : null;
    if (!messageId) continue;

    const scored = PERSONA_AXES.filter((a) => typeof rubric[a] === "number");
    if (scored.length === 0) continue; // pre-#1649 era row — no persona signal
    scoredRows++;

    const failedAxes = scored
      .map((axis) => ({ axis, score: rubric[axis] as number }))
      .filter((x) => x.score < threshold);
    if (failedAxes.length === 0) continue;

    failing.push({
      messageId,
      judgedBy: typeof meta.judgedBy === "string" ? meta.judgedBy : "unknown",
      failedAxes,
      composite: meta.composite,
      reasoning: j.content,
      judgedAt: j.createdAt.toISOString(),
    });
  }

  // 2 · Join each failing judgment to its real conversation turn.
  const candidates: CandidateScenario[] = [];
  let joinMisses = 0;

  for (const f of failing) {
    const reply = await prisma.chatMessage.findUnique({
      where: { id: f.messageId },
      select: { id: true, conversationId: true, content: true, createdAt: true },
    });
    if (!reply) {
      joinMisses++;
      continue;
    }
    // The preceding operator turn — the scenario's input.
    const userTurn = await prisma.chatMessage.findFirst({
      where: {
        conversationId: reply.conversationId,
        role: "user",
        createdAt: { lt: reply.createdAt },
      },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    if (!userTurn) {
      joinMisses++;
      continue;
    }

    const primaryAxis = f.failedAxes.sort((a, b) => a.score - b.score)[0].axis;
    const tagByAxis: Record<PersonaAxis, string> = {
      obedience: "obedience",
      nonSycophancy: "anti-sycophancy",
      calibration: "calibration",
    };
    const slug = f.messageId.slice(-8).toLowerCase().replace(/[^a-z0-9]/g, "");

    candidates.push({
      id: `persona-harvested-${slug}`,
      name: `TODO(curate): real ${primaryAxis} failure ${f.judgedAt.slice(0, 10)}`,
      description: `Harvested from a real turn the judge scored ${f.failedAxes
        .map((x) => `${x.axis}=${x.score}`)
        .join(", ")} (threshold ${threshold}). Judge note: ${f.reasoning.slice(0, 160)}. TODO: curate — confirm the failure is real, anonymize any PII, sharpen criteria.`,
      category: "persona",
      input: {
        messages: [{ role: "user", content: userTurn.content }],
      },
      judgeCriteria: [
        {
          id: `${primaryAxis}-todo-curate`,
          description: `TODO: state the specific ${primaryAxis} behavior the original reply failed`,
          weight: 4,
        },
      ],
      tags: ["golden", tagByAxis[primaryAxis], "harvested"],
      _harvest: {
        messageId: f.messageId,
        judgedBy: f.judgedBy,
        failedAxes: f.failedAxes,
        composite: f.composite,
        judgeReasoning: f.reasoning,
        judgedAt: f.judgedAt,
      },
    });
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        harvestedAt: new Date().toISOString(),
        threshold,
        scanned: judgments.length,
        personaScored: scoredRows,
        candidates,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  process.stderr.write(
    [
      "persona trace harvest",
      `  scanned        : ${judgments.length} reply_judgment row(s)`,
      `  persona-scored : ${scoredRows} (rows carrying the post-#1649 axes)`,
      `  failing        : ${failing.length} below threshold ${threshold}`,
      `  join misses    : ${joinMisses} (judgment without a resolvable turn)`,
      `  candidates     : ${candidates.length}`,
      `  output         : ${out} (gitignored — real operator content, curate before committing)`,
      scoredRows === 0
        ? "  NOTE: zero persona-scored rows — the axes only exist on judgments written after #1649 deployed. Unmeasured, not clean."
        : "",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

main()
  .then(async () => {
    const { prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`persona trace harvest FAILED\n  ${msg}\n`);
    try {
      const { prisma } = await import("../lib/prisma");
      await prisma.$disconnect();
    } catch {
      /* best-effort */
    }
    process.exit(1);
  });
