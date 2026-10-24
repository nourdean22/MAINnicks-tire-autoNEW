/**
 * tests/components/brain/offline-reads.test.tsx - bdnick wave D round 2 (2026-10-24).
 *
 * A paused (offline) read has no data and no error (lib/query-state.ts). Five Brain blocks used to treat
 * it as "nothing to show", and the preferences card drew DEFAULT_VECTOR as if it were the saved vector.
 * Each must render the offline note (data-read-state="offline") instead, and the preferences card must
 * draw no axis bar.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/trpc/client", () => {
  const paused = { data: undefined, isError: false, isPending: true, isLoading: false, fetchStatus: "paused", status: "pending", refetch: () => Promise.resolve() };
  const make = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, k: string) => {
        if (k === "useQuery") return () => paused;
        if (k === "useMutation") return () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false });
        if (k === "useUtils") return () => make(["utils"]);
        if (k === "invalidate" || k === "fetch" || k === "refetch" || k === "setData") return () => Promise.resolve();
        return make([...path, k]);
      },
    });
  return { trpc: make([]) };
});
vi.mock("@/lib/events/data-change", () => ({ onDataChanged: () => () => undefined }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn(), info: vi.fn() }) }));

import { PreferencesCard } from "@/components/ultron/preferences-card";
import { DecisionReplayCard } from "@/components/ultron/decision-replay-card";
import { GhostNickStrip } from "@/components/ultron/ghost-nick/ghost-nick-strip";
import { InsightRibbon } from "@/components/brain/insight-ribbon";
import { PatternCard } from "@/components/brain/pattern-card";

let host: HTMLDivElement;
let root: Root;

async function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a paused read says offline, never draws defaults", () => {
  it("preferences: no axis bar, an offline note", async () => {
    await mount(<PreferencesCard />);
    expect(host.querySelector('input[type="range"]')).toBeNull();
    expect(host.querySelector('[data-read-state="offline"]')).not.toBeNull();
  });

  it.each([
    ["decision replays", <DecisionReplayCard key="d" />],
    ["Ghost Nick", <GhostNickStrip key="g" />],
    ["insight ribbon", <InsightRibbon key="i" />],
    ["patterns", <PatternCard key="p" />],
  ])("%s: an offline note", async (_name, node) => {
    await mount(node);
    expect(host.querySelector('[data-read-state="offline"]')).not.toBeNull();
  });
});
