import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * scripts/lint-curdate.mjs — no NEW bare CURDATE() in server SQL.
 *
 * Positive control first: a planted CURDATE() must FAIL the gate, and the real
 * tree must PASS. A gate that has never failed is a silent instrument, and one
 * that fails on a clean tree is switched off within a week.
 */
const APP = process.cwd();
const GATE = join(APP, "scripts/lint-curdate.mjs");
const gate = (args: string[] = []) => spawnSync(process.execPath, [GATE, ...args], { cwd: APP, encoding: "utf-8" });

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

/** A throwaway app root: server files + a baseline, so the real tree is never mutated. */
function fixture(files: Record<string, string>, baseline: Array<{ file: string; count: number; effect?: string; reason?: string }>) {
  dir = mkdtempSync(join(tmpdir(), "curdate-"));
  for (const [rel, src] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), src);
  }
  const bl = join(dir, "baseline.json");
  writeFileSync(bl, JSON.stringify({ entries: baseline.map((e) => ({ effect: "rolling-window", reason: "fixture", ...e })) }));
  return ["--root", dir, "--baseline-file", bl];
}

const SITE = "const q = sql`SELECT 1 FROM invoices WHERE invoiceDate >= CURDATE()`;\n";

describe("lint-curdate gate", () => {
  it("POSITIVE CONTROL: a planted CURDATE() in a file with no baseline FAILS", () => {
    const r = gate(fixture({ "server/services/x.ts": SITE }, []));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEW bare CURDATE\(\)/);
    expect(r.stderr).toMatch(/server\/services\/x\.ts\s+0 → 1/);
    expect(r.stderr).toMatch(/getBusinessDateKey/);
  });

  it("one more site than the file's baseline FAILS", () => {
    const r = gate(fixture({ "server/a.ts": SITE + SITE }, [{ file: "server/a.ts", count: 1 }]));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/a\.ts\s+1 → 2/);
  });

  it("a baselined site passes; comments, tests and CONVERT_TZ are not counted", () => {
    const r = gate(fixture({
      "server/a.ts": SITE +
        "// the old code used CURDATE() here\n/* CURDATE() in a block comment */\n" +
        "const ok = sql`DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))`;\n",
      "server/a.test.ts": SITE,
      "server/__tests__/b.ts": SITE,
    }, [{ file: "server/a.ts", count: 1 }]));
    expect(r.stdout).toMatch(/1 site\(s\) in 1 file\(s\)/);
    expect(r.status).toBe(0);
  });

  it("a FIXED site fails until the baseline is lowered (the ratchet)", () => {
    const r = gate(fixture({ "server/a.ts": "const x = 1;\n" }, [{ file: "server/a.ts", count: 1 }]));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/lower the baseline/);
  });

  it("a baseline entry without an effect class or reason FAILS", () => {
    const r = gate(fixture({ "server/a.ts": SITE }, [{ file: "server/a.ts", count: 1, reason: " " }]));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/without an effect class or reason/);
  });

  it("CLEAN TREE: the real server/ passes against config/curdate-baseline.json", () => {
    const r = gate();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no new bare CURDATE\(\)/);
  });
});
