import { spawnSync } from "node:child_process";
import path from "node:path";
import { readEngineStatus } from "../lib/obsidian/engine-config";

const scriptPath = path.join(process.cwd(), "scripts", "export-brain-to-obsidian.ts");
const result = spawnSync("npx", ["tsx", scriptPath, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: true,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const status = readEngineStatus();
const failed = status?.stats.failed ?? 0;
if (!status?.lastExportRunAt) {
  console.error("[Obsidian] export did not publish a completion status.");
  process.exit(1);
}
if (failed > 0 || status.health === "error") {
  console.error(`[Obsidian] export completed with ${failed} failed write(s); refusing false success.`);
  process.exit(1);
}

console.log("[Obsidian] verified export completed without failed writes.");
