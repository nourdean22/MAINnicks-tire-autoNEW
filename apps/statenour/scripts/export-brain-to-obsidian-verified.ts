import { spawnSync } from "node:child_process";
import path from "node:path";
import { readEngineStatus } from "../lib/obsidian/engine-config";
import { judgeExportRun } from "../lib/obsidian/export-verdict";

const scriptPath = path.join(process.cwd(), "scripts", "export-brain-to-obsidian.ts");
const startedAtMs = Date.now();
const result = spawnSync("npx", ["tsx", scriptPath, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: true,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const verdict = judgeExportRun(readEngineStatus(), startedAtMs);
if (!verdict.ok) {
  console.error(`[Obsidian] ${verdict.reason}.`);
  process.exit(1);
}

console.log("[Obsidian] verified export completed without failed writes.");
