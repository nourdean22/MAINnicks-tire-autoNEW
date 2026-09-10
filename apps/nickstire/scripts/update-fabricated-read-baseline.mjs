/**
 * Regenerate config/fabricated-admin-read-baseline.json.
 *
 * REFUSES TO RAISE THE COUNT. A regenerator that happily records a bigger
 * number turns the gate into a formality: the fix for a red becomes "re-run the
 * script", which is how a ratchet quietly becomes a rubber stamp. Growth has to
 * be a deliberate edit someone reviews, not a command anyone can run.
 *
 * Imports the SAME scanner the gate uses. The fail-open-slice pair in this
 * directory drifted twice when each side carried its own copy.
 *
 * Usage:  node scripts/update-fabricated-read-baseline.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanFabricatedAdminReads, pairKey } from "./lib/fabricatedAdminReadScan.mjs";

const APP = process.cwd();
const PATH = resolve(APP, "config/fabricated-admin-read-baseline.json");

const prev = JSON.parse(readFileSync(PATH, "utf8"));
const hits = scanFabricatedAdminReads(APP);
const pairs = hits.map(pairKey);

if (pairs.length > prev.total) {
  const fresh = pairs.filter((p) => !new Set(prev.pairs).has(p));
  console.error(
    `REFUSING: this would RAISE the baseline from ${prev.total} to ${pairs.length}.\n` +
      fresh.map((f) => `  + ${f}`).join("\n") +
      `\n\nGuard the procedure (ROS-083 shape) or give the helper an { available, rows } shape.\n` +
      `If the growth is genuinely intended, edit the baseline by hand in a PR where the diff is reviewable.`,
  );
  process.exit(1);
}

writeFileSync(
  PATH,
  JSON.stringify(
    {
      $comment: prev.$comment,
      total: pairs.length,
      adminTier: hits.filter((h) => h.tier === "admin").length,
      pairs,
    },
    null,
    2,
  ) + "\n",
);

const removed = prev.total - pairs.length;
console.log(
  removed > 0
    ? `baseline lowered: ${prev.total} -> ${pairs.length} (${removed} fixed)`
    : `baseline unchanged at ${pairs.length}`,
);
