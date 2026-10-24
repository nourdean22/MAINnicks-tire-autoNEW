/**
 * ThreadSuggestions used to return null on a failed read ("advisory, stays quiet") while the closed
 * Threads fold said "(1 unreadable)": the fold promised a failure the panel hid. The panel now says so.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const q = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    journal: {
      suggestions: { useQuery: () => ({ data: [], isError: false, isLoading: false, fetchStatus: "idle", refetch: () => {}, ...q.state }) },
      acceptSuggestion: { useMutation: () => ({ mutateAsync: async () => ({}) }) },
      dismissSuggestion: { useMutation: () => ({ mutateAsync: async () => ({}) }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { ThreadSuggestions } from "@/components/journal/thread-suggestions";

const render = () => renderToStaticMarkup(<ThreadSuggestions refreshSignal={0} onActioned={() => {}} />);

afterEach(() => {
  q.state = {};
});

describe("ThreadSuggestions read states", () => {
  it("a failed read says so and offers Retry, never nothing", () => {
    q.state = { data: undefined, isError: true };
    const html = render();
    expect(html).toContain("could not load. State unknown, not empty.");
    expect(html).toContain("Retry");
  });

  it("control: a measured empty list still renders nothing", () => {
    expect(render()).toBe("");
  });
});
