/**
 * Status rules for the instrument-health reader.
 *
 * The production case that motivated the module is pinned as a fixture:
 * `action.done.shadow` with 1 write across 253 assistant turns, zero failures.
 * The failures reader reported that as "no failures"; this reader must say
 * UNDERPOWERED, must say it is conditional, and must NOT say STALE or NEVER_RAN
 * — because the instrument is alive and the phenomenon is rare, and accusing
 * a correct instrument is the opposite error.
 *
 * Per AGENTS.md > "Ship the canary, not just the control": precedence is
 * asserted by fixtures that qualify for TWO statuses at once, so a reorder of
 * the if-chain fails a test instead of silently changing verdicts.
 */
import { describe, expect, it } from "vitest";
import {
  assembleInstrumentHealth,
  CONDITIONAL_INSTRUMENTS,
  MIN_POWERED_N,
} from "@/lib/observability/instrument-liveness";
import {
  DEFERRED_TURN_INSTRUMENT,
  KNOWN_INSTRUMENTS,
  type InstrumentFailureView,
} from "@/lib/observability/instrument-failures";

const SINCE = new Date("2026-09-08T00:00:00Z");
const WINDOW_H = 24 * 14;

function noFailures(): InstrumentFailureView {
  return {
    windowHours: WINDOW_H,
    since: SINCE.toISOString(),
    totalFailures: 0,
    failing: [],
    instrumentsWithNoFailures: [...KNOWN_INSTRUMENTS],
    truncated: false,
    sampleCap: 2000,
    caveat: "",
  };
}

function withFailure(instrument: string, failures: number): InstrumentFailureView {
  const base = noFailures();
  return {
    ...base,
    totalFailures: failures,
    failing: [{ instrument, failures, lastAt: SINCE.toISOString(), lastMessage: "boom" }],
    instrumentsWithNoFailures: base.instrumentsWithNoFailures.filter((n) => n !== instrument),
  };
}

describe("assembleInstrumentHealth", () => {
  it("POSITIVE CONTROL: a powered, non-failing instrument is HEALTHY with its denominator", () => {
    const view = assembleInstrumentHealth(
      [{ instrument: "tool.surfaced", lastWriteAt: new Date("2026-09-22T10:00:00Z"), writesInWindow: 294 }],
      noFailures(),
      253,
      WINDOW_H,
      SINCE,
    );
    const row = view.rows[0];
    expect(row.status).toBe("HEALTHY");
    expect(row.coverage).toBeCloseTo(294 / 253, 6);
    expect(row.reason).toContain("294 writes across 253 turns");
    expect(view.attention).toEqual([]);
  });

  // The measured production case. This is the whole reason the module exists.
  it("1 write across 253 turns on a conditional instrument is UNDERPOWERED — not STALE, not NEVER_RAN", () => {
    const view = assembleInstrumentHealth(
      [{ instrument: "action.done.shadow", lastWriteAt: new Date("2026-09-19T20:28:22Z"), writesInWindow: 1 }],
      noFailures(),
      253,
      WINDOW_H,
      SINCE,
    );
    const row = view.rows[0];
    expect(row.status).toBe("UNDERPOWERED");
    expect(row.conditional).toBe(CONDITIONAL_INSTRUMENTS["action.done.shadow"]);
    expect(row.reason).toContain("rare phenomenon, not a dead writer");
    expect(row.reason).toContain(`n=${MIN_POWERED_N}`);
    expect(row.coverage).toBeCloseTo(1 / 253, 6);
    expect(view.attention.map((r) => r.instrument)).toEqual(["action.done.shadow"]);
  });

  it("an unconditional instrument with a low count is UNDERPOWERED without the rare-phenomenon excuse", () => {
    const view = assembleInstrumentHealth(
      [{ instrument: "tool.chosen", lastWriteAt: new Date("2026-09-22T10:00:00Z"), writesInWindow: 5 }],
      noFailures(),
      253,
      WINDOW_H,
      SINCE,
    );
    expect(view.rows[0].status).toBe("UNDERPOWERED");
    expect(view.rows[0].conditional).toBeNull();
    expect(view.rows[0].reason).not.toContain("rare phenomenon");
  });

  // Measured on the first live run: tool_telemetry is aggregate-by-tool, so its
  // count is distinct tools touched, and the reason said "8 writes". A reader
  // built to stop instruments misdescribing themselves cannot misdescribe its
  // own units.
  it("an aggregate-by-key instrument describes its count in its own unit", () => {
    const view = assembleInstrumentHealth(
      [{ instrument: "tool_invocation", lastWriteAt: new Date("2026-09-19T20:17:23Z"), writesInWindow: 8, unit: "tools touched" }],
      noFailures(),
      253,
      WINDOW_H,
      SINCE,
    );
    expect(view.rows[0].status).toBe("UNDERPOWERED");
    expect(view.rows[0].reason).toContain("8 tools touched across 253 turns");
    expect(view.rows[0].reason).not.toContain("8 writes");
  });

  it("zero writes in a window where turns happened is STALE, and names the last write", () => {
    const view = assembleInstrumentHealth(
      [{ instrument: "tool.chosen", lastWriteAt: new Date("2026-08-30T00:00:00Z"), writesInWindow: 0 }],
      noFailures(),
      253,
      WINDOW_H,
      SINCE,
    );
    expect(view.rows[0].status).toBe("STALE");
    expect(view.rows[0].reason).toContain("2026-08-30T00:00:00.000Z");
  });

  it("zero writes with ZERO turns is not STALE — nothing happened for it to miss", () => {
    const view = assembleInstrumentHealth(
      [{ instrument: "tool.chosen", lastWriteAt: new Date("2026-08-30T00:00:00Z"), writesInWindow: 0 }],
      noFailures(),
      0,
      WINDOW_H,
      SINCE,
    );
    // Falls through to UNDERPOWERED (0 < MIN_POWERED_N) with a null coverage.
    expect(view.rows[0].status).toBe("UNDERPOWERED");
    expect(view.rows[0].coverage).toBeNull();
  });

  it("no row ever written is NEVER_RAN and points at a wiring test, not a log", () => {
    const view = assembleInstrumentHealth(
      [{ instrument: "tool.chosen", lastWriteAt: null, writesInWindow: 0 }],
      noFailures(),
      253,
      WINDOW_H,
      SINCE,
    );
    expect(view.rows[0].status).toBe("NEVER_RAN");
    expect(view.rows[0].reason).toContain("wiring test");
  });

  // ── Precedence canaries · each fixture qualifies for two statuses ──
  it("FAILING beats NEVER_RAN — the cause names itself", () => {
    const view = assembleInstrumentHealth(
      [{ instrument: "tool.chosen", lastWriteAt: null, writesInWindow: 0 }],
      withFailure("tool.chosen", 7),
      253,
      WINDOW_H,
      SINCE,
    );
    expect(view.rows[0].status).toBe("FAILING");
    expect(view.rows[0].failuresInWindow).toBe(7);
    expect(view.rows[0].reason).toContain("floor");
  });

  it("FAILING beats HEALTHY — a powered instrument that is also failing is not healthy", () => {
    const view = assembleInstrumentHealth(
      [{ instrument: "tool.surfaced", lastWriteAt: new Date("2026-09-22T10:00:00Z"), writesInWindow: 294 }],
      withFailure("tool.surfaced", 1),
      253,
      WINDOW_H,
      SINCE,
    );
    expect(view.rows[0].status).toBe("FAILING");
  });

  it("NEVER_RAN beats STALE — never is stronger than lapsed", () => {
    const view = assembleInstrumentHealth(
      [{ instrument: "tool.chosen", lastWriteAt: null, writesInWindow: 0 }],
      noFailures(),
      253,
      WINDOW_H,
      SINCE,
    );
    expect(view.rows[0].status).not.toBe("STALE");
    expect(view.rows[0].status).toBe("NEVER_RAN");
  });

  it("attention is sorted worst-first across mixed statuses", () => {
    const view = assembleInstrumentHealth(
      [
        { instrument: "tool.surfaced", lastWriteAt: new Date("2026-09-22T10:00:00Z"), writesInWindow: 294 },
        { instrument: "action.done.shadow", lastWriteAt: new Date("2026-09-19T20:28:22Z"), writesInWindow: 1 },
        { instrument: "tool.chosen", lastWriteAt: new Date("2026-08-30T00:00:00Z"), writesInWindow: 0 },
        { instrument: "tool_invocation", lastWriteAt: null, writesInWindow: 0 },
        { instrument: "operation.integrity_shadow", lastWriteAt: new Date("2026-09-22T10:00:00Z"), writesInWindow: 100 },
      ],
      withFailure("operation.integrity_shadow", 2),
      253,
      WINDOW_H,
      SINCE,
    );
    expect(view.attention.map((r) => `${r.instrument}:${r.status}`)).toEqual([
      "operation.integrity_shadow:FAILING",
      "tool_invocation:NEVER_RAN",
      "tool.chosen:STALE",
      "action.done.shadow:UNDERPOWERED",
    ]);
    expect(view.rows).toHaveLength(5);
  });

  it("carries the failures reader's truncation flag so floors stay floors", () => {
    const f = noFailures();
    f.truncated = true;
    const view = assembleInstrumentHealth([], f, 253, WINDOW_H, SINCE);
    expect(view.failuresTruncated).toBe(true);
  });

  it("every conditional instrument is a KNOWN instrument — a condition for a name nobody registers is dead config", () => {
    for (const name of Object.keys(CONDITIONAL_INSTRUMENTS)) {
      expect(KNOWN_INSTRUMENTS).toContain(name);
    }
  });
});

describe("deferred-turn heartbeat · the denominator the conditional shadows never had (2026-09-22)", () => {
  // Before the heartbeat, "0 writes" on a conditional shadow had two readings
  // the reader could not tell apart: the path ran and the condition did not
  // occur, or the path never ran. The heartbeat writes once per turn the
  // deferred path ran for, so the reader can split them.
  const heartbeat = (writes: number, everWrote = true) => ({
    instrument: DEFERRED_TURN_INSTRUMENT,
    lastWriteAt: everWrote ? SINCE : null,
    writesInWindow: writes,
  });
  const conditionalZero = {
    instrument: "action.done.shadow",
    lastWriteAt: new Date("2026-09-01T00:00:00Z"),
    writesInWindow: 0,
  };
  const rowOf = (view: ReturnType<typeof assembleInstrumentHealth>, name: string) =>
    view.rows.find((r) => r.instrument === name)!;

  it("POSITIVE CONTROL: without the heartbeat among the inputs, a conditional zero is STALE — the old verdict, unchanged", () => {
    const view = assembleInstrumentHealth([conditionalZero], noFailures(), 13, WINDOW_H, SINCE);
    expect(rowOf(view, "action.done.shadow").status).toBe("STALE");
    expect(rowOf(view, "action.done.shadow").reason).toMatch(/confirm the condition did not occur/);
  });

  it("with the path PROVEN to have run, a conditional zero is UNDERPOWERED — the condition did not occur", () => {
    const view = assembleInstrumentHealth([heartbeat(13), conditionalZero], noFailures(), 13, WINDOW_H, SINCE);
    const row = rowOf(view, "action.done.shadow");
    expect(row.status).toBe("UNDERPOWERED");
    expect(row.reason).toMatch(/ran on 13 of 13 turns/);
    expect(row.reason).toMatch(/condition did not occur, the writer is not dead/);
  });

  it("with a heartbeat that wrote NOTHING while turns happened, the conditional zero stays STALE and names the whole path", () => {
    const view = assembleInstrumentHealth([heartbeat(0), conditionalZero], noFailures(), 13, WINDOW_H, SINCE);
    expect(rowOf(view, DEFERRED_TURN_INSTRUMENT).status).toBe("STALE");
    const row = rowOf(view, "action.done.shadow");
    expect(row.status).toBe("STALE");
    expect(row.reason).toMatch(/the whole path did not run/);
  });

  it("a heartbeat that has NEVER written yet (its first window after deploy) changes no verdict", () => {
    const view = assembleInstrumentHealth([heartbeat(0, false), conditionalZero], noFailures(), 13, WINDOW_H, SINCE);
    expect(rowOf(view, DEFERRED_TURN_INSTRUMENT).status).toBe("NEVER_RAN");
    expect(rowOf(view, "action.done.shadow").status).toBe("STALE");
    expect(rowOf(view, "action.done.shadow").reason).not.toMatch(/whole path did not run/);
  });

  it("an UNCONDITIONAL zero stays STALE even when the path ran — it should have written on every turn", () => {
    const unconditionalZero = { instrument: "tool.surfaced", lastWriteAt: SINCE, writesInWindow: 0 };
    const view = assembleInstrumentHealth([heartbeat(13), unconditionalZero], noFailures(), 13, WINDOW_H, SINCE);
    expect(rowOf(view, "tool.surfaced").status).toBe("STALE");
  });

  it("NEVER_RAN on a conditional instrument cites the path's runs, so 'never' reads as 'not yet' when it is", () => {
    const neverRan = { instrument: "recommendation.novelty", lastWriteAt: null, writesInWindow: 0 };
    const view = assembleInstrumentHealth([heartbeat(13), neverRan], noFailures(), 13, WINDOW_H, SINCE);
    const row = rowOf(view, "recommendation.novelty");
    expect(row.status).toBe("NEVER_RAN");
    expect(row.reason).toMatch(/deferred path ran on 13 of 13 turns/);
  });

  it("the heartbeat itself is a KNOWN, UNCONDITIONAL, per-turn instrument", () => {
    expect(KNOWN_INSTRUMENTS).toContain(DEFERRED_TURN_INSTRUMENT);
    expect(CONDITIONAL_INSTRUMENTS[DEFERRED_TURN_INSTRUMENT]).toBeUndefined();
    const view = assembleInstrumentHealth([heartbeat(MIN_POWERED_N)], noFailures(), MIN_POWERED_N, WINDOW_H, SINCE);
    expect(rowOf(view, DEFERRED_TURN_INSTRUMENT).status).toBe("HEALTHY");
  });
});

/**
 * 2026-09-22 · review on #2482. A read that fails is not a reading of zero, and an
 * instrument missing from a truncated failure sample is not clean. Both were HEALTHY.
 */
describe("UNKNOWN is a status, not an absence (review on #2482)", () => {
  const written = (instrument: string, n = 100) => ({ instrument, lastWriteAt: new Date("2026-09-22T10:00:00Z"), writesInWindow: n });

  it("a liveness source that failed is an UNKNOWN row naming the error, sorted right after FAILING", () => {
    const view = assembleInstrumentHealth(
      [
        written("tool.surfaced"),
        { instrument: "tool_selection_turn", lastWriteAt: null, writesInWindow: 0, sourceError: "relation tool_selection_turns does not exist" },
        { instrument: "tool_invocation", lastWriteAt: null, writesInWindow: 0 },
      ],
      withFailure("tool.chosen", 1),
      253,
      WINDOW_H,
      SINCE,
    );
    const row = view.rows.find((r) => r.instrument === "tool_selection_turn")!;
    expect(row.status).toBe("UNKNOWN");
    expect(row.reason).toContain("does not exist");
    expect(row.reason).toContain("unread, not healthy");
    expect(view.attention.map((r) => r.status)).toEqual(["UNKNOWN", "NEVER_RAN"]);
  });

  it("a truncated failure sample makes an ABSENT instrument UNKNOWN, while a present one is still FAILING", () => {
    const f = withFailure("tool.chosen", 40);
    f.truncated = true;
    const view = assembleInstrumentHealth([written("tool.surfaced"), written("tool.chosen", 50)], f, 253, WINDOW_H, SINCE);
    expect(view.rows.find((r) => r.instrument === "tool.chosen")!.status).toBe("FAILING");
    const absent = view.rows.find((r) => r.instrument === "tool.surfaced")!;
    expect(absent.status).toBe("UNKNOWN");
    expect(absent.reason).toContain(`${f.sampleCap}-row cap`);
  });

  it("POSITIVE CONTROL: the same absent instrument is HEALTHY when the sample was NOT truncated", () => {
    const view = assembleInstrumentHealth([written("tool.surfaced")], withFailure("tool.chosen", 40), 253, WINDOW_H, SINCE);
    expect(view.rows[0].status).toBe("HEALTHY");
  });

  it("an unknown denominator makes a written instrument UNKNOWN, and keeps a never-written one NEVER_RAN", () => {
    const view = assembleInstrumentHealth([written("tool.surfaced"), { instrument: "tool_invocation", lastWriteAt: null, writesInWindow: 0 }], noFailures(), null, WINDOW_H, SINCE, ["assistant turns: connection refused"]);
    expect(view.rows.find((r) => r.instrument === "tool.surfaced")!.status).toBe("UNKNOWN");
    expect(view.rows.find((r) => r.instrument === "tool_invocation")!.status).toBe("NEVER_RAN");
    expect(view.sourceErrors).toEqual(["assistant turns: connection refused"]);
    expect(view.assistantTurns).toBe(0);
  });
});

/**
 * 2026-09-23 · review on #2482 (P1): every persisted assistant message was the
 * denominator, including fast-path confirmations, image results and scheduled
 * follow-ups that never enter tool routing. In a window dominated by those, a
 * working tool.surfaced writer read STALE or artificially low. The tool-path
 * instruments now read against the turns that entered tool routing - the
 * tool_selection_turn rows in the window - and say so in their reason.
 */
describe("eligible-turn denominator (review on #2482)", () => {
  const routing = (writes: number, everWrote = true) => ({ instrument: "tool_selection_turn", lastWriteAt: everWrote ? SINCE : null, writesInWindow: writes });
  const surfaced = (writes: number) => ({ instrument: "tool.surfaced", lastWriteAt: new Date("2026-09-22T10:00:00Z"), writesInWindow: writes });
  const rowOf = (view: ReturnType<typeof assembleInstrumentHealth>, name: string) => view.rows.find((r) => r.instrument === name)!;

  it("tool.surfaced reads its coverage against tool-routing turns, not every assistant message", () => {
    const view = assembleInstrumentHealth([routing(50), surfaced(40)], noFailures(), 253, WINDOW_H, SINCE);
    const row = rowOf(view, "tool.surfaced");
    expect(row.status).toBe("HEALTHY");
    expect(row.coverage).toBeCloseTo(40 / 50, 6);
    expect(row.reason).toContain("40 writes across 50 tool-routing turns");
    expect(row.denominator).toEqual({ name: "tool-routing turns", count: 50, fallback: false });
  });

  it("zero writes while tool routing ran on NO turn is UNDERPOWERED (the path did not run), not STALE", () => {
    const view = assembleInstrumentHealth([routing(0), surfaced(0)], noFailures(), 253, WINDOW_H, SINCE);
    const row = rowOf(view, "tool.surfaced");
    expect(row.status).toBe("UNDERPOWERED");
    expect(row.reason).toContain("tool routing ran on 0");
    expect(row.reason).toContain("writer is not dead");
  });

  it("zero writes while tool routing DID run is STALE and names the routing denominator", () => {
    const view = assembleInstrumentHealth([routing(50), surfaced(0)], noFailures(), 253, WINDOW_H, SINCE);
    const row = rowOf(view, "tool.surfaced");
    expect(row.status).toBe("STALE");
    expect(row.reason).toContain("0 writes across 50 tool-routing turns");
  });

  it("POSITIVE CONTROL: without a routing counter among the inputs, the shared denominator is used and marked as a fallback", () => {
    const view = assembleInstrumentHealth([surfaced(294)], noFailures(), 253, WINDOW_H, SINCE);
    const row = rowOf(view, "tool.surfaced");
    expect(row.reason).toContain("294 writes across 253 turns");
    expect(row.denominator).toEqual({ name: "assistant turns", count: 253, fallback: true });
  });

  it("a routing counter that has NEVER written falls back too - a dead counter is not a zero-turn window", () => {
    const view = assembleInstrumentHealth([routing(0, false), surfaced(0)], noFailures(), 253, WINDOW_H, SINCE);
    expect(rowOf(view, "tool.surfaced").status).toBe("STALE");
    expect(rowOf(view, "tool.surfaced").denominator.fallback).toBe(true);
  });

  it("the routing counter itself and the aggregate tool_invocation stay on assistant turns", () => {
    const view = assembleInstrumentHealth([routing(50), { instrument: "tool_invocation", lastWriteAt: SINCE, writesInWindow: 8, unit: "tools touched" }], noFailures(), 253, WINDOW_H, SINCE);
    expect(rowOf(view, "tool_selection_turn").denominator).toEqual({ name: "assistant turns", count: 253, fallback: false });
    expect(rowOf(view, "tool_invocation").denominator.name).toBe("assistant turns");
  });
});
