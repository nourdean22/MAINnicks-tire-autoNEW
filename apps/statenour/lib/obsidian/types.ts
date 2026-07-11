/**
 * Headless Obsidian Engine Types — Statenour OS
 */

export type ObsidianEngineHealth = "healthy" | "degraded" | "error";
export type ObsidianEngineRunState = "idle" | "running" | "failed";

export interface EngineIssue {
  type: "FAIL" | "WARN";
  message: string;
  file?: string;
  detected_at: string;
  suggested_fix?: string;
}

export interface QuarantinedFileInfo {
  filename: string;
  relativePath: string;
  reason: string;
  detected_at: string;
  suggested_fix?: string;
}

export interface ObsidianEngineStepResults {
  doctor: boolean;
  ingest: boolean;
  export: boolean;
  finalDoctor: boolean;
}

export interface ObsidianEngineStatus {
  health: ObsidianEngineHealth;
  /** Timestamp of the most recent real engine command, not the daemon heartbeat. */
  lastRunAt: string | null;
  lastDoctorRunAt: string | null;
  lastIngestRunAt: string | null;
  lastExportRunAt: string | null;
  /** Updated by watch mode only. Lets the cloud UI distinguish a live daemon from stale history. */
  daemonHeartbeatAt?: string | null;
  /** Advances only when doctor -> ingest -> export -> doctor all succeed. */
  lastSuccessfulSyncAt?: string | null;
  runState?: ObsidianEngineRunState;
  lastRunSteps?: ObsidianEngineStepResults | null;

  // Note statistics
  stats: {
    totalNotes: number;
    processed: number;
    synced: number;
    skipped: number;
    failed: number;
    quarantined: number;
    warnings: number;
    failures: number;
  };

  issues: EngineIssue[];
  quarantinedFiles: QuarantinedFileInfo[];

  // Environment configurations
  config: {
    vaultPath: string;
    icloudShortcutsPath: string | null;
    syncMode: "bidirectional" | "obsidian_to_statenour" | "none";
    restUrl: string | null;
  };
}
