/**
 * Headless Obsidian Engine CLI Runner & Watch Daemon — Statenour OS
 *
 * Orchestrates doctor, ingest, export, sync, status, and watch mode commands.
 *
 * Usage:
 *   pnpm tsx scripts/obsidian-engine-runner.ts doctor [--fix] [--strict] [--json]
 *   pnpm tsx scripts/obsidian-engine-runner.ts ingest
 *   pnpm tsx scripts/obsidian-engine-runner.ts export [--memory-mode=rollup|individual]
 *   pnpm tsx scripts/obsidian-engine-runner.ts sync
 *   pnpm tsx scripts/obsidian-engine-runner.ts status
 *   pnpm tsx scripts/obsidian-engine-runner.ts watch
 */

import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import { getObsidianEngineConfig, readEngineStatus, writeEngineStatus } from "../lib/obsidian/engine-config";
import { ObsidianEngineStatus } from "../lib/obsidian/types";

// Parse CLI command
const args = process.argv.slice(2);
const command = args[0] || "sync";
const extraArgs = args.slice(1);

const engineConfig = getObsidianEngineConfig();

function runScript(scriptName: string, runArgs: string[] = []): boolean {
  const scriptPath = path.join(process.cwd(), "scripts", scriptName);
  console.log(`[Engine] Executing: tsx scripts/${scriptName} ${runArgs.join(" ")}`);
  
  const result = spawnSync("npx", ["tsx", scriptPath, ...runArgs], {
    stdio: "inherit",
    shell: true,
    cwd: process.cwd()
  });

  return result.status === 0;
}

async function main() {
  switch (command) {
    case "doctor":
      runScript("obsidian-doctor.ts", extraArgs);
      break;

    case "ingest":
      runScript("ingest-obsidian-vault.ts", extraArgs);
      break;

    case "export":
      runScript("export-brain-to-obsidian.ts", extraArgs);
      break;

    case "sync":
      console.log("[Engine] Starting sequential synchronization...");
      const docOk = runScript("obsidian-doctor.ts", ["--fix"]);
      const ingOk = runScript("ingest-obsidian-vault.ts");
      const expOk = runScript("export-brain-to-obsidian.ts", extraArgs);
      // Run final doctor check to write the consolidated stats status file
      runScript("obsidian-doctor.ts");
      console.log("[Engine] Synchronization complete.");
      break;

    case "status":
      const status = readEngineStatus();
      if (!status) {
        console.log("No engine status file found. Run 'sync' or 'doctor' first.");
        process.exit(1);
      }
      if (extraArgs.includes("--json")) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log("═══════════════════════════════════════════════════════════");
        console.log("  STATENOUR HEADLESS OBSIDIAN ENGINE STATUS");
        console.log("═══════════════════════════════════════════════════════════");
        console.log(`  Health:       ${status.health.toUpperCase()}`);
        console.log(`  Last Run:     ${status.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : "Never"}`);
        console.log(`  Last Ingest:  ${status.lastIngestRunAt ? new Date(status.lastIngestRunAt).toLocaleString() : "Never"}`);
        console.log(`  Last Export:  ${status.lastExportRunAt ? new Date(status.lastExportRunAt).toLocaleString() : "Never"}`);
        console.log("───────────────────────────────────────────────────────────");
        console.log(`  Total Notes:  ${status.stats.totalNotes}`);
        console.log(`  Synced:       ${status.stats.synced}`);
        console.log(`  Quarantined:  ${status.stats.quarantined}`);
        console.log(`  Warnings:     ${status.stats.warnings}`);
        console.log(`  Failures:     ${status.stats.failures}`);
        console.log("═══════════════════════════════════════════════════════════");
        if (status.issues.length > 0) {
          console.log("\n  Active Issues:");
          for (const issue of status.issues) {
            console.log(`  - [${issue.type}] ${issue.file ? `(${issue.file}) ` : ""}${issue.message}`);
            if (issue.suggested_fix) {
              console.log(`    └─ Fix: ${issue.suggested_fix}`);
            }
          }
          console.log("");
        }
      }
      break;

    case "watch":
      startWatcher();
      break;

    default:
      console.error(`Unknown engine command: "${command}"`);
      console.log("Supported commands: doctor, ingest, export, sync, status, watch");
      process.exit(1);
  }
}

function startWatcher() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  STATENOUR HEADLESS OBSIDIAN ENGINE - WATCH DEBUNKER");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Watching Vault:      ${engineConfig.vaultPath}`);
  console.log(`  Watching iCloud:     ${engineConfig.icloudShortcutsPath}`);
  console.log("  Debounce delay:      5 seconds");
  console.log("  Sync sequence:       doctor -> ingest -> export -> doctor");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  [Active] Press Ctrl+C to terminate the daemon.");
  console.log("");

  let isSyncing = false;
  let pendingSync = false;
  let debounceTimer: NodeJS.Timeout | null = null;

  function triggerSync() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    debounceTimer = setTimeout(() => {
      if (isSyncing) {
        console.log("  [Watch] Sync run already in progress. Queueing next sync.");
        pendingSync = true;
        return;
      }

      isSyncing = true;
      console.log(`\n  🔔 [Watch] Change detected. Starting synchronization... [${new Date().toLocaleTimeString()}]`);
      
      try {
        const docOk = runScript("obsidian-doctor.ts", ["--fix"]);
        const ingOk = runScript("ingest-obsidian-vault.ts");
        const expOk = runScript("export-brain-to-obsidian.ts");
        runScript("obsidian-doctor.ts"); // final status check to update UI metrics
      } catch (err) {
        console.error("  ❌ [Watch] Sync sequence failed:", err);
      } finally {
        isSyncing = false;
        console.log(`  ✅ [Watch] Sync sequence complete. [${new Date().toLocaleTimeString()}]`);
        if (pendingSync) {
          pendingSync = false;
          triggerSync();
        }
      }
    }, 5000);
  }

  // Run initial sync on startup
  triggerSync();

  // Set up directory watchers
  const watchedPaths = [engineConfig.vaultPath, engineConfig.icloudShortcutsPath].filter(p => fs.existsSync(p));

  for (const watchedPath of watchedPaths) {
    try {
      fs.watch(watchedPath, { recursive: true }, (eventType, filename) => {
        // Ignore system files, temp files, and status updates to avoid infinite sync loops
        if (
          !filename ||
          filename.includes(".obsidian") ||
          filename.includes(".git") ||
          filename.includes("node_modules") ||
          filename.includes("Quarantine") ||
          filename.includes("Archive") ||
          filename.includes(".tmp") ||
          filename.startsWith("~")
        ) {
          return;
        }

        console.log(`  [Watch] File changed: ${filename} (Event: ${eventType})`);
        triggerSync();
      });
      console.log(`  👀 Successfully registered recursive watcher for: ${watchedPath}`);
    } catch (watchErr) {
      console.error(`  ❌ Failed to register watcher for ${watchedPath}:`, watchErr);
    }
  }

  // Heartbeat interval (updates lastRunAt timestamp every 30s to signal daemon is active)
  setInterval(async () => {
    try {
      const existingStatus = readEngineStatus();
      if (existingStatus) {
        existingStatus.lastRunAt = new Date().toISOString();
        await writeEngineStatus(existingStatus);
      }
    } catch {}
  }, 30000);
}

main().catch((err) => {
  console.error("Engine runner failed:", err);
  process.exit(1);
});
