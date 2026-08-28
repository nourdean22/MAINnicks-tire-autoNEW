/**
 * Every memory key that embeds an hour must record WHICH CLOCK it used.
 *
 * THE AMBIGUITY. Before #1809 the `{h}` in `mood_{date}_{h}` came from a bare
 * `new Date().getHours()`, which is UTC on Railway. After #1809 it comes from
 * `hourET()`. Nothing on the row distinguishes them, so `mood_2026-08-20_18` is
 * 18:00 UTC or 18:00 ET depending only on when it was written.
 *
 * WHY A MARKER AND NOT A MIGRATION — measured 2026-08-26, before any ET-keyed
 * row existed: 330 rows, ALL UTC-keyed, ~1-3/day, and NOTHING READS THE HOUR
 * (these rows are read by category, per DAY, at
 * app/api/brain/time-travel/route.ts:153). Rewriting 330 keys would be a
 * production write with no consumer on the other end. Stamping the frame costs
 * nothing and touches no existing row.
 *
 * THE ARM THAT MATTERS is the discovery one. Asserting "the three known call
 * sites pass hourFrameMeta()" would be satisfied forever by three unchanged
 * lines while a FOURTH hour-encoding key is added next to them — the ambiguity
 * would quietly resume and every test would stay green. So this file DISCOVERS
 * hour-encoding remember() call sites from the tree and requires the set to
 * match. A new one fails until it either stamps the frame or is added here
 * deliberately.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { hourFrameMeta, HOUR_FRAME_ET, HOUR_FRAME_BOUNDARY_ISO } from "@/lib/brain/hour-frame";

/** Call sites whose remember() KEY embeds an hour. Discovered, then compared. */
const KNOWN_HOUR_ENCODING_SITES = [
  "lib/brain/journal-ingest.ts",
  "lib/brain/pipeline-controller.ts",
] as const;

/** Every tracked source file under lib/ and app/. */
function trackedSources(): string[] {
  return execFileSync("git", ["ls-files", "--", "lib", "app"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

/**
 * Find every `brainMemory.remember(` whose key argument embeds an hour.
 * Returns `{ file, block }` — `block` is the call text, used to check the
 * metadata argument.
 */
function hourEncodingRememberCalls(): Array<{ file: string; block: string }> {
  const out: Array<{ file: string; block: string }> = [];
  for (const file of trackedSources()) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.includes("brainMemory.remember(")) continue;
    let i = text.indexOf("brainMemory.remember(");
    while (i !== -1) {
      // The call block: from the call to the first `);` that closes it. Good
      // enough for this codebase's formatting, and a miss fails LOUD (the site
      // would not be discovered, and the count assertion below catches that).
      const end = text.indexOf("\n      );", i);
      const block = text.slice(i, end === -1 ? i + 800 : end + 9);
      // The KEY is the 2nd argument — a template literal embedding the hour.
      const keyLine = block.split("\n").slice(1, 4).join("\n");
      if (/\$\{hourET\(\)\}|_\$\{hour\}/.test(keyLine)) out.push({ file, block });
      i = text.indexOf("brainMemory.remember(", i + 1);
    }
  }
  return out;
}

describe("hourFrameMeta", () => {
  it("marks the ET frame", () => {
    expect(hourFrameMeta()).toEqual({ hourFrame: "et" });
    expect(HOUR_FRAME_ET).toBe("et");
  });

  it("the boundary is a real instant in the past", () => {
    const t = Date.parse(HOUR_FRAME_BOUNDARY_ISO);
    expect(Number.isFinite(t), "the boundary must parse").toBe(true);
    expect(t).toBeLessThan(Date.now());
  });
});

/**
 * READER side of the same ratchet (operator decision 2026-08-28: exclude
 * pre-boundary rows from keyed-hour aggregates, never migrate). A read that
 * prefix-queries one of the hour-encoding families without bounding to the
 * frame boundary would silently aggregate a mixed UTC/ET series — the exact
 * false-aggregate shape the decision forbids.
 */
const HOUR_KEY_PREFIX_READ = /startsWith:\s*["'`](journal_mood_|mood_|booking_hour_|unanswered_leads_)/;

/** Files that prefix-read an hour-encoding family without referencing the boundary. */
function unboundedHourKeyReaders(): string[] {
  const out: string[] = [];
  for (const file of trackedSources()) {
    if (file === "lib/brain/hour-frame.ts") continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (HOUR_KEY_PREFIX_READ.test(text) && !text.includes("HOUR_FRAME_BOUNDARY_ISO")) {
      out.push(file);
    }
  }
  return out;
}

describe("no keyed-hour reader aggregates across the frame boundary", () => {
  it("the matcher SEES an offender (positive control)", () => {
    // Without this, an empty-tree assertion below passes vacuously on a broken
    // regex — the blind-instrument shape, applied to this file's own scanner.
    const offender = 'await prisma.brainMemory.findMany({ where: { key: { startsWith: "mood_" } } })';
    expect(HOUR_KEY_PREFIX_READ.test(offender)).toBe(true);
  });

  it("the matcher SPARES a boundary-aware reader (negative control)", () => {
    const compliant =
      'where: { key: { startsWith: "mood_" }, createdAt: { gte: new Date(HOUR_FRAME_BOUNDARY_ISO) } }';
    // The file-level rule: the prefix read may exist only alongside a
    // reference to the boundary constant.
    expect(HOUR_KEY_PREFIX_READ.test(compliant)).toBe(true);
    expect(compliant.includes("HOUR_FRAME_BOUNDARY_ISO")).toBe(true);
  });

  it("no reader in the tree bypasses the boundary", () => {
    const offenders = unboundedHourKeyReaders();
    expect(
      offenders,
      `these files prefix-read an hour-encoding key family without referencing ` +
        `HOUR_FRAME_BOUNDARY_ISO — bound the query with createdAt >= the boundary and ` +
        `label the window "since 2026-08-25 (ET frame)"; see lib/brain/hour-frame.ts: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("every hour-encoding memory key stamps its frame", () => {
  it("finds the hour-encoding call sites at all", () => {
    // Positive control. If the scanner silently matched nothing, every
    // assertion below would pass vacuously — which is the failure mode this
    // whole file exists to prevent, applied to itself.
    const calls = hourEncodingRememberCalls();
    expect(calls.length, "the scanner found no hour-encoding remember() calls — it is broken").toBeGreaterThan(0);
  });

  it("every one of them passes hourFrameMeta()", () => {
    const missing = hourEncodingRememberCalls()
      .filter((c) => !c.block.includes("hourFrameMeta()"))
      .map((c) => c.file);
    expect(
      missing,
      `these remember() calls embed an hour in the key but do not record which clock: ${missing.join(", ")}. ` +
        `Pass hourFrameMeta() as the 5th argument — see lib/brain/hour-frame.ts.`,
    ).toEqual([]);
  });

  it("no NEW hour-encoding call site appeared unnoticed", () => {
    // The ratchet. Without this, a fourth hour-encoding key added tomorrow
    // WITH the marker would be fine, but one added WITHOUT it in a file not
    // listed here would only be caught by the arm above — which is the point,
    // so this arm exists to make the file list itself a reviewed decision
    // rather than an accident.
    const files = [...new Set(hourEncodingRememberCalls().map((c) => c.file))].sort();
    expect(files).toEqual([...KNOWN_HOUR_ENCODING_SITES].sort());
  });
});
