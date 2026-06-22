/**
 * Headless Obsidian Engine Config — Statenour OS
 */

import path from "path";
import fs from "fs";
import { ObsidianEngineStatus } from "./types";

export interface ObsidianEngineConfig {
  vaultPath: string;
  icloudShortcutsPath: string;
  syncMode: "bidirectional" | "obsidian_to_statenour" | "none";
  restUrl: string;
  restToken: string;
}

export function getObsidianEngineConfig(): ObsidianEngineConfig {
  const vaultPath = path.resolve(
    process.env.OBSIDIAN_VAULT_PATH || "C:\\Users\\nourd\\OneDrive\\Documents\\Obsidian Vault"
  );
  
  const icloudShortcutsPath = path.resolve(
    process.env.ICLOUD_SHORTCUTS_PATH || "C:\\Users\\nourd\\iCloudDrive\\iCloud~is~workflow~my~workflows"
  );

  let syncMode: "bidirectional" | "obsidian_to_statenour" | "none" = "bidirectional";
  const envSyncMode = process.env.OBSIDIAN_SYNC_MODE;
  if (envSyncMode === "obsidian_to_statenour" || envSyncMode === "none") {
    syncMode = envSyncMode;
  }

  const restUrl = process.env.OBSIDIAN_REST_URL || "http://127.0.0.1:27124";
  const restToken = process.env.OBSIDIAN_REST_TOKEN || "";

  return {
    vaultPath,
    icloudShortcutsPath,
    syncMode,
    restUrl,
    restToken
  };
}

export function getRuntimeDir(): string {
  // Locate apps/statenour/.runtime deterministically
  let baseDir = process.cwd();
  if (baseDir.includes(".worktrees")) {
    // If running in a worktree, we are inside .worktrees/statenour-headless-obsidian-engine
    // Let's check if apps/statenour exists
    if (fs.existsSync(path.join(baseDir, "apps", "statenour"))) {
      baseDir = path.join(baseDir, "apps", "statenour");
    }
  } else if (!baseDir.endsWith("statenour") && fs.existsSync(path.join(baseDir, "apps", "statenour"))) {
    baseDir = path.join(baseDir, "apps", "statenour");
  }
  return path.join(baseDir, ".runtime");
}

export function getStatusFilePath(): string {
  return path.join(getRuntimeDir(), "obsidian-engine-status.json");
}

export function ensureRuntimeDir(): string {
  const dir = getRuntimeDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function readEngineStatus(): ObsidianEngineStatus | null {
  const filePath = getStatusFilePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function writeEngineStatus(status: ObsidianEngineStatus): void {
  ensureRuntimeDir();
  fs.writeFileSync(getStatusFilePath(), JSON.stringify(status, null, 2), "utf-8");
}
