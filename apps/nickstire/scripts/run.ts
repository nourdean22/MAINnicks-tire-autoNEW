import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";
import { dirname } from "path";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SUBDIRS = ["migrations", "backfills", "diagnostics", "maintenance", ""]; // include root

function findScript(name: string): string | null {
  const extensions = [".ts", ".mjs", ".js"];
  
  for (const dir of SUBDIRS) {
    for (const ext of extensions) {
      const targetName = name.endsWith(ext) ? name : name + ext;
      const targetPath = path.join(SCRIPTS_DIR, dir, targetName);
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
        return targetPath;
      }
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const scriptName = args[0];

  if (!scriptName) {
    console.error("Usage: pnpm run script <script-name> [args...]");
    process.exit(1);
  }

  const scriptPath = findScript(scriptName);

  if (!scriptPath) {
    console.error(`Script not found: "${scriptName}" in scripts/ or any subdirectories.`);
    process.exit(1);
  }

import dotenv from "dotenv";

// At the start of main
  // Load dotenv variables first before running the child process
  dotenv.config({ path: path.resolve(SCRIPTS_DIR, "../.env") });

  const remainingArgs = args.slice(1);
  
  console.log(`[Dispatcher] Executing: ${path.relative(SCRIPTS_DIR, scriptPath)} ${remainingArgs.join(" ")}`);

  const runner = scriptPath.endsWith(".mjs") ? "node" : "tsx";
  const child = spawn(runner, [scriptPath, ...remainingArgs], {
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main();
