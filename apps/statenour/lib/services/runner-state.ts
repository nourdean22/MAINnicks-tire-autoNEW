import { readFile } from "node:fs/promises";
import { Prisma, ServiceState, WorkItemStatus, WorkItemType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/runtime";

type ServiceHealthView = {
  service: string;
  status: string;
  detail: string;
  recovery_action: string;
  checked_at: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_duration_ms: number | null;
  metadata: Record<string, unknown>;
  severity?: string;
  is_blocking?: boolean;
  freshness?: string;
  source?: string;
  recent_checks: Array<{
    checked_at: string;
    status: string;
    detail: string;
    duration_ms: number | null;
  }>;
};

type NightShiftRunView = {
  run_id: string;
  mode: string;
  status: string;
  focus: string;
  summary: string;
  surface: string;
  screenshot_status: string;
  changed_file_count: number;
  started_at: string;
  ended_at: string;
  report_path: string;
  summary_path: string;
};

type NightShiftStatusView = {
  mode: string;
  mutation_allowed: boolean;
  kill_switch: boolean;
  run_policy?: string;
  scheduled?: boolean;
  detail: string;
  next_window: {
    mode: string;
    starts_at: string;
  };
  latest_run: NightShiftRunView | null;
  latest_draft: NightShiftRunView | null;
  latest_promoted: NightShiftRunView | null;
  current_active_build: NightShiftRunView | null;
  heuristics: Record<string, number>;
  top_backlog: Array<Record<string, unknown>>;
  eligible_fix_count?: number;
  last_manual_run_at?: string;
  summary_path: string;
  report_path: string;
  screenshot_dir: string;
};

type RepairStatusView = {
  auto_heal_enabled: boolean;
  auto_heal_last_run: string;
  last_repair_action: string;
  last_repair_status: string;
  last_repair_detail: string;
  last_repair_mode: string;
  last_repair_checked_at: string;
  next_recommended_action: string;
  available_actions: string[];
  cooldowns: Record<string, string>;
  circuit_breakers: Record<string, string>;
  detail: string;
};

type RecoveryPayload = {
  entity_key: string;
  source: string;
  title: string;
  summary: string;
  priority_score: number;
  status: string;
  payload?: Record<string, unknown>;
  updated_at: string;
};

export type CaptureInboxItemView = {
  item_key: string;
  source: string;
  kind: string;
  title: string;
  summary: string;
  excerpt: string | null;
  content_path: string | null;
  status: string;
  triage_status: string;
  primary_tag: string | null;
  actionability_score: number;
  conversion_target: string | null;
  converted_task_id: string | null;
  converted_mission_id: string | null;
  converted_lead_id: string | null;
  triaged_at: string | null;
  captured_at: string;
  synced_at: string;
  metadata: Record<string, unknown>;
};

const DEFAULT_SERVICE_ORDER = ["launcher", "app", "runner", "repair_supervisor", "upgrade_runner", "ale", "capture", "network"] as const;
const DEFAULT_INTEGRATION_ORDER = ["ale_session", "ale_refresh", "capture_sync"] as const;
const LOCAL_STATUS_SNAPSHOT_PATH = "C:\\NOUR_OS\\state\\status_snapshot.json";

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown data-plane failure.";
}

async function loadLocalSnapshot(): Promise<SystemHealthSnapshot | null> {
  try {
    const raw = await readFile(LOCAL_STATUS_SNAPSHOT_PATH, "utf8");
    return normalizeSnapshot(JSON.parse(raw) as Partial<SystemHealthSnapshot>, "local_snapshot");
  } catch {
    return null;
  }
}

function normalizeServiceEntry(service: string, value: unknown, source: string): ServiceHealthView {
  const payload = (value as Partial<ServiceHealthView> | null) || {};
  const status = String(payload.status || "failed");
  const checkedAt = typeof payload.checked_at === "string" && payload.checked_at ? payload.checked_at : new Date().toISOString();
  const severity =
    typeof payload.severity === "string" && payload.severity
      ? payload.severity
      : status === "failed"
        ? service === "app" || service === "runner"
          ? "critical"
          : "warning"
        : status === "degraded" || status === "auth_pending"
          ? "warning"
          : "info";
  return {
    service,
    status,
    detail: String(payload.detail || `${service} has not reported yet.`),
    recovery_action: String(payload.recovery_action || ""),
    checked_at: checkedAt,
    last_success_at: typeof payload.last_success_at === "string" ? payload.last_success_at : null,
    last_failure_at: typeof payload.last_failure_at === "string" ? payload.last_failure_at : null,
    last_duration_ms: typeof payload.last_duration_ms === "number" ? payload.last_duration_ms : null,
    metadata: (payload.metadata as Record<string, unknown> | null) || {},
    severity,
    is_blocking:
      typeof payload.is_blocking === "boolean"
        ? payload.is_blocking
        : (service === "app" || service === "runner") && severity === "critical",
    freshness: typeof payload.freshness === "string" ? payload.freshness : "fresh",
    source: typeof payload.source === "string" ? payload.source : source,
    recent_checks: Array.isArray(payload.recent_checks)
      ? payload.recent_checks.map((entry) => ({
          checked_at: String(entry?.checked_at || checkedAt),
          status: String(entry?.status || status),
          detail: String(entry?.detail || ""),
          duration_ms: typeof entry?.duration_ms === "number" ? entry.duration_ms : null
        }))
      : []
  };
}

function normalizeSnapshot(snapshot: Partial<SystemHealthSnapshot>, source: string): SystemHealthSnapshot {
  const generatedAt = typeof snapshot.generated_at === "string" && snapshot.generated_at ? snapshot.generated_at : new Date().toISOString();
  const services = Object.fromEntries(
    DEFAULT_SERVICE_ORDER.map((service) => [service, normalizeServiceEntry(service, (snapshot.services as Record<string, unknown> | undefined)?.[service], source)])
  ) as Record<string, ServiceHealthView>;
  const integrations = Object.fromEntries(
    DEFAULT_INTEGRATION_ORDER.map((service) => [
      service,
      normalizeServiceEntry(service, (snapshot.integrations as Record<string, unknown> | undefined)?.[service], source)
    ])
  ) as Record<string, ServiceHealthView>;
  return {
    ...emptyStatusSnapshot,
    ...snapshot,
    generated_at: generatedAt,
    services,
    integrations,
    night_shift: {
      ...emptyStatusSnapshot.night_shift,
      ...((snapshot.night_shift as NightShiftStatusView | undefined) || {}),
      run_policy:
        ((snapshot.night_shift as NightShiftStatusView | undefined)?.run_policy as string | undefined) || "manual_fix_only",
      scheduled:
        typeof (snapshot.night_shift as NightShiftStatusView | undefined)?.scheduled === "boolean"
          ? Boolean((snapshot.night_shift as NightShiftStatusView | undefined)?.scheduled)
          : false
    },
    repair: {
      ...emptyStatusSnapshot.repair,
      ...((snapshot.repair as RepairStatusView | undefined) || {})
    },
    diagnostics: {
      ...emptyStatusSnapshot.diagnostics,
      ...((snapshot as Record<string, unknown>).diagnostics as Record<string, unknown> | undefined)
    },
    last_green_startup_at: typeof snapshot.last_green_startup_at === "string" ? snapshot.last_green_startup_at : "",
    last_green_ai_probe_at: typeof snapshot.last_green_ai_probe_at === "string" ? snapshot.last_green_ai_probe_at : "",
    last_green_visual_check_at: typeof snapshot.last_green_visual_check_at === "string" ? snapshot.last_green_visual_check_at : ""
  };
}

function degradedSnapshot(detail: string): SystemHealthSnapshot {
  const generatedAt = new Date().toISOString();

  return {
    ...emptyStatusSnapshot,
    generated_at: generatedAt,
    headline: "Data plane is degraded.",
    focus: "The public control plane is up, but Neon-backed state is temporarily unavailable.",
        services: {
          launcher: emptyService("launcher", "degraded", detail, "Check the database connection and rerun the local launcher."),
          app: emptyService("app", "ready", "Public control plane is serving cached-safe surfaces.", ""),
          runner: emptyService("runner", "degraded", "Local worker plane heartbeat is unavailable.", "Run Start NOUR OS to restore the local worker plane."),
          upgrade_runner: emptyService("upgrade_runner", "degraded", "Night Shift has not reported yet.", "Run or verify the Night Shift controller."),
          ale: emptyService("ale", "degraded", "Recovery cache cannot refresh while the data plane is degraded.", "Restore database connectivity, then refresh ALE."),
          capture: emptyService("capture", "degraded", "Capture inbox cannot refresh while the data plane is degraded.", "Restore database connectivity, then rerun the local runner."),
          network: emptyService("network", "degraded", "Mobile and remote URLs may be stale.", "Check the latest runner heartbeat.")
        },
        integrations: {
          ale_session: emptyService("ale_session", "degraded", detail, "Re-run the runner once the database path is healthy."),
          ale_refresh: emptyService("ale_refresh", "degraded", detail, "Re-run the runner once the database path is healthy."),
          capture_sync: emptyService("capture_sync", "degraded", detail, "Re-run the runner once the data plane is healthy.")
        },
    startup: {
      status: "degraded",
      summary: "Control plane is live, but the data plane is unavailable.",
      focus: "Hold execution on cached state until Neon connectivity returns.",
      next_action: "Check Neon connectivity and rerun the local runner.",
      blocking_service: "database",
      checked_at: generatedAt
    },
    night_shift: {
      mode: "manual_fix_only",
      mutation_allowed: false,
      kill_switch: false,
      run_policy: "manual_fix_only",
      scheduled: false,
      detail: "Night Shift state is unavailable while the data plane is degraded.",
      next_window: {
        mode: "manual_only",
        starts_at: generatedAt
      },
      latest_run: null,
      latest_draft: null,
      latest_promoted: null,
      current_active_build: null,
      heuristics: {},
      top_backlog: [],
      eligible_fix_count: 0,
      last_manual_run_at: "",
      summary_path: "",
      report_path: "",
      screenshot_dir: ""
    },
    repair: {
      ...emptyStatusSnapshot.repair
    },
    today: {
      primary_move: "Keep the control plane up and restore database connectivity.",
      next_actions: ["Verify Neon connectivity.", "Rerun the local runner."]
    },
    diagnostics: {
      warning_count: 1,
      warnings: [{ service: "database", severity: "critical", detail, recovery_action: "Check Neon connectivity and rerun the local runner." }],
      route_failures: [],
      latest_night_shift_status: "offline"
    },
    last_green_startup_at: "",
    last_green_ai_probe_at: "",
    last_green_visual_check_at: ""
  };
}

const emptyService = (service: string, status: string, detail: string, recoveryAction: string): ServiceHealthView => ({
  service,
  status,
  detail,
  recovery_action: recoveryAction,
  checked_at: new Date(0).toISOString(),
  last_success_at: null,
  last_failure_at: null,
  last_duration_ms: null,
  metadata: {},
  severity: status === "failed" ? "critical" : status === "degraded" ? "warning" : "info",
  is_blocking: service === "app" || service === "runner" ? status === "failed" || status === "degraded" : false,
  freshness: "stale",
  source: "db_cache",
  recent_checks: []
});

export const emptyStatusSnapshot = {
  generated_at: "",
  headline: "STATENOUR runner state is offline.",
  focus: "Start the local runner to refresh the control plane.",
  queue: {
    pending: 0,
    approved: 0,
    discarded: 0
  },
  mirror: {
    record_count: 0,
    generated_at: "",
    age_hours: null as number | null
  },
  downloads: {
    incoming_count: 0,
    path: "C:\\NOUR_OS\\Downloads"
  },
  recovery: {
    open_count: 0,
    top_items: [] as RecoveryPayload[]
  },
  brief: {
    updated_at: ""
  },
  watch: {
    recent_events_24h: 0,
    latest_event: null as Record<string, unknown> | null
  },
  backups: {
    count: 0,
    latest: null as string | null
  },
  sqlite: {
    table_count: 0,
    tables: {} as Record<string, number>
  },
  paths: {
    root: "C:\\NOUR_OS",
    status_snapshot: "C:\\NOUR_OS\\state\\status_snapshot.json",
    morning_brief: "C:\\NOUR_OS\\state\\morning_brief.md",
    watch_events: "C:\\NOUR_OS\\state\\watch_events.jsonl"
  },
  services: {} as Record<string, ServiceHealthView>,
  integrations: {} as Record<string, ServiceHealthView>,
  night_shift: {
    mode: "manual_fix_only",
    mutation_allowed: false,
    kill_switch: false,
    run_policy: "manual_fix_only",
    scheduled: false,
    detail: "Night Shift is manual and idle.",
    next_window: {
      mode: "manual_only",
      starts_at: ""
    },
    latest_run: null,
    latest_draft: null,
    latest_promoted: null,
    current_active_build: null,
    heuristics: {},
    top_backlog: [],
    eligible_fix_count: 0,
    last_manual_run_at: "",
    summary_path: "",
    report_path: "",
    screenshot_dir: ""
  } as NightShiftStatusView,
  repair: {
    auto_heal_enabled: true,
    auto_heal_last_run: "",
    last_repair_action: "",
    last_repair_status: "",
    last_repair_detail: "Auto-heal is watching the local stack.",
    last_repair_mode: "",
    last_repair_checked_at: "",
    next_recommended_action: "Open System and use the repair console.",
    available_actions: ["warm_ai", "refresh_ale", "restart_runner", "rescan_capture", "verify_system"],
    cooldowns: {},
    circuit_breakers: {},
    detail: "Auto-heal is watching the local stack."
  } as RepairStatusView,
  startup: {
    status: "failed",
    summary: "Runner has not reported in.",
    focus: "Bring the local worker online.",
    next_action: "Run Start NOUR OS.",
    blocking_service: "runner",
    checked_at: ""
  },
  today: {
    primary_move: "Bring the local runner online and refresh system state.",
    next_actions: ["Run Start NOUR OS."]
  },
  diagnostics: {
    warning_count: 0,
    warnings: [] as Array<Record<string, unknown>>,
    route_failures: [] as Array<Record<string, unknown>>,
    latest_night_shift_status: "idle"
  },
  last_green_startup_at: "",
  last_green_ai_probe_at: "",
  last_green_visual_check_at: ""
};

export type SystemHealthSnapshot = typeof emptyStatusSnapshot;

export type AleSessionSnapshot = {
  status: string;
  detail?: string;
  session_ready: boolean;
  final_url?: string;
  final_title?: string;
  screenshot_path?: string;
};

export type AleRecoverySnapshot = {
  status: string;
  detail?: string;
  session_ready: boolean;
  final_url?: string;
  final_title?: string;
  item_count: number;
  generated_at: string;
  source: string;
  items: RecoveryPayload[];
};

type WorkRequestResult<T> =
  | { kind: "completed"; payload: T; workItemId: string }
  | { kind: "failed"; workItemId: string; errorCode: string | null; errorMessage: string | null }
  | { kind: "processing"; workItemId: string };

function parseDate(value: unknown) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function toState(value: string | undefined): ServiceState {
  switch ((value || "").toUpperCase()) {
    case "STARTING":
    case "DRY_RUN":
      return ServiceState.STARTING;
    case "READY":
    case "APPLIED":
      return ServiceState.READY;
    case "DEGRADED":
      return ServiceState.DEGRADED;
    case "AUTH_PENDING":
      return ServiceState.AUTH_PENDING;
    default:
      return ServiceState.FAILED;
  }
}

function serializeService(record: {
  service: string;
  status: ServiceState;
  detail: string;
  recoveryAction: string | null;
  checkedAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastDurationMs: number | null;
  metadata: Prisma.JsonValue | null;
}) {
  return {
    service: record.service,
    status: record.status.toLowerCase(),
    detail: record.detail,
    recovery_action: record.recoveryAction || "",
    checked_at: record.checkedAt.toISOString(),
    last_success_at: record.lastSuccessAt?.toISOString() || null,
    last_failure_at: record.lastFailureAt?.toISOString() || null,
    last_duration_ms: record.lastDurationMs,
    metadata: (record.metadata as Record<string, unknown> | null) || {},
    severity:
      record.status === ServiceState.FAILED
        ? record.service === "app" || record.service === "runner"
          ? "critical"
          : "warning"
        : record.status === ServiceState.DEGRADED || record.status === ServiceState.AUTH_PENDING
          ? "warning"
          : "info",
    is_blocking: record.service === "app" || record.service === "runner" ? record.status !== ServiceState.READY : false,
    freshness: "fresh",
    source: "db_cache",
    recent_checks: [] as Array<{ checked_at: string; status: string; detail: string; duration_ms: number | null }>
  } satisfies ServiceHealthView;
}

function serializeRunnerNode(record: {
  label: string;
  status: ServiceState;
  lastHeartbeatAt: Date | null;
  metadata: Prisma.JsonValue | null;
}) {
  const metadata = (record.metadata as Record<string, unknown> | null) || {};
  const isReady = record.status === ServiceState.READY;

  return {
    service: "runner",
    status: record.status.toLowerCase(),
    detail:
      (typeof metadata.detail === "string" && metadata.detail) ||
      (isReady ? `${record.label} heartbeat is current.` : `${record.label} is not ready.`),
    recovery_action: isReady ? "" : "Run Start NOUR OS to restore the local worker plane.",
    checked_at: record.lastHeartbeatAt?.toISOString() ?? new Date(0).toISOString(),
    last_success_at: isReady && record.lastHeartbeatAt ? record.lastHeartbeatAt.toISOString() : null,
    last_failure_at: !isReady && record.lastHeartbeatAt ? record.lastHeartbeatAt.toISOString() : null,
    last_duration_ms: null as number | null,
    metadata,
    severity: isReady ? "info" : "critical",
    is_blocking: !isReady,
    freshness: "fresh",
    source: "db_cache",
    recent_checks: [] as Array<{ checked_at: string; status: string; detail: string; duration_ms: number | null }>
  } satisfies ServiceHealthView;
}

function serializeCaptureInboxItem(record: {
  itemKey: string;
  source: string;
  kind: string;
  title: string;
  summary: string;
  excerpt: string | null;
  contentPath: string | null;
  status: string;
  triageStatus: string;
  primaryTag: string | null;
  actionabilityScore: number;
  conversionTarget: string | null;
  convertedTaskId: string | null;
  convertedMissionId: string | null;
  convertedLeadId: string | null;
  triagedAt: Date | null;
  metadata: Prisma.JsonValue | null;
  capturedAt: Date;
  syncedAt: Date;
}) {
  return {
    item_key: record.itemKey,
    source: record.source,
    kind: record.kind,
    title: record.title,
    summary: record.summary,
    excerpt: record.excerpt,
    content_path: record.contentPath,
    status: record.status,
    triage_status: record.triageStatus.toLowerCase(),
    primary_tag: record.primaryTag,
    actionability_score: record.actionabilityScore,
    conversion_target: record.conversionTarget ? record.conversionTarget.toLowerCase() : null,
    converted_task_id: record.convertedTaskId,
    converted_mission_id: record.convertedMissionId,
    converted_lead_id: record.convertedLeadId,
    triaged_at: record.triagedAt?.toISOString() || null,
    captured_at: record.capturedAt.toISOString(),
    synced_at: record.syncedAt.toISOString(),
    metadata: (record.metadata as Record<string, unknown> | null) || {}
  } satisfies CaptureInboxItemView;
}

function mapStatusSnapshot(record: {
  generatedAt: Date;
  headline: string;
  focus: string;
  startupStatus: ServiceState;
  startupSummary: string;
  startupNextAction: string | null;
  startupBlockingService: string | null;
  primaryMove: string;
  nextActions: Prisma.JsonValue | null;
  queuePending: number;
  queueApproved: number;
  queueDiscarded: number;
  mirrorRecordCount: number;
  recoveryOpenCount: number;
  downloadsIncomingCount: number;
  watchRecentEvents24h: number;
  backupCount: number;
  briefUpdatedAt: Date | null;
  metadata: Prisma.JsonValue | null;
}) {
  const metadata = (record.metadata as Record<string, unknown> | null) || {};
  return {
    ...emptyStatusSnapshot,
    generated_at: record.generatedAt.toISOString(),
    headline: record.headline,
    focus: record.focus,
    queue: {
      pending: record.queuePending,
      approved: record.queueApproved,
      discarded: record.queueDiscarded
    },
    mirror: {
      record_count: record.mirrorRecordCount,
      generated_at: record.generatedAt.toISOString(),
      age_hours: 0
    },
    downloads: {
      incoming_count: record.downloadsIncomingCount,
      path: String(metadata.downloadPath || emptyStatusSnapshot.downloads.path)
    },
    recovery: {
      open_count: record.recoveryOpenCount,
      top_items: [] as RecoveryPayload[]
    },
    brief: {
      updated_at: record.briefUpdatedAt?.toISOString() || ""
    },
    watch: {
      recent_events_24h: record.watchRecentEvents24h,
      latest_event: (metadata.latestWatchEvent as Record<string, unknown> | null) || null
    },
    backups: {
      count: record.backupCount,
      latest: (typeof metadata.latestBackup === "string" && metadata.latestBackup) || null
    },
    sqlite: {
      table_count: Number(metadata.sqliteTableCount || 0),
      tables: (metadata.sqliteTables as Record<string, number>) || {}
    },
    paths: {
      root: String(metadata.rootPath || emptyStatusSnapshot.paths.root),
      status_snapshot: String(metadata.statusSnapshotPath || emptyStatusSnapshot.paths.status_snapshot),
      morning_brief: String(metadata.morningBriefPath || emptyStatusSnapshot.paths.morning_brief),
      watch_events: String(metadata.watchEventsPath || emptyStatusSnapshot.paths.watch_events)
    },
    night_shift: (metadata.nightShift as NightShiftStatusView | undefined) || emptyStatusSnapshot.night_shift,
    repair: (metadata.repair as RepairStatusView | undefined) || emptyStatusSnapshot.repair,
    startup: {
      status: record.startupStatus.toLowerCase(),
      summary: record.startupSummary,
      focus: record.focus,
      next_action: record.startupNextAction ?? "",
      blocking_service: record.startupBlockingService ?? "",
      checked_at: record.generatedAt.toISOString()
    },
    today: {
      primary_move: record.primaryMove,
      next_actions: Array.isArray(record.nextActions) ? (record.nextActions as string[]) : []
    }
  } satisfies SystemHealthSnapshot;
}

export async function getSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
  if (isDemoMode) {
    return emptyStatusSnapshot;
  }

  const localSnapshot = await loadLocalSnapshot();
  if (localSnapshot) {
    return localSnapshot;
  }

  try {
    const [snapshot, serviceRows, integrationRows, runnerNode, captureCount] = await Promise.all([
      prisma.systemSnapshot.findUnique({
        where: { scope: "global" }
      }),
      prisma.serviceHealth.findMany({
        where: {
          serviceKey: {
            in: [...DEFAULT_SERVICE_ORDER]
          }
        }
      }),
      prisma.serviceHealth.findMany({
        where: {
          serviceKey: {
            in: [...DEFAULT_INTEGRATION_ORDER]
          }
        }
      }),
      prisma.runnerNode.findFirst({
        orderBy: {
          lastHeartbeatAt: "desc"
        }
      }),
      prisma.captureInboxItem.count({
        where: {
          status: "active"
        }
      })
    ]);

    const base = snapshot ? mapStatusSnapshot(snapshot) : { ...emptyStatusSnapshot };
    const services = Object.fromEntries(
      DEFAULT_SERVICE_ORDER.map((key) => {
        if (key === "runner") {
          return [
            key,
            runnerNode
              ? serializeRunnerNode(runnerNode)
              : emptyService("runner", "failed", "No runner heartbeat yet.", "Run Start NOUR OS to launch the local worker plane.")
          ];
        }

        const match = serviceRows.find((service) => service.serviceKey === key);
        if (key === "capture") {
          const captureSync = integrationRows.find((service) => service.serviceKey === "capture_sync");
          return [
            key,
            captureSync
              ? {
                  ...serializeService(captureSync),
                  service: "capture",
                  detail:
                    captureCount > 0
                      ? `${captureCount} local capture item(s) are staged.`
                      : serializeService(captureSync).detail,
                  metadata: {
                    ...(((captureSync.metadata as Record<string, unknown> | null) || {})),
                    item_count: captureCount
                  }
                }
              : emptyService(
                  "capture",
                  "failed",
                  "No capture sync snapshot yet.",
                  "Run Start NOUR OS to sync local capture sources."
                )
          ];
        }
        return [key, match ? serializeService(match) : emptyService(key, "failed", `No ${key} snapshot yet.`, "Run the local runner.")];
      })
    );
    const integrations = Object.fromEntries(
      DEFAULT_INTEGRATION_ORDER.map((key) => {
        const match = integrationRows.find((service) => service.serviceKey === key);
        return [key, match ? serializeService(match) : emptyService(key, "failed", `No ${key} snapshot yet.`, "Run the local runner.")];
      })
    );

    return {
      ...base,
      services,
      integrations,
      recovery: {
        open_count: snapshot?.recoveryOpenCount ?? 0,
        top_items: []
      }
    };
  } catch (error) {
    return degradedSnapshot(errorMessage(error));
  }
}

export async function getCaptureInboxItems(limit = 12): Promise<CaptureInboxItemView[]> {
  if (isDemoMode) {
    return [];
  }

  try {
    const rows = await prisma.captureInboxItem.findMany({
      where: {
        status: "active"
      },
      orderBy: [{ actionabilityScore: "desc" }, { capturedAt: "desc" }, { updatedAt: "desc" }],
      take: Math.max(1, Math.min(limit, 24))
    });

    return rows.map(serializeCaptureInboxItem);
  } catch {
    return [];
  }
}

export async function getNourStatusSnapshot() {
  return getSystemHealthSnapshot();
}

export async function getAleSessionSnapshot(): Promise<AleSessionSnapshot> {
  if (isDemoMode) {
    return {
      status: "offline",
      detail: "ALE runner is offline.",
      session_ready: false
    };
  }

  try {
    const record =
      (await prisma.serviceHealth.findUnique({ where: { serviceKey: "ale_session" } })) ||
      (await prisma.serviceHealth.findUnique({ where: { serviceKey: "ale" } }));

    if (!record) {
      return {
        status: "offline",
        detail: "ALE runner has not published a session yet.",
        session_ready: false
      };
    }

    const metadata = (record.metadata as Record<string, unknown> | null) || {};
    return {
      status: record.status.toLowerCase(),
      detail: record.detail,
      session_ready: record.status === ServiceState.READY,
      final_url: typeof metadata.final_url === "string" ? metadata.final_url : undefined,
      final_title: typeof metadata.final_title === "string" ? metadata.final_title : undefined,
      screenshot_path: typeof metadata.screenshot_path === "string" ? metadata.screenshot_path : undefined
    };
  } catch (error) {
    return {
      status: "degraded",
      detail: errorMessage(error),
      session_ready: false
    };
  }
}

export async function getAleRecoverySnapshot(): Promise<AleRecoverySnapshot> {
  if (isDemoMode) {
    return {
      status: "offline",
      detail: "ALE recovery has not been staged yet.",
      session_ready: false,
      item_count: 0,
      generated_at: "",
      source: "ale_recent",
      items: []
    };
  }

  try {
    const [refresh] = await Promise.all([
      prisma.serviceHealth.findUnique({ where: { serviceKey: "ale_refresh" } })
    ]);

    const metadata = (refresh?.metadata as Record<string, unknown> | null) || {};
    return {
      status: refresh?.status.toLowerCase() || "offline",
      detail: refresh?.detail || "ALE recovery has not been staged yet.",
      session_ready: Boolean(metadata.session_ready),
      final_url: typeof metadata.final_url === "string" ? metadata.final_url : undefined,
      final_title: typeof metadata.final_title === "string" ? metadata.final_title : undefined,
      item_count: 0,
      generated_at: refresh?.checkedAt.toISOString() || "",
      source: "ale_recent",
      items: []
    };
  } catch (error) {
    return {
      status: "degraded",
      detail: errorMessage(error),
      session_ready: false,
      item_count: 0,
      generated_at: "",
      source: "ale_recent",
      items: []
    };
  }
}

export async function ingestSystemSnapshot(
  payload: SystemHealthSnapshot,
  options?: {
    nodeKey?: string;
    runnerLabel?: string;
  }
) {
  if (isDemoMode) {
    return;
  }

  const metadata = {
    rootPath: payload.paths.root,
    statusSnapshotPath: payload.paths.status_snapshot,
    morningBriefPath: payload.paths.morning_brief,
    watchEventsPath: payload.paths.watch_events,
    downloadPath: payload.downloads.path,
    latestWatchEvent: payload.watch.latest_event,
    latestBackup: payload.backups.latest,
    sqliteTableCount: payload.sqlite.table_count,
    sqliteTables: payload.sqlite.tables,
    nightShift: payload.night_shift ?? emptyStatusSnapshot.night_shift,
    repair: (payload as SystemHealthSnapshot).repair ?? emptyStatusSnapshot.repair
  } satisfies Record<string, unknown>;

  const runnerNode = options?.nodeKey
    ? await prisma.runnerNode.upsert({
        where: { nodeKey: options.nodeKey },
        update: {
          label: options.runnerLabel || "NOUR Runner",
          lastHeartbeatAt: new Date(payload.generated_at || new Date().toISOString()),
          metadata: asJsonValue({
            focus: payload.focus,
            headline: payload.headline
          })
        },
        create: {
          nodeKey: options.nodeKey,
          label: options.runnerLabel || "NOUR Runner",
          status: ServiceState.STARTING,
          lastHeartbeatAt: new Date(payload.generated_at || new Date().toISOString()),
          metadata: asJsonValue({
            focus: payload.focus,
            headline: payload.headline
          })
        }
      })
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.systemSnapshot.upsert({
      where: { scope: "global" },
      update: {
        headline: payload.headline,
        focus: payload.focus,
        startupStatus: toState(payload.startup.status),
        startupSummary: payload.startup.summary,
        startupNextAction: payload.startup.next_action,
        startupBlockingService: payload.startup.blocking_service,
        primaryMove: payload.today.primary_move,
        nextActions: payload.today.next_actions,
        queuePending: payload.queue.pending,
        queueApproved: payload.queue.approved,
        queueDiscarded: payload.queue.discarded,
        mirrorRecordCount: payload.mirror.record_count,
        recoveryOpenCount: payload.recovery.open_count,
        downloadsIncomingCount: payload.downloads.incoming_count,
        watchRecentEvents24h: payload.watch.recent_events_24h,
        backupCount: payload.backups.count,
        briefUpdatedAt: parseDate(payload.brief.updated_at),
        generatedAt: parseDate(payload.generated_at) || new Date(),
        metadata: asJsonValue(metadata)
      },
      create: {
        scope: "global",
        headline: payload.headline,
        focus: payload.focus,
        startupStatus: toState(payload.startup.status),
        startupSummary: payload.startup.summary,
        startupNextAction: payload.startup.next_action,
        startupBlockingService: payload.startup.blocking_service,
        primaryMove: payload.today.primary_move,
        nextActions: payload.today.next_actions,
        queuePending: payload.queue.pending,
        queueApproved: payload.queue.approved,
        queueDiscarded: payload.queue.discarded,
        mirrorRecordCount: payload.mirror.record_count,
        recoveryOpenCount: payload.recovery.open_count,
        downloadsIncomingCount: payload.downloads.incoming_count,
        watchRecentEvents24h: payload.watch.recent_events_24h,
        backupCount: payload.backups.count,
        briefUpdatedAt: parseDate(payload.brief.updated_at),
        generatedAt: parseDate(payload.generated_at) || new Date(),
        metadata: asJsonValue(metadata)
      }
    });

    for (const [serviceKey, service] of Object.entries(payload.services || {})) {
      await tx.serviceHealth.upsert({
        where: { serviceKey },
        update: {
          service: service.service,
          status: toState(service.status),
          detail: service.detail,
          recoveryAction: service.recovery_action,
          checkedAt: parseDate(service.checked_at) || new Date(),
          lastSuccessAt: parseDate(service.last_success_at),
          lastFailureAt: parseDate(service.last_failure_at),
          lastDurationMs: service.last_duration_ms,
          metadata: asJsonValue(service.metadata),
          runnerNodeId: runnerNode?.id
        },
        create: {
          serviceKey,
          service: service.service,
          status: toState(service.status),
          detail: service.detail,
          recoveryAction: service.recovery_action,
          checkedAt: parseDate(service.checked_at) || new Date(),
          lastSuccessAt: parseDate(service.last_success_at),
          lastFailureAt: parseDate(service.last_failure_at),
          lastDurationMs: service.last_duration_ms,
          metadata: asJsonValue(service.metadata),
          runnerNodeId: runnerNode?.id
        }
      });
    }

    for (const [serviceKey, service] of Object.entries(payload.integrations || {})) {
      await tx.serviceHealth.upsert({
        where: { serviceKey },
        update: {
          service: service.service,
          status: toState(service.status),
          detail: service.detail,
          recoveryAction: service.recovery_action,
          checkedAt: parseDate(service.checked_at) || new Date(),
          lastSuccessAt: parseDate(service.last_success_at),
          lastFailureAt: parseDate(service.last_failure_at),
          lastDurationMs: service.last_duration_ms,
          metadata: asJsonValue(service.metadata),
          runnerNodeId: runnerNode?.id
        },
        create: {
          serviceKey,
          service: service.service,
          status: toState(service.status),
          detail: service.detail,
          recoveryAction: service.recovery_action,
          checkedAt: parseDate(service.checked_at) || new Date(),
          lastSuccessAt: parseDate(service.last_success_at),
          lastFailureAt: parseDate(service.last_failure_at),
          lastDurationMs: service.last_duration_ms,
          metadata: asJsonValue(service.metadata),
          runnerNodeId: runnerNode?.id
        }
      });
    }
  });
}

export async function replaceRecoverySnapshot(
  payload: AleRecoverySnapshot,
  options?: {
    nodeKey?: string;
  }
) {
  if (isDemoMode) {
    return;
  }

  // StagedRecoveryItem model removed — no-op
  return;

}

export async function replaceCaptureInbox(
  payload: {
    status: string;
    detail?: string;
    generated_at: string;
    scanned_sources: string[];
    items: Array<{
      item_key: string;
      source: string;
      kind: string;
      title: string;
      summary: string;
      excerpt?: string | null;
      content_path?: string | null;
      metadata?: Record<string, unknown>;
      captured_at: string;
    }>;
  },
  options?: {
    nodeKey?: string;
  }
) {
  if (isDemoMode) {
    return;
  }

  const runnerNode = options?.nodeKey
    ? await prisma.runnerNode.findUnique({
        where: { nodeKey: options.nodeKey }
      })
    : null;

  const sources = Array.from(
    new Set(payload.scanned_sources.filter(Boolean).concat(payload.items.map((item) => item.source).filter(Boolean)))
  );

  await prisma.$transaction(async (tx) => {
    for (const item of payload.items) {
      const existing = await tx.captureInboxItem.findUnique({
        where: { itemKey: item.item_key }
      });
      const metadata = (item.metadata || {}) as Record<string, unknown>;
      const tags = Array.isArray(metadata.tags) ? metadata.tags.map((tag) => String(tag).toLowerCase()) : [];
      const inferredPrimaryTag =
        tags.includes("customer")
          ? "customer"
          : tags.includes("reference")
            ? "reference"
            : tags.includes("personal")
              ? "personal"
              : item.kind === "image"
                ? "ops"
                : "idea";
      const inferredActionability = Math.max(
        5,
        Math.min(
          100,
          (item.kind === "image" ? 58 : 65) +
            (/urgent|today|call|estimate|callback|follow up/i.test(`${item.title} ${item.summary}`) ? 20 : 0) +
            (tags.includes("customer") ? 10 : 0) -
            (tags.includes("reference") ? 10 : 0)
        )
      );

      await tx.captureInboxItem.upsert({
        where: { itemKey: item.item_key },
        update: {
          source: item.source,
          kind: item.kind,
          title: item.title,
          summary: item.summary,
          excerpt: item.excerpt || null,
          contentPath: item.content_path || null,
          status: existing?.status === "archived" ? "archived" : "active",
          metadata: asJsonValue(metadata),
          capturedAt: parseDate(item.captured_at) || new Date(),
          syncedAt: parseDate(payload.generated_at) || new Date(),
          primaryTag: existing?.primaryTag || inferredPrimaryTag,
          actionabilityScore: existing?.actionabilityScore ?? inferredActionability
        },
        create: {
          itemKey: item.item_key,
          source: item.source,
          kind: item.kind,
          title: item.title,
          summary: item.summary,
          excerpt: item.excerpt || null,
          contentPath: item.content_path || null,
          status: "active",
          triageStatus: "NEW",
          primaryTag: inferredPrimaryTag,
          actionabilityScore: inferredActionability,
          metadata: asJsonValue(metadata),
          capturedAt: parseDate(item.captured_at) || new Date(),
          syncedAt: parseDate(payload.generated_at) || new Date()
        }
      });
    }

    await tx.serviceHealth.upsert({
      where: { serviceKey: "capture_sync" },
      update: {
        service: "capture_sync",
        status: toState(payload.status),
        detail: payload.detail || "Capture sync completed.",
        recoveryAction: payload.status === "ready" ? "" : "Verify ShareX and Obsidian paths, then rerun the local runner.",
        checkedAt: parseDate(payload.generated_at) || new Date(),
        lastSuccessAt: payload.status === "ready" ? parseDate(payload.generated_at) || new Date() : undefined,
        lastFailureAt: payload.status === "failed" ? parseDate(payload.generated_at) || new Date() : undefined,
        metadata: asJsonValue({
          item_count: payload.items.length,
          scanned_sources: sources
        }),
        runnerNodeId: runnerNode?.id
      },
      create: {
        serviceKey: "capture_sync",
        service: "capture_sync",
        status: toState(payload.status),
        detail: payload.detail || "Capture sync completed.",
        recoveryAction: payload.status === "ready" ? "" : "Verify ShareX and Obsidian paths, then rerun the local runner.",
        checkedAt: parseDate(payload.generated_at) || new Date(),
        lastSuccessAt: payload.status === "ready" ? parseDate(payload.generated_at) || new Date() : null,
        lastFailureAt: payload.status === "failed" ? parseDate(payload.generated_at) || new Date() : null,
        metadata: asJsonValue({
          item_count: payload.items.length,
          scanned_sources: sources
        }),
        runnerNodeId: runnerNode?.id
      }
    });
  });
}

export async function heartbeatRunner(input: {
  nodeKey: string;
  label: string;
  status?: string;
  version?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (isDemoMode) {
    return null;
  }

  return prisma.runnerNode.upsert({
    where: { nodeKey: input.nodeKey },
    update: {
      label: input.label,
      status: toState(input.status),
      version: input.version || undefined,
      lastHeartbeatAt: new Date(),
      metadata: asJsonValue(input.metadata || {})
    },
    create: {
      nodeKey: input.nodeKey,
      label: input.label,
      status: toState(input.status),
      version: input.version || undefined,
      lastHeartbeatAt: new Date(),
      metadata: asJsonValue(input.metadata || {})
    }
  });
}

export async function enqueueWorkItem<TPayload extends Record<string, unknown>>(input: {
  type: WorkItemType;
  requestPayload: TPayload;
  idempotencyKey?: string;
}) {
  if (isDemoMode) {
    return null;
  }

  if (input.idempotencyKey) {
    const existing = await prisma.workItem.findUnique({
      where: { idempotencyKey: input.idempotencyKey }
    });
    if (existing) {
      return existing;
    }
  }

  return prisma.workItem.create({
    data: {
      type: input.type,
      requestPayload: asJsonValue(input.requestPayload),
      idempotencyKey: input.idempotencyKey
    }
  });
}

export async function claimWorkItems(input: { nodeKey: string; limit?: number; types?: WorkItemType[] }) {
  if (isDemoMode) {
    return [];
  }

  const runnerNode = await heartbeatRunner({
    nodeKey: input.nodeKey,
    label: "NOUR Runner",
    status: "READY"
  });

  const limit = Math.max(1, Math.min(input.limit || 4, 10));
  const claimed: Awaited<ReturnType<typeof prisma.workItem.findUnique>>[] = [];

  // v9.1.26 · TOCTOU spin guard. Track ids we've already attempted +
  // bound the loop so a two-runner race on a single PENDING item
  // can't burn `limit` iterations re-finding the same already-
  // claimed candidate. The previous loop did `findFirst` then
  // `updateMany` (count=1 wins, count=0 retries with the SAME query
  // finding the same row), spinning until the limit was reached.
  // Now: collect attempted ids and exclude them from subsequent
  // findFirst calls. After 2× limit total iterations we bail
  // unconditionally as a hard cap.
  const attemptedIds = new Set<string>();
  const hardCap = limit * 2;
  let iterations = 0;

  while (claimed.length < limit && iterations < hardCap) {
    iterations++;
    const candidate = await prisma.workItem.findFirst({
      where: {
        status: WorkItemStatus.PENDING,
        availableAt: {
          lte: new Date(),
        },
        ...(input.types?.length ? { type: { in: input.types } } : {}),
        ...(attemptedIds.size > 0
          ? { id: { notIn: Array.from(attemptedIds) } }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }],
    });

    if (!candidate) {
      break;
    }
    attemptedIds.add(candidate.id);

    const updated = await prisma.workItem.updateMany({
      where: {
        id: candidate.id,
        status: WorkItemStatus.PENDING,
      },
      data: {
        status: WorkItemStatus.CLAIMED,
        claimedAt: new Date(),
        attempts: {
          increment: 1,
        },
        runnerNodeId: runnerNode?.id,
      },
    });

    if (updated.count === 0) {
      // Lost the race to another runner — keep this id excluded so
      // we don't re-find it next iteration.
      continue;
    }

    claimed.push(
      await prisma.workItem.findUnique({
        where: { id: candidate.id },
      }),
    );
  }

  return claimed.filter(Boolean);
}

export async function completeWorkItem(input: {
  workItemId: string;
  status: "completed" | "failed";
  payload?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  if (isDemoMode) {
    return null;
  }

  const mappedStatus = input.status === "completed" ? WorkItemStatus.COMPLETED : WorkItemStatus.FAILED;
  return prisma.$transaction(async (tx) => {
    const workItem = await tx.workItem.update({
      where: { id: input.workItemId },
      data: {
        status: mappedStatus,
        completedAt: new Date(),
        errorCode: input.errorCode || undefined,
        errorMessage: input.errorMessage || undefined
      }
    });

    // WorkResult model removed — no-op
    const result = null;

    return { workItem, result };
  });
}

export async function waitForWorkItemResult<T>(workItemId: string, timeoutMs = 8500, pollMs = 350): Promise<WorkRequestResult<T>> {
  // WorkResult model removed — no-op
  return {
    kind: "processing",
    workItemId
  };
}

export async function getWorkItemResult<T>(workItemId: string): Promise<WorkRequestResult<T>> {
  // WorkResult model removed — no-op
  return {
    kind: "processing",
    workItemId
  };
}

export async function createAuditEvent(input: {
  actor: string;
  eventType: string;
  detail: string;
  payload?: Record<string, unknown>;
}) {
  if (isDemoMode) {
    return null;
  }

  return prisma.auditEvent.create({
    data: {
      actor: input.actor,
      eventType: input.eventType,
      detail: input.detail,
      payload: input.payload ? asJsonValue(input.payload) : undefined
    }
  });
}
