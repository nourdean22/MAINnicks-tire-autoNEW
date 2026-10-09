/**
 * AI Ideas · a failed chat-funnel read is reported on its card, not as a page error (2026-10-09).
 *
 * Since 2026-10-09 `intelligence.chatFunnel` errors on a failed read instead of returning an empty
 * funnel (see server/routers/intelligenceChatFunnelUnavailable.test.ts). The page folded that error
 * into its page-level error, so one failed read replaced the seasonal and competitor ideas with
 * "Couldn't load intelligence data", though no idea on the page comes from the funnel's payload.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({ failed: new Set<string>() }));

function query(name: string, data: unknown) {
  return {
    useQuery: () =>
      h.failed.has(name)
        ? { data: undefined, isLoading: false, isError: true, refetch: () => undefined }
        : { data, isLoading: false, isError: false, refetch: () => undefined },
  };
}

vi.mock("@/lib/trpc", () => ({
  trpc: {
    intelligence: {
      chatFunnel: query("chatFunnel", { opened: 12, engaged: 8, sharedInfo: 5, convertedToLead: 3, booked: 2, dropOffStage: "engaged" }),
      seasonalDemand: query("seasonalDemand", {}),
      competitorGap: query("competitorGap", {}),
      contentPerformance: query("contentPerformance", {}),
    },
    contentAdmin: { generateArticle: { useMutation: () => ({ mutate: () => undefined, isPending: false }) } },
  },
}));

import { AIIdeasEngine } from "@/pages/admin/content/AIIdeasEngine";

afterEach(() => {
  cleanup();
  h.failed.clear();
});

describe("AI Ideas · chat funnel read failure", () => {
  it("keeps the page and says the intelligence was not read", () => {
    h.failed.add("chatFunnel");
    render(React.createElement(AIIdeasEngine));
    expect(screen.queryByText("Couldn't load intelligence data")).toBeNull();
    expect(screen.getByText("0 (not read)")).toBeTruthy();
    expect(screen.getByText("Total Ideas")).toBeTruthy();
  });

  it("control: every read resolved, the zero names its cause", () => {
    render(React.createElement(AIIdeasEngine));
    expect(screen.getByText("0 (payloads carry no topics)")).toBeTruthy();
  });

  it("control: a failed read the ideas DO come from still shows the page error", () => {
    h.failed.add("competitorGap");
    render(React.createElement(AIIdeasEngine));
    expect(screen.getByText("Couldn't load intelligence data")).toBeTruthy();
  });
});
