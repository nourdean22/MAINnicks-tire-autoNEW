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

export const GET = apiHandler(
  async () => {
    const status = readEngineStatus();
    
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
