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

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — refusing to run against an unknown DB.");
  }

  const out = flag("out") ?? "eval-datasets/recall-corpus.json";
  const { cases, sources, degraded } = await buildRealRecallCases();
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
