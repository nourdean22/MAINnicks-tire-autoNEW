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
import { KNOWN_INSTRUMENTS, type InstrumentFailureView } from "@/lib/observability/instrument-failures";

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
