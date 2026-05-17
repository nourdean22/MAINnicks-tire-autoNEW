import { apiHandler } from "@/lib/utils/http";

/** GET /api/docs — API route documentation */
export const GET = apiHandler(async () => {
  return {
    name: "NOUR OS API",
    version: "2.0.0",
    description: "Personal operating system API for disciplined execution, device control, and AI intelligence.",
    baseUrl: "https://autonicks.com/api",
    auth: {
      types: ["Bearer token (CRON_SECRET)", "x-sync-key header (STATENOUR_SYNC_KEY)", "NextAuth session"],
      note: "Most endpoints require authentication. System endpoints use cron/sync auth. Dashboard endpoints use session auth.",
    },
    routes: {
      health: {
        "GET /api/health": "System health check with DB, devices, alerts, loops, commitments",
        "GET /api/system/heartbeat": "Uptime monitor endpoint (200=ok, 503=degraded)",
        "GET /api/system/diagnostics": "Full system diagnostics (DB, KPIs, models, devices, integrations, queue)",
      },
      sync: {
        "POST /api/sync/nour-os": "Push data from local agents (auth: sync key). Modules: energy, daily_score, vision, habits, brain_dump, financial, decisions, patterns, insights, journal, commitment, open_loop, body, devices",
        "GET /api/sync/nour-os": "Pull current brain state for local agents (auth: sync key)",
        "POST /api/sync/session-reports": "Push Claude session reports (auth: sync key)",
      },
      tasks: {
        "GET /api/tasks": "List tasks with pagination (?page, ?pageSize, ?status)",
        "POST /api/tasks": "Create task",
        "GET /api/tasks/[id]": "Get task detail",
        "PATCH /api/tasks/[id]": "Update task",
      },
      missions: {
        "GET /api/missions": "List missions",
        "POST /api/missions": "Create mission",
        "GET /api/missions/[id]": "Get mission detail",
        "PATCH /api/missions/[id]": "Update mission",
      },
      customers: {
        "GET /api/customers": "List customers with pagination",
        "POST /api/customers": "Create customer",
        "GET /api/customers/[id]": "Get customer detail",
        "PATCH /api/customers/[id]": "Update customer",
      },
      leads: {
        "GET /api/leads": "List leads",
        "POST /api/leads": "Create lead",
        "GET /api/leads/[id]": "Get lead detail",
        "PATCH /api/leads/[id]": "Update lead",
      },
      jobs: {
        "GET /api/jobs": "List jobs",
        "POST /api/jobs": "Create job",
        "GET /api/jobs/[id]": "Get job detail",
        "PATCH /api/jobs/[id]": "Update job",
      },
      devices: {
        "GET /api/devices": "List all smart devices (auth: sync key)",
        "POST /api/devices": "Register device (auth: sync key)",
        "GET /api/devices/[id]": "Device detail (auth: sync key)",
        "PATCH /api/devices/[id]": "Update device (auth: sync key)",
        "GET /api/devices/[id]/events": "Device event history (auth: sync key)",
        "POST /api/devices/[id]/events": "Log device event (auth: sync key)",
        "GET /api/devices/[id]/command": "List device commands (auth: sync key)",
        "POST /api/devices/[id]/command": "Queue device command (auth: sync key)",
        "PATCH /api/devices/[id]/command": "Update command status (auth: sync key)",
      },
      cameras: {
        "GET /api/cameras": "List all camera devices with snapshots",
        "GET /api/cameras/[id]/snapshot": "Get latest snapshot URL",
        "POST /api/cameras/[id]/snapshot": "Trigger manual snapshot (auth: sync key)",
      },
      brain: {
        "GET /api/brain/status": "Brain health, memory stats, automation rules, recent patterns",
        "GET /api/brain/memories": "List memories (?category, ?q, ?minConfidence, ?limit)",
        "POST /api/brain/memories": "Add a memory manually",
        "PATCH /api/brain/memories": "Confirm, contradict, forget, or reinforce a memory",
      },
      automations: {
        "GET /api/automations": "List automation rules (?enabled)",
        "POST /api/automations": "Create automation rule",
        "PATCH /api/automations": "Update automation rule",
      },
      integrations: {
        "GET /api/integrations": "List integrations with last sync",
        "POST /api/integrations": "Register integration",
      },
      notifications: {
        "GET /api/notifications": "List notifications (?status, ?channel)",
        "POST /api/notifications": "Enqueue notification",
      },
      settings: {
        "GET /api/settings": "All settings grouped by category",
        "PATCH /api/settings": "Bulk update settings",
      },
      system: {
        "GET /api/system/metrics": "Query metrics (?metric, ?from, ?to, ?summary)",
        "POST /api/system/metrics": "Record metric (auth: sync key)",
        "GET /api/system/errors": "Recent errors (?grouped, ?level, ?from, ?to)",
        "GET /api/system/ai-analytics": "AI cost dashboard (?days)",
        "GET /api/system/diagnostics": "Full system diagnostics",
      },
      ai: {
        "POST /api/ai/chat": "AI chat (streaming)",
        "GET /api/ai/chat": "List recent conversations",
      },
      crons: {
        "GET /api/cron/drift-check": "Run drift detection (auth: cron)",
        "GET /api/cron/weekly-digest": "Generate weekly digest email (auth: cron)",
        "GET /api/cron/weekly-review": "Generate weekly review (auth: cron)",
        "GET /api/cron/learn": "AI learning cycle (auth: cron)",
        "GET /api/cron/device-health": "Check device statuses (auth: cron)",
        "GET /api/cron/stale-tasks": "Flag stale tasks (auth: cron)",
        "GET /api/cron/daily-report": "Generate daily report (auth: cron)",
        "GET /api/cron/notification-sender": "Process notification queue (auth: cron)",
        "GET /api/cron/data-cleanup": "Retention cleanup (auth: cron)",
        "GET /api/cron/brain-cycle": "Brain analysis loop (auth: cron)",
      },
    },
    envelope: {
      description: "All routes return a standard envelope",
      format: "{ ok: boolean, data?: T, error?: string, details?: unknown, meta: { duration_ms, timestamp, request_id, queries? } }",
    },
  };
});
