/**
 * scripts/sweep-embedding-shadow.ts · operator runner for the shadow repair
 *
 * Runs THE SAME lib/db/embedding-shadow.ts the nightly cron runs — not a
 * re-implementation. A measurement taken with different code than the code
 * that ships proves nothing about the code that ships.
 *
 * Usage (from apps/statenour, needs DATABASE_URL):
 *   railway run -s statenour-web -- pnpm tsx scripts/sweep-embedding-shadow.ts
 *   railway run -s statenour-web -- pnpm tsx scripts/sweep-embedding-shadow.ts --apply
 *   railway run -s statenour-web -- pnpm tsx scripts/sweep-embedding-shadow.ts --apply --force
 *
 * DRY RUN BY DEFAULT. `--apply` writes; `--force` additionally bypasses
 * MAX_NEW_MARKS_PER_RUN, which the FIRST real run needs on purpose — the
 * initial quarantine should be a deliberate operator act with the number in
 * front of them, not a silent background event.
 *
 * Nothing here deletes. The only writes are to two nullable columns, and the
 * restore is one UPDATE (see the migration header).
 */
import { loadEnvConfig } from "@next/env";
import Module from "node:module";

loadEnvConfig(process.cwd());

// Same pattern as scripts/recall-eval.ts — the lib stack imports "server-only",
// which throws under tsx. Stub it for this CLI runner.
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

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required — refusing to run against an unknown DB.");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");

  const { sweepEmbeddingShadow, MAX_NEW_MARKS_PER_RUN, UNMAPPED_SOURCE_TYPES } = await import(
    "../lib/db/embedding-shadow"
  );

  const t0 = Date.now();
  const report = await sweepEmbeddingShadow({ dryRun: !apply, force });
  const ms = Date.now() - t0;

  console.log(`embedding shadow sweep · ${apply ? "APPLY" : "DRY RUN"}${force ? " --force" : ""}`);
  console.log(`cap: MAX_NEW_MARKS_PER_RUN=${MAX_NEW_MARKS_PER_RUN}`);
  console.log("");
  console.log("sourceType             marked   cleared   note");
  console.log("-".repeat(78));
  for (const s of report.sources) {
    console.log(
      `${s.sourceType.padEnd(22)} ${String(s.marked).padStart(6)} ${String(s.cleared).padStart(9)}   ${s.skipped ?? ""}`,
    );
  }
  console.log("-".repeat(78));
  console.log(`marked=${report.totalMarked}  cleared=${report.totalCleared}  ${ms}ms`);
  if (report.refused) console.log(`REFUSED: ${report.refusedReason}`);
  console.log("");
  console.log("deliberately unmapped (never swept):");
  for (const [k, v] of Object.entries(UNMAPPED_SOURCE_TYPES)) console.log(`  ${k.padEnd(20)} ${v}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("sweep failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
