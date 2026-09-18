/**
 * scripts/harvest-eval-corpus.ts — WP-21 Truth Flywheel (2026-08-03).
 *
 * `lib/brain/recall-corpus-builder.ts` shipped 2026-07-29 able to turn
 * real operator rejections and claim warnings into eval cases — and
 * nothing ever called it. Imported only by itself and its own test.
 * Same shape as the OTel mapper: built, tested, unwired. This is the
 * caller, plus the third signal (failed tool calls) that no lane read.
 *
 * The flywheel: production failure -> harvested case -> replay -> fix.
 *
 * READ-ONLY BY CONSTRUCTION — findMany only, pinned by a source-scan
 * test, for the same reason as scripts/export-otel-traces.ts.
 *
 * OUTPUT IS GITIGNORED AND STAYS THAT WAY. Harvested cases carry real
 * operator content (rejected recommendation summaries, the text of a
 * turn that made an unproven claim). `eval-datasets/` is already in
 * .gitignore; the register's WP-21 rule is "local no-send first", and
 * nothing here uploads anywhere. Review before promoting any case into
 * the committed corpus.
 *
 * Usage (from apps/statenour):
 *   pnpm harvest:evals                  # -> eval-datasets/recall-corpus.json
 *   pnpm harvest:evals --out other.json
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildRealRecallCases, describeCorpus } from "../lib/brain/recall-corpus-builder";
import type { RecallEvalCase } from "../lib/brain/recall-eval";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * Turn a positive case's CONTENT into the question a person would actually ask.
 *
 * ★★★ WITHOUT THIS THE POSITIVE ARM IS A TAUTOLOGY. `caseFromDurableFact`
 * builds its query from the memory's own wording, so the query IS the document:
 * both the lexical and the vector lane match it trivially and score ~1.0 while
 * proving nothing. Measured on the first cut, the cases read like
 * `surface=missions day=2026-09-06 mount=2` — text no operator would ever type.
 *
 * A benchmark that cannot lose is not a benchmark. Paraphrasing makes the query
 * a QUESTION and leaves the answer key (`brain_memories.key`) untouched, so a
 * hit requires actually finding the row rather than echoing it.
 *
 * ⚠ STATED BIAS: the questions are model-written, so this measures retrieval
 * against SYNTHESISED queries, not against the operator's real phrasing. That
 * is the standard LongMemEval-style construction and it is honest as long as it
 * is labelled — which the provenance string does, per case.
 *
 * ⚠ OFF BY DEFAULT. `pnpm harvest:evals` stays deterministic and read-only;
 * this arm costs model calls and introduces run-to-run variance, so it is
 * opt-in via --paraphrase and records which cases it rewrote.
 */
async function paraphrasePositives(
  cases: RecallEvalCase[],
): Promise<{ rewritten: number; failed: number; blocked?: string }> {
  // ⚠ AN OPTIONAL ARM MUST NOT BE ABLE TO DESTROY THE REQUIRED OUTPUT.
  // The first version imported these at the top of the function and let the
  // failure propagate, so when `@/lib/ai/provider` hit its transitive
  // `server-only` guard under plain tsx, the ENTIRE harvest aborted and wrote
  // no corpus at all — an enhancement taking out the thing it was enhancing.
  let generateText: typeof import("ai").generateText;
  let getModel: typeof import("@/lib/ai/provider").getModel;
  try {
    ({ generateText } = await import("ai"));
    ({ getModel } = await import("@/lib/ai/provider"));
  } catch (err) {
    return {
      rewritten: 0,
      failed: cases.filter((c) => c.relevantKeys?.length).length,
      blocked: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160),
    };
  }
  let rewritten = 0;
  let failed = 0;

  for (const c of cases) {
    if (!c.relevantKeys?.length) continue; // abstention cases keep their query
    try {
      const res = await generateText({
        model: getModel("reason"),
        prompt:
          "Below is a note from someone's personal knowledge base. Write the ONE natural " +
          "question that person would type to find it again. Use their own everyday words, " +
          "not the note's wording. Reply with the question only — no preamble, no quotes.\n\n" +
          `NOTE:\n${c.query.slice(0, 600)}`,
      });
      const q = (res.text ?? "")
        .trim()
        .split("\n")[0]
        .replace(/^["']|["']$/g, "")
        .trim();
      // A paraphrase that is empty, or that just echoed the note back, is not a
      // paraphrase — keep the original and count it as failed rather than
      // silently shipping a case that proves nothing.
      if (q.length < 8 || q.length > 300 || q.toLowerCase() === c.query.slice(0, q.length).toLowerCase()) {
        failed++;
        continue;
      }
      c.query = q;
      c.provenance = `${c.provenance} · query paraphrased by model (synthesised phrasing, not operator's own)`;
      rewritten++;
    } catch {
      failed++;
    }
  }
  return { rewritten, failed };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — refusing to run against an unknown DB.");
  }

  const out = flag("out") ?? "eval-datasets/recall-corpus.json";
  const { cases, sources, degraded } = await buildRealRecallCases();

  let paraphrase: { rewritten: number; failed: number; blocked?: string } | null = null;
  if (process.argv.includes("--paraphrase")) {
    paraphrase = await paraphrasePositives(cases);
  }

  const composition = describeCorpus(cases);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ harvestedAt: new Date().toISOString(), composition, sources, cases }, null, 2)}\n`,
    "utf8",
  );

  const lines = [
    "eval corpus harvest",
    ...sources.map((s) =>
      s.ok
        ? `  OK      ${s.source} -> ${s.cases} row(s)`
        : `  FAILED  ${s.source} -> ${s.error}`,
    ),
    `  cases   : ${cases.length} real`,
    ...(paraphrase
      ? paraphrase.blocked
        ? [
            `  queries : PARAPHRASE BLOCKED — ${paraphrase.blocked}`,
            "            The corpus below is still written, with VERBATIM queries. Its",
            "            positive arm therefore measures ECHO (query == document), not",
            "            recall. Do not read precision on it as retrieval quality.",
          ]
        : [
            `  queries : ${paraphrase.rewritten} paraphrased · ${paraphrase.failed} kept verbatim` +
              (paraphrase.failed > 0 ? " (those measure echo, not recall)" : ""),
          ]
      : [
          "  queries : VERBATIM content slices — the positive arm is an ECHO check, not a",
          "            recall benchmark. Re-run with --paraphrase for real queries.",
        ]),
    `  note    : ${composition.note}`,
    `  output  : ${out} (gitignored — contains real operator content)`,
    "",
  ];

  process.stderr.write(lines.join("\n"));

  // A partially-harvested corpus must not exit 0 and read as a clean
  // run — that is precisely how a stopped flywheel looks healthy.
  if (degraded) {
    process.stderr.write(
      "HARVEST DEGRADED — at least one source failed. The corpus above is INCOMPLETE,\n" +
        "not merely small. Do not read its composition as a quality measurement.\n",
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`eval corpus harvest FAILED\n  ${msg}\n`);
  process.exit(1);
});
