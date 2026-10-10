/**
 * The outcome ledger's failures must be NAMED by the instrument-failures reader
 * (audit 2026-10-10, 01-F1 / 06-F4).
 *
 * The ledger logs through `logError("intel.outcome-ledger", ...)`, so its rows read
 * `[intel.outcome-ledger] ...`. The reader matched only `[instrument.` rows, so a
 * week of ledger write failures (2026-10-03 -> 10-08, zero rows written) never
 * appeared on the one surface that exists to name failing instruments.
 *
 * The ledger itself is owned by another change, so the reader recognises the
 * ledger's existing scope rather than the ledger switching scopes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { errorLog: { findMany: (a: unknown) => findMany(a) } } }));

import {
  assembleInstrumentFailures,
  buildInstrumentFailures,
  instrumentScope,
  KNOWN_INSTRUMENTS,
} from "@/lib/observability/instrument-failures";

const SINCE = new Date("2026-10-03T00:00:00.000Z");
const row = (source: string, message: string, iso: string) => ({
  message: `[${source}] ${message}`,
  createdAt: new Date(iso),
});

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

describe("assembleInstrumentFailures · outcome ledger", () => {
  it("RED CASE: a real ledger warn row is named as a failing instrument", () => {
    const view = assembleInstrumentFailures(
      [
        row("intel.outcome-ledger", "Invalid prisma.$queryRaw() invocation", "2026-10-04T10:00:00.000Z"),
        row("intel.outcome-ledger", "Invalid prisma.$queryRaw() invocation", "2026-10-05T10:00:00.000Z"),
      ],
      24,
      SINCE,
    );
    expect(view.totalFailures).toBe(2);
    expect(view.failing).toEqual([
      {
        instrument: "intel.outcome-ledger",
        failures: 2,
        lastAt: "2026-10-05T10:00:00.000Z",
        lastMessage: "Invalid prisma.$queryRaw() invocation",
      },
    ]);
  });

  it("CONTROL: an ordinary non-instrument scope is still ignored", () => {
    // Recognising one named scope must not turn every logError row into an
    // instrument failure.
    const view = assembleInstrumentFailures(
      [
        row("intel.outcome-ledger-x", "near miss", "2026-10-04T10:00:00.000Z"),
        row("intel.other", "unrelated", "2026-10-04T10:00:00.000Z"),
        row("ai.chat-mode", "unrelated", "2026-10-04T10:00:00.000Z"),
      ],
      24,
      SINCE,
    );
    expect(view.totalFailures).toBe(0);
    expect(view.failing).toEqual([]);
  });

  it("CONTROL: `[instrument.*]` rows still parse exactly as before", () => {
    const view = assembleInstrumentFailures(
      [row(instrumentScope("tool.surfaced"), "db unreachable", "2026-10-04T10:00:00.000Z")],
      24,
      SINCE,
    );
    expect(view.failing.map((f) => [f.instrument, f.lastMessage])).toEqual([["tool.surfaced", "db unreachable"]]);
  });

  it("does not add the ledger to KNOWN_INSTRUMENTS (it has no liveness source; fleet-truth probes its silence)", () => {
    expect(KNOWN_INSTRUMENTS).not.toContain("intel.outcome-ledger");
  });
});

describe("buildInstrumentFailures · the live query reaches the ledger's rows", () => {
  it("asks the error log for the ledger prefix as well as `[instrument.`", async () => {
    await buildInstrumentFailures(24);
    const where = (findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    const prefixes = JSON.stringify(where);
    expect(prefixes).toContain('"startsWith":"[instrument."');
    expect(prefixes).toContain('"startsWith":"[intel.outcome-ledger]"');
  });
});

describe("WIRING: the producer still logs under the scope the reader recognises", () => {
  it("lib/services/outcome-ledger.ts reports through `intel.outcome-ledger`", () => {
    const src = readFileSync(join(process.cwd(), "lib/services/outcome-ledger.ts"), "utf8");
    // If the ledger renames its scope, this reader goes blind again; fail loudly.
    expect(src).toMatch(/["']intel\.outcome-ledger["']/);
  });
});
