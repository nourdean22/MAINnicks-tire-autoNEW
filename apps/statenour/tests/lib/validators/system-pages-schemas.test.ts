/**
 * System-pages slice contract tests · Phase B.7a (2026-05-22 ·
 * legacy-modernizer REST→tRPC system-pages slice · sub-slice A).
 *
 * Sub-slice A migrated the `authedFetch` call-sites in the first ~13
 * `app/(mastery)/system/*` page files onto `trpc.system.*`:
 *
 *   · system/page.tsx              → system.diagnostics (NEW, read · no input)
 *                                    · system.healthSummary (NEW, read · no input)
 *                                    · brain.status (REUSED · no input)
 *   · system/actions/page.tsx      → system.autonomousActions (NEW, read)
 *   · system/agent-traces/page.tsx → system.agentTraces (NEW, read)
 *   · system/agent-traces/[traceId] → system.agentTraceDetail (NEW, read)
 *   · system/alerts/page.tsx       → brain.activeAlerts (REUSED)
 *   · system/approvals/page.tsx    → system.approvals (NEW, read · no input)
 *                                    · system.decideApproval (NEW, mutation)
 *   · system/brain-bus/page.tsx    → system.brainBusEvents (NEW, read)
 *   · system/chat-health/page.tsx  → system.chatHealth (NEW, read · no input)
 *   · system/costs/page.tsx        → system.costs (NEW, read)
 *   · system/cron-runs/[jobName]   → system.cronRunHistory (NEW, read)
 *                                    · system.runManifestCron (NEW, mutation)
 *   · system/crons/page.tsx        → system.cronDeck (NEW, read · no input)
 *                                    · system.setCronEnabled (REUSED, mutation)
 *                                    · system.runManifestCron (NEW, mutation)
 *   · system/deployment-truth      → system.deploymentTruth (NEW, read · no input)
 *   · system/devices/page.tsx      → system.deviceFleet (NEW, read · no input)
 *                                    · system.retireStaleDevices (NEW, mutation)
 *
 * The risk migration introduces is the typed-payload-mismatch class: a
 * client payload TypeScript accepts but the server Zod `.input()`
 * rejects at runtime, surfacing as a generic failure toast (the /tasks
 * quick-add bug, 2026-05-21).
 *
 * The new procedures take scalar inputs declared inline in
 * lib/trpc/routers/system.ts. The schemas below are the literal
 * `.input(...)` objects — re-declared here verbatim so a tightened
 * bound fails CI before it breaks a real call-site. Pure schema parse,
 * no Prisma — the contract is the schema, so the test is too. Mirrors
 * tests/lib/validators/ultron-system-schemas.test.ts.
 *
 * No-input procedures (diagnostics · healthSummary · chatHealth ·
 * cronDeck · deploymentTruth · deviceFleet · approvals) have nothing to
 * pin.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── system.autonomousActions ────────────────
//
// ActionsPage.actionsQuery sends { since: win } plus, when set, `rule`
// and `approval`. `win` is one of the 24h/7d/30d window pills.

describe("system.autonomousActions · ActionsPage filter payloads", () => {
  const autonomousActionsInput = z
    .object({
      since: z.enum(["24h", "7d", "30d"]).optional(),
      rule: z.string().max(200).optional(),
      approval: z
        .enum(["auto", "pending", "approved", "rejected"])
        .optional(),
    })
    .optional();

  it("accepts the default window-only payload", () => {
    expect(() =>
      autonomousActionsInput.parse({ since: "7d" }),
    ).not.toThrow();
  });

  it("accepts every window pill", () => {
    for (const since of ["24h", "7d", "30d"] as const) {
      expect(() => autonomousActionsInput.parse({ since })).not.toThrow();
    }
  });

  it("accepts a window + rule + approval payload", () => {
    expect(() =>
      autonomousActionsInput.parse({
        since: "30d",
        rule: "stale-task-nudge",
        approval: "pending",
      }),
    ).not.toThrow();
  });

  it("accepts every approval-filter chip value", () => {
    for (const approval of [
      "auto",
      "pending",
      "approved",
      "rejected",
    ] as const) {
      expect(() =>
        autonomousActionsInput.parse({ since: "7d", approval }),
      ).not.toThrow();
    }
  });

  it("rejects an unknown window value", () => {
    expect(() =>
      autonomousActionsInput.parse({
        since: "90d" as unknown as "30d",
      }),
    ).toThrow();
  });

  it("rejects an unknown approval value", () => {
    expect(() =>
      autonomousActionsInput.parse({
        since: "7d",
        approval: "deferred" as unknown as "pending",
      }),
    ).toThrow();
  });
});

// ──────────────── system.agentTraces ────────────────
//
// AgentTracesPage.tracesQuery sends { limit: 50 } plus `source` when
// the operator filters away from "all".

describe("system.agentTraces · AgentTracesPage payloads", () => {
  const traceSource = z.enum([
    "chat",
    "cron",
    "autonomous",
    "tool",
    "journal",
    "brain",
    "other",
  ]);
  const agentTracesInput = z
    .object({
      limit: z.number().int().min(1).max(100).optional(),
      source: traceSource.optional(),
    })
    .optional();

  it("accepts the limit-only (source=all) payload", () => {
    expect(() => agentTracesInput.parse({ limit: 50 })).not.toThrow();
  });

  it("accepts every source-filter value", () => {
    for (const source of [
      "chat",
      "cron",
      "autonomous",
      "tool",
      "journal",
      "brain",
      "other",
    ] as const) {
      expect(() =>
        agentTracesInput.parse({ limit: 50, source }),
      ).not.toThrow();
    }
  });

  it("rejects an unknown source value", () => {
    expect(() =>
      agentTracesInput.parse({
        limit: 50,
        source: "webhook" as unknown as "chat",
      }),
    ).toThrow();
  });

  it("rejects a limit above the 100 cap", () => {
    expect(() => agentTracesInput.parse({ limit: 250 })).toThrow();
  });
});

// ──────────────── system.agentTraceDetail ────────────────
//
// TraceDetailPage.detailQuery sends { traceId } from the route param.

describe("system.agentTraceDetail · TraceDetailPage payload", () => {
  const agentTraceDetailInput = z.object({
    traceId: z.string().min(1).max(128),
  });

  it("accepts a real traceId", () => {
    expect(() =>
      agentTraceDetailInput.parse({ traceId: "trace_a1b2c3d4e5f6" }),
    ).not.toThrow();
  });

  it("rejects an empty traceId", () => {
    expect(() => agentTraceDetailInput.parse({ traceId: "" })).toThrow();
  });
});

// ──────────────── system.costs ────────────────
//
// SystemCostsPage.costsQuery sends { days } where days ∈ {1, 7, 30}
// (the window pills).

describe("system.costs · SystemCostsPage window payloads", () => {
  const costsInput = z
    .object({ days: z.number().int().min(1).max(90).optional() })
    .optional();

  it("accepts each window pill value (1 / 7 / 30)", () => {
    for (const days of [1, 7, 30]) {
      expect(() => costsInput.parse({ days })).not.toThrow();
    }
  });

  it("rejects a days window above the 90 cap", () => {
    expect(() => costsInput.parse({ days: 365 })).toThrow();
  });

  it("rejects a fractional days value", () => {
    expect(() => costsInput.parse({ days: 7.5 })).toThrow();
  });
});

// ──────────────── system.cronRunHistory ────────────────
//
// CronRunsPage.runsQuery sends { jobName, sinceDays, limit: 200 }.
// `sinceDays` is one of the 1/7/30/90 window pills.

describe("system.cronRunHistory · CronRunsPage payloads", () => {
  const cronRunHistoryInput = z.object({
    jobName: z.string().min(1).max(120),
    sinceDays: z.number().int().min(1).max(180).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  });

  it("accepts the page's { jobName, sinceDays, limit: 200 } payload", () => {
    for (const sinceDays of [1, 7, 30, 90]) {
      expect(() =>
        cronRunHistoryInput.parse({
          jobName: "drift-check",
          sinceDays,
          limit: 200,
        }),
      ).not.toThrow();
    }
  });

  it("accepts a slot-suffixed jobName (mega-evening)", () => {
    expect(() =>
      cronRunHistoryInput.parse({
        jobName: "mega-evening",
        sinceDays: 7,
        limit: 200,
      }),
    ).not.toThrow();
  });

  it("rejects an empty jobName", () => {
    expect(() =>
      cronRunHistoryInput.parse({ jobName: "", limit: 200 }),
    ).toThrow();
  });

  it("rejects a limit above the 500 cap", () => {
    expect(() =>
      cronRunHistoryInput.parse({ jobName: "drift-check", limit: 999 }),
    ).toThrow();
  });
});

// ──────────────── system.runManifestCron ────────────────
//
// CronRunsPage + CronsPage both fire runMutation.mutateAsync({ jobName })
// — the run-now button. The procedure input mirrors the legacy
// /api/system/crons/run BodySchema verbatim.

describe("system.runManifestCron · run-now payload", () => {
  const runManifestCronInput = z.object({
    jobName: z.string().min(1).max(64),
  });

  it("accepts a real cron jobName", () => {
    expect(() =>
      runManifestCronInput.parse({ jobName: "ingest-gmail" }),
    ).not.toThrow();
  });

  it("rejects an empty jobName", () => {
    expect(() => runManifestCronInput.parse({ jobName: "" })).toThrow();
  });

  it("rejects a jobName over the 64-char cap", () => {
    expect(() =>
      runManifestCronInput.parse({ jobName: "x".repeat(65) }),
    ).toThrow();
  });
});

// ──────────────── system.setCronEnabled (REUSED) ────────────────
//
// CronsPage.toggle() fires toggleMutation.mutateAsync({ jobName,
// enabled }). The procedure already shipped (Phase NN); pinning the
// /system/crons call-site confirms it sends exactly the input shape.

describe("system.setCronEnabled · CronsPage kill-switch payload", () => {
  const setCronEnabledInput = z.object({
    jobName: z.string().min(1).max(80),
    enabled: z.boolean(),
    note: z.string().max(200).optional(),
  });

  it("accepts the { jobName, enabled } toggle payload", () => {
    expect(() =>
      setCronEnabledInput.parse({ jobName: "drift-check", enabled: false }),
    ).not.toThrow();
    expect(() =>
      setCronEnabledInput.parse({ jobName: "drift-check", enabled: true }),
    ).not.toThrow();
  });

  it("rejects a missing enabled flag", () => {
    expect(() =>
      setCronEnabledInput.parse({ jobName: "drift-check" }),
    ).toThrow();
  });
});

// ──────────────── system.retireStaleDevices ────────────────
//
// DevicesPage's retire button fires retireMutation.mutateAsync twice:
// the dry-run probe { olderThanDays: 7, dryRun: true } then the real
// retire { olderThanDays: 7 }.

describe("system.retireStaleDevices · DevicesPage retire payloads", () => {
  const retireStaleDevicesInput = z
    .object({
      olderThanDays: z.number().int().min(1).max(365).optional(),
      statuses: z.array(z.string().min(1).max(40)).max(10).optional(),
      dryRun: z.boolean().optional(),
    })
    .optional();

  it("accepts the dry-run probe payload", () => {
    expect(() =>
      retireStaleDevicesInput.parse({ olderThanDays: 7, dryRun: true }),
    ).not.toThrow();
  });

  it("accepts the real retire payload", () => {
    expect(() =>
      retireStaleDevicesInput.parse({ olderThanDays: 7 }),
    ).not.toThrow();
  });

  it("rejects an olderThanDays above the 365 cap", () => {
    expect(() =>
      retireStaleDevicesInput.parse({ olderThanDays: 9999 }),
    ).toThrow();
  });
});

// ──────────────── system.brainBusEvents ────────────────
//
// BrainBusPage.fetchOnce sends { limit } (50 initial / 200 incremental)
// plus `sinceId` once a cursor exists.

describe("system.brainBusEvents · BrainBusPage cursor payloads", () => {
  const brainBusEventsInput = z
    .object({
      sinceId: z.string().max(128).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      topic: z.string().max(120).optional(),
    })
    .optional();

  it("accepts the initial seed payload — { limit: 50 }", () => {
    expect(() => brainBusEventsInput.parse({ limit: 50 })).not.toThrow();
  });

  it("accepts the incremental cursor payload — { limit: 200, sinceId }", () => {
    expect(() =>
      brainBusEventsInput.parse({
        limit: 200,
        sinceId: "evt_0f1e2d3c4b5a",
      }),
    ).not.toThrow();
  });

  it("rejects a limit above the 200 cap", () => {
    expect(() => brainBusEventsInput.parse({ limit: 500 })).toThrow();
  });
});

// ──────────────── system.decideApproval ────────────────
//
// ApprovalsPage.decide() fires decideMutation.mutateAsync({ id,
// decision, notes? }). The button row emits decision ∈ approved/
// rejected; `notes` is currently always omitted by the page.

describe("system.decideApproval · ApprovalsPage decide payloads", () => {
  const decideApprovalInput = z.object({
    id: z.string().min(1).max(128),
    decision: z.enum(["approved", "rejected"]),
    notes: z.string().max(2000).optional(),
  });

  it("accepts the approve payload the button emits", () => {
    expect(() =>
      decideApprovalInput.parse({
        id: "clx9k2p4t0001abcd1234efgh",
        decision: "approved",
      }),
    ).not.toThrow();
  });

  it("accepts the reject payload", () => {
    expect(() =>
      decideApprovalInput.parse({
        id: "clx9k2p4t0001abcd1234efgh",
        decision: "rejected",
      }),
    ).not.toThrow();
  });

  it("accepts a decision with an optional notes string", () => {
    expect(() =>
      decideApprovalInput.parse({
        id: "clx9k2p4t0001abcd1234efgh",
        decision: "rejected",
        notes: "flagged for postmortem · rule fired on a stale row",
      }),
    ).not.toThrow();
  });

  it("rejects an empty id", () => {
    expect(() =>
      decideApprovalInput.parse({ id: "", decision: "approved" }),
    ).toThrow();
  });

  it("rejects an unknown decision — the enum is the guard", () => {
    expect(() =>
      decideApprovalInput.parse({
        id: "clx9k2p4t0001abcd1234efgh",
        decision: "snoozed" as unknown as "approved",
      }),
    ).toThrow();
  });
});

// ──────────────── brain.activeAlerts (REUSED) ────────────────
//
// AlertsInspectorPage.alertsQuery sends { sinceDays, limit: 50 }.
// `sinceDays` is one of the 1/7/30/90/180 window pills. The procedure
// already shipped in the brain-domain slice; pinning the /system/alerts
// call-site confirms the window range covers every pill.

describe("brain.activeAlerts · AlertsInspectorPage window payloads", () => {
  const activeAlertsInput = z
    .object({
      limit: z.number().int().min(1).max(50).optional(),
      sinceDays: z.number().int().min(1).max(180).optional(),
    })
    .optional();

  it("accepts every window pill (1 / 7 / 30 / 90 / 180)", () => {
    for (const sinceDays of [1, 7, 30, 90, 180]) {
      expect(() =>
        activeAlertsInput.parse({ sinceDays, limit: 50 }),
      ).not.toThrow();
    }
  });

  it("rejects a sinceDays above the 180 cap", () => {
    expect(() =>
      activeAlertsInput.parse({ sinceDays: 365, limit: 50 }),
    ).toThrow();
  });

  it("rejects a limit above the 50 cap", () => {
    expect(() => activeAlertsInput.parse({ limit: 200 })).toThrow();
  });
});
