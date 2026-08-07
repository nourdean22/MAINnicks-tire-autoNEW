/**
 * IG retro DUAL-judge backfill (2026-08-07) — manufacture the disagreement
 * corpus, and measure whether the live publish gate is actually independent.
 *
 * WHY TWO JUDGES. The live shadow lane has produced 3 verdicts and ZERO
 * disagreements. That reads like "the generator is good". It may instead be
 * structural: prod runs AI_FORCE_OLLAMA=true, and resolveEffectiveModel
 * (server/_core/llm.ts) returns OLLAMA_MODEL || "deepseek-v4-pro" while
 * DISCARDING the requested model — OLLAMA_MODEL is unset on Railway. So every
 * lane in prod is deepseek-v4-pro, including judgeSingleConcept, including the
 * igAutopost generator it grades. A model agreeing with itself is not a gate.
 *
 * This script grades the same rows twice:
 *   PROD lane      deepseek-v4-pro  — reproduces exactly what the live gate does
 *   DIVERSE lane   gpt-oss:120b     — a genuinely different family
 *
 * The delta between them is (a) the quantified cost of the pin defect and
 * (b) the held-out-judge calibration the anti-collusion design needs: if the
 * two families disagree with EACH OTHER as often as they disagree with
 * self-eval, a held-out judge is not a trustworthy gate and option 2 is dead.
 *
 * READ-ONLY against the DB. Writes ONLY to eval-datasets/*.jsonl (house
 * pattern — Railway's FS is ephemeral, and this is a local analysis artifact).
 * Resumable: rows already in the JSONL are skipped.
 *
 * Run from apps/nickstire:
 *   pnpm exec tsx scripts/ig-retro-dual-judge.ts --limit 136
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path: string, only?: string[]): void {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      if (only && !only.includes(m[1])) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* absent file is fine */
  }
}

/**
 * Credential homes (verified 2026-08-07 — do not guess these):
 *   DATABASE_URL   apps/nickstire/.env        — ABSENT in a harness worktree
 *   OLLAMA_API_KEY apps/statenour/.env ONLY   — not in nickstire's .env at all,
 *                                               and statenour's .env.local holds
 *                                               the literal placeholder "local"
 * A harness worktree under .claude/worktrees/* carries NO .env files, so both
 * resolve to the PRIMARY checkout. Earlier instrument runs worked only because
 * the invoking shell happened to carry the key — the absent-key case is what
 * let a gauntlet exit 0 printing "0 losses" (#1416).
 */
const PRIMARY = "C:/Users/nourd/NOURCITY";
loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(`${PRIMARY}/apps/nickstire/.env`);
loadEnvFile(resolve(process.cwd(), "../statenour/.env"), ["OLLAMA_API_KEY"]);
loadEnvFile(`${PRIMARY}/apps/statenour/.env`, ["OLLAMA_API_KEY"]);

/**
 * #1416 doctrine: the force flag flattens BOTH lanes onto one model, which
 * would silently defeat the entire point of this script. Strip it in-process,
 * loudly. Both model names below are Ollama-native substrings
 * (OLLAMA_MODEL_SUBSTRINGS in llm.ts), so they route to Ollama with no flag.
 */
const PROD_LANE = "deepseek-v4-pro";
const DIVERSE_LANE = "gpt-oss:120b";
for (const flag of ["AI_FORCE_OLLAMA", "AI_FORCE_GEMINI"]) {
  if (process.env[flag]) {
    console.log(`NOTE: stripping ${flag}=${process.env[flag]} in-process — it would flatten both judge lanes onto one model`);
    delete process.env[flag];
  }
}
if (!process.env.OLLAMA_API_KEY) {
  console.error("FATAL: OLLAMA_API_KEY absent — both lanes would fail and this run would report a meaningless zero.");
  process.exit(1);
}

const OUT_DIR = resolve(process.cwd(), "eval-datasets");
const OUT_FILE = resolve(OUT_DIR, "ig-retro-dual-judge.jsonl");

interface Row {
  id: number;
  conceptKey: string;
  archetype: string;
  status: string;
  caption: string;
  imagePrompt: string;
  overallScore: number | null;
  imageUrl: string | null;
  createdAt: Date;
}

const PROBE_CONCEPT = {
  title: "credits-probe",
  hook: "Cleveland potholes do not schedule appointments.",
  coreIdea: "A blunt seasonal post: what a pothole hit actually does to alignment, and why a quick check beats a bent rim discovered in July.",
  visualIdea: "One decisive photo of a pothole-scarred East Side street.",
  whyItWorks: "Concrete, local, teaches one verifiable mechanic truth.",
};

/** #1416: the probe must ride the EXACT lanes the work uses, or a dead lane renders as a clean zero. */
async function probeBothLanes(): Promise<boolean> {
  const { judgeSingleConcept } = await import("../server/services/conceptTournament");
  let ok = true;
  for (const model of [PROD_LANE, DIVERSE_LANE]) {
    try {
      const v = await judgeSingleConcept({
        campaignAsk: "Probe: judge lane liveness check",
        concept: PROBE_CONCEPT,
        priority: 3,
        model,
      });
      console.log(`  probe OK   ${model.padEnd(18)} total=${v.total} rejected=${v.rejected}`);
    } catch (err) {
      console.log(`  probe FAIL ${model.padEnd(18)} ${err instanceof Error ? err.message.slice(0, 140) : String(err)}`);
      ok = false;
    }
  }
  return ok;
}

/** The concept reconstruction, verbatim from scripts/retro-tournament.ts:158 — one mapping, not two. */
function toConcept(r: Row) {
  return {
    title: r.conceptKey,
    hook: r.caption.split("\n")[0] ?? r.caption.slice(0, 120),
    coreIdea: r.caption,
    visualIdea: r.imagePrompt,
    whyItWorks: "retro-graded published draft",
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Math.max(1, Math.min(400, parseInt(args[limIdx + 1], 10) || 136)) : 136;

  console.log(`lanes: PROD=${PROD_LANE}  DIVERSE=${DIVERSE_LANE}`);
  console.log("probing both lanes before the batch...");
  if (!(await probeBothLanes())) {
    console.error("FATAL: a judge lane is down — aborting rather than reporting a partial corpus as complete.");
    process.exit(1);
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const done = new Set<number>();
  if (existsSync(OUT_FILE)) {
    for (const line of readFileSync(OUT_FILE, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { done.add((JSON.parse(line) as { id: number }).id); } catch { /* skip */ }
    }
    console.log(`resuming — ${done.size} rows already graded`);
  }

  const { getDb } = await import("../server/db");
  const d = await getDb();
  if (!d) throw new Error("no DB");
  const { igAutopostLog } = await import("../drizzle/schema");
  const { desc, sql } = await import("drizzle-orm");

  const rows = (await d.select({
    id: igAutopostLog.id,
    conceptKey: igAutopostLog.conceptKey,
    archetype: igAutopostLog.archetype,
    status: igAutopostLog.status,
    caption: igAutopostLog.caption,
    imagePrompt: igAutopostLog.imagePrompt,
    overallScore: igAutopostLog.overallScore,
    imageUrl: igAutopostLog.imageUrl,
    createdAt: igAutopostLog.createdAt,
  }).from(igAutopostLog)
    .where(sql`${igAutopostLog.status} = 'posted' AND ${igAutopostLog.caption} <> ''`)
    .orderBy(desc(igAutopostLog.createdAt))
    // + done.size: the done-set filter runs AFTER this window, so on a resume
    // a fresh post entering the top of the window would silently push an
    // ungraded row out the bottom (review-confirmed). Widening by the cached
    // count keeps every originally-targeted row reachable.
    .limit(limit + done.size)) as Row[];

  const todo = rows.filter((r) => !done.has(r.id));
  console.log(`\n${rows.length} posted rows, ${todo.length} to grade (${rows.length - todo.length} cached)\n`);

  const { judgeSingleConcept } = await import("../server/services/conceptTournament");
  let graded = 0;
  let failed = 0;

  for (const r of todo) {
    const concept = toConcept(r);
    const ask = `Autonomous ${r.archetype} Instagram post for the shop feed (retro-grade)`;
    try {
      // The two lanes are independent verdicts on the same row, so they run
      // concurrently — exactly the 2-of-3 slots ollamaScheduler reserves for
      // background (P3) work, halving a ~5.7h serial grind. Rows stay serial:
      // going wider would starve the live lanes this is supposed to yield to.
      const [prod, diverse] = await Promise.all([
        judgeSingleConcept({ campaignAsk: ask, concept, priority: 3, model: PROD_LANE }),
        judgeSingleConcept({ campaignAsk: ask, concept, priority: 3, model: DIVERSE_LANE }),
      ]);
      const rec = {
        id: r.id,
        conceptKey: r.conceptKey,
        archetype: r.archetype,
        createdAt: new Date(r.createdAt).toISOString(),
        selfOverall: r.overallScore,
        hasImageUrl: !!(r.imageUrl && r.imageUrl.length > 5),
        // ?? "" — parseSingleVerdict validates only `total`; note/rejectionReason
        // are unchecked casts and CAN arrive undefined (review-confirmed). A
        // TypeError here would kill the whole batch over a missing note.
        prod: { model: PROD_LANE, total: prod.total, rejected: prod.rejected, note: String(prod.note ?? prod.rejectionReason ?? "").slice(0, 200) },
        diverse: { model: DIVERSE_LANE, total: diverse.total, rejected: diverse.rejected, note: String(diverse.note ?? diverse.rejectionReason ?? "").slice(0, 200) },
      };
      appendFileSync(OUT_FILE, `${JSON.stringify(rec)}\n`);
      graded++;
      const dis = (n: number, rej: boolean) => ((r.overallScore ?? 0) >= 70 && (n < 60 || rej) ? " DISAGREE" : "");
      console.log(`  ${String(graded).padStart(3)}/${todo.length} row ${r.id} self=${r.overallScore ?? "?"} | prod=${prod.total}${prod.rejected ? "R" : ""}${dis(prod.total, prod.rejected)} | diverse=${diverse.total}${diverse.rejected ? "R" : ""}${dis(diverse.total, diverse.rejected)}`);
    } catch (err) {
      failed++;
      console.log(`  row ${r.id} FAILED: ${err instanceof Error ? err.message.slice(0, 140) : String(err)}`);
    }
  }

  console.log(`\ngraded ${graded}, failed ${failed}, corpus -> ${OUT_FILE}`);
  // Zero-measured must never render as zero-findings (#1416). The original
  // guard only fired on a cold run: a RESUME that graded nothing, or any run
  // with row failures, exited 0 and read as success (review-confirmed).
  if (todo.length > 0 && graded === 0) {
    console.error("FATAL: had work to do and graded ZERO rows — a failed run, not an empty corpus.");
    process.exit(1);
  }
  if (failed > 0) {
    console.error(`FATAL: ${failed} row(s) failed — the corpus is INCOMPLETE; do not read it as a finished batch.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[ig-retro-dual-judge] fatal:", err);
  process.exit(1);
});
