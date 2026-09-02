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

const SWALLOW = /recordsProcessed:\s*0,\s*details:\s*[`"'](Failed|Error)\b[^`"']*[`"'\$]/;

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

  it("no handler module returns a swallowed failure as a completed run", () => {
    const offenders: string[] = [];
    const allowlisted: string[] = [];
    for (const file of modules) {
      const rel = file.slice(APP.length + 1).replace(/\\/g, "/");
      const text = readFileSync(file, "utf8");
      if (!SWALLOW.test(text)) continue;
      if (rel in ALLOWLIST) { allowlisted.push(rel); continue; }
      offenders.push(rel);
    }
    expect(offenders, `cron handler(s) still swallow failures into \`completed\` — rethrow instead: ${offenders.join(", ")}`).toEqual([]);
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
