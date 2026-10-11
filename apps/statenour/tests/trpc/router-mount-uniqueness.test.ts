/**
 * Every tRPC procedure is mounted at exactly one path (audit 03-F6).
 *
 * systemAutomation and systemBrain were carved out of `system` by spreading the same procedure objects, but
 * `system` kept spreading them too: 17 procedures answered under two paths. React Query keys on the path, so a
 * mutation that invalidated `system.cronDeck` never refreshed the page that queried `systemAutomation.cronDeck`
 * (a kill-switch toggle on /system/crons showed the old state until the 30 s poll).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { appRouter } from "@/lib/trpc/root";
import { router, publicProcedure } from "@/lib/trpc/trpc";

function mountedTwice(r: { _def: { procedures: Record<string, unknown> } }): string[][] {
  const pathsByProc = new Map<unknown, string[]>();
  for (const [path, proc] of Object.entries(r._def.procedures)) {
    pathsByProc.set(proc, [...(pathsByProc.get(proc) ?? []), path]);
  }
  return [...pathsByProc.values()].filter((paths) => paths.length > 1);
}

describe("tRPC router mount uniqueness", () => {
  it("positive control: the walker sees a procedure mounted under two paths", () => {
    const p = publicProcedure.query(() => 1);
    const planted = router({ a: router({ x: p }), b: router({ x: p }) });
    expect(mountedTwice(planted)).toEqual([["a.x", "b.x"]]);
  });

  it("no procedure in appRouter answers under two paths", () => {
    expect(Object.keys(appRouter._def.procedures).length).toBeGreaterThan(100); // the walk saw the real tree
    expect(mountedTwice(appRouter)).toEqual([]);
  });
});
