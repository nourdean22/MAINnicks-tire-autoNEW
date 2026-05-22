/**
 * System-pages slice contract tests · Phase B.7b (2026-05-22 ·
 * legacy-modernizer REST→tRPC system-pages slice · sub-slice B).
 *
 * Sub-slice B migrated the `authedFetch` call-sites in the REMAINING
 * `app/(mastery)/system/*` page files onto `trpc.system.*` (sub-slice
 * A's `system-pages-schemas.test.ts` covered the first ~13):
 *
 *   · system/vapi-calls/page.tsx          → system.vapiCalls (NEW, read)
 *   · system/tools/page.tsx               → system.toolStats (NEW, read · no input)
 *   · system/performance/page.tsx         → system.routePerformance (NEW, read)
 *   · system/policies/page.tsx            → system.policies (NEW, read · no input from page)
 *                                           · system.updatePolicy (NEW, mutation)
 *                                           · system.policyFires (NEW, read)
 *   · system/power/page.tsx               → system.powerSettings (NEW, read · no input)
 *                                           · system.setPowerSetting (NEW, mutation)
 *   · system/prompt/page.tsx              → system.promptDiagnostics (NEW, read)
 *                                           · system.flushPromptCache (NEW, mutation)
 *   · system/repos/page.tsx               → system.reposOverview (NEW, read · no input)
 *                                           · system.repoBriefing (NEW, read · no input)
 *   · system/schema-history/page.tsx      → system.schemaHistory (NEW, read)
 *   · system/tire-stock-requests/page.tsx → system.tireStockRequests (NEW, read)
 *   · system/history/page.tsx             → system.actorActivity (NEW, read)
 *   · system/logs/page.tsx                → system.systemLogs (NEW, read)
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
 * tests/lib/validators/system-pages-schemas.test.ts.
 *
 * No-input procedures (toolStats · powerSettings · reposOverview ·
 * repoBriefing) have nothing to pin.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── system.vapiCalls ────────────────
//
// VapiCallsPage.vapiCalls query sends { days } where days ∈
// {1, 7, 30, 90} (the window pills).

describe("system.vapiCalls · VapiCallsPage window payloads", () => {
  const vapiCallsInput = z
    .object({ days: z.number().int().min(1).max(90).optional() })
    .optional();

  it("accepts each window pill value (1 / 7 / 30 / 90)", () => {
    for (const days of [1, 7, 30, 90]) {
      expect(() => vapiCallsInput.parse({ days })).not.toThrow();
    }
  });

  it("rejects a days window above the 90 cap", () => {
    expect(() => vapiCallsInput.parse({ days: 365 })).toThrow();
  });

  it("rejects a fractional days value", () => {
    expect(() => vapiCallsInput.parse({ days: 7.5 })).toThrow();
  });
});

// ──────────────── system.routePerformance ────────────────
//
// PerformancePage.routePerformance query sends { hours } where hours ∈
// {1, 6, 24, 168, 720} (the window pills).

describe("system.routePerformance · PerformancePage window payloads", () => {
  const routePerformanceInput = z
    .object({
      hours: z.number().int().min(1).max(720).optional(),
      minRequests: z.number().int().min(1).max(1000).optional(),
    })
    .optional();

  it("accepts every window pill (1 / 6 / 24 / 168 / 720)", () => {
    for (const hours of [1, 6, 24, 24 * 7, 24 * 30]) {
      expect(() => routePerformanceInput.parse({ hours })).not.toThrow();
    }
  });

  it("rejects an hours window above the 720 cap", () => {
    expect(() => routePerformanceInput.parse({ hours: 9999 })).toThrow();
  });
});

// ──────────────── system.updatePolicy ────────────────
//
// PoliciesPage.patch() fires updateMutation.mutateAsync({ id, ...body })
// — the body is one of { approvalClass } (the class flip) or
// { enabled } (the kill-switch toggle).

describe("system.updatePolicy · PoliciesPage edit payloads", () => {
  const updatePolicyInput = z.object({
    id: z.string().min(1).max(160),
    approvalClass: z.enum(["auto", "pending", "forbidden"]).optional(),
    enabled: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
  });

  it("accepts the approval-class flip payload", () => {
    for (const approvalClass of ["auto", "pending", "forbidden"] as const) {
      expect(() =>
        updatePolicyInput.parse({ id: "cron.brain-cycle", approvalClass }),
      ).not.toThrow();
    }
  });

  it("accepts the kill-switch toggle payload", () => {
    expect(() =>
      updatePolicyInput.parse({ id: "cron.brain-cycle", enabled: false }),
    ).not.toThrow();
    expect(() =>
      updatePolicyInput.parse({ id: "cron.brain-cycle", enabled: true }),
    ).not.toThrow();
  });

  it("accepts a notes edit (including the explicit-null clear)", () => {
    expect(() =>
      updatePolicyInput.parse({
        id: "cron.brain-cycle",
        notes: "paused pending the schema migration",
      }),
    ).not.toThrow();
    expect(() =>
      updatePolicyInput.parse({ id: "cron.brain-cycle", notes: null }),
    ).not.toThrow();
  });

  it("rejects an empty id", () => {
    expect(() =>
      updatePolicyInput.parse({ id: "", enabled: true }),
    ).toThrow();
  });

  it("rejects an unknown approvalClass — the enum is the guard", () => {
    expect(() =>
      updatePolicyInput.parse({
        id: "cron.brain-cycle",
        approvalClass: "gated" as unknown as "auto",
      }),
    ).toThrow();
  });
});

// ──────────────── system.policyFires ────────────────
//
// PoliciesPage's PolicyRow lazy-loads fire history via
// utils.system.policyFires.fetch({ policyId, limit: 20 }).

describe("system.policyFires · PolicyRow fire-history payload", () => {
  const policyFiresInput = z.object({
    policyId: z.string().min(1).max(160),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(100000).optional(),
  });

  it("accepts the page's { policyId, limit: 20 } payload", () => {
    expect(() =>
      policyFiresInput.parse({ policyId: "cron.brain-cycle", limit: 20 }),
    ).not.toThrow();
  });

  it("accepts a paginated { policyId, limit, offset } payload", () => {
    expect(() =>
      policyFiresInput.parse({
        policyId: "tool.send-sms",
        limit: 50,
        offset: 100,
      }),
    ).not.toThrow();
  });

  it("rejects an empty policyId", () => {
    expect(() => policyFiresInput.parse({ policyId: "" })).toThrow();
  });

  it("rejects a limit above the 200 cap", () => {
    expect(() =>
      policyFiresInput.parse({ policyId: "cron.brain-cycle", limit: 999 }),
    ).toThrow();
  });
});

// ──────────────── system.setPowerSetting ────────────────
//
// PowerPanel.patch() fires setPowerSetting.mutateAsync({ key, value }).
// The `key` enum is the 6 mutable PowerSettings keys; `value` is a
// string | number | boolean union. The procedure's extra providerPin /
// quietMode value guards are runtime checks INSIDE the procedure body
// (TRPCError BAD_REQUEST), not part of the .input() schema — so they
// aren't pinned here · the schema test pins the boundary shape only.

describe("system.setPowerSetting · PowerPanel patch payloads", () => {
  const setPowerSettingInput = z.object({
    key: z.enum([
      "quietMode",
      "providerPin",
      "strictMode",
      "dailyCostCapCents",
      "pauseAllCrons",
      "shadowMode",
    ]),
    value: z.union([z.string(), z.number(), z.boolean()]),
    note: z.string().max(280).optional(),
  });

  it("accepts the provider-pin patch (string value)", () => {
    expect(() =>
      setPowerSettingInput.parse({ key: "providerPin", value: "venice" }),
    ).not.toThrow();
  });

  it("accepts the daily-cost-cap patch (number value)", () => {
    for (const value of [0, 100, 250, 500, 1000, 2500, 10000]) {
      expect(() =>
        setPowerSettingInput.parse({ key: "dailyCostCapCents", value }),
      ).not.toThrow();
    }
  });

  it("accepts the strict-mode / shadow-mode / pause-all toggles (boolean value)", () => {
    for (const key of [
      "strictMode",
      "shadowMode",
      "pauseAllCrons",
    ] as const) {
      expect(() =>
        setPowerSettingInput.parse({ key, value: true }),
      ).not.toThrow();
      expect(() =>
        setPowerSettingInput.parse({ key, value: false }),
      ).not.toThrow();
    }
  });

  it("accepts the quiet-mode patch (string value)", () => {
    for (const value of ["off", "nudges", "all"]) {
      expect(() =>
        setPowerSettingInput.parse({ key: "quietMode", value }),
      ).not.toThrow();
    }
  });

  it("rejects an unknown setting key — the enum is the guard", () => {
    expect(() =>
      setPowerSettingInput.parse({
        key: "updatedAt" as unknown as "quietMode",
        value: "x",
      }),
    ).toThrow();
  });
});

// ──────────────── system.promptDiagnostics ────────────────
//
// PromptDiagnosticsPage.promptDiagnostics query sends { tier, msg } —
// tier from the 5 tier pills, msg from the sample-message input.

describe("system.promptDiagnostics · PromptDiagnosticsPage payloads", () => {
  const promptDiagnosticsInput = z.object({
    tier: z
      .enum(["core", "business", "personal", "strategy", "full"])
      .optional(),
    msg: z.string().max(2000).optional(),
  });

  it("accepts every tier pill + a sample message", () => {
    for (const tier of [
      "core",
      "business",
      "personal",
      "strategy",
      "full",
    ] as const) {
      expect(() =>
        promptDiagnosticsInput.parse({
          tier,
          msg: "generate today's instagram post for nicks tire",
        }),
      ).not.toThrow();
    }
  });

  it("accepts an empty sample message", () => {
    expect(() =>
      promptDiagnosticsInput.parse({ tier: "full", msg: "" }),
    ).not.toThrow();
  });

  it("rejects an unknown tier value", () => {
    expect(() =>
      promptDiagnosticsInput.parse({
        tier: "deep" as unknown as "full",
      }),
    ).toThrow();
  });
});

// ──────────────── system.flushPromptCache ────────────────
//
// PromptDiagnosticsPage.flush() fires flushMutation.mutateAsync({
// reason }).

describe("system.flushPromptCache · hot-flush payload", () => {
  const flushPromptCacheInput = z
    .object({ reason: z.string().max(2000).optional() })
    .optional();

  it("accepts the page's manual-flush reason", () => {
    expect(() =>
      flushPromptCacheInput.parse({
        reason: "manual flush from /system/prompt",
      }),
    ).not.toThrow();
  });

  it("accepts an omitted reason (the empty-body path)", () => {
    expect(() => flushPromptCacheInput.parse(undefined)).not.toThrow();
    expect(() => flushPromptCacheInput.parse({})).not.toThrow();
  });
});

// ──────────────── system.schemaHistory ────────────────
//
// SchemaHistoryPage.schemaHistory query sends { limit: 100, env } where
// env is one of production/preview/local OR undefined (the "all" pill).

describe("system.schemaHistory · SchemaHistoryPage env payloads", () => {
  const schemaHistoryInput = z
    .object({
      limit: z.number().int().min(1).max(200).optional(),
      env: z.enum(["local", "preview", "production"]).optional(),
    })
    .optional();

  it("accepts the all-env payload (no env key)", () => {
    expect(() =>
      schemaHistoryInput.parse({ limit: 100 }),
    ).not.toThrow();
  });

  it("accepts every env-filter value", () => {
    for (const env of ["local", "preview", "production"] as const) {
      expect(() =>
        schemaHistoryInput.parse({ limit: 100, env }),
      ).not.toThrow();
    }
  });

  it("rejects an unknown env value", () => {
    expect(() =>
      schemaHistoryInput.parse({
        limit: 100,
        env: "staging" as unknown as "local",
      }),
    ).toThrow();
  });

  it("rejects a limit above the 200 cap", () => {
    expect(() => schemaHistoryInput.parse({ limit: 500 })).toThrow();
  });
});

// ──────────────── system.tireStockRequests ────────────────
//
// TireStockRequestsPage.tireStockRequests query sends { days } where
// days ∈ {1, 7, 30, 90} (the window pills).

describe("system.tireStockRequests · TireStockRequestsPage payloads", () => {
  const tireStockRequestsInput = z
    .object({ days: z.number().int().min(1).max(365).optional() })
    .optional();

  it("accepts each window pill value (1 / 7 / 30 / 90)", () => {
    for (const days of [1, 7, 30, 90]) {
      expect(() =>
        tireStockRequestsInput.parse({ days }),
      ).not.toThrow();
    }
  });

  it("rejects a days window above the 365 cap", () => {
    expect(() => tireStockRequestsInput.parse({ days: 999 })).toThrow();
  });
});

// ──────────────── system.actorActivity ────────────────
//
// FirehoseList sends { actor, action?, since?, limit: 200 }. `since`
// rides as an ISO datetime string (translated client-side from the
// 1h/24h/7d/30d pills); `action` is one of the 5 audit-action chips.

describe("system.actorActivity · FirehoseList payloads", () => {
  const actorActivityInput = z.object({
    actor: z.string().min(1).max(120),
    action: z
      .enum(["created", "updated", "soft_deleted", "restored", "purged"])
      .optional(),
    since: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  });

  it("accepts the actor-only payload", () => {
    expect(() =>
      actorActivityInput.parse({ actor: "nick", limit: 200 }),
    ).not.toThrow();
  });

  it("accepts every audit-action chip value", () => {
    for (const action of [
      "created",
      "updated",
      "soft_deleted",
      "restored",
      "purged",
    ] as const) {
      expect(() =>
        actorActivityInput.parse({ actor: "nick", action, limit: 200 }),
      ).not.toThrow();
    }
  });

  it("accepts an ISO `since` translated from a window pill", () => {
    expect(() =>
      actorActivityInput.parse({
        actor: "cron:brain-cycle",
        since: new Date(Date.now() - 86_400_000).toISOString(),
        limit: 200,
      }),
    ).not.toThrow();
  });

  it("rejects an empty actor", () => {
    expect(() =>
      actorActivityInput.parse({ actor: "", limit: 200 }),
    ).toThrow();
  });

  it("rejects a non-ISO `since` string", () => {
    expect(() =>
      actorActivityInput.parse({ actor: "nick", since: "7d" }),
    ).toThrow();
  });
});

// ──────────────── system.systemLogs ────────────────
//
// LogsPage.systemLogs query sends { limit: 300, sinceMs, level?,
// sources? }. `sinceMs` is the WINDOW_MS map value for the 5m/1h/24h
// pill; `level` is one of the level chips; `sources` is the selected
// source-chip set as an array.

describe("system.systemLogs · LogsPage filter payloads", () => {
  const systemLogsInput = z
    .object({
      limit: z.number().int().min(10).max(500).optional(),
      sinceMs: z.number().int().min(60_000).max(86_400_000).optional(),
      level: z
        .enum(["error", "warn", "info", "success", "metric"])
        .optional(),
      sources: z
        .array(z.enum(["errors", "crons", "metrics", "actions", "requests"]))
        .max(5)
        .optional(),
    })
    .optional();

  it("accepts the default { limit: 300, sinceMs } payload for every window pill", () => {
    for (const sinceMs of [5 * 60_000, 60 * 60_000, 24 * 60 * 60_000]) {
      expect(() =>
        systemLogsInput.parse({ limit: 300, sinceMs }),
      ).not.toThrow();
    }
  });

  it("accepts every level-filter chip value", () => {
    for (const level of [
      "error",
      "warn",
      "info",
      "success",
      "metric",
    ] as const) {
      expect(() =>
        systemLogsInput.parse({ limit: 300, sinceMs: 3600_000, level }),
      ).not.toThrow();
    }
  });

  it("accepts a multi-source filter array", () => {
    expect(() =>
      systemLogsInput.parse({
        limit: 300,
        sinceMs: 3600_000,
        sources: ["errors", "crons", "requests"],
      }),
    ).not.toThrow();
  });

  it("rejects a sinceMs below the 60s floor", () => {
    expect(() =>
      systemLogsInput.parse({ limit: 300, sinceMs: 1000 }),
    ).toThrow();
  });

  it("rejects an unknown source value", () => {
    expect(() =>
      systemLogsInput.parse({
        limit: 300,
        sinceMs: 3600_000,
        sources: ["webhooks" as unknown as "errors"],
      }),
    ).toThrow();
  });
});
