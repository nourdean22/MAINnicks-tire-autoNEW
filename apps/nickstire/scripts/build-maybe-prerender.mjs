/**
 * Build-time prerender gate.
 *
 * Called at the end of `pnpm run build`. Checks PRERENDER_ON_BUILD env var:
 *   - Not set / "false" / "0"  → skip (default) — fast deploys, serves
 *     committed prerendered/ files
 *   - "true" / "1"             → run full prerender regen (adds ~3-5 min)
 *
 * Rationale: the GitHub Action `prerender-refresh.yml` runs weekly to
 * keep prerendered/ fresh without slowing down every deploy. Flip this
 * env var to true on Railway only if you ever need a deploy to
 * regenerate prerender inline (rare — usually after a major route
 * registry change).
 */

import { spawnSync } from "child_process";

const flag = (process.env.PRERENDER_ON_BUILD || "").toLowerCase();
const shouldRun = flag === "true" || flag === "1" || flag === "yes";

if (!shouldRun) {
  console.log("[build] PRERENDER_ON_BUILD not set → skipping prerender regen.");
  console.log("[build] Committed prerendered/ will be served. Use pnpm run regen locally or wait for weekly workflow.");
  process.exit(0);
}

console.log("[build] PRERENDER_ON_BUILD=true → running full prerender regen…");
const result = spawnSync("node", ["scripts/regen-prerender.mjs"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
