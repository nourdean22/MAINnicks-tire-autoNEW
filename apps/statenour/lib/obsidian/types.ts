/**
 * Headless Obsidian Engine Types — Statenour OS
 */

export type ObsidianEngineHealth = "healthy" | "degraded" | "error";

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

export interface ObsidianEngineStatus {
  health: ObsidianEngineHealth;
  lastRunAt: string | null;
  lastDoctorRunAt: string | null;
  lastIngestRunAt: string | null;
  lastExportRunAt: string | null;
  
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
