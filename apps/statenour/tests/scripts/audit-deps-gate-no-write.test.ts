/**
 * 10-R3-N1 · `check:audit-deps` runs inside verify:hard, and every worktree binds the PRODUCTION
 * DATABASE_URL, so a high/critical advisory wrote ErrorLog rows to prod from a local gate run.
 * The gate must pass --dry-run, and --dry-run must return before the write (prod-db-guard: a flag is not
 * a guard until a non-executing read proves it). main() runs with the argv package.json really passes;
 * the scanner is faked (no network) and loading prisma at all counts as reaching the write.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadDecls } from "./fixtures/script-decls";

const gateCommand = (): string => JSON.parse(readFileSync("package.json", "utf8")).scripts["check:audit-deps"];
const HIGH = { level: "high", scanned: 1, versions: 1, hits: [{ name: "left-pad", severity: "high", title: "proto pollution" }] };
const CRITICAL = { ...HIGH, hits: [{ name: "left-pad", severity: "critical", title: "rce" }] };

async function runMain(command: string, scan: object = HIGH) {
  const args = command.split(/\s+/);
  const create = vi.fn().mockResolvedValue({});
  const requireFn = vi.fn((id: string) => {
    if (id === "@/lib/prisma") return { prisma: { errorLog: { create } } };
    throw new Error(`unexpected require ${id}`);
  });
  const proc = {
    argv: ["node", ...args.slice(args.indexOf("scripts/audit-deps.ts"))],
    exit(code?: number): never {
      throw { exited: code ?? 0 };
    },
  };
  const { main } = loadDecls("scripts/audit-deps.ts", ["extractFindings", "writeFindings", "main"], {
    process: proc,
    console: { log: () => {}, error: () => {} },
    runBulkAdvisoryScan: () => scan,
    require: requireFn,
  });
  const out = await main().then(() => ({ exited: "returned" }), (e: { exited?: unknown }) => e);
  return { code: out.exited, requireFn, create };
}

describe("check:audit-deps never writes to the bound database", () => {
  it("the verify:hard command passes --dry-run", () => {
    expect(gateCommand().split(/\s+/)).toContain("--dry-run");
  });

  it("the verify:hard command, run with a HIGH finding, never loads prisma and exits 0", async () => {
    const { code, requireFn, create } = await runMain(gateCommand());
    expect(code).toBe(0);
    expect(requireFn).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("--dry-run does not defang the gate: a CRITICAL still exits 1, still without loading prisma", async () => {
    const { code, requireFn } = await runMain(gateCommand(), CRITICAL);
    expect(code).toBe(1);
    expect(requireFn).not.toHaveBeenCalled();
  });

  it("CONTROL: without --dry-run the same finding IS written (the fake write path is live)", async () => {
    const { requireFn, create } = await runMain("tsx scripts/audit-deps.ts");
    expect(requireFn).toHaveBeenCalledWith("@/lib/prisma");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
