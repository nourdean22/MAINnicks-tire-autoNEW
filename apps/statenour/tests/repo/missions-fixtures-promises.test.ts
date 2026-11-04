/**
 * R3 round 2, item 7 (CI run 41905313228): the e2e fixture lane failed on /missions with "Missions read page data
 * the fixtures do not answer" because the Promises section reads operator.promisesList on every load and
 * tests/e2e/fixtures/index.ts had no answer. Every query the section makes must have a fixture (not an allowlist
 * entry: the read is unconditional), with the shape the section renders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TRPC_FIXTURES, UNSTUBBED_ALLOWLIST } from "../e2e/fixtures";

const SECTION = "components/missions/promises-section.tsx";

/** `trpc.<router>.<procedure>.useQuery` reads in a source file, as fixture keys. */
function queriesIn(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/trpc\.(\w+)\.(\w+)\.useQuery\b/g)].map((m) => `${m[1]}.${m[2]}`);
}

describe("the Promises section's reads are answered by the e2e fixtures", () => {
  it("SUBJECT: the scan finds the section's list read", () => {
    expect(queriesIn(SECTION)).toContain("operator.promisesList");
  });

  it("every query the section makes has a fixture, not an allowlist pass", () => {
    for (const key of queriesIn(SECTION)) {
      expect(TRPC_FIXTURES, key).toHaveProperty([key]);
      expect(UNSTUBBED_ALLOWLIST.some((a) => (typeof a === "string" ? a === key : a.test(key))), key).toBe(false);
    }
  });

  it("the promisesList fixture has active and proposed rows and real counts", () => {
    const f = TRPC_FIXTURES["operator.promisesList"] as {
      active: Array<{ id: number; description: string; toWhom: string }>;
      proposed: Array<{ id: number; description: string }>;
      activeCount: number;
      proposedCount: number;
    };
    expect(f.active.length).toBeGreaterThanOrEqual(2);
    expect(f.proposed.length).toBeGreaterThanOrEqual(1);
    expect(f.activeCount).toBe(f.active.length);
    expect(f.proposedCount).toBeGreaterThanOrEqual(f.proposed.length);
    for (const r of [...f.active, ...f.proposed]) expect(r.description).toMatch(/demo/i);
  });
});
