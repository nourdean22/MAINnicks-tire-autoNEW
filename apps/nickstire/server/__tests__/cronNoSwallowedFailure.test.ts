/**
 * No cron handler may swallow its failure into a `completed` run (audit F-9).
 *
 * cron_log records `completed` whenever a handler RETURNS, and the observer's
 * failure-streak alert reads that status — it never reads `details`. So
 * `return { recordsProcessed: 0, details: "Failed: …" }` is a run that failed
 * every day for weeks with no alert. The 2026-09-01 wave converted every such
 * catch to a rethrow; this gate keeps it that way.
 *
 * The scan set is DERIVED from the scheduler: every module a tier handler
 * dynamically imports is scanned, so a new job cannot escape by living in a
 * new file. Positive control: the regex is proven against the exact old
 * pattern; negative control: an allowlisted file with its own status
 * contract is reported as allowlisted, not silently skipped.
 *
 * 2026-09-23 widening: the first regex only matched a details string that
 * STARTED with "Failed"/"Error" AND sat right after `recordsProcessed: 0,`.
 * Nineteen swallows escaped it — `Reminders failed: …`, `digest failed: …`,
 * `Google API error: …`, and `{ details: `Error: …` }` with no
 * recordsProcessed at all. The scan now reads every `details:` string literal
 * and flags one that leads with failed/error OR names a failure mid-string
 * ("<x> failed: …", "<x> error: …"). Count summaries ("3 sent · 1 failed",
 * "failed=2", "errors=0") carry no colon after the word and do not match.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";

const APP = join(__dirname, "..", "..");
const CRON_DIR = join(APP, "server", "cron");

/** Files with their own explicit status contract read by callers (not the cron runner). */
const ALLOWLIST: Record<string, string> = {
  "server/services/igAutopost.ts": "returns { status: 'failed' } which its callers and tests assert on; the IG lane has its own ledger",
};

/**
 * Literals with a failure-shaped text that are provably NOT a cron run's
 * result, pinned by exact text and exact count so a second copy cannot hide
 * behind the first.
 */
const LITERAL_ALLOWLIST: { file: string; text: string; count: number; reason: string }[] = [
  {
    file: "server/services/weatherIntelligence.ts",
    text: "API error: ${res.status}",
    count: 1,
    reason: "evaluateWeatherTriggers() is the side-effect-free read for the shadow planner/dashboards; no cron handler calls it. checkWeatherTriggers (the cron path) throws.",
  },
];

/**
 * NOT an allowlist: real swallowed failures in a file another session owns
 * right now. Shrink-only — the count may fall to 0 (the owner fixed it; then
 * delete the entry) but never rise. Nothing else may be added here.
 */
const KNOWN_OPEN: { file: string; text: string; max: number; owner: string }[] = [
  { file: "server/cron/scheduler.ts", text: "overnight probe failed: ${(e as Error).message}", max: 1, owner: "concurrent scheduler.ts session (2026-09-23)" },
  { file: "server/cron/scheduler.ts", text: "evening probe failed: ${(e as Error).message}", max: 1, owner: "concurrent scheduler.ts session (2026-09-23)" },
];

/** Every `details:` string literal — template, double- or single-quoted, even on the next line. */
const DETAILS_LITERAL = /details:\s*(?:`([^`]*)`|"([^"\n]*)"|'([^'\n]*)')/g;
/** Leads with failed/error, or names a failure mid-string ("X failed: …", "API error: …"). */
const FAILURE_TEXT = /^\s*(?:failed|error)\b|\b(?:failed|error)\s*:/i;

/** The failure-reporting `details:` literals in a source text, with 1-based line numbers. */
function swallowedFailures(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  for (const m of src.matchAll(DETAILS_LITERAL)) {
    const text = m[1] ?? m[2] ?? m[3] ?? "";
    if (FAILURE_TEXT.test(text)) out.push({ line: src.slice(0, m.index).split("\n").length, text });
  }
  return out;
}
const SWALLOW = { test: (src: string) => swallowedFailures(src).length > 0 };

function handlerModules(): string[] {
  const files = ["scheduler.ts", "index.ts"].map((f) => join(CRON_DIR, f));
  const out = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/import\("([^"]+)"\)/g)) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(f), spec);
      for (const cand of [base + ".ts", base + ".mts", join(base, "index.ts")]) {
        if (existsSync(cand)) { out.add(cand); break; }
      }
    }
  }
  return [...out].sort();
}

describe("cron handlers fail loudly", () => {
  const modules = handlerModules();

  it("derives a real scan set from the scheduler (the instrument fired)", () => {
    expect(modules.length).toBeGreaterThan(40);
    expect(modules.some((m) => m.endsWith("chatFaqPipeline.ts"))).toBe(true);
  });

  it("positive control — the regex catches the exact pattern that was removed", () => {
    expect(SWALLOW.test('    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };')).toBe(true);
    expect(SWALLOW.test('    return { recordsProcessed: 0, details: `Error: ${msg}` };')).toBe(true);
    expect(SWALLOW.test('    return { recordsProcessed: 0, details: "Skipped · no DB" };')).toBe(false);
  });

  it("positive control — the widened scan catches every shape the first regex let through", () => {
    // Each of these was live on main 2026-09-23 and recorded `completed`.
    expect(SWALLOW.test('    return { recordsProcessed: 0, details: `Reminders failed: ${(e as Error).message}` };')).toBe(true);
    expect(SWALLOW.test('    return { recordsProcessed: 0, details: `digest failed: ${msg}` };')).toBe(true);
    expect(SWALLOW.test('      return { recordsProcessed: 0, details: `Google API error: ${response.status}` };')).toBe(true);
    expect(SWALLOW.test('    return { details: `Error: ${err instanceof Error ? err.message : "unknown"}` };')).toBe(true);
    expect(SWALLOW.test('    return { details: "Failed to fetch from statenour" };')).toBe(true);
    expect(SWALLOW.test('    return { recordsProcessed: 0, details: `error=${msg}` };')).toBe(true);
    expect(SWALLOW.test("    return { recordsProcessed: 3, details: 'Publish failed: quota' };")).toBe(true);
    expect(SWALLOW.test('    return {\n      recordsProcessed: 0,\n      details:\n        `error: ${String(err)}`,\n    };')).toBe(true);
  });

  it("negative control — count summaries and plain skips stay green", () => {
    expect(SWALLOW.test('return { recordsProcessed: n, details: `${sent} sent · ${failed} failed` };')).toBe(false);
    expect(SWALLOW.test('return { recordsProcessed: n, details: `placed=${p} skipped=${s} failed=${f}` };')).toBe(false);
    expect(SWALLOW.test('details: `audited=${n} errors=${errored}`,')).toBe(false);
    expect(SWALLOW.test('details: `stamped sent ${s} · failed ${f} · left queued ${l}`,')).toBe(false);
    expect(SWALLOW.test('return { recordsProcessed: 0, details: "skip · not Monday (shop TZ)" };')).toBe(false);
    expect(SWALLOW.test('return { recordsProcessed: 0, details: "No inventory table" };')).toBe(false);
    // A thrown Error carries the text, but it is not a `details:` result.
    expect(SWALLOW.test('throw new Error(`Reminders failed: ${(e as Error).message}`, { cause: e });')).toBe(false);
  });

  it("no handler module returns a swallowed failure as a completed run", () => {
    const offenders: string[] = [];
    const allowlisted: string[] = [];
    const literalHits = new Map<string, number>();
    const openHits = new Map<string, number>();
    for (const file of modules) {
      const rel = file.slice(APP.length + 1).replace(/\\/g, "/");
      const hits = swallowedFailures(readFileSync(file, "utf8"));
      if (hits.length === 0) continue;
      if (rel in ALLOWLIST) { allowlisted.push(rel); continue; }
      for (const h of hits) {
        const entry = LITERAL_ALLOWLIST.find((e) => e.file === rel && e.text === h.text);
        if (entry) { literalHits.set(`${rel}|${h.text}`, (literalHits.get(`${rel}|${h.text}`) ?? 0) + 1); continue; }
        const open = KNOWN_OPEN.find((e) => e.file === rel && e.text === h.text);
        if (open) { openHits.set(`${rel}|${h.text}`, (openHits.get(`${rel}|${h.text}`) ?? 0) + 1); continue; }
        offenders.push(`${rel}:${h.line} ${JSON.stringify(h.text.slice(0, 80))}`);
      }
    }
    expect(offenders, `cron handler(s) still swallow failures into \`completed\` — rethrow instead: ${offenders.join(", ")}`).toEqual([]);
    // Exact counts: a second copy of an allowlisted literal is an offender, a
    // removed one is a stale entry.
    for (const e of LITERAL_ALLOWLIST) {
      expect(literalHits.get(`${e.file}|${e.text}`) ?? 0, `${e.file}: allowlisted literal ${JSON.stringify(e.text)} count drifted — re-justify or remove`).toBe(e.count);
    }
    for (const e of KNOWN_OPEN) {
      expect(openHits.get(`${e.file}|${e.text}`) ?? 0, `${e.file}: known-open swallow ${JSON.stringify(e.text)} was COPIED — it may only shrink`).toBeLessThanOrEqual(e.max);
    }
    // A stale allowlist entry (file no longer matches) would be silent; keep it honest.
    for (const rel of Object.keys(ALLOWLIST)) {
      const file = join(APP, rel);
      if (existsSync(file) && modules.includes(resolve(file))) {
        expect(allowlisted, `${rel} is allowlisted but no longer matches — remove it`).toContain(rel);
      }
    }
  });
});

/**
 * Second shape (self-review on PR #2063): the scheduler file ITSELF wraps some
 * handlers in `try { … } catch (e) { log.warn(…); return { details: "X failed" }; }`
 * — one frame above the module the first scan covers. A rethrow inside
 * chatFaqPipeline.ts was caught by exactly such a wrapper and recorded
 * `completed` again, and the module scan was green. Twelve more wrappers of
 * that shape lived in scheduler.ts. This scan reads the wiring files directly.
 */
const INLINE_SWALLOW = /catch \((?:e|err|error)(?::\s*unknown)?\)\s*\{\s*(?:log\.\w+\([^;]*\);\s*)?return \{[^}]*details:\s*[`"'][^`"']*(?:failed|skipped)/i;

describe("the scheduler's own inline handlers fail loudly", () => {
  const wiring = ["scheduler.ts", "index.ts"].map((f) => join(CRON_DIR, f));

  it("positive control — the regex catches the exact wrapper that was removed, and ignores a legitimate skip outside a catch", () => {
    expect(INLINE_SWALLOW.test('} catch (e) { log.warn("[cron/scheduler] operation failed:", e); return { details: "Accuracy check failed" }; }')).toBe(true);
    expect(INLINE_SWALLOW.test('} catch (e: unknown) { return { details: `Digest failed: ${(e as Error).message}` }; }')).toBe(true);
    expect(INLINE_SWALLOW.test('} catch (e) { log.warn("x", e); return { details: "Segmentation skipped" }; }')).toBe(true);
    expect(INLINE_SWALLOW.test('if (dow !== "Sunday") return { details: "Not Sunday, skipped" };')).toBe(false);
    expect(INLINE_SWALLOW.test('} catch (e) { log.warn("[cron/scheduler] operation failed:", e); throw e; }')).toBe(false);
  });

  it("no inline catch in scheduler.ts / index.ts returns a failure as a completed run", () => {
    const offenders: string[] = [];
    for (const f of wiring) {
      const text = readFileSync(f, "utf8");
      const lines = text.split("\n");
      lines.forEach((line, i) => { if (INLINE_SWALLOW.test(line)) offenders.push(`${f.slice(APP.length + 1).replace(/\\/g, "/")}:${i + 1}`); });
    }
    expect(offenders, `inline catch(es) still swallow a failure into \`completed\` — rethrow instead: ${offenders.join(", ")}`).toEqual([]);
  });
});
