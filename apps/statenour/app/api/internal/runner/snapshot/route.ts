import { z } from "zod";

import { assertRunnerRequest } from "@/lib/internal/runner-auth";
import { ingestSystemSnapshot } from "@/lib/services/runner-state";
import { apiHandler, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const serviceSchema = z.object({
  service: z.string(),
  status: z.string(),
  detail: z.string(),
  recovery_action: z.string().optional().default(""),
  checked_at: z.string(),
  last_success_at: z.string().nullable().optional().default(null),
  last_failure_at: z.string().nullable().optional().default(null),
  last_duration_ms: z.number().nullable().optional().default(null),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  recent_checks: z.array(
    z.object({
      checked_at: z.string(),
      status: z.string(),
      detail: z.string(),
      duration_ms: z.number().nullable().optional().default(null)
    })
  ).optional().default([])
});

const recoveryItemSchema = z.object({
  entity_key: z.string(),
  source: z.string(),
  title: z.string(),
  summary: z.string(),
  priority_score: z.number(),
  status: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  updated_at: z.string()
});

const snapshotSchema = z.object({
  generated_at: z.string(),
  headline: z.string(),
  focus: z.string(),
  queue: z.object({
    pending: z.number(),
    approved: z.number(),
    discarded: z.number()
  }),
  mirror: z.object({
    record_count: z.number(),
    generated_at: z.string(),
    age_hours: z.number().nullable().optional().default(null)
  }),
  downloads: z.object({
    incoming_count: z.number(),
    path: z.string()
  }),
  recovery: z.object({
    open_count: z.number(),
    top_items: z.array(recoveryItemSchema)
  }),
  brief: z.object({
    updated_at: z.string()
  }),
  watch: z.object({
    recent_events_24h: z.number(),
    latest_event: z.record(z.string(), z.unknown()).nullable().optional().default(null)
  }),
  backups: z.object({
    count: z.number(),
    latest: z.string().nullable().optional().default(null)
  }),
  sqlite: z.object({
    table_count: z.number(),
    tables: z.record(z.string(), z.number())
  }),
  paths: z.object({
    root: z.string(),
    status_snapshot: z.string(),
    morning_brief: z.string(),
    watch_events: z.string()
  }),
  services: z.record(z.string(), serviceSchema),
  integrations: z.record(z.string(), serviceSchema),
  night_shift: z.object({
    mode: z.string(),
    mutation_allowed: z.boolean(),
    kill_switch: z.boolean(),
    run_policy: z.string().optional().default("manual_fix_only"),
    scheduled: z.boolean().optional().default(false),
    detail: z.string(),
    eligible_fix_count: z.number().optional().default(0),
    last_manual_run_at: z.string().optional().default(""),
    next_window: z.object({
      mode: z.string(),
      starts_at: z.string()
    }),
    latest_run: z.record(z.string(), z.unknown()).nullable().optional().default(null),
    latest_draft: z.record(z.string(), z.unknown()).nullable().optional().default(null),
    latest_promoted: z.record(z.string(), z.unknown()).nullable().optional().default(null),
    current_active_build: z.record(z.string(), z.unknown()).nullable().optional().default(null),
    heuristics: z.record(z.string(), z.number()).optional().default({}),
    top_backlog: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    summary_path: z.string().optional().default(""),
    report_path: z.string().optional().default(""),
    screenshot_dir: z.string().optional().default("")
  }).optional().default({
    mode: "verify_window",
    mutation_allowed: false,
    kill_switch: false,
    run_policy: "manual_fix_only",
    scheduled: false,
    detail: "Night Shift is offline.",
    eligible_fix_count: 0,
    last_manual_run_at: "",
    next_window: {
      mode: "build_window",
      starts_at: ""
    },
    latest_run: null,
    latest_draft: null,
    latest_promoted: null,
    current_active_build: null,
    heuristics: {},
    top_backlog: [],
    summary_path: "",
    report_path: "",
    screenshot_dir: ""
  }),
  repair: z.object({
    auto_heal_enabled: z.boolean().optional().default(true),
    auto_heal_last_run: z.string().optional().default(""),
    last_repair_action: z.string().optional().default(""),
    last_repair_status: z.string().optional().default(""),
    last_repair_detail: z.string().optional().default(""),
    last_repair_mode: z.string().optional().default(""),
    last_repair_checked_at: z.string().optional().default(""),
    next_recommended_action: z.string().optional().default(""),
    available_actions: z.array(z.string()).optional().default([]),
    cooldowns: z.record(z.string(), z.string()).optional().default({}),
    circuit_breakers: z.record(z.string(), z.string()).optional().default({}),
    detail: z.string().optional().default("")
  }).optional().default({
    auto_heal_enabled: true,
    auto_heal_last_run: "",
    last_repair_action: "",
    last_repair_status: "",
    last_repair_detail: "",
    last_repair_mode: "",
    last_repair_checked_at: "",
    next_recommended_action: "",
    available_actions: [],
    cooldowns: {},
    circuit_breakers: {},
    detail: ""
  }),
  startup: z.object({
    status: z.string(),
    summary: z.string(),
    focus: z.string(),
    next_action: z.string().nullable().optional().default(null),
    blocking_service: z.string().nullable().optional().default(null),
    checked_at: z.string()
  }),
  today: z.object({
    primary_move: z.string(),
    next_actions: z.array(z.string())
  })
});

const inputSchema = z.object({
  nodeKey: z.string().min(1),
  runnerLabel: z.string().min(1).optional(),
  snapshot: snapshotSchema
});

export const POST = apiHandler(async (request) => {
  assertRunnerRequest(request);
  const input = inputSchema.parse(await readRequestJson(request));
  await ingestSystemSnapshot(input.snapshot as any, {
    nodeKey: input.nodeKey,
    runnerLabel: input.runnerLabel,
  });
  return { ingested: true };
});
