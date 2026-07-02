/**
 * /api/obsidian/status — Headless Obsidian Engine Status Endpoint
 *
 * GET → Returns ObsidianEngineStatus JSON payload
 *
 * Secured by owner-auth.
 */

import { apiHandler } from "@/lib/utils/http";
import { readEngineStatus, getObsidianEngineConfig } from "@/lib/obsidian/engine-config";
import { ObsidianEngineStatus } from "@/lib/obsidian/types";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler(
  async () => {
    let status: ObsidianEngineStatus | null = null;
    
    // 1. Try DB first (production / cloud access)
    try {
      const log = await prisma.localSyncLog.findFirst({
        where: { module: "obsidian_engine", action: "status" }
      });
      if (log && log.details) {
        status = JSON.parse(log.details) as ObsidianEngineStatus;
      }
    } catch (e) {
      console.warn("Failed to read obsidian status from db:", e);
    }

    // 2. Fallback to local file (local dev)
    if (!status) {
      status = readEngineStatus();
    }
    
    if (!status) {
      const config = getObsidianEngineConfig();
      // Return a default status if no run has occurred yet
      const defaultStatus: ObsidianEngineStatus = {
        health: "degraded",
        lastRunAt: null,
        lastDoctorRunAt: null,
        lastIngestRunAt: null,
        lastExportRunAt: null,
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
        issues: [
          {
            type: "WARN",
            message: "Engine status not initialized. Please run synchronization or doctor.",
            detected_at: new Date().toISOString(),
            suggested_fix: "Run 'pnpm obsidian:sync' in the monorepo root to trigger the first sync run."
          }
        ],
        quarantinedFiles: [],
        config: {
          vaultPath: config.vaultPath,
          icloudShortcutsPath: config.icloudShortcutsPath,
          syncMode: config.syncMode,
          restUrl: config.restUrl
        }
      };
      return defaultStatus;
    }

    return status;
  },
  { auth: "owner" }
);
