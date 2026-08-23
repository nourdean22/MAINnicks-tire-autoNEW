/**
 * Gate: every cron registered in `registerAllJobs()` must be able to run.
 *
 * --- Why this is a script and not a sentence -------------------------------
 *
 * `docs/admin-surface-audit/code-underneath-audit-logic.md` found two crons
 * that could never fire (`confirmation-calls`, `voice-recovery`). Both were
 * fixed. The same table then wrote:
 *
 *   "every job in it duplicates a tiered job EXCEPT the two above"
 *
 * That sentence closed the question, and the class stopped being swept. It was
 * false. Measured against origin/main on 2026-08-23: 33 registry jobs, 8 absent
 * from every tier BY NAME. Six were name mismatches with real coverage. Two -
 * `campaign-resume` and `sms-learning-digest` - were genuinely dead, and
 * production cron_log confirmed it: ZERO rows all-time for both, against
 * control jobs in the same table at 2,344 / 799 / 38 runs.
 *
 * A doc line cannot notice a ninth stranded cron. This can. Never let a doc
 * close a question a script could keep open.
 *
 * --- Why the logic is not in this file ------------------------------------
 *
 * `scripts/` sits OUTSIDE the typecheck project (apps/nickstire/AGENTS.md,
 * "Typecheck blind spot"), so a broken import here passes every gate and fails
 * only at runtime. All the real logic lives in
 * `server/cron/registry-tier-map.ts`, which IS typechecked and IS unit-tested;
 * this file only parses the two sources and prints. `cronControlPlane.test.ts`
 * runs the same comparison inside vitest, so the gate and the suite cannot
 * disagree about what counts as wired.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  findCronWiringFaults,
  extractRegistryJobNames,
  extractTierJobNames,
  REGISTRY_TIER_ALIASES,
} from "../server/cron/registry-tier-map";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const registrySrc = readFileSync(join(APP_ROOT, "server/cron/index.ts"), "utf-8");
const schedulerSrc = readFileSync(join(APP_ROOT, "server/cron/scheduler.ts"), "utf-8");

// Extraction lives in the typechecked module - a tier LABEL is not a job,
// and matching every `name:` swept up five of them (review, #1808).
const registryNames = extractRegistryJobNames(registrySrc);
const tierNames = extractTierJobNames(schedulerSrc);

// Prove the instrument sees its target before trusting a green. A regex that
// silently stops matching would otherwise report "0 faults" forever - the
// exact "a scan that ran on nothing prints the same green" failure this repo
// keeps hitting.
if (registryNames.length < 20 || tierNames.size < 50) {
  console.error(
    `  cron-wiring lint FAILED TO PARSE its own inputs: ` +
      `${registryNames.length} registry jobs, ${tierNames.size} tier jobs. ` +
      `Expected >=20 and >=50. The extraction regexes no longer match - fix them ` +
      `rather than trusting the zero-fault result they would otherwise print.`,
  );
  process.exit(2);
}

const faults = findCronWiringFaults(
  registryNames.map((name) => ({ name, enabled: true })),
  tierNames,
);

if (faults.length > 0) {
  console.error(`\n  ${faults.length} cron wiring fault(s):\n`);
  for (const fault of faults) console.error(`   [${fault.kind}] ${fault.message}\n`);
  console.error(
    `  A registry job in no tier CANNOT RUN. Either add it to a tier in ` +
      `server/cron/scheduler.ts, or - if a differently-named tier job already does ` +
      `this work - add an alias in server/cron/registry-tier-map.ts naming that job ` +
      `and citing the evidence. Do not widen the alias list to silence this.\n`,
  );
  process.exit(1);
}

console.log(
  `  cron wiring: ${registryNames.length} registry jobs, ${tierNames.size} tier jobs, ` +
    `${REGISTRY_TIER_ALIASES.length} justified aliases, 0 faults`,
);
