/**
 * Polarity contract — autoPriority / manualPriorityOverride are 0-100
 * where HIGHER = MORE URGENT (canonicalized 2026-08-19).
 *
 * Before this, the same column carried two opposite scales: the scoring
 * engine (scoreTaskPriority → syncTaskPriorities, the writer that
 * rewrites every open task) has always produced higher-is-hotter, while
 * the nick-agent create path and the setTaskPriority chat tool wrote a
 * 5/15/30/60 lower-is-hotter map. Readers split down the middle — the
 * 8am MIT picker, the daily scheduler and half the mission surfaces
 * sorted ascending and structurally surfaced the LEAST urgent work.
 *
 * The source scan below pins the repo-wide reader convention: an
 * ascending DB sort or a lower-than filter on autoPriority reintroduces
 * the inverted scale, so both are banned outside the explicit allowlist.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  PRIORITY_CRITICAL_MIN,
  PRIORITY_HIGH_MIN,
  PRIORITY_MEDIUM_MIN,
  byPriorityDesc,
  priorityBandLabel,
  priorityFromLabel,
} from "@/lib/scoring/task-priority";

describe("task-priority polarity · canonical helpers", () => {
  it("labels map to a strictly ascending urgency scale", () => {
    const critical = priorityFromLabel("critical");
    const high = priorityFromLabel("high");
    const medium = priorityFromLabel(undefined);
    const low = priorityFromLabel("low");
    expect(critical).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(low);
  });

  it("labels land in their own bands (round-trip)", () => {
    expect(priorityBandLabel(priorityFromLabel("critical"))).toBe("critical");
    expect(priorityBandLabel(priorityFromLabel("high"))).toBe("high");
    expect(priorityBandLabel(priorityFromLabel(undefined))).toBe("medium");
    expect(priorityBandLabel(priorityFromLabel("low"))).toBe("low");
  });

  it("band thresholds are the exported constants, higher = hotter", () => {
    expect(priorityBandLabel(PRIORITY_CRITICAL_MIN)).toBe("critical");
    expect(priorityBandLabel(PRIORITY_CRITICAL_MIN - 1)).toBe("high");
    expect(priorityBandLabel(PRIORITY_HIGH_MIN)).toBe("high");
    expect(priorityBandLabel(PRIORITY_HIGH_MIN - 1)).toBe("medium");
    expect(priorityBandLabel(PRIORITY_MEDIUM_MIN)).toBe("medium");
    expect(priorityBandLabel(PRIORITY_MEDIUM_MIN - 1)).toBe("low");
    expect(priorityBandLabel(null)).toBe("medium");
  });

  it("byPriorityDesc puts the most urgent first and unscored rows last", () => {
    const rows = [
      { id: "mid", autoPriority: 55 },
      { id: "unscored", autoPriority: null },
      { id: "hot", autoPriority: 92 },
      { id: "cold", autoPriority: 12 },
    ];
    expect(rows.sort(byPriorityDesc).map((r) => r.id)).toEqual([
      "hot",
      "mid",
      "cold",
      "unscored",
    ]);
  });
});

// ── Source scan — the reader convention is repo-wide or it is nothing ──

const SCAN_ROOTS = ["lib", "app", "components", "hooks", "features"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * Patterns that reintroduce the inverted (lower = hotter) scale.
 * An ascending Prisma sort, an ascending nulls-ordered sort, or a
 * lower-than filter on autoPriority all read the bottom of the scale
 * as "most urgent".
 */
const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /autoPriority:\s*"asc"/, why: 'ascending sort (`autoPriority: "asc"`) reads least-urgent-first' },
  { re: /autoPriority:\s*\{\s*sort:\s*"asc"/, why: "ascending nulls-ordered sort on autoPriority" },
  { re: /autoPriority:\s*\{\s*lte?:/, why: "lower-than filter treats the bottom of the scale as hot" },
];

/** Relative paths (forward slashes) allowed to violate — none today. */
const ALLOWLIST = new Set<string>([]);

function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (SCAN_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) out.push(full);
    }
  };
  walk(root);
  return out;
}

describe("task-priority polarity · source scan", () => {
  it("the scanner sees a planted positive (instrument check)", () => {
    // A check that reports zero must first prove it can report one.
    const planted = 'orderBy: { autoPriority: "asc" }';
    expect(FORBIDDEN.some(({ re }) => re.test(planted))).toBe(true);
  });

  it("no file sorts or filters autoPriority as lower-is-hotter", () => {
    const appRoot = process.cwd();
    const violations: string[] = [];
    for (const rootName of SCAN_ROOTS) {
      const root = join(appRoot, rootName);
      let files: string[] = [];
      try {
        files = collectSourceFiles(root);
      } catch {
        continue; // root doesn't exist in this checkout shape
      }
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        for (const { re, why } of FORBIDDEN) {
          if (re.test(text)) {
            const rel = relative(appRoot, file).replaceAll("\\", "/");
            if (!ALLOWLIST.has(rel)) violations.push(`${rel} — ${why}`);
          }
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
