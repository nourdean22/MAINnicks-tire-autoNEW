/**
 * tests/cron/cron-failure-guards.test.ts
 * 2026-09-02 · guards the three highest-failure crons on /system/health.
 *
 * The health page reported, over the retained window:
 *
 *   correlation-alarm      354 failed / 924 runs   (38%)
 *   weekly-review           27 failed / 291 runs   (91% of its 318 attempts)
 *   ollama-model-liveness   32 failed / 2,312 runs (1.4%)
 *
 * Three unrelated-looking numbers, one shape: an exception thrown on a path
 * that had no business being fatal. A cron has no user to retry it, so every
 * uncaught throw is a lost run, and a lost run only ever surfaces as a
 * "failed" row on a page nobody opens until the ratio gets embarrassing.
 *
 * Each block below pairs the guard with a PLANTED POSITIVE: a demonstration
 * that the hazard is real and that the assertion can still fail. Without the
 * pair, a matcher that silently stopped matching would score green forever —
 * the silent-instrument shape this repo keeps re-learning.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ─────────────────────────────────────────────────────────────────────────
// 1 · correlation-finder · a bridge-supplied date must not kill the run
// ─────────────────────────────────────────────────────────────────────────
import { dayKey } from "@/lib/brain/correlation-finder";

describe("correlation-finder · dayKey survives an unparseable date", () => {
  it("PLANTED POSITIVE · the unguarded call really does throw", () => {
    // This is the exact expression that used to run on every row:
    //   j.jobDate.toISOString().split("T")[0]
    // On an Invalid Date it is a RangeError, not a NaN or an empty string.
    // If this ever stops throwing, the guard below is testing nothing.
    expect(() => new Date("not-a-date").toISOString()).toThrow(RangeError);
  });

  it("buckets a real Date to its UTC day", () => {
    expect(dayKey(new Date("2026-09-02T18:30:00.000Z"))).toBe("2026-09-02");
  });

  it("buckets a date-shaped string the same way", () => {
    // recent_invoices / recent_leads arrive from the nickstire bridge as JSON,
    // so these are strings by the time they reach the correlation window.
    expect(dayKey("2026-09-02T18:30:00.000Z")).toBe("2026-09-02");
  });

  it("returns null instead of throwing on garbage", () => {
    for (const bad of ["not-a-date", "", "2026-13-45", "undefined"]) {
      expect(() => dayKey(bad), `dayKey(${JSON.stringify(bad)}) must not throw`).not.toThrow();
      expect(dayKey(bad), `dayKey(${JSON.stringify(bad)})`).toBeNull();
    }
  });

  it("returns null for null and undefined", () => {
    expect(dayKey(null)).toBeNull();
    expect(dayKey(undefined)).toBeNull();
  });

  /**
   * dayKey being correct is only half the fix — the four bucketing loops have
   * to actually call it. This pins the invariant as "no unguarded
   * .toISOString() survives in this module", which is what stops the next
   * loop from being written the old way, rather than pinning the four call
   * sites that exist today.
   */
  const UNGUARDED = /\.toISOString\(\)\s*\.split\(/g;

  function liveCode(rel: string): string {
    return readFileSync(resolve(APP_ROOT, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");
  }

  it("PLANTED POSITIVE · the matcher recognises the old shape", () => {
    expect(`const d = j.jobDate.toISOString().split("T")[0];`.match(UNGUARDED)).toHaveLength(1);
  });

  it("only dayKey itself calls toISOString().split() in correlation-finder", () => {
    const hits = liveCode("lib/brain/correlation-finder.ts").match(UNGUARDED) ?? [];
    expect(
      hits,
      "Each of these is a row-shaped RangeError waiting for one bad bridge date. " +
        "Bucket through dayKey() and skip the row when it returns null.",
    ).toHaveLength(1); // the one inside dayKey, after its own NaN check
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2 · provider config must not pin a model the docs record as dead
// ─────────────────────────────────────────────────────────────────────────
/**
 * weekly-review called getModelWithFallback() — a name that promised failure
 * handling and delivered `return getModel()`. The model it reached for was
 * `deepseek-v4-pro`, which docs/CURRENT-TRUTH.md records as retired upstream.
 * A dead default plus an unguarded call is the whole 91% failure rate.
 *
 * The dead ids are quoted from CURRENT-TRUTH rather than invented here, and
 * that file is the source: if a model comes back, the list shrinks there and
 * this test follows.
 */
const DEAD_MODEL_IDS = ["deepseek-v4-pro", "kimi-k3", "deepseek-v3.1:671b"];

function providerConfigSource(): string {
  return readFileSync(resolve(APP_ROOT, "config/ai-providers.ts"), "utf8");
}

/** Quoted string values in the config, comments stripped. */
function quotedValues(src: string): string[] {
  const noComments = src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
  return [...noComments.matchAll(/["'`]([^"'`\n]+)["'`]/g)].map((m) => m[1]);
}

describe("ai-providers config · no model pinned that CURRENT-TRUTH calls dead", () => {
  it("PLANTED POSITIVE · the extractor sees real model ids", () => {
    // A regex that matched nothing would make the assertion below vacuous.
    const values = quotedValues(providerConfigSource());
    expect(values.length).toBeGreaterThan(10);
    expect(values.some((v) => v.includes("minimax-m3"))).toBe(true);
  });

  it("PLANTED POSITIVE · a dead id would be caught if one were added", () => {
    const planted = quotedValues(`const x = { defaultModel: "deepseek-v4-pro" };`);
    expect(planted.some((v) => DEAD_MODEL_IDS.includes(v))).toBe(true);
  });

  it("no dead model id appears as a configured value", () => {
    const offenders = quotedValues(providerConfigSource()).filter((v) => DEAD_MODEL_IDS.includes(v));
    expect(
      offenders,
      "docs/CURRENT-TRUTH.md records these as retired upstream. A cron pinned to one\n" +
        "fails every run, and the failure only shows as a row on /system/health:\n" +
        offenders.join(", "),
    ).toEqual([]);
  });
});

describe("provider · getModelWithFallback is gone, not merely unused", () => {
  /**
   * Strip comments before asserting on source text. The first version of this
   * test was `expect(src).not.toContain("getModelWithFallback")` and it FAILED
   * — on the tombstone comment in provider.ts explaining the deletion, and on
   * weekly-review's note about what it used to call. A naive substring check
   * cannot tell "this was removed" from "this is documented as removed", so it
   * punishes the explanation and would pass just as happily against a file
   * where the function came back inside a comment-free block.
   *
   * This is the SECOND time this exact shape bit this session; the first was a
   * `meta?.mutates` assertion tripping over its own explanatory comment.
   */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  }

  const FILES = ["lib/ai/provider.ts", "app/api/cron/weekly-review/route.ts"];

  it("PLANTED POSITIVE · stripComments keeps code and drops commentary", () => {
    const sample = stripComments(`const a = getModelWithFallback(); // getModelWithFallback
/* getModelWithFallback */`);
    expect(sample).toContain("getModelWithFallback()");
    expect(sample.match(/getModelWithFallback/g)).toHaveLength(1);
  });

  it("no declaration or call survives in the modules that carried it", () => {
    // It was `return getModel()` with a comment admitting it was a
    // backward-compat alias. A name that promises fallback and provides none
    // is worse than no helper: weekly-review's author trusted the name and
    // wrote no catch. Deleting it is the fix; a re-add would restore the trap.
    for (const f of FILES) {
      const code = stripComments(readFileSync(resolve(APP_ROOT, f), "utf8"));
      expect(code, `${f} still references getModelWithFallback in live code`).not.toContain(
        "getModelWithFallback",
      );
    }
  });
});
