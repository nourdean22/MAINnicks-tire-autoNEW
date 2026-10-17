/**
 * Outcome-ledger contract (audit 2026-10-10, report 06: F1 F3 F5 F8 + F2 ledger half).
 *
 *  · F1  a machine forecast miss (kind "prediction") is not an operator correction.
 *  · F5  a dismissal with a reason of timing/alternative is not a correction; a
 *        reasonless dismissal and a "not useful" rating still are.
 *  · F3  the 24 h dedup key is summary + sourceEngine + the evidence task: two
 *        `stuck-doing` chips about different tasks are two rows; the same
 *        recommendation about the same task on two surfaces is one row.
 *  · F8  rating returns recorded | already | failed — never one `false` for two causes.
 *  · F2  a chip tap with no ledger id still decides, by the summary it rendered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  kind: string;
  sourceEngine: string;
  contentHash: string;
  summary: string;
  shownSurface: string;
  evidenceRefs: Record<string, unknown> | null;
  shownAt: Date;
  decision: string | null;
  resultRef: string | null;
  outcomeAt: Date | null;
  outcomeUseful: boolean | null;
};

const store = vi.hoisted(() => ({ rows: [] as Row[], seq: 0, failUpdate: false }));

/** Just enough of Prisma's where-input to evaluate the ledger's predicates on rows. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    if (key === "AND") return (cond as Record<string, unknown>[]).every((w) => matches(row, w));
    if (key === "NOT") return !matches(row, cond as Record<string, unknown>);
    const value = row[key];
    if (cond === null || typeof cond !== "object" || cond instanceof Date) return value === cond;
    const c = cond as Record<string, unknown>;
    if ("path" in c) {
      const json = (value ?? {}) as Record<string, unknown>;
      return json[(c.path as string[])[0]] === c.equals;
    }
    if ("startsWith" in c) return typeof value === "string" && value.startsWith(c.startsWith as string);
    if ("not" in c) return value !== c.not;
    if ("notIn" in c) return value != null && !(c.notIn as unknown[]).includes(value);
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("gte" in c) return (value as Date) >= (c.gte as Date);
    throw new Error(`unsupported condition on ${key}: ${JSON.stringify(c)}`);
  });
}

vi.mock("@/lib/prisma", () => {
  const intelligenceOutcome = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const hit = [...store.rows].reverse().find((r) => matches(r, where));
      return hit ? { id: hit.id } : null;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
      const row: Row = {
        id: `row${++store.seq}`,
        evidenceRefs: null,
        shownAt: new Date(),
        decision: null,
        resultRef: null,
        outcomeAt: null,
        outcomeUseful: null,
        ...(data as Row),
      };
      store.rows.push(row);
      return { id: row.id };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      if (store.failUpdate) throw new Error("db down");
      const hits = store.rows.filter((r) => matches(r, where));
      for (const r of hits) Object.assign(r, data);
      return { count: hits.length };
    }),
  };
  const client = {
    intelligenceOutcome,
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  };
  return { prisma: client };
});
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import {
  CORRECTION_WHERE,
  outcomeContentHash,
  recordDecisionFromEvidence,
  recordOutcomeResult,
  recordShown,
} from "@/lib/services/outcome-ledger";

beforeEach(() => {
  store.rows = [];
  store.seq = 0;
  store.failUpdate = false;
});

function row(over: Partial<Row>): Row {
  return {
    id: "r",
    kind: "suggestion",
    sourceEngine: "x",
    contentHash: "h",
    summary: "s",
    shownSurface: "home",
    evidenceRefs: null,
    shownAt: new Date(),
    decision: null,
    resultRef: null,
    outcomeAt: null,
    outcomeUseful: null,
    ...over,
  };
}

describe("CORRECTION_WHERE · what counts as an operator correction", () => {
  const isCorrection = (r: Row) => matches(r as unknown as Record<string, unknown>, CORRECTION_WHERE as Record<string, unknown>);

  it("a reasonless dismissal and a not-useful rating are corrections (positive controls)", () => {
    expect(isCorrection(row({ decision: "dismissed" }))).toBe(true);
    expect(isCorrection(row({ decision: "dismissed", resultRef: "nudge:orphans" }))).toBe(true);
    expect(isCorrection(row({ outcomeUseful: false }))).toBe(true);
  });

  it("F1 · a missed machine forecast (kind prediction) is not an operator correction", () => {
    expect(isCorrection(row({ kind: "prediction", outcomeUseful: false }))).toBe(false);
  });

  it("F5 · dismiss:timing and dismiss:alternative are not corrections; a not-useful rating on such a row still is", () => {
    expect(isCorrection(row({ decision: "dismissed", resultRef: "dismiss:timing" }))).toBe(false);
    expect(isCorrection(row({ decision: "dismissed", resultRef: "dismiss:alternative" }))).toBe(false);
    expect(isCorrection(row({ decision: "dismissed", resultRef: "dismiss:timing", outcomeUseful: false }))).toBe(true);
  });

  it("W2 tutor taps are a quiz, not a verdict on a recommendation: never corrections", () => {
    // A wrong recall answer, a Skip, an old tutor:S dismissal, a Not yet: none is the operator pushing back.
    expect(isCorrection(row({ sourceEngine: "tutor:recall", decision: "accepted", outcomeUseful: false }))).toBe(false);
    expect(isCorrection(row({ sourceEngine: "tutor:recall", decision: "dismissed", resultRef: "dismiss:timing" }))).toBe(false);
    expect(isCorrection(row({ sourceEngine: "tutor:recall", decision: "dismissed", resultRef: "tutor:S" }))).toBe(false);
    expect(isCorrection(row({ sourceEngine: "tutor:decision", decision: "dismissed", resultRef: "tutor:N" }))).toBe(false);
    // Positive control: the same shapes from a non-tutor engine still count.
    expect(isCorrection(row({ sourceEngine: "nick-suggestions:stuck-task", decision: "dismissed" }))).toBe(true);
    expect(isCorrection(row({ sourceEngine: "tutorial-engine", decision: "dismissed" }))).toBe(true);
  });

  it("scout 9 tutor refs (tutor:<code>:unaided|hint) are never corrections; the same ref on another engine still is", () => {
    for (const resultRef of ["tutor:R:unaided", "tutor:X:unaided", "tutor:A:hint", "tutor:B:hint", "tutor:C:hint"]) {
      expect(isCorrection(row({ sourceEngine: "tutor:recall", decision: "accepted", outcomeUseful: false, resultRef })), resultRef).toBe(false);
      expect(isCorrection(row({ sourceEngine: "tutor:recall", decision: "dismissed", resultRef })), resultRef).toBe(false);
      // Positive control: the exclusion is the engine, not the ref text.
      expect(isCorrection(row({ sourceEngine: "nick-suggestions:stuck-task", decision: "accepted", outcomeUseful: false, resultRef })), resultRef).toBe(true);
    }
  });

  it("accepted and undecided rows are not corrections", () => {
    expect(isCorrection(row({ decision: "accepted" }))).toBe(false);
    expect(isCorrection(row({}))).toBe(false);
  });
});

describe("recordShown · dedup key = summary + sourceEngine + evidence task (F3)", () => {
  const chip = (taskId: string | null, surface = "chat-chips") => ({
    kind: "suggestion" as const,
    sourceEngine: "nick-suggestions:stuck-task",
    summary: "chip: stuck-doing",
    shownSurface: surface,
    evidenceRefs: { suggestionId: "stuck-doing", ...(taskId ? { taskId } : {}) },
  });

  it("two `stuck-doing` chips about different tasks are two rows", async () => {
    const a = await recordShown(chip("task-A"));
    const b = await recordShown(chip("task-B"));
    expect(a).not.toBeNull();
    expect(b).not.toBe(a);
    expect(store.rows).toHaveLength(2);
  });

  it("the same recommendation about the same task on two surfaces is one row", async () => {
    const a = await recordShown(chip("task-A", "chat-chips"));
    const b = await recordShown(chip("task-A", "brain"));
    expect(b).toBe(a);
    expect(store.rows).toHaveLength(1);
  });

  it("the same text from a different engine is a different recommendation", async () => {
    await recordShown({ kind: "suggestion", sourceEngine: "nudge:a", summary: "tag your tasks", shownSurface: "p" });
    await recordShown({ kind: "suggestion", sourceEngine: "nudge:b", summary: "tag your tasks", shownSurface: "p" });
    expect(store.rows).toHaveLength(2);
  });

  it("the stored contentHash stays the summary hash, so by-content joins keep matching", async () => {
    await recordShown(chip("task-A"));
    expect(store.rows[0].contentHash).toBe(outcomeContentHash("chip: stuck-doing"));
  });
});

describe("recordOutcomeResult · tri-state (F8)", () => {
  it("recorded on the first rating", async () => {
    store.rows.push(row({ id: "r1" }));
    expect(await recordOutcomeResult({ id: "r1", useful: true })).toBe("recorded");
  });

  it("already when the row was rated before — the first verdict stands", async () => {
    store.rows.push(row({ id: "r1", outcomeAt: new Date(), outcomeUseful: true }));
    expect(await recordOutcomeResult({ id: "r1", useful: false })).toBe("already");
    expect(store.rows[0].outcomeUseful).toBe(true);
  });

  it("failed on a DB error or an unknown id — never reported as already rated", async () => {
    expect(await recordOutcomeResult({ id: "nope", useful: true })).toBe("failed");
    store.rows.push(row({ id: "r1" }));
    store.failUpdate = true;
    expect(await recordOutcomeResult({ id: "r1", useful: true })).toBe("failed");
  });
});

describe("recordDecisionFromEvidence · no ledger id (F2)", () => {
  it("a tap without an id still decides the row its summary was shown as", async () => {
    store.rows.push(
      row({ id: "chip1", contentHash: outcomeContentHash("chip: stuck-doing · task:t1"), evidenceRefs: { taskId: "t1" } }),
    );
    expect(await recordDecisionFromEvidence(null, "accepted", "chip: stuck-doing · task:t1")).toBe(true);
    expect(store.rows[0]).toMatchObject({ decision: "accepted", resultRef: "task:t1" });
  });

  it("no id and no summary records nothing", async () => {
    expect(await recordDecisionFromEvidence(null, "accepted", null)).toBe(false);
  });
});
