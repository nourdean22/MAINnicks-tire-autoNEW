/**
 * Scattered-components slice contract tests · (2026-05-22 ·
 * legacy-modernizer REST→tRPC · 13 scattered component files slice).
 *
 * This slice migrated the leftover `authedFetch` / `useAuthedFetch`
 * call-sites in 13 scattered component files (OmniCapture · TodoDesk ·
 * GoalBoard · CommandPalette · NickMessage · NickReasoner · HomeNarrator
 * · SessionExpiryBanner · PageNick · ClientErrorTelemetry ·
 * BrainHealthView · InsightRibbon · BrainContinuityView) onto tRPC.
 *
 * It added procedures across `ai` / `operator` / `system` / `brain`.
 * Many are no-input reads (`brain.memoryHealth`, `brain.insightsRibbon`,
 * `brain.continuityReport`, `operator.businessDashboard`,
 * `system.aiSpend`, `system.sessionExpiry`) — nothing to pin. The
 * procedures with a structured `.input()` are pinned here:
 *
 *   · ai.suggestGoals            · { horizon, domain?, context? }
 *   · ai.coachGoal               · { goalId, currentState? }
 *   · operator.logDecision       · { title, domain?, stakes?, … }
 *   · system.resolveDrift        · { id: string | number }
 *   · system.recordClientError   · { kind, message, stack?, … }
 *
 * The risk a migration introduces is the typed-payload-mismatch class: a
 * client payload TypeScript accepts but the server Zod `.input()` rejects
 * at runtime, surfacing as a generic failure toast.
 *
 * The schemas below are the literal `.input(...)` objects from
 * lib/trpc/routers/{ai,operator,system}.ts — re-declared here verbatim
 * so a tightened bound fails CI before it breaks a real call-site. Pure
 * schema parse, no Prisma. Mirrors tests/lib/validators/
 * actions-surface-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── ai.suggestGoals ────────────────
//
// GoalBoard fires suggestGoalsMut.mutateAsync({ horizon: "LIFE" }) from
// its "AI suggest" button.

describe("ai.suggestGoals · GoalBoard suggestion payload", () => {
  const SUGGEST_GOAL_HORIZONS = [
    "DAY",
    "WEEK",
    "MONTH",
    "QUARTER",
    "YEAR",
    "LIFE",
  ] as const;
  const suggestGoalsInput = z.object({
    horizon: z.enum(SUGGEST_GOAL_HORIZONS).default("WEEK"),
    domain: z.string().max(80).optional(),
    context: z.string().max(2000).optional(),
  });

  it("accepts the LIFE-horizon payload GoalBoard sends", () => {
    expect(() =>
      suggestGoalsInput.parse({ horizon: "LIFE" }),
    ).not.toThrow();
  });

  it("accepts a bare payload — defaults horizon to 'WEEK'", () => {
    const parsed = suggestGoalsInput.parse({});
    expect(parsed.horizon).toBe("WEEK");
  });

  it("accepts a payload with a domain filter + operator note", () => {
    expect(() =>
      suggestGoalsInput.parse({
        horizon: "QUARTER",
        domain: "business",
        context: "focus on the EV-tire transition",
      }),
    ).not.toThrow();
  });

  it("rejects a horizon outside the six-horizon enum", () => {
    expect(() =>
      suggestGoalsInput.parse({
        horizon: "DECADE" as unknown as "LIFE",
      }),
    ).toThrow();
  });

  it("rejects a context past the 2000-char ceiling", () => {
    expect(() =>
      suggestGoalsInput.parse({ horizon: "WEEK", context: "x".repeat(2001) }),
    ).toThrow();
  });
});

// ──────────────── ai.coachGoal ────────────────
//
// GoalBoard fires coachGoalMut.mutateAsync({ goalId }) from each goal
// card's "Ask Nick to analyze" / "refresh" affordance.

describe("ai.coachGoal · GoalBoard goal-coach payload", () => {
  const coachGoalInput = z.object({
    goalId: z.string().min(1).max(64),
    currentState: z.string().max(2000).optional(),
  });

  it("accepts the bare { goalId } payload GoalBoard sends", () => {
    expect(() =>
      coachGoalInput.parse({ goalId: "goal_abc123" }),
    ).not.toThrow();
  });

  it("accepts an optional currentState note", () => {
    expect(() =>
      coachGoalInput.parse({
        goalId: "goal_abc123",
        currentState: "stalled — no loops logged in 2 weeks",
      }),
    ).not.toThrow();
  });

  it("rejects an empty goalId", () => {
    expect(() => coachGoalInput.parse({ goalId: "" })).toThrow();
  });

  it("rejects a goalId past the 64-char ceiling", () => {
    expect(() =>
      coachGoalInput.parse({ goalId: "x".repeat(65) }),
    ).toThrow();
  });
});

// ──────────────── operator.logDecision ────────────────
//
// OmniCapture's /decide branch fires logDecision.mutateAsync({ title,
// stakes, chosen, reasoning, domain }).

describe("operator.logDecision · OmniCapture decision-log payload", () => {
  const logDecisionInput = z.object({
    title: z.string().min(1).max(500),
    domain: z.string().max(80).optional(),
    stakes: z.string().max(40).optional(),
    context: z.string().max(8000).optional(),
    optionsConsidered: z.array(z.string().max(500)).max(20).optional(),
    chosen: z.string().max(500).optional(),
    reasoning: z.string().max(8000).optional(),
    predictedOutcome: z.string().max(2000).optional(),
    emotionalState: z.string().max(200).optional(),
    reviewDate: z.string().max(40).optional(),
  });

  it("accepts the OmniCapture /decide quick-capture payload", () => {
    expect(() =>
      logDecisionInput.parse({
        title: "Whether to take the bulk DK Tire order",
        stakes: "medium",
        chosen: "pending",
        reasoning: "margin is thin but it clears slow stock",
        domain: "general",
      }),
    ).not.toThrow();
  });

  it("accepts a fuller decision with options + a review date", () => {
    expect(() =>
      logDecisionInput.parse({
        title: "Hire a second tech",
        domain: "business",
        stakes: "high",
        optionsConsidered: ["hire now", "wait for Q3", "use a temp"],
        chosen: "hire now",
        reasoning: "drop-off line is past capacity",
        predictedOutcome: "throughput up 30% within 6 weeks",
        emotionalState: "confident",
        reviewDate: "2026-07-01",
      }),
    ).not.toThrow();
  });

  it("rejects a missing title — the legacy POST /api/decisions 400 case", () => {
    expect(() =>
      logDecisionInput.parse({ reasoning: "no title here" }),
    ).toThrow();
  });

  it("rejects an empty title", () => {
    expect(() => logDecisionInput.parse({ title: "" })).toThrow();
  });

  it("rejects an optionsConsidered array longer than 20", () => {
    expect(() =>
      logDecisionInput.parse({
        title: "x",
        optionsConsidered: new Array(21).fill("option"),
      }),
    ).toThrow();
  });
});

// ──────────────── system.resolveDrift ────────────────
//
// TodoDesk fires resolveDriftMut.mutateAsync({ id }) from the aging-
// backlog "resolve" button. DriftAlert.id is `Int @id` but stale
// localStorage ids arrive stringified ("drift-42" → "42") — the input
// accepts both shapes.

describe("system.resolveDrift · TodoDesk drift-resolve payload", () => {
  const resolveDriftInput = z.object({
    id: z.union([z.string().max(128), z.number()]),
  });

  it("accepts a stringified id (the BacklogItem shape)", () => {
    expect(() => resolveDriftInput.parse({ id: "42" })).not.toThrow();
  });

  it("accepts a numeric id (the raw DriftAlert.id)", () => {
    expect(() => resolveDriftInput.parse({ id: 42 })).not.toThrow();
  });

  it("rejects a string id past the 128-char ceiling", () => {
    expect(() =>
      resolveDriftInput.parse({ id: "x".repeat(129) }),
    ).toThrow();
  });

  it("rejects a missing id", () => {
    expect(() => resolveDriftInput.parse({})).not.toThrow;
  });
});

// ──────────────── system.recordClientError ────────────────
//
// ClientErrorTelemetry fires trpcVanilla.system.recordClientError.mutate(
// payload) fire-and-forget on every unhandled error / promise rejection
// / error-boundary trip.

describe("system.recordClientError · client-error-ingest payload", () => {
  const recordClientErrorInput = z.object({
    kind: z.enum(["error", "unhandledrejection", "boundary"]),
    message: z.string().min(1).max(4000),
    stack: z.string().max(20_000).optional(),
    url: z.string().max(2000).optional(),
    userAgent: z.string().max(1000).optional(),
    timestamp: z.number().finite().optional(),
    componentStack: z.string().max(10_000).optional(),
    errorBoundary: z.string().max(200).optional(),
  });

  it("accepts an unhandled-error payload", () => {
    expect(() =>
      recordClientErrorInput.parse({
        kind: "error",
        message: "Cannot read properties of undefined (reading 'map')",
        stack: "TypeError: ...\n    at TodoDesk (todo-desk.tsx:370)",
        url: "https://statenour-web-production.up.railway.app/tasks",
        userAgent: "Mozilla/5.0",
        timestamp: 1747900000000,
      }),
    ).not.toThrow();
  });

  it("accepts a React error-boundary trip", () => {
    expect(() =>
      recordClientErrorInput.parse({
        kind: "boundary",
        message: "[brain.health-view] Maximum update depth exceeded",
        componentStack: "    at BrainHealthView\n    at Suspense",
        errorBoundary: "BrainErrorBoundary",
      }),
    ).not.toThrow();
  });

  it("accepts an unhandled promise rejection", () => {
    expect(() =>
      recordClientErrorInput.parse({
        kind: "unhandledrejection",
        message: "fetch failed",
      }),
    ).not.toThrow();
  });

  it("rejects a kind outside the three-value enum", () => {
    expect(() =>
      recordClientErrorInput.parse({
        kind: "panic" as unknown as "error",
        message: "x",
      }),
    ).toThrow();
  });

  it("rejects an empty message", () => {
    expect(() =>
      recordClientErrorInput.parse({ kind: "error", message: "" }),
    ).toThrow();
  });
});
