/**
 * tests/brain/arbiter-judge-split-readonly.test.ts · 2026-10-16 (Brain W1, review round 2 R2-1)
 *
 * scripts/arbiter-judge-split.ts points at whatever DATABASE_URL the shell
 * holds (every worktree binds prod), so it is SELECT-only by construction and
 * that is pinned here. Method-call shapes, so the file's own prose cannot
 * satisfy or trip the scan; a POSITIVE CONTROL feeds known write shapes
 * through the same scanner so a scanner that matches nothing cannot pass.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { arbiterStateOf } from "../../scripts/arbiter-judge-split";

const src = readFileSync(new URL("../../scripts/arbiter-judge-split.ts", import.meta.url), "utf8");

const WRITE_SHAPES: Array<[string, RegExp]> = [
  ["create", /\.create(Many)?(AndReturn)?\s*\(/],
  ["update", /\.update(Many)?(AndReturn)?\s*\(/],
  ["delete", /\.delete(Many)?\s*\(/],
  ["upsert", /\.upsert\s*\(/],
  ["raw execute", /\$executeRaw/],
  ["raw query", /\$queryRaw/],
  ["transaction", /\$transaction/],
  ["run command raw", /\$runCommandRaw/],
  ["bracket access to a write", /\[\s*["'](create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|delete|deleteMany|upsert)["']\s*\]\s*\(/],
];

/** The scanner under test: every write shape the source matches. */
function findWrites(source: string): string[] {
  return WRITE_SHAPES.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

describe("the arbiter judge-split CLI is read-only by construction", () => {
  it("POSITIVE CONTROL: the scanner goes red on every known write shape", () => {
    const samples: Array<[string, string]> = [
      ["create", "await prisma.brainMemory.create({ data })"],
      ["create", "await prisma.brainMemory.createManyAndReturn({ data })"],
      ["update", "await prisma.chatMessage.updateManyAndReturn({ where, data })"],
      ["delete", "await prisma.chatMessage.deleteMany({ where })"],
      ["upsert", "await prisma.x.upsert({})"],
      ["raw execute", "await prisma.$executeRawUnsafe('DELETE FROM x')"],
      ["raw query", "await prisma.$queryRaw`SELECT 1`"],
      ["transaction", "await prisma.$transaction([])"],
      ["run command raw", "await prisma.$runCommandRaw({})"],
      ["bracket access to a write", 'await prisma["brainMemory"]["delete"]({ where })'],
    ];
    for (const [label, sample] of samples) {
      expect(findWrites(sample), sample).toContain(label);
    }
    expect(findWrites("await prisma.brainMemory.findMany({ where })")).toEqual([]);
  });

  it("the script matches none of them", () => {
    expect(findWrites(src)).toEqual([]);
  });

  it("still actually reads judge rows and chat messages (the scan above is not passing by vacuity)", () => {
    expect(src).toMatch(/brainMemory\.findMany\s*\(/);
    expect(src).toMatch(/chatMessage\.findMany\s*\(/);
    expect(src).toMatch(/reply_judgment/);
  });

  it("splits by the persisted contextReceipt.arbiter into true / false / unknown, 7-day default window", () => {
    expect(src).toMatch(/contextReceipt/);
    expect(src).toMatch(/"unknown"/);
    expect(src).toMatch(/--days/);
    expect(src).toMatch(/\?\?\s*7\b/);
    expect(src).toMatch(/p50/);
    expect(src).toMatch(/mean/);
  });

  it("refuses to run without a DATABASE_URL rather than defaulting, and does not run main() on import", () => {
    expect(src).toMatch(/DATABASE_URL/);
    expect(src).toMatch(/process\.exit\(1\)/);
    expect(src).toMatch(/process\.argv\[1\]/);
  });
});

describe("arbiterStateOf · the persisted tokenUsage.contextReceipt.arbiter read", () => {
  it("true / false when the receipt carries the W1 field", () => {
    expect(arbiterStateOf({ contextReceipt: { arbiter: true, entries: [] } })).toBe("true");
    expect(arbiterStateOf({ contextReceipt: { arbiter: false, entries: [] } })).toBe("false");
  });
  it("unknown for a missing receipt, a pre-W1 receipt without the field, or garbage; never false", () => {
    expect(arbiterStateOf(null)).toBe("unknown");
    expect(arbiterStateOf({ traceId: "t" })).toBe("unknown");
    expect(arbiterStateOf({ contextReceipt: { entries: [], tokensBudget: 7250 } })).toBe("unknown");
    expect(arbiterStateOf({ contextReceipt: { arbiter: "true" } })).toBe("unknown");
    expect(arbiterStateOf("nope")).toBe("unknown");
  });
});
