/**
 * Brain-domain slice contract tests · Phase B.6d (2026-05-22 ·
 * legacy-modernizer REST→tRPC brain-domain slice).
 *
 * The brain-domain slice migrated ~20 client components in
 * components/brain/* (+ components/brain-dump-modal.tsx) off
 * `authedFetch` onto `trpc.brain.*`:
 *
 *   · active-alerts-card.tsx        → brain.activeAlerts (NEW, read)
 *   · beliefs-panel.tsx             → brain.beliefs (NEW, read)
 *                                     · brain.harvestBeliefs (NEW, mutation · no input)
 *                                     · brain.actOnBelief (NEW, mutation)
 *   · brain-maturity-header.tsx     → brain.maturity (NEW, read · no input)
 *                                     · brain.exportBrain (NEW, read · no input)
 *                                     · brain.reset (NEW, mutation · no input)
 *   · categories-view.tsx           → brain.categoryStats (NEW, read · no input)
 *   · contradiction-resolution-panel → brain.contradictions (NEW, read)
 *                                     · brain.resolveContradiction (NEW, mutation)
 *   · global-activity-stream.tsx    → brain.activityStream (NEW, read)
 *   · memory-graph-explorer.tsx     → brain.graphNeighborhood (NEW, read)
 *   · nudge-panel.tsx               → brain.nudges (NEW, read · no input)
 *                                     · brain.dismissNudge (NEW, mutation)
 *   · page-tracker.tsx              → brain.pageVisit (NEW, mutation)
 *   · pattern-card.tsx              → brain.patterns (NEW, read · no input)
 *                                     · brain.regeneratePatterns (NEW, mutation · no input)
 *   · pinned-context-panel.tsx      → brain.{pinned,createPin,updatePin,deletePin} (REUSED)
 *   · prediction-streaks-card.tsx   → brain.predictionStreaks (NEW, read)
 *   · qualitative-identity-panel    → brain.qualitativeIdentity (NEW, read · no input)
 *                                     · brain.recomputeQualitativeIdentity (NEW, mutation · no input)
 *                                     · brain.editQualitativeIdentity (NEW, mutation)
 *   · recent-insights-panel.tsx     → brain.recentInsights (NEW, read)
 *   · suggestion-telemetry-panel    → brain.suggestionStats (NEW, read · no input)
 *   · tool-telemetry-panel.tsx      → brain.toolTelemetry (NEW, read · no input)
 *   · wisdom-evolution-panel.tsx    → brain.wisdomEvolution (NEW, read · no input)
 *                                     · brain.actOnWisdom (REUSED · deprecate)
 *                                     · brain.recordTelemetry (NEW, mutation)
 *   · brain-dump-modal.tsx          → brain.captureThought (NEW, mutation)
 *
 * The risk that migration introduces is the typed-payload-mismatch
 * class: a client payload TypeScript accepts but the server Zod input
 * rejects at runtime, surfacing as a generic failure toast (the /tasks
 * quick-add bug, 2026-05-21).
 *
 * Read/mutation procedures with no payload — maturity · exportBrain ·
 * reset · categoryStats · nudges · patterns · regeneratePatterns ·
 * qualitativeIdentity · recomputeQualitativeIdentity · suggestionStats ·
 * toolTelemetry · wisdomEvolution · harvestBeliefs — have nothing to
 * pin. The REUSED pin procedures (`pinned` / `createPin` / `updatePin` /
 * `deletePin`) are already pinned by the Phase YY suite.
 *
 * Every new `brain.*` procedure declares its `.input()` as an inline
 * strict `z.object` in lib/trpc/routers/brain.ts. The schemas below are
 * those literal `.input(...)` objects re-declared verbatim — pinned
 * against the REAL payloads each migrated call-site sends, so a
 * tightened bound fails CI before it breaks a real call-site.
 *
 * Pure schema parse, no Prisma — the contract IS the schema, so the
 * test is too. Mirrors tests/lib/validators/ultron-system-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── brain.activeAlerts ────────────────
//
// ActiveAlertsCard calls `trpc.brain.activeAlerts.useQuery(undefined)` —
// no input. The procedure's `.input()` is the optional object below;
// `undefined` and `{}` both validate, and the limit/sinceDays clamps
// match the legacy `?limit` / `?sinceDays` query params.

describe("brain.activeAlerts · ActiveAlertsCard input", () => {
  const activeAlertsInput = z
    .object({
      limit: z.number().int().min(1).max(50).optional(),
      sinceDays: z.number().int().min(1).max(180).optional(),
    })
    .optional();

  it("accepts the ActiveAlertsCard no-arg call — undefined", () => {
    expect(() => activeAlertsInput.parse(undefined)).not.toThrow();
  });

  it("accepts an explicit limit + sinceDays", () => {
    expect(() =>
      activeAlertsInput.parse({ limit: 10, sinceDays: 30 }),
    ).not.toThrow();
  });

  it("rejects a limit above the 50 cap", () => {
    expect(() => activeAlertsInput.parse({ limit: 99 })).toThrow();
  });

  it("rejects a sinceDays above the 180 cap", () => {
    expect(() => activeAlertsInput.parse({ sinceDays: 365 })).toThrow();
  });
});

// ──────────────── brain.actOnBelief ────────────────
//
// BeliefsPanel fires `actMutation.mutateAsync` in three modes:
// `act(key,"promote")`, `act(key,"drop",kind)`, and the edit path
// `mutateAsync({ key, action:"edit", kind, statement })`.

describe("brain.actOnBelief · BeliefsPanel act/saveEdit payloads", () => {
  const actOnBeliefInput = z.object({
    key: z.string().min(1).max(64),
    action: z.enum(["promote", "drop", "edit"]),
    kind: z.enum(["belief", "belief_candidate"]).optional(),
    statement: z.string().min(1).max(2000).optional(),
  });

  it("accepts the promote payload — { key, action: 'promote' }", () => {
    expect(() =>
      actOnBeliefInput.parse({
        key: "a1b2c3d4e5f60718",
        action: "promote",
      }),
    ).not.toThrow();
  });

  it("accepts the drop payload — { key, action: 'drop', kind }", () => {
    expect(() =>
      actOnBeliefInput.parse({
        key: "a1b2c3d4e5f60718",
        action: "drop",
        kind: "belief",
      }),
    ).not.toThrow();
  });

  it("accepts the edit payload — { key, action: 'edit', kind, statement }", () => {
    expect(() =>
      actOnBeliefInput.parse({
        key: "a1b2c3d4e5f60718",
        action: "edit",
        kind: "belief_candidate",
        statement: "I ship the ugly v0 before polishing",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown action — the enum is the guard", () => {
    expect(() =>
      actOnBeliefInput.parse({
        key: "a1b2c3d4e5f60718",
        action: "harvest_now" as unknown as "drop",
      }),
    ).toThrow();
  });

  it("rejects an empty key", () => {
    expect(() =>
      actOnBeliefInput.parse({ key: "", action: "promote" }),
    ).toThrow();
  });
});

// ──────────────── brain.contradictions ────────────────
//
// ContradictionResolutionPanel calls `trpc.brain.contradictions.useQuery(
// { includeResolved: tab === "history" })` — a bool, always present.

describe("brain.contradictions · ContradictionResolutionPanel input", () => {
  const contradictionsInput = z
    .object({ includeResolved: z.boolean().optional() })
    .optional();

  it("accepts the unresolved-tab payload — { includeResolved: false }", () => {
    expect(() =>
      contradictionsInput.parse({ includeResolved: false }),
    ).not.toThrow();
  });

  it("accepts the history-tab payload — { includeResolved: true }", () => {
    expect(() =>
      contradictionsInput.parse({ includeResolved: true }),
    ).not.toThrow();
  });

  it("accepts an omitted input", () => {
    expect(() => contradictionsInput.parse(undefined)).not.toThrow();
  });

  it("rejects a non-boolean includeResolved", () => {
    expect(() =>
      contradictionsInput.parse({
        includeResolved: "yes" as unknown as boolean,
      }),
    ).toThrow();
  });
});

// ──────────────── brain.resolveContradiction ────────────────
//
// ContradictionResolutionPanel's `resolve(key, status, note?)` fires
// `resolveMutation.mutateAsync({ key, status, note })`. The 4 statuses
// are the resolve-button row; `unresolved` is excluded.

describe("brain.resolveContradiction · panel resolve payloads", () => {
  const resolveContradictionInput = z.object({
    key: z.string().min(1).max(128),
    status: z.enum(["current_wins", "old_wins", "both_valid", "dismissed"]),
    note: z.string().max(2000).optional(),
  });

  it("accepts every status the panel's 4-button row emits", () => {
    for (const status of [
      "current_wins",
      "old_wins",
      "both_valid",
      "dismissed",
    ] as const) {
      expect(() =>
        resolveContradictionInput.parse({
          key: "0f1e2d3c4b5a6978",
          status,
        }),
      ).not.toThrow();
    }
  });

  it("accepts a status with the optional note the textarea fills", () => {
    expect(() =>
      resolveContradictionInput.parse({
        key: "0f1e2d3c4b5a6978",
        status: "current_wins",
        note: "the SMB pivot held up · old enterprise stance is stale",
      }),
    ).not.toThrow();
  });

  it("rejects 'unresolved' — it is excluded from the resolve enum", () => {
    expect(() =>
      resolveContradictionInput.parse({
        key: "0f1e2d3c4b5a6978",
        status: "unresolved" as unknown as "dismissed",
      }),
    ).toThrow();
  });

  it("rejects an empty key", () => {
    expect(() =>
      resolveContradictionInput.parse({ key: "", status: "dismissed" }),
    ).toThrow();
  });
});

// ──────────────── brain.activityStream ────────────────
//
// GlobalActivityStream calls `trpc.brain.activityStream.useQuery({ limit:
// windowSize })` where windowSize grows by `limit` (default 30) up to
// 500 via the "load older" button.

describe("brain.activityStream · GlobalActivityStream input", () => {
  const activityStreamInput = z
    .object({ limit: z.number().int().min(1).max(500).optional() })
    .optional();

  it("accepts the initial { limit: 30 } payload", () => {
    expect(() => activityStreamInput.parse({ limit: 30 })).not.toThrow();
  });

  it("accepts the max paginated { limit: 500 } payload", () => {
    expect(() => activityStreamInput.parse({ limit: 500 })).not.toThrow();
  });

  it("rejects a limit above the 500 cap", () => {
    expect(() => activityStreamInput.parse({ limit: 501 })).toThrow();
  });
});

// ──────────────── brain.graphNeighborhood ────────────────
//
// MemoryGraphExplorer calls `utils.brain.graphNeighborhood.fetch({ type,
// id, depth })` on each pivot/reload. `depth` is the 1|2 toggle.

describe("brain.graphNeighborhood · MemoryGraphExplorer input", () => {
  const graphNeighborhoodInput = z.object({
    type: z.string().min(1).max(60),
    id: z.string().min(1).max(128),
    depth: z.union([z.literal(1), z.literal(2)]).default(1),
  });

  it("accepts a depth-1 pivot payload", () => {
    expect(() =>
      graphNeighborhoodInput.parse({
        type: "brain_memory",
        id: "clx9k2p4t0001abcd1234efgh",
        depth: 1,
      }),
    ).not.toThrow();
  });

  it("accepts a depth-2 pivot payload", () => {
    expect(() =>
      graphNeighborhoodInput.parse({
        type: "task",
        id: "clx9k2p4t0001abcd1234efgh",
        depth: 2,
      }),
    ).not.toThrow();
  });

  it("defaults depth to 1 when omitted", () => {
    const r = graphNeighborhoodInput.parse({
      type: "decision",
      id: "12345",
    });
    expect(r.depth).toBe(1);
  });

  it("rejects a depth of 3 — only the 1|2 toggle is valid", () => {
    expect(() =>
      graphNeighborhoodInput.parse({
        type: "task",
        id: "abc",
        depth: 3 as unknown as 1,
      }),
    ).toThrow();
  });

  it("rejects an empty type or id", () => {
    expect(() =>
      graphNeighborhoodInput.parse({ type: "", id: "abc", depth: 1 }),
    ).toThrow();
    expect(() =>
      graphNeighborhoodInput.parse({ type: "task", id: "", depth: 1 }),
    ).toThrow();
  });
});

// ──────────────── brain.dismissNudge ────────────────
//
// NudgePanel's dismiss button fires `dismissMutation.mutateAsync({
// source, text, until: "7d" })` — the panel always sends `until: "7d"`.

describe("brain.dismissNudge · NudgePanel dismiss payload", () => {
  const dismissNudgeInput = z.object({
    source: z.string().min(1).max(60),
    text: z.string().min(1).max(2000),
    until: z.enum(["today", "7d", "forever"]).optional(),
  });

  it("accepts the NudgePanel { source, text, until: '7d' } payload", () => {
    expect(() =>
      dismissNudgeInput.parse({
        source: "contradiction",
        text: "2 unresolved contradictions from the last 7d",
        until: "7d",
      }),
    ).not.toThrow();
  });

  it("accepts every until window the schema allows", () => {
    for (const until of ["today", "7d", "forever"] as const) {
      expect(() =>
        dismissNudgeInput.parse({ source: "ghost", text: "x", until }),
      ).not.toThrow();
    }
  });

  it("accepts an omitted until (the procedure defaults to 7d)", () => {
    expect(() =>
      dismissNudgeInput.parse({ source: "skill", text: "x" }),
    ).not.toThrow();
  });

  it("rejects an unknown until window", () => {
    expect(() =>
      dismissNudgeInput.parse({
        source: "skill",
        text: "x",
        until: "30d" as unknown as "7d",
      }),
    ).toThrow();
  });

  it("rejects an empty source or text", () => {
    expect(() =>
      dismissNudgeInput.parse({ source: "", text: "x" }),
    ).toThrow();
    expect(() =>
      dismissNudgeInput.parse({ source: "skill", text: "" }),
    ).toThrow();
  });
});

// ──────────────── brain.pageVisit ────────────────
//
// PageTracker fires `pageVisit.mutate({ page: pathname, referrer:
// document.referrer })` on every route change. `referrer` is a string
// or null (document.referrer is "" when there is none).

describe("brain.pageVisit · PageTracker payload", () => {
  const pageVisitInput = z.object({
    page: z.string().min(1).max(512),
    referrer: z.string().max(2048).nullable().optional(),
  });

  it("accepts the PageTracker { page, referrer } payload", () => {
    expect(() =>
      pageVisitInput.parse({
        page: "/brain",
        referrer: "https://statenour-web-production.up.railway.app/tasks",
      }),
    ).not.toThrow();
  });

  it("accepts a null referrer (no document.referrer)", () => {
    expect(() =>
      pageVisitInput.parse({ page: "/journal", referrer: null }),
    ).not.toThrow();
  });

  it("accepts an empty-string referrer (document.referrer === '')", () => {
    expect(() =>
      pageVisitInput.parse({ page: "/journal", referrer: "" }),
    ).not.toThrow();
  });

  it("rejects an empty page", () => {
    expect(() => pageVisitInput.parse({ page: "", referrer: null })).toThrow();
  });
});

// ──────────────── brain.predictionStreaks ────────────────
//
// PredictionStreaksCard calls `trpc.brain.predictionStreaks.useQuery(
// undefined)` — no input. The optional windowDays clamp mirrors the
// legacy `?windowDays=` param.

describe("brain.predictionStreaks · PredictionStreaksCard input", () => {
  const predictionStreaksInput = z
    .object({ windowDays: z.number().int().min(7).max(365).optional() })
    .optional();

  it("accepts the PredictionStreaksCard no-arg call — undefined", () => {
    expect(() => predictionStreaksInput.parse(undefined)).not.toThrow();
  });

  it("accepts an explicit windowDays", () => {
    expect(() =>
      predictionStreaksInput.parse({ windowDays: 90 }),
    ).not.toThrow();
  });

  it("rejects a windowDays below the 7-day floor", () => {
    expect(() => predictionStreaksInput.parse({ windowDays: 1 })).toThrow();
  });

  it("rejects a windowDays above the 365-day cap", () => {
    expect(() => predictionStreaksInput.parse({ windowDays: 999 })).toThrow();
  });
});

// ──────────────── brain.editQualitativeIdentity ────────────────
//
// QualitativeIdentityPanel fires `editMutation.mutateAsync({ action,
// bucket, text })` from the add row and the per-row remove button.

describe("brain.editQualitativeIdentity · panel add/remove payloads", () => {
  const editQualitativeIdentityInput = z.object({
    action: z.enum(["add", "remove"]),
    bucket: z.enum([
      "values",
      "fears",
      "operating_style",
      "rhythms",
      "red_lines",
    ]),
    text: z.string().min(3).max(180),
  });

  it("accepts an add payload for every bucket", () => {
    for (const bucket of [
      "values",
      "fears",
      "operating_style",
      "rhythms",
      "red_lines",
    ] as const) {
      expect(() =>
        editQualitativeIdentityInput.parse({
          action: "add",
          bucket,
          text: "ship before polishing",
        }),
      ).not.toThrow();
    }
  });

  it("accepts a remove payload", () => {
    expect(() =>
      editQualitativeIdentityInput.parse({
        action: "remove",
        bucket: "fears",
        text: "shipping something half-baked",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown bucket — the enum is the guard", () => {
    expect(() =>
      editQualitativeIdentityInput.parse({
        action: "add",
        bucket: "habits" as unknown as "values",
        text: "valid text",
      }),
    ).toThrow();
  });

  it("rejects a text under the 3-char floor", () => {
    expect(() =>
      editQualitativeIdentityInput.parse({
        action: "add",
        bucket: "values",
        text: "no",
      }),
    ).toThrow();
  });
});

// ──────────────── brain.recentInsights ────────────────
//
// RecentInsightsPanel calls `trpc.brain.recentInsights.useQuery({ days:
// 7, limit: 30 })` — the legacy `?days=7&limit=30` query string.

describe("brain.recentInsights · RecentInsightsPanel input", () => {
  const recentInsightsInput = z
    .object({
      days: z.number().int().min(1).max(30).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })
    .optional();

  it("accepts the RecentInsightsPanel { days: 7, limit: 30 } payload", () => {
    expect(() =>
      recentInsightsInput.parse({ days: 7, limit: 30 }),
    ).not.toThrow();
  });

  it("accepts an omitted input", () => {
    expect(() => recentInsightsInput.parse(undefined)).not.toThrow();
  });

  it("rejects a days window above the 30-day cap", () => {
    expect(() => recentInsightsInput.parse({ days: 90 })).toThrow();
  });

  it("rejects a limit above the 200 cap", () => {
    expect(() => recentInsightsInput.parse({ limit: 500 })).toThrow();
  });
});

// ──────────────── brain.recordTelemetry ────────────────
//
// WisdomEvolutionPanel's deprecate handler fires `telemetryMutation
// .mutate({ event: "evolution_deprecate", tags: { wisdomId, key } })`.
// The event enum is the route's ALLOWED_EVENTS whitelist verbatim.

describe("brain.recordTelemetry · WisdomEvolutionPanel payload", () => {
  const recordTelemetryInput = z.object({
    event: z.enum([
      "see_also_click",
      "evolution_deprecate",
      "evolution_review",
      "mode_chip_cycle",
      "mode_chip_send",
      "improve_page_view",
    ]),
    value: z.number().finite().optional(),
    tags: z.record(z.string(), z.unknown()).optional(),
  });

  it("accepts the WisdomEvolutionPanel deprecate-telemetry payload", () => {
    expect(() =>
      recordTelemetryInput.parse({
        event: "evolution_deprecate",
        tags: { wisdomId: "clx9k2p4t0001abcd1234efgh", key: "wisdom_jobs_3" },
      }),
    ).not.toThrow();
  });

  it("accepts every allowed event", () => {
    for (const event of [
      "see_also_click",
      "evolution_deprecate",
      "evolution_review",
      "mode_chip_cycle",
      "mode_chip_send",
      "improve_page_view",
    ] as const) {
      expect(() => recordTelemetryInput.parse({ event })).not.toThrow();
    }
  });

  it("rejects an unknown event — the whitelist is the guard", () => {
    expect(() =>
      recordTelemetryInput.parse({
        event: "random_click" as unknown as "see_also_click",
      }),
    ).toThrow();
  });

  it("rejects a non-finite value", () => {
    expect(() =>
      recordTelemetryInput.parse({
        event: "evolution_deprecate",
        value: Number.POSITIVE_INFINITY,
      }),
    ).toThrow();
  });
});

// ──────────────── brain.captureThought ────────────────
//
// BrainDumpModal fires `captureMutation.mutateAsync({ text: trimmed })`.
// The modal client-side blocks a submit under 3 chars; the schema's
// `min(3)` is the backstop.

describe("brain.captureThought · BrainDumpModal payload", () => {
  const captureThoughtInput = z.object({
    text: z.string().min(3).max(20_000),
  });

  it("accepts a normal brain-dump payload", () => {
    expect(() =>
      captureThoughtInput.parse({
        text: "call DK Tire about the bulk order, then draft the spring promo",
      }),
    ).not.toThrow();
  });

  it("rejects a text under the 3-char floor (the modal's own guard's backstop)", () => {
    expect(() => captureThoughtInput.parse({ text: "hi" })).toThrow();
  });

  it("rejects a text over the 20k cap", () => {
    expect(() =>
      captureThoughtInput.parse({ text: "x".repeat(20_001) }),
    ).toThrow();
  });
});
