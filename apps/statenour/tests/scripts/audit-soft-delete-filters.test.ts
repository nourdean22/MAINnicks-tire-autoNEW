/**
 * scripts/audit-soft-delete-filters.ts against the REAL scanner, on scratch copies of lib/services/contradictions.ts
 * (manager round 1 part 2, 2026-11-03; guard-red-team). The second reader proved two bypasses: a by-signature waiver
 * exempted any unfiltered count whose 12-line window reached a waived line, and the window itself let a count borrow
 * `deletedAt` from the next call's text. Ruling: no waiver; the two counts spell `deletedAt: null` at the call, and the
 * scanner reads the call's own argument (balanced parentheses), not 12 lines.
 * Expected exits: clean copy 0; an unfiltered count appended 1; the same line six lines above a filtered count 1;
 * a new `count({ where })` with an unfiltered local where 1.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "../..");
const SCRIPT = path.join(APP, "scripts/audit-soft-delete-filters.ts");
const TSX = path.join(APP, "node_modules/tsx/dist/cli.mjs");
const REAL = fs.readFileSync(path.join(APP, "lib/services/contradictions.ts"), "utf8");
const dirs: string[] = [];

function scan(contradictionsSource: string): { status: number | null; out: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sd-audit-"));
  dirs.push(root);
  fs.mkdirSync(path.join(root, "prisma"));
  fs.copyFileSync(path.join(APP, "prisma/schema.prisma"), path.join(root, "prisma/schema.prisma"));
  fs.mkdirSync(path.join(root, "lib/services"), { recursive: true });
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(path.join(root, "lib/services/contradictions.ts"), contradictionsSource);
  const r = spawnSync(process.execPath, [TSX, SCRIPT], { cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("audit-soft-delete-filters on contradictions.ts", () => {
  it("POSITIVE CONTROL: the scanner located both real counts (2 aggregate reads) and passes the clean file", () => {
    const r = scan(REAL);
    expect(r.out).toMatch(/2 aggregate reads/);
    expect(r.status).toBe(0);
  });

  it("an unfiltered count appended to the file fails", () => {
    const r = scan(`${REAL}\nexport const __c1 = () => prisma.contradiction.count({ where: {} });\n`);
    expect(r.out).toMatch(/1 NEW aggregate read/);
    expect(r.status).toBe(1);
  });

  it("the same unfiltered count six lines above a filtered count fails (it cannot borrow the next call's deletedAt)", () => {
    const lines = REAL.split("\n");
    const at = lines.findIndex((l) => l.includes("prisma.contradiction.count("));
    expect(at).toBeGreaterThan(6);
    lines.splice(at - 6, 0, "  void prisma.contradiction.count({ where: {} });");
    const r = scan(lines.join("\n"));
    expect(r.out).toMatch(/1 NEW aggregate read/); // a crash also exits 1: assert the finding, not the code
    expect(r.status).toBe(1);
  });

  it("a new count({ where }) with an unfiltered local where fails", () => {
    const r = scan(
      `${REAL}\nexport async function __c2() {\n  const where = { resolved: false };\n  return Promise.all([\n    prisma.contradiction.count({ where }),\n  ]);\n}\n`,
    );
    expect(r.out).toMatch(/1 NEW aggregate read/);
    expect(r.status).toBe(1);
  });
});
