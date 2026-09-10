/**
 * Regenerate docs/operations/CRON-INVENTORY.md from the scheduler (2026-09-01
 * admin audit, artifact 2 §2.1: the doc claimed 85 jobs; the scheduler had
 * 105, plus the HTTP registry). The per-job "purpose" prose is carried over
 * from the existing doc when a row already exists; new jobs get "—" until a
 * human writes one. server/cron/cronInventoryParity.test.ts fails whenever
 * the doc and the code disagree, so this must run in the same commit as any
 * scheduler change.
 *
 * Run from apps/nickstire:  pnpm exec tsx scripts/gen-cron-inventory.mts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getJobCadences } from "../server/cron/scheduler";
import { getRegisteredJobNames } from "../server/cron/index";
import {
  buildCronInventoryMarkdown,
  parseExistingPurposes,
  parseInventoryJobNames,
  parseInventoryCounts,
  parseInventoryScheduled,
} from "../server/cron/cronInventory";

const here = path.dirname(fileURLToPath(import.meta.url));
const docPath = path.resolve(here, "..", "docs", "operations", "CRON-INVENTORY.md");

const existing = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
const purposes = parseExistingPurposes(existing);
const md = buildCronInventoryMarkdown({
  cadences: getJobCadences(),
  httpJobs: getRegisteredJobNames(),
  purposes,
  generatedOn: new Date().toISOString().slice(0, 10),
});
fs.writeFileSync(docPath, md, "utf8");
// Read the doc back through the parser the parity test uses — a generator
// whose output its own parser cannot read would pass here and fail in CI.
const rows = parseInventoryJobNames(md).size;
if (rows === 0) throw new Error("generated inventory has no parseable job rows");

// ...and the NUMBERS through the same parsers, for the same reason. The doc's tier table and
// totals line went ungoverned for weeks because the parity gate compared names only; now that
// it compares counts too, a generator whose own output those parsers cannot read would write a
// file that fails in CI while reporting success here.
const counts = parseInventoryCounts(md);
if (counts.tiers.length === 0) throw new Error("generated inventory has no parseable tier rows");
if (!counts.total) throw new Error("generated inventory has no parseable Total line");

// Cross-check the parsed numbers against what was actually built. A tier table that parses
// cleanly and disagrees with the cadences it came from is the exact drift this doc exists to
// prevent, and catching it here is cheaper than catching it in review.
const cadences = getJobCadences();
const builtScheduled = [...cadences.values()].filter((c) => c.scheduledAutomatically).length;
if (counts.total.tiered !== cadences.size || counts.total.scheduled !== builtScheduled) {
  throw new Error(
    `the generated Total line (${counts.total.tiered} tiered, ${counts.total.scheduled} scheduled) ` +
      `disagrees with the scheduler it was built from (${cadences.size}, ${builtScheduled})`,
  );
}
const flags = parseInventoryScheduled(md);
const wrongFlag = [...cadences].find(([name, c]) => flags.get(name) !== c.scheduledAutomatically);
if (wrongFlag) throw new Error(`the Scheduled column is wrong for \`${wrongFlag[0]}\``);

const tierSummary = counts.tiers.map((t) => `${t.tier} ${t.scheduled}/${t.staged}`).join("  ");
console.log(`wrote ${path.relative(process.cwd(), docPath)} (${md.length} bytes, ${rows} job rows)`);
console.log(`  ${tierSummary}`);
console.log(
  `  total ${counts.total.tiered} tiered (${counts.total.scheduled} scheduled, ` +
    `${counts.total.staged} staged) + ${counts.total.httpOnly} HTTP-only`,
);
