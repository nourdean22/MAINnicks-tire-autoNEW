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

/** Split each file into createFunction blocks and keep the cron-triggered ones. */
export function scanCronFunctions(dir: string = FN_DIR): CronFn[] {
  const out: CronFn[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.tsx?$/.test(f)) continue;
    const src = readFileSync(join(dir, f), "utf8");
    const starts = [...src.matchAll(/inngest\.createFunction\(/g)].map((m) => m.index!);
    for (let i = 0; i < starts.length; i++) {
      const block = src.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : src.length);
      if (!/\{\s*cron:/.test(block)) continue;
      const id = /id:\s*"([^"]+)"/.exec(block)?.[1] ?? "(no id)";
      const cron = /\{\s*cron:\s*"([^"]+)"/.exec(block)?.[1] ?? "?";
      // ⚠ Whitespace collapsed before matching: cron-heartbeat writes
      // `prisma.cronJobLog\n  .create({…})`, and a line-anchored pattern sees
      // nothing. That trap has now cost this repo three separate detectors.
      const flat = src.replace(/\s+/g, " ");
      const blockFlat = block.replace(/\s+/g, " ");
      const instrumented =
        /cronJobLog\s*\.\s*create/.test(blockFlat) ||
        new RegExp(`recordSelfRow\\(\\s*step\\s*,\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(flat);
      out.push({ file: f, id, cron, instrumented });
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
    expect(create).toHaveBeenCalledWith({ data: { jobName: "goal-pruner", status: "success" } });
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
