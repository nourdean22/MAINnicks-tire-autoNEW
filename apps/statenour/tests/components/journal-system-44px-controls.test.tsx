/**
 * CI round (PR 3260): target-size at 390 px failed on controls that only render WITH data, which the
 * local dead-DB render never shows: the tool-census filter chips (/system) and "+ new thread" (/journal).
 * This renders those components with fixture data and requires every control to carry the 44 px floor
 * in its class, so a data-backed control cannot ship at 32 px again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const store = vi.hoisted(() => ({ q: {} as Record<string, unknown> }));
vi.mock("@/lib/trpc/client", () => {
  const base = { isError: false, isLoading: false, fetchStatus: "idle", refetch: () => {}, error: null };
  const proc = (name: string) => ({
    useQuery: () => ({ ...base, data: store.q[name] }),
    useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }),
  });
  const ns = new Proxy({}, { get: (_t, name: string) => proc(name) });
  return { trpc: { system: ns, journal: ns } };
});
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { ToolUsageCensusPanel } from "@/components/system/tool-usage-census-panel";
import { ThreadRail } from "@/components/journal/thread-rail";
import { ThreadRadar } from "@/components/journal/thread-radar";

const FLOOR = /min-h-11|min-h-\[44px\]|min-h-\[48px\]|\bh-11\b|\bh-12\b/;

/** Every <button> and <a> start tag in the markup, as its class attribute plus visible text. */
function controls(html: string): { cls: string; text: string }[] {
  const out: { cls: string; text: string }[] = [];
  const re = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({
      cls: /class="([^"]*)"/.exec(m[2])?.[1] ?? "",
      text: m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}
const expectFloor = (html: string, min: number) => {
  const found = controls(html);
  expect(found.length, "the subject rendered no controls").toBeGreaterThanOrEqual(min);
  for (const c of found) expect(c.cls, `"${c.text}" is under the 44 px floor`).toMatch(FLOOR);
};

afterEach(() => {
  store.q = {};
});

const thread = (id: string, status = "active") => ({
  id, name: `Thread ${id}`, summary: null, status, coherence: 0.8, memberCount: 3,
  detectedAt: "2026-10-01T00:00:00Z", namedAt: "2026-10-01T00:00:00Z", lastJoinAt: "2026-10-20T00:00:00Z",
  recentExcerpts: ["an excerpt"], joins7d: 2, joinsPrior7d: 1, trend: "steady",
});

describe("tool census filter chips (seeded data)", () => {
  it("every chip is a 44 px control", () => {
    store.q = {
      toolUsageCensus: {
        highFailure: [], neverInvoked: Array.from({ length: 130 }, (_, i) => ({ name: `tool${i}`, calls: 0, failures: 0 })),
        surfacedNeverChosen: [], neverSurfaced: [], stale: [],
        surfacedWindow: { turns: 40, windowDays: 7 }, chosenWindow: { turns: 40, windowDays: 7 },
      },
      instrumentHealth: { attention: [], assistantTurns: 40 },
    };
    const html = renderToStaticMarkup(<ToolUsageCensusPanel />);
    expect(html).toContain('role="tablist"');
    expectFloor(html, 3);
  });
});

describe("thread rail and radar controls (seeded data)", () => {
  it("the empty-state '+ new thread' is a 44 px control", () => {
    store.q = { threads: [] };
    const html = renderToStaticMarkup(<ThreadRail refreshSignal={0} />);
    expect(html).toContain("+ new thread");
    expectFloor(html, 1);
  });

  it("with threads, '+ new', 'Show n dormant' and the failed-read Retry are 44 px controls", () => {
    store.q = { threads: [thread("a"), thread("b", "dormant")] };
    const html = renderToStaticMarkup(<ThreadRail refreshSignal={0} />);
    expect(html).toContain("+ new");
    expect(html).toContain("dormant");
    expectFloor(html, 3);
  });

  it("the radar's scan buttons are 44 px controls", () => {
    store.q = { convergence: [] };
    const html = renderToStaticMarkup(<ThreadRadar />);
    expect(html).toContain("Scan radar now");
    expectFloor(html, 1);
  });
});
