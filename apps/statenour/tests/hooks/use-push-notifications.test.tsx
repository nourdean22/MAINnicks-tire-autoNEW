import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { usePushNotifications } from "@/hooks/use-push-notifications";

// Mock the tRPC client context hook
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({
      system: {
        pushVapidKey: {
          fetch: vi.fn(),
        },
      },
    }),
    system: {
      pushSubscribe: {
        useMutation: () => ({}),
      },
      pushUnsubscribe: {
        useMutation: () => ({}),
      },
    },
  },
}));

function Probe() {
  const { isSupported, isSubscribed } = usePushNotifications();
  return (
    <div
      data-supported={String(isSupported)}
      data-subscribed={String(isSubscribed)}
    />
  );
}

describe("usePushNotifications Hook", () => {
  it("defaults to unsupported and unsubscribed on mount", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-supported="false"');
    expect(markup).toContain('data-subscribed="false"');
  });
});
