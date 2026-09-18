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
import Module from "node:module";

loadEnvConfig(process.cwd());

// ── `server-only` stub · 2026-09-18 ──────────────────────────────────────
// Same pattern as scripts/recall-eval.ts:32 and scripts/measure-prompt-size.ts.
// WHY IT IS NEEDED, MEASURED RATHER THAN ASSUMED: `server-only` is a tripwire
// package whose entry point throws by design; Next's bundler rewrites it to a
// no-op in server builds, and under plain tsx there is no bundler, so it fires.
// `@/lib/ai/provider` pulls it in transitively, which is what made --paraphrase
// unrunnable and left retrieval precision unmeasurable (recorded in #2426).
//
// Probed 2026-09-18 with one control per process, because a module that throws
// during evaluation is cached as errored and re-throws on later imports without
// re-evaluating — both controls in one process would have shown the stub
// failing even when it works:
//   A · no stub   -> threw "This module cannot be imported from a Client Component module."
//   B · with stub -> resolved, getModel is a function
{
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildRealRecallCases,
  describeCorpus,
  paraphraseVerdict,
} from "../lib/brain/recall-corpus-builder";
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
  const verdict = paraphraseVerdict(paraphrase);

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
    // ONE source for the interpretability rule — lib/brain/recall-corpus-builder
    // .paraphraseVerdict(). The banner and the exit code below read the SAME
    // verdict object, so a change to the rule cannot move one without the other.
    `  queries : ${verdict.status.toUpperCase()} — ${verdict.reason}`,
    `  scorable: ${verdict.scorable ? "yes" : "NO — do not publish a precision figure from this corpus"}`,
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

  // ⚠ A REQUESTED ARM THAT PRODUCED NOTHING IS A FAILURE, NOT A FOOTNOTE.
  // Until 2026-09-18 a blocked paraphrase printed its warning and then exited 0,
  // so every non-human reader — CI, a wrapper script, a future scheduled harvest
  // — saw SUCCESS while the corpus it produced measured echo instead of recall.
  // Same shape as the cron-manager defect fixed this week: a failure rendered
  // for a human and hidden from the exit code.
  //
  // `failedRequest`, NOT `scorable`, is the gate. A plain `pnpm harvest:evals`
  // is also unscorable and must still exit 0 — the operator did not ask for a
  // scorable corpus. And a PARTIAL rewrite exits 0 on purpose: each case's
  // provenance records whether it was paraphrased, so the eval can separate the
  // arms rather than being poisoned by the verbatim remainder.
  if (verdict.failedRequest) {
    process.stderr.write(
      `PARAPHRASE FAILED (${verdict.status}) — ${verdict.reason}\n` +
        "The corpus was still written, but its positive arm is query==document,\n" +
        "which cannot lose and therefore measures nothing. Do NOT publish a\n" +
        "precision figure from it.\n",
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`eval corpus harvest FAILED\n  ${msg}\n`);
  process.exit(1);
});
