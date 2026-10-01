/**
 * Q-23 phase 13 · the Messages page makes no Twilio fallback claim.
 *
 * Phase 12 (#2844) took the "Twilio fallback" claim off OutreachBrief and the
 * Settings gateway-offline alert. SmsSection's page subtitle still said texts
 * route "through the shop F25e gateway with Twilio fallback".
 *
 * `server/sms.ts` says otherwise: the F25e is the sole sender ("Twilio
 * intentionally not set up"), and while a configured gateway is unreachable
 * every send is queued until the phone checks back in, never sent via Twilio.
 * The subtitle now says that.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// Every tRPC procedure reads as idle and empty: the subtitle is static copy, so
// the page only needs to mount.
vi.mock("@/lib/trpc", () => {
  const idleQuery = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  const idleMutation = { mutate: () => {}, mutateAsync: async () => undefined, isPending: false };
  const node: unknown = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === "useQuery") return () => idleQuery;
      if (prop === "useMutation") return () => idleMutation;
      if (prop === "useUtils") return () => node;
      if (prop === "then") return undefined;
      return node;
    },
    apply: () => undefined,
  });
  return { trpc: node };
});

import SmsSection from "../pages/admin/outreach/SmsSection";

afterEach(() => cleanup());

describe("SmsSection page copy", () => {
  it("says texts queue while the gateway is offline, and claims no Twilio fallback", () => {
    const { container } = render(<SmsSection />);
    const text = container.textContent ?? "";
    // Control: the page mounted and the header rendered.
    expect(text).toMatch(/Two-way SMS with customers/);
    expect(text).toMatch(/F25e/);
    expect(text).toMatch(/queue/);
    expect(text).not.toMatch(/Twilio/);
  });
});
