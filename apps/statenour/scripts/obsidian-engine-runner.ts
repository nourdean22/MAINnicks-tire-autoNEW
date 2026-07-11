/**
 * Headless Obsidian Engine CLI Runner & Watch Daemon — Statenour OS.
 */
import "dotenv/config";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  getObsidianEngineConfig,
  readEngineStatus,
  writeEngineStatus,
} from "../lib/obsidian/engine-config";
import type {
  ObsidianEngineStatus,
  ObsidianEngineStepResults,
} from "../lib/obsidian/types";

const args = process.argv.slice(2);
const command = args[0] || "sync";
const extraArgs = args.slice(1);
const engineConfig = getObsidianEngineConfig();
const BRAIN_COMMANDS = new Set(["sync", "ingest", "export", "watch"]);
const LOCAL_HEARTBEAT_MS = 30_000;
const DATABASE_HEARTBEAT_MS = 120_000;

if (BRAIN_COMMANDS.has(command) && !process.env.DATABASE_URL) {
  console.error(
    `\nobsidian:${command} needs DATABASE_URL. Run from a checkout with apps/statenour/.env ` +
      "or export DATABASE_URL before starting the engine.\n",
  );
  process.exit(1);
}

function runScript(scriptName: string, runArgs: string[] = []): boolean {
  const scriptPath = path.join(process.cwd(), "scripts", scriptName);
  console.log(`[Engine] tsx scripts/${scriptName} ${runArgs.join(" ")}`);
  try {
    const result = spawnSync("npx", ["tsx", scriptPath, ...runArgs], {
      stdio: "inherit",
      shell: true,
      cwd: process.cwd(),
    });
    return result.status === 0;
  } catch (error) {
    console.error(`[Engine] ${scriptName} failed to start:`, error);
    return false;
  }
}

function defaultStatus(): ObsidianEngineStatus {
  return {
    health: "degraded",
    lastRunAt: null,
    lastDoctorRunAt: null,
    lastIngestRunAt: null,
    lastExportRunAt: null,
    daemonHeartbeatAt: null,
    lastSuccessfulSyncAt: null,
    runState: "idle",
    lastRunSteps: null,
    stats: {
      totalNotes: 0,
      processed: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      quarantined: 0,
      warnings: 0,
      failures: 0,
    },
    issues: [],
    quarantinedFiles: [],
    config: {
      vaultPath: engineConfig.vaultPath,
      icloudShortcutsPath: engineConfig.icloudShortcutsPath,
      syncMode: engineConfig.syncMode,
      restUrl: engineConfig.restUrl,
    },
  };
}

async function markRunning(): Promise<void> {
  const status = readEngineStatus() ?? defaultStatus();
  status.lastRunAt = new Date().toISOString();
  status.runState = "running";
  status.lastRunSteps = null;
  await writeEngineStatus(status);
}

async function finishSync(steps: ObsidianEngineStepResults): Promise<boolean> {
  const status = readEngineStatus() ?? defaultStatus();
  const success = Object.values(steps).every(Boolean);
  const now = new Date().toISOString();
  status.lastRunAt = now;
  status.runState = success ? "idle" : "failed";
  status.lastRunSteps = steps;

  if (success) {
    status.lastSuccessfulSyncAt = now;
    status.health = status.stats.warnings > 0 || status.stats.quarantined > 0 ? "degraded" : "healthy";
    status.issues = status.issues.filter((issue) => !issue.message.startsWith("Sync pipeline failed:"));
  } else {
    status.health = "error";
    status.issues = [
      ...status.issues.filter((issue) => !issue.message.startsWith("Sync pipeline failed:")),
      {
        type: "FAIL",
        message: `Sync pipeline failed: ${Object.entries(steps).filter(([, ok]) => !ok).map(([name]) => name).join(", ")}`,
        detected_at: now,
        suggested_fix: "Run pnpm obsidian:sync locally and inspect the first failing step.",
      },
    ];
  }

  await writeEngineStatus(status);
  return success;
}

async function runSyncPipeline(): Promise<boolean> {
  await markRunning();
  const steps: ObsidianEngineStepResults = {
    doctor: runScript("obsidian-doctor.ts", ["--fix"]),
    ingest: false,
    export: false,
    finalDoctor: false,
  };
  if (steps.doctor) steps.ingest = runScript("ingest-obsidian-vault.ts");
  if (steps.ingest) steps.export = runScript("export-brain-to-obsidian.ts", extraArgs);
  steps.finalDoctor = runScript("obsidian-doctor.ts");
  const success = await finishSync(steps);
  console.log(success ? "[Engine] Full synchronization succeeded." : "[Engine] Synchronization failed.");
  return success;
}

function printStatus(status: ObsidianEngineStatus): void {
  if (extraArgs.includes("--json")) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log("STATENOUR OBSIDIAN BRIDGE");
  console.log(`Health: ${status.health}`);
  console.log(`Run state: ${status.runState ?? "legacy"}`);
  console.log(`Last command: ${status.lastRunAt ?? "never"}`);
  console.log(`Last successful sync: ${status.lastSuccessfulSyncAt ?? "never"}`);
  console.log(`Daemon heartbeat: ${status.daemonHeartbeatAt ?? "offline"}`);
  console.log(`Notes: ${status.stats.totalNotes}; synced: ${status.stats.synced}; failures: ${status.stats.failures}`);
  for (const issue of status.issues) console.log(`- [${issue.type}] ${issue.message}`);
}

async function heartbeat(persistToDatabase: boolean): Promise<void> {
  const status = readEngineStatus() ?? defaultStatus();
  status.daemonHeartbeatAt = new Date().toISOString();
  await writeEngineStatus(status, { persistToDatabase });
}

function startWatcher(): void {
  console.log(`[Engine] Watching ${engineConfig.vaultPath}`);
  let syncing = false;
  let pending = false;
  let timer: NodeJS.Timeout | null = null;

  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (syncing) {
        pending = true;
        return;
      }
      syncing = true;
      try {
        await runSyncPipeline();
      } finally {
        syncing = false;
        if (pending) {
          pending = false;
          trigger();
        }
      }
    }, 5000);
  };

  void heartbeat(true);
  trigger();
  const watchedPaths = [engineConfig.vaultPath, engineConfig.icloudShortcutsPath].filter(fs.existsSync);
  for (const watchedPath of watchedPaths) {
    fs.watch(watchedPath, { recursive: true }, (_event, filename) => {
      if (!filename || /(?:\.obsidian|\.git|node_modules|Quarantine|Archive|\.tmp)/.test(filename) || filename.startsWith("~")) return;
      trigger();
    });
  }

  setInterval(() => {
    void heartbeat(false).catch((error) => console.error("[Engine] local heartbeat failed:", error));
  }, LOCAL_HEARTBEAT_MS);
  setInterval(() => {
    void heartbeat(true).catch((error) => console.error("[Engine] database heartbeat failed:", error));
  }, DATABASE_HEARTBEAT_MS);
}

async function main(): Promise<void> {
  if (command === "doctor") process.exitCode = runScript("obsidian-doctor.ts", extraArgs) ? 0 : 1;
  else if (command === "ingest") process.exitCode = runScript("ingest-obsidian-vault.ts", extraArgs) ? 0 : 1;
  else if (command === "export") process.exitCode = runScript("export-brain-to-obsidian.ts", extraArgs) ? 0 : 1;
  else if (command === "sync") process.exitCode = (await runSyncPipeline()) ? 0 : 1;
  else if (command === "status") {
    const status = readEngineStatus();
    if (!status) throw new Error("No engine status found. Run pnpm obsidian:sync first.");
    printStatus(status);
  } else if (command === "watch") startWatcher();
  else throw new Error(`Unknown engine command: ${command}`);
}

main().catch((error) => {
  console.error("Obsidian engine failed:", error);
  process.exit(1);
});
