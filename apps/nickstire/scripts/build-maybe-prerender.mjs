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
// regen-prerender.mjs's Step 1 re-runs the full `build` script — whose
// final step is THIS file. Strip PRERENDER_ON_BUILD from the child env
// so that inner build hits its early-exit branch instead of spawning
// regen again. Without this, build → prerender → build → prerender
// recurses forever — the loop that wedged every Railway deploy
// 2026-05-21 (status "Building" but never completing → Heartbeat timeout).
const result = spawnSync("node", ["scripts/regen-prerender.mjs"], {
  stdio: "inherit",
  env: { ...process.env, PRERENDER_ON_BUILD: "false" },
});
process.exit(result.status ?? 1);
