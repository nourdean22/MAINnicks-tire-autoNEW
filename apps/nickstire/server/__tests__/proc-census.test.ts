/**
 * Registered-procedure census (2026-08-30 harvest) — emits the full
 * procedure list as `<type>.<path>`, the exact shape the
 * [tRPC first-call] probe logs, to eval-datasets/proc-census.json.
 * Lives as a test because importing appRouter spins up the full
 * router graph (heavy modules); the vitest env already pays that
 * cost for trpc-auth-tier.test.ts, which reads the same registry.
 *
 * This is the SUBTRAHEND of the dead-procedure harvest: probe lines
 * harvested from Railway logs minus this list = dead candidates for
 * the named window. NOT a delete list (#1478): every procedure is
 * reachable over HTTP by callers outside this repo.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { appRouter } from "../routers";

describe("registered-procedure census (harvest subtrahend)", () => {
  it("emits <type>.<path> for every registered procedure", () => {
    const procedures = (
      appRouter as unknown as { _def: { procedures: Record<string, { _def?: { type?: string } }> } }
    )._def.procedures;
    const out: string[] = [];
    for (const [path, proc] of Object.entries(procedures)) {
      const type = proc?._def?.type;
      if (!type) throw new Error(`procedure without type: ${path}`);
      out.push(`${type}.${path}`);
    }
    out.sort();
    const outPath = join(process.cwd(), "eval-datasets", "proc-census.json");
    writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), count: out.length, procedures: out }, null, 2) + "\n");
    console.log(`registered procedures: ${out.length} -> ${outPath}`);
    expect(out.length).toBeGreaterThan(100);
  });
});
