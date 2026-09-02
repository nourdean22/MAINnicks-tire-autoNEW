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
import { buildCronInventoryMarkdown, parseExistingPurposes } from "../server/cron/cronInventory";

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
console.log(`wrote ${path.relative(process.cwd(), docPath)} (${md.length} bytes)`);
