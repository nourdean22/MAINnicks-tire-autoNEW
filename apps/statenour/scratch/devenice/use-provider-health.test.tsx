import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

// One-line note: Assertions checking providerHealth tone mappings go green only after F2 hook and TRPC wiring are implemented.

// Mock trpc
const useQueryMock = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      providerHealth: {
        useQuery: (input: any, opts: any) => useQueryMock(input, opts),
      },
    },
  },
}));

describe("useProviderHealth hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderHookHelper = (hookFn: () => any) => {
    let result: any;
    const TestComponent = () => {
      result = hookFn();
      return null;
    };
    renderToString(<TestComponent />);
    return result;
  };

  it("returns true (healthy) when overallTone is green", async () => {
    useQueryMock.mockReturnValue({
      data: { overallTone: "green" },
    });

    const { useProviderHealth } = await import("@/components/chat/use-provider-health");
    const result = renderHookHelper(() => useProviderHealth());
    expect(result).toBe(true);
  });

  it("returns false (unhealthy) when overallTone is red or amber", async () => {
    const { useProviderHealth } = await import("@/components/chat/use-provider-health");

    useQueryMock.mockReturnValue({
      data: { overallTone: "red" },
    });
    const resultRed = renderHookHelper(() => useProviderHealth());
    expect(resultRed).toBe(false);

    useQueryMock.mockReturnValue({
      data: { overallTone: "amber" },
    });
    const resultAmber = renderHookHelper(() => useProviderHealth());
    expect(resultAmber).toBe(false);
  });

  it("returns true (healthy) on undefined data or transport errors to avoid false alarms", async () => {
    const { useProviderHealth } = await import("@/components/chat/use-provider-health");

    // Transport error / undefined data
    useQueryMock.mockReturnValue({
      data: undefined,
    });
    const result = renderHookHelper(() => useProviderHealth());
    expect(result).toBe(true);
  });
});
