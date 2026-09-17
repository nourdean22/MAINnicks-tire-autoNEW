/**
 * Every cron-triggered Inngest function must prove it was invoked.
 *
 * WHY — measured 2026-09-17. `/api/cron/*` routes are wrapped by
 * cronHandler -> logCronRun, so route crons appear in `cron_job_log`
 * automatically. Inngest functions BYPASS that wrapper: of 21 cron-triggered
 * functions, only 5 wrote a row. The other 16 were invisible to the log,
 * `/system/crons`, and every audit built on them — they could stop firing
 * tomorrow and nothing would look different.
 *
 * That is not hypothetical: `data-cleanup` (a VISIBLE route cron) went quiet on
 * 2026-09-01 and nobody noticed for 16 days. The invisible ones have no such
 * tripwire at all.
 *
 * ⚠⚠ THIS GUARD KEYS ON THE FUNCTION, NOT THE FILE. Two files hold TWO cron
 * functions each — intelligence-brief (daily + weekly) and journal-convergence
 * (scan + dormancy). A per-file check passes the moment ONE of the pair is
 * instrumented, leaving the other exactly as blind as before while reporting
 * the tree clean. A first draft of this audit was per-file and would have done
 * precisely that.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../lib/inngest/functions");

interface CronFn {
  file: string;
  id: string;
  cron: string;
  instrumented: boolean;
}

/**
 * Is the proof-of-invocation call the FIRST statement of this handler?
 *
 * ⚠⚠ PRESENCE IS NOT POSITION, and an earlier version only checked presence by
 * searching the flattened file. That passes when the call is moved BELOW
 * fallible work — at which point an early crash again leaves no row, which is
 * the entire failure being guarded against — and it also passes on a call that
 * appears only inside a comment or a dead helper.
 *
 * Comments are stripped first so a commented-out call cannot satisfy the guard,
 * and only the text BEFORE the call inside the handler body is inspected: any
 * `await`/`step.run` ahead of it means something fallible runs first.
 */
/** Blank comments while preserving offsets, so a mention cannot pose as code. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .split("\n")
    .map((l) => {
      const i = l.indexOf("//");
      return i >= 0 ? l.slice(0, i) + " ".repeat(l.length - i) : l;
    })
    .join("\n");
}

export function isInstrumentedFirst(block: string, id: string, wholeFile = ""): boolean {
  // Pre-existing inline writers (cron-heartbeat, mega-fanout) already place
  // their row first; whitespace is collapsed because cron-heartbeat writes
  // `prisma.cronJobLog\n  .create({…})` and a line-anchored pattern sees
  // nothing — a trap that has cost this repo three separate detectors.
  // Strip defensively as well as at the caller: stripComments is idempotent,
  // and a helper whose correctness depends on the caller having remembered is
  // one refactor away from silently accepting a commented-out call.
  const flat = stripComments(block).replace(/\s+/g, " ");
  if (/cronJobLog\s*\.\s*create/.test(flat)) return true;

  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const call = new RegExp(`recordSelfRow\\(\\s*step\\s*,\\s*"${esc}"`);
  let m = call.exec(flat);

  // ⚠⚠ THE HANDLER IS NOT ALWAYS INSIDE THE createFunction BLOCK.
  // `audit-todays-leads.ts` defines `auditTodaysLeadsHandler` as a NAMED export
  // ~130 lines ABOVE its createFunction call, so a block-scoped search finds
  // nothing and reports a correctly-instrumented cron as blind. Fall back to
  // the whole file, then position-check inside whichever function body holds
  // the call.
  let scope = flat;
  if (!m && wholeFile) {
    scope = stripComments(wholeFile).replace(/\s+/g, " ");
    m = call.exec(scope);
  }
  if (!m) return false;
  return isFirstInItsBody(scope, m.index);
}

/** True when nothing fallible runs between the enclosing body's `{` and `at`. */
function isFirstInItsBody(flat: string, at: number): boolean {
  // ⚠ The NEAREST PRECEDING body opening, not the first one in scope. When the
  // search widened to whole files (for named handlers), taking the first match
  // measured from some unrelated function far above and silently compared the
  // wrong span.
  //
  // Both shapes count: the inline `async ({ step }) => {` every sibling uses,
  // and the `async function name({ step }…) {` that audit-todays-leads uses.
  const OPENERS = /async\s*(?:function\s+\w+\s*)?\(\s*\{[^}]*\}[^)]*\)\s*(?:=>\s*)?\{/g;
  let bodyStart = 0;
  for (const o of flat.matchAll(OPENERS)) {
    const end = o.index! + o[0].length;
    if (end <= at) bodyStart = end;
    else break;
  }

  // ⚠ Drop the trailing `await` — it belongs to the recordSelfRow call itself,
  // not to work preceding it. Counting it made this reject the CORRECT shape,
  // which the positive control caught immediately; without that control the
  // ratchet would have reported all 17 crons blind and sent me hunting a
  // defect that did not exist.
  const before = flat.slice(bodyStart, at).replace(/\bawait\s*$/, "");
  return !/\bawait\b|\bstep\s*\.\s*run\b|\breturn\b/.test(before);
}

/** Split each file into createFunction blocks and keep the cron-triggered ones. */
export function scanCronFunctions(dir: string = FN_DIR): CronFn[] {
  const out: CronFn[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.tsx?$/.test(f)) continue;
    // ⚠⚠ STRIP COMMENTS BEFORE SPLITTING, NOT AFTER — and this one bit for
    // real. A comment in approval-sweeper.ts explaining the very bug this
    // guard exists for contains the literal `.createFunction(...)` twice, so
    // splitting the raw source on that pattern created two PHANTOM block
    // boundaries, severed the handler from its config, and hid the call that
    // had just been added. ★ Documenting a fix concealed its own fix —
    // the identical failure this repo already recorded for the terse-lane
    // guard, reproduced on the same night by the same hand.
    const src = stripComments(readFileSync(join(dir, f), "utf8"));
    // ⚠⚠ MATCH EVERY createFunction FORM, NOT JUST THE COMMON ONE.
    // `approval-sweeper.ts` writes `getInngest().createFunction(...)` while
    // every sibling uses a module-level `inngest.createFunction(...)`. A
    // literal `inngest\.createFunction\(` pattern skips it — and BOTH the
    // instrumentation pass AND this guard originally used that pattern, so the
    // fix missed the five-minute sweeper and the guard reported the fleet
    // clean. ★ A detector sharing an assumption with the thing it checks
    // cannot catch that assumption being wrong; it just produces a green.
    const starts = [...src.matchAll(/\.createFunction\s*\(/g)].map((m) => m.index!);
    for (let i = 0; i < starts.length; i++) {
      const block = src.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : src.length);
      if (!/\{\s*cron:/.test(block)) continue;
      const id = /id:\s*"([^"]+)"/.exec(block)?.[1] ?? "(no id)";
      const cron = /\{\s*cron:\s*"([^"]+)"/.exec(block)?.[1] ?? "?";
      out.push({ file: f, id, cron, instrumented: isInstrumentedFirst(block, id, src) });
    }
  }
  return out;
}

const FNS = scanCronFunctions();

/**
 * ── CANARY · the "never throws" guarantee must be REAL ──────────────
 *
 * The first version used `prisma.cronJobLog.create(...).catch(...)` while its
 * docstring promised it never throws. `.catch()` only handles a REJECTED
 * PROMISE; an undefined `prisma.cronJobLog` throws SYNCHRONOUSLY on property
 * access, before a promise exists, so the handler blew up —
 * `TypeError: Cannot read properties of undefined (reading 'create')` — and
 * took a real cron test down with it.
 *
 * ★ A telemetry write that can fail its own job is strictly worse than the
 *   blindness it replaces. This asserts the guarantee against the exact shape
 *   that broke it, rather than trusting the sentence in the docstring.
 */
describe("recordSelfRow · never throws", () => {
  const stubStep = { run: async (_id: string, fn: () => Promise<unknown>) => fn() };

  it("CANARY — survives a prisma client with no cronJobLog at all", async () => {
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({ prisma: {} }));
    vi.doMock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
    const { recordSelfRow } = await import("../../lib/inngest/self-row");
    await expect(recordSelfRow(stubStep, "some-cron")).resolves.toBeUndefined();
  });

  it("survives a rejected create as well", async () => {
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({
      prisma: { cronJobLog: { create: () => Promise.reject(new Error("db down")) } },
    }));
    vi.doMock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
    const { recordSelfRow } = await import("../../lib/inngest/self-row");
    await expect(recordSelfRow(stubStep, "some-cron")).resolves.toBeUndefined();
  });

  it("positive control: it really does write when the client works", async () => {
    vi.resetModules();
    const create = vi.fn(async () => ({}));
    vi.doMock("@/lib/prisma", () => ({ prisma: { cronJobLog: { create } } }));
    vi.doMock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
    const { recordSelfRow } = await import("../../lib/inngest/self-row");
    await recordSelfRow(stubStep, "goal-pruner");
    // "partial", not "success": the row is written BEFORE the work, so it can
    // only witness invocation. Claiming success here would show a fresh green
    // for a job that then crashed — see the helper's own note.
    expect(create).toHaveBeenCalledWith({ data: { jobName: "goal-pruner", status: "partial" } });
  });
});

/**
 * ── NEGATIVE FIXTURES · the guard must REJECT, not just accept ──────
 *
 * Review asked for these, and they are the difference between a guard and a
 * decoration: a check that only ever passes proves nothing about what it would
 * catch. Each fixture is a regression that leaves an early crash with no
 * invocation row while looking instrumented to a presence-only scan.
 */
describe("isInstrumentedFirst · rejects the regressions", () => {
  const wrap = (body: string) => `.createFunction(\n  { id: "x", triggers: [{ cron: "0 1 * * *" }] },\n  async ({ step }) => {\n${body}\n  },\n)`;

  it("accepts the correct shape (positive control)", () => {
    expect(isInstrumentedFirst(wrap(`    await recordSelfRow(step, "x");\n    await step.run("work", async () => 1);`), "x")).toBe(true);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  it("CANARY — rejects a call placed AFTER fallible work", () => {
    expect(
      isInstrumentedFirst(wrap(`    await step.run("work", async () => 1);\n    await recordSelfRow(step, "x");`), "x"),
      "a row written after the work cannot witness an early crash",
    ).toBe(false);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  it("CANARY — rejects a call that exists only in a comment", () => {
    expect(
      isInstrumentedFirst(wrap(`    // await recordSelfRow(step, "x");\n    await step.run("work", async () => 1);`), "x"),
      "a commented-out call instruments nothing",
    ).toBe(false);
  });

  it("rejects a block-commented call too", () => {
    expect(isInstrumentedFirst(wrap(`    /* await recordSelfRow(step, "x"); */\n    await step.run("w", async () => 1);`), "x")).toBe(false);
  });

  it("rejects a missing call outright", () => {
    expect(isInstrumentedFirst(wrap(`    await step.run("work", async () => 1);`), "x")).toBe(false);
  });

  it("rejects a call for a DIFFERENT job id", () => {
    expect(isInstrumentedFirst(wrap(`    await recordSelfRow(step, "other");`), "x")).toBe(false);
  });
});

describe("inngest cron self-row", () => {
  // POSITIVE CONTROL — a broken scanner makes every assertion below pass on an
  // empty list, which is exactly how a guard reports a blind tree as clean.
  it("the scan sees the cron functions at all", () => {
    expect(FNS.length).toBeGreaterThanOrEqual(15);
    expect(FNS.filter((f) => f.instrumented).length).toBeGreaterThan(0);
  });

  // The per-function point, pinned: these two files each hold two cron
  // functions, so a per-file guard would pass with half of them blind.
  it("CANARY — counts functions, not files, where one file holds two crons", () => {
    for (const file of ["intelligence-brief.ts", "journal-convergence.ts"]) {
      expect(FNS.filter((f) => f.file === file).length, `${file} should contribute 2 cron functions`).toBe(2);
    }
  });

  // ── THE RATCHET ─────────────────────────────────────────────────────
  it("every cron-triggered inngest function writes a proof-of-invocation row", () => {
    const blind = FNS.filter((f) => !f.instrumented).map((f) => `${f.file}:${f.id} (${f.cron})`);
    expect(
      blind,
      "these crons would be invisible to cron_job_log and /system/crons — add " +
        "`await recordSelfRow(step, \"<id>\")` as the FIRST statement of the handler",
    ).toEqual([]);
  });

  /**
   * The jobName WRITTEN must exist in config/crons.ts, or the row lands under a
   * name the reconciler cannot attribute — as silent as no row at all, but
   * harder to spot.
   *
   * ⚠⚠ THE FUNCTION ID IS NOT ALWAYS THE JOB NAME, and an earlier version of
   * this test assumed it was. `mega-fanout.ts` exports functions with ids
   * `mega-fanout-morning` / `mega-fanout-evening` while deliberately logging
   * under `mega` / `mega-evening` — the names the manifest and the log have
   * always used. Comparing the ID flagged two correct, long-standing rows as
   * defects. Extract the string actually passed to the writer instead.
   */
  it("every jobName WRITTEN exists in the cron manifest", () => {
    const manifest = readFileSync(join(FN_DIR, "../../../config/crons.ts"), "utf8");
    const written = new Set<string>();
    for (const f of readdirSync(FN_DIR)) {
      if (!/\.tsx?$/.test(f)) continue;
      const flat = readFileSync(join(FN_DIR, f), "utf8").replace(/\s+/g, " ");
      for (const m of flat.matchAll(/recordSelfRow\(\s*step\s*,\s*"([^"]+)"/g)) written.add(m[1]);
      for (const m of flat.matchAll(/cronJobLog\s*\.\s*create\(\s*\{\s*data:\s*\{\s*jobName:\s*"([^"]+)"/g)) written.add(m[1]);
    }
    expect(written.size, "no jobNames extracted — the extractor is broken, not the code").toBeGreaterThan(10);
    const orphans = [...written].filter((n) => !manifest.includes(`name: "${n}"`));
    expect(orphans, "a jobName absent from config/crons.ts produces unattributable rows").toEqual([]);
  });
});
