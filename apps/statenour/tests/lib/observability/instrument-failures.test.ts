/**
 * A broken instrument must be NAMEABLE, not a silence someone misreads.
 *
 * Every census and shadow in this app answers a question of the form "how often
 * did X happen?" by counting rows. When the writer fails, the count does not go
 * wrong — it goes DOWN, and a smaller count reads as a fact about X. #2359 lost
 * three weeks to that reading. Review found the same shape again on
 * `action.done.shadow` (2026-09-16), and the sweep that followed found two more
 * with an identical `.catch(() => {})`, one of them commented as though
 * swallowing were the point.
 *
 * These tests pin the reader that tells the two apart, and — more importantly —
 * pin the WIRING, because the reader is worthless if the call sites keep
 * swallowing. That half cannot be proved by calling this module.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  assembleInstrumentFailures,
  instrumentScope,
  KNOWN_INSTRUMENTS,
  INSTRUMENT_SCOPE_PREFIX,
} from "@/lib/observability/instrument-failures";

const SINCE = new Date("2026-09-16T00:00:00.000Z");

function row(source: string, message: string, iso: string) {
  // Exactly how logError composes it: `[${source}] ${message}`.
  return { message: `[${source}] ${message}`, createdAt: new Date(iso) };
}

describe("instrumentScope", () => {
  it("prefixes so every instrument reports on ONE queryable channel", () => {
    expect(instrumentScope("tool.surfaced")).toBe("instrument.tool.surfaced");
    expect(instrumentScope("tool.surfaced").startsWith(`${INSTRUMENT_SCOPE_PREFIX}.`)).toBe(true);
  });
});

describe("assembleInstrumentFailures", () => {
  it("POSITIVE CONTROL: it parses a real logError line at all", () => {
    // Without this, a regex that matched nothing would report "no failures"
    // for every input — the precise failure mode this module exists to end.
    const view = assembleInstrumentFailures(
      [row(instrumentScope("tool.surfaced"), "db unreachable", "2026-09-16T10:00:00.000Z")],
      24,
      SINCE,
    );
    expect(view.totalFailures).toBe(1);
    expect(view.failing[0].instrument).toBe("tool.surfaced");
    expect(view.failing[0].lastMessage).toBe("db unreachable");
  });

  it("groups by instrument and ranks the worst first", () => {
    const view = assembleInstrumentFailures(
      [
        row(instrumentScope("tool.surfaced"), "a", "2026-09-16T12:00:00.000Z"),
        row(instrumentScope("tool.surfaced"), "b", "2026-09-16T11:00:00.000Z"),
        row(instrumentScope("action.done.shadow"), "c", "2026-09-16T09:00:00.000Z"),
      ],
      24,
      SINCE,
    );
    expect(view.failing.map((f) => [f.instrument, f.failures])).toEqual([
      ["tool.surfaced", 2],
      ["action.done.shadow", 1],
    ]);
    expect(view.totalFailures).toBe(3);
  });

  it("keeps the NEWEST message, not whichever row arrived first", () => {
    // Rows come back newest-first today. Depending on that ordering would make
    // this silently wrong the day someone adds an index or changes orderBy.
    const view = assembleInstrumentFailures(
      [
        row(instrumentScope("tool.surfaced"), "older", "2026-09-16T08:00:00.000Z"),
        row(instrumentScope("tool.surfaced"), "newest", "2026-09-16T20:00:00.000Z"),
      ],
      24,
      SINCE,
    );
    expect(view.failing[0].lastMessage).toBe("newest");
  });

  it("ignores ordinary error rows that are not instrument failures", () => {
    const view = assembleInstrumentFailures(
      [
        { message: "[ai.chat-mode] something else broke", createdAt: new Date("2026-09-16T10:00:00.000Z") },
        row(instrumentScope("tool.surfaced"), "real", "2026-09-16T10:00:00.000Z"),
      ],
      24,
      SINCE,
    );
    expect(view.totalFailures).toBe(1);
  });

  it("lists known instruments with no logged failure — WITHOUT calling them healthy", () => {
    const view = assembleInstrumentFailures(
      [row(instrumentScope("tool.surfaced"), "x", "2026-09-16T10:00:00.000Z")],
      24,
      SINCE,
    );
    expect(view.instrumentsWithNoFailures).toEqual(
      KNOWN_INSTRUMENTS.filter((n) => n !== "tool.surfaced"),
    );
    // The distinction this module must never blur: an instrument that never ran
    // logs nothing and is indistinguishable from one that ran cleanly. Saying
    // so in the payload is the difference between a readout and a false
    // reassurance.
    expect(view.caveat).toMatch(/never ran/i);
    expect(view.caveat).toMatch(/wiring test/i);
  });
});

/**
 * THE WIRING HALF.
 *
 * The reader above can be perfect and still report nothing forever if the call
 * sites keep swallowing. Nothing reachable from this module can detect that —
 * exactly the gap review exposed on the Done-shadow's zero-action arm — so this
 * matches CALL EXPRESSIONS on COMMENT-STRIPPED source, the repo's own remedy
 * for guards that a comment could satisfy. The prose above names
 * `.catch(() => {})` several times and must not count.
 */
describe("WIRING: measurement instruments do not swallow their own failures", () => {
  const SITES = [
    { file: "app/api/ai/chat/prepare-tools.ts", instrument: "tool.surfaced" },
    { file: "lib/services/chat/tool-telemetry-walk.ts", instrument: "operation.integrity_shadow" },
    { file: "lib/ai/tool-selection-telemetry.ts", instrument: "tool_selection_turn" },
  ];

  function codeOf(file: string): string {
    return readFileSync(join(process.cwd(), file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
  }

  it.each(SITES)("$file reports $instrument failures through the shared channel", ({ file, instrument }) => {
    const code = codeOf(file);
    expect(
      code,
      `${file} must route its write failure to instrumentScope("${instrument}")`,
    ).toContain(`instrumentScope("${instrument}")`);
  });

  it.each(SITES)("$file has no silent catch left in it", ({ file }) => {
    const code = codeOf(file);
    // `.catch(() => {})` is the exact shape that hid all three of these. An
    // empty arrow body is never a correct handler for a measurement write.
    const silent = code.match(/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g) ?? [];
    expect(silent, `${file} still swallows a failure silently`).toEqual([]);
  });

  it("EVERY name in KNOWN_INSTRUMENTS has a real producer", () => {
    // The trap this closes, found by self-review of this very file:
    // `action.done.shadow` was listed as known while its recorder logged under
    // the bespoke scope "chat.action-done-shadow". The reader's regex could
    // never match it, so it would have sat in `instrumentsWithNoFailures`
    // forever — reading as healthy precisely when broken. A roster that lists
    // an instrument nothing reports is worse than omitting it: it converts an
    // unknown into a false all-clear.
    //
    // Scanning the whole lib+app tree rather than a fixed file list, so moving
    // a producer does not silently uncover its instrument.
    const roots = ["lib", "app"];
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") walk(p);
          continue;
        }
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
        const src = readFileSync(p, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n")
          .map((l) => l.replace(/\/\/.*$/, ""))
          .join("\n");
        for (const m of src.matchAll(/instrumentScope\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) found.add(m[1]);
        // The Done-shadow passes its metric constant rather than a literal.
        if (src.includes("instrumentScope(ACTION_DONE_SHADOW_METRIC)")) found.add("action.done.shadow");
      }
    };
    for (const r of roots) walk(join(process.cwd(), r));

    // POSITIVE CONTROL: the scan found producers at all, so an empty result
    // cannot make this vacuously green.
    expect(found.size, "the producer scan found nothing — it is not seeing the tree").toBeGreaterThan(2);

    const orphaned = KNOWN_INSTRUMENTS.filter((n) => !found.has(n));
    expect(
      orphaned,
      "listed as known but nothing reports under that scope — it would read as healthy forever",
    ).toEqual([]);
  });

  it("the two hot-path instruments use the PROPAGATING writer", () => {
    // `recordMetric` cannot reject — it ends in `.catch(() => {})` — so wiring
    // an instrument to it makes the error branch dead code. That was the P1.
    for (const file of ["app/api/ai/chat/prepare-tools.ts", "lib/services/chat/tool-telemetry-walk.ts"]) {
      const code = codeOf(file);
      expect(code, `${file} must use recordMetricStrict`).toContain("recordMetricStrict");
    }
  });
});
