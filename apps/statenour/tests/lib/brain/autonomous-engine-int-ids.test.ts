/**
 * Int row ids reach `autonomousAction.targetId` (String?) as STRINGS.
 *
 * PROD, 2026-10-10 03:00:34Z: `trigger_failed` for commitment_checkin,
 * commitment_escalation_day5 and decision_review_due -- "Argument `targetId`:
 * Invalid value provided. Expected StringNullableFilter, String or Null,
 * provided Int." Commitment.id and MasteryDecision.id are Int; the rule loop
 * passed the raw id into the cooldown read and the lock create, and the
 * per-rule catch aborted each rule at its first item. Present since the
 * 2026-05-17 import.
 *
 * Every earlier engine test mocked Prisma with plain vi.fn()s, which accept a
 * number as happily as a string -- so the one check that mattered (Prisma's
 * argument validation) never ran. No test in this repo loads the real query
 * engine without a database, so this file stands in a SCHEMA-DERIVED
 * validator: the scalar type of every AutonomousAction column is read from
 * prisma/schema.prisma, and the fake model rejects a mistyped argument with
 * the same message prod logged. Change the column type and the expectation
 * follows the schema, not a hand-written guess.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── schema-derived validator ────────────────────────────────────────────────
type Scalar = { type: string; optional: boolean };

function modelScalars(model: string): Record<string, Scalar> {
  const schema = readFileSync(path.resolve(__dirname, "../../../prisma/schema.prisma"), "utf8");
  const block = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1];
  if (!block) throw new Error(`model ${model} not found in schema.prisma`);
  const out: Record<string, Scalar> = {};
  for (const line of block.split("\n")) {
    const m = /^\s+(\w+)\s+(String|Int|Boolean|DateTime|Json|Float|BigInt|Decimal)(\?)?(\s|$)/.exec(line);
    if (m) out[m[1]] = { type: m[2], optional: m[3] === "?" };
  }
  return out;
}

const fits = (type: string, v: unknown): boolean => {
  switch (type) {
    case "String": return typeof v === "string";
    case "Int": return typeof v === "number" && Number.isInteger(v);
    case "Boolean": return typeof v === "boolean";
    case "DateTime": return v instanceof Date || typeof v === "string";
    default: return true;
  }
};
const jsName = (v: unknown) =>
  typeof v === "number" ? (Number.isInteger(v) ? "Int" : "Float") : typeof v === "string" ? "String" : typeof v;

function check(cols: Record<string, Scalar>, field: string, v: unknown, kind: "filter" | "data") {
  const col = cols[field];
  if (!col || v === undefined) return;
  if (v === null) {
    if (col.optional) return;
  } else if (typeof v !== "object" || v instanceof Date) {
    if (fits(col.type, v)) return;
  } else {
    // Filter objects: check the operands that carry a column value. Range
    // operators on DateTime and string matchers are left alone.
    const f = v as Record<string, unknown>;
    if (Array.isArray(f.in)) for (const x of f.in) check(cols, field, x, kind);
    if ("equals" in f) check(cols, field, f.equals, kind);
    return;
  }
  const expected =
    kind === "filter"
      ? `${col.type}${col.optional ? "Nullable" : ""}Filter, ${col.type}${col.optional ? " or Null" : ""}`
      : `${col.type}${col.optional ? " or Null" : ""}`;
  throw new Error(
    `Argument \`${field}\`: Invalid value provided. Expected ${expected}, provided ${jsName(v)}.`,
  );
}

const ACTION_COLS = modelScalars("AutonomousAction");
const validateWhere = (where: Record<string, unknown> | undefined) => {
  for (const [k, v] of Object.entries(where ?? {})) check(ACTION_COLS, k, v, "filter");
};
const validateData = (data: Record<string, unknown> | undefined) => {
  for (const [k, v] of Object.entries(data ?? {})) check(ACTION_COLS, k, v, "data");
};

// ── fixtures: one Int-keyed row per Int-keyed model the rules read ──────────
const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const fourDaysAgo = () => new Date(Date.now() - 4 * 86_400_000);
  return {
    prisma: {
      autonomousAction: {
        findFirst: h.findFirst,
        findMany: h.findMany,
        create: h.create,
        update: h.update,
        groupBy: h.groupBy,
      },
      commitment: {
        findMany: vi.fn(async () => [
          { id: 7, description: "call the supplier", status: "active", createdAt: fourDaysAgo(), deadline: "2026-10-01" },
        ]),
      },
      masteryDecision: {
        findMany: vi.fn(async () => [
          { id: 7, title: "hire a tech", chosen: "yes", stakes: "high", createdAt: fourDaysAgo() },
        ]),
      },
      decisionReplay: { findMany: vi.fn(async () => []) },
      brainMemory: {
        findUnique: vi.fn(async () => ({ updatedAt: new Date(), deletedAt: null })),
        findFirst: vi.fn(async () => ({ id: "snap" })),
        findMany: vi.fn(async () => []),
      },
      task: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
    },
  };
});

vi.mock("@/lib/nickstire/query", () => ({
  queryNick: vi.fn(async () => ({ error: "bridge off in tests" })),
  queryNickBatch: vi.fn(async () => ({})),
}));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// Fail-closed policy lookup: no policy -> every fire DEFERS (no side effect).
vi.mock("@/lib/automation/policy", () => ({
  getPolicy: vi.fn(async () => null),
  logPolicyFire: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/agent-trace", () => ({
  mintTraceId: () => "trace-test",
  recordTrace: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/confidence-tier", () => ({ canAutoExecute: () => false }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitAutonomousFired: vi.fn(async () => undefined) }));

import { runAutonomousActions } from "@/lib/brain/autonomous-engine";

beforeEach(() => {
  vi.useFakeTimers();
  // Saturday 10:00 EDT: with the bridge off no hour-gated rule yields, so only
  // the id-keyed rules act.
  vi.setSystemTime(new Date("2026-10-10T14:00:00Z"));
  let n = 0;
  h.findFirst.mockReset().mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    validateWhere(args?.where);
    return null;
  });
  h.findMany.mockReset().mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    validateWhere(args?.where);
    return [];
  });
  h.create.mockReset().mockImplementation(async (args: { data: Record<string, unknown> }) => {
    validateData(args.data);
    return { id: `row-${++n}`, ...args.data };
  });
  h.update.mockReset().mockImplementation(async () => ({}));
  h.groupBy.mockReset().mockImplementation(async () => []);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("schema-derived validator · positive control", () => {
  it("reads targetId as String? and rejects an Int with the message prod logged", () => {
    expect(ACTION_COLS.targetId).toEqual({ type: "String", optional: true });
    expect(() => validateWhere({ targetId: 7 })).toThrow(
      "Argument `targetId`: Invalid value provided. Expected StringNullableFilter, String or Null, provided Int.",
    );
    expect(() => validateWhere({ targetId: "7" })).not.toThrow();
    expect(() => validateWhere({ targetId: null })).not.toThrow();
  });
});

describe("autonomous engine · Int ids cross the boundary as strings", () => {
  it("runs the Int-keyed rules without a single argument error", async () => {
    const result = await runAutonomousActions();
    expect(result.errors).toBe(0);
    expect(result.failedRules).toEqual([]);
  });

  it("names every rule that failed, so the cron row can say which", async () => {
    // Force the pre-fix shape back in for one call: an Int reaches the validator.
    h.findFirst.mockImplementationOnce(async () => {
      validateWhere({ targetId: 7 });
      return null;
    });
    const result = await runAutonomousActions();
    // commitment_checkin is the first rule with a matched item at this hour.
    expect(result.errors).toBe(1);
    expect(result.failedRules).toEqual(["commitment_checkin"]);
  });

  it("passes targetId '7' (not 7) to the cooldown read for commitment and decision rules", async () => {
    await runAutonomousActions();
    const cooldownReads = h.findFirst.mock.calls
      .map(([a]) => (a as { where?: Record<string, unknown> }).where ?? {})
      .filter((w) => typeof w.ruleName === "string");
    for (const rule of ["commitment_checkin", "overdue_commitment_escalation", "decision_review_due"]) {
      const read = cooldownReads.find((w) => w.ruleName === rule);
      expect(read, `${rule} reached its cooldown read`).toBeDefined();
      expect(read!.targetId).toBe("7");
    }
  });

  it("writes targetId '7' on the lock row", async () => {
    await runAutonomousActions();
    const created = h.create.mock.calls.map(([a]) => (a as { data: Record<string, unknown> }).data);
    const decision = created.find((d) => d.ruleName === "decision_review_due");
    expect(decision?.targetId).toBe("7");
    const commitmentRows = created.filter((d) => String(d.ruleName).startsWith("commitment_") || d.ruleName === "overdue_commitment_escalation");
    expect(commitmentRows.length).toBeGreaterThan(0);
    for (const row of commitmentRows) expect(row.targetId).toBe("7");
  });
});
