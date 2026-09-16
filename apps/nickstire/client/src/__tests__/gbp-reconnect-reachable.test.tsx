/**
 * The GBP reconnect control must be reachable WHILE CONNECTED.
 *
 * THE DEFECT. The only control that starts Google OAuth was rendered in the
 * false branch of `authStatus?.connected ? (fingerprint) : (<button/>)`. So the
 * button existed exactly when it was least needed and vanished the moment a
 * token existed — including a token for the WRONG Google account. The live
 * shop hit precisely that state: the GBP listing is owned by
 * moeseuclid@gmail.com, the app held a token for an account managing zero
 * businesses, and because `connected === true` the UI hid the one affordance
 * that could re-run consent as the right account.
 *
 * WHY IT WAS INESCAPABLE. `server/routers/gbp.ts` exposes performance,
 * getAuthStatus, getAuthUrl, reconnect, listLocations, saveLocation and
 * publishPost — and NO disconnect. Nothing could flip `connected` back to
 * false, so nothing could bring the button back. getAuthUrl and reconnect both
 * worked the entire time; they were simply unreachable. That is this repo's
 * most-recorded defect shape wearing a different hat: not a writer with no
 * reader, but a capability with no door. It left the operator fix documented in
 * docs/ENTITY-CONTINUITY-FILE.md §3 impossible to perform, and the reconnect
 * logged "pending verification" from 2026-07-29 until 2026-09-16.
 *
 * WHAT THIS ASSERTS. Behaviour, not presence: clicking the control while
 * CONNECTED must actually reach `gbp.getAuthUrl`. The disconnected case is kept
 * as a positive control — if the harness could not find the button there
 * either, a green connected-case assertion would prove nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  authStatus: { connected: true, clientIdFingerprint: "…nt.com" } as Record<string, unknown> | undefined,
  getAuthUrl: vi.fn(async () => ({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" })),
  // Must live inside vi.hoisted: the vi.mock factory below is hoisted above
  // any top-level const, so referencing one from there is a TDZ error.
  idleMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isLoading: false }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: vi.fn(async () => false) }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: { gbp: { getAuthUrl: { query: h.getAuthUrl } } },
      contentAdmin: { gbpPostHistory: { invalidate: vi.fn() } },
      gbp: { getAuthStatus: { invalidate: vi.fn() }, listLocations: { invalidate: vi.fn() } },
    }),
    contentAdmin: {
      gbpPostHistory: { useQuery: () => ({ data: [], isLoading: false }) },
      generateGBPPost: { useMutation: h.idleMutation },
    },
    gbp: {
      getAuthStatus: { useQuery: () => ({ data: h.authStatus, isLoading: false }) },
      listLocations: { useQuery: () => ({ data: undefined, isLoading: false }) },
      saveLocation: { useMutation: h.idleMutation },
      publishPost: { useMutation: h.idleMutation },
    },
  },
}));

import { GBPPostGenerator } from "../pages/admin/content/GBPPostGenerator";

// handleConnect assigns window.location.href; jsdom would log a navigation
// "not implemented" error. Swap in a plain object so the click is observable
// without the noise — the assertion is on getAuthUrl being reached, which
// happens before the assignment.
let originalLocation: Location;
beforeEach(() => {
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, href: "", origin: "https://nickstire.org" },
  });
  h.getAuthUrl.mockClear();
  h.authStatus = { connected: true, clientIdFingerprint: "…nt.com" };
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: originalLocation });
  cleanup();
});

describe("positive control — the harness can see the OAuth control at all", () => {
  it("renders CONNECT GBP when disconnected", () => {
    h.authStatus = { connected: false };
    render(<GBPPostGenerator />);
    expect(screen.getByText(/CONNECT GBP/i)).toBeTruthy();
  });

  it("reaches gbp.getAuthUrl when clicked while disconnected", async () => {
    h.authStatus = { connected: false };
    render(<GBPPostGenerator />);
    fireEvent.click(screen.getByText(/CONNECT GBP/i));
    await waitFor(() => expect(h.getAuthUrl).toHaveBeenCalledTimes(1));
  });
});

describe("the regression this file exists for — connected must not hide the door", () => {
  it("still renders a reconnect control when already connected", () => {
    render(<GBPPostGenerator />);
    expect(screen.getByText(/RECONNECT/i)).toBeTruthy();
  });

  it("keeps showing the client-ID fingerprint alongside it", () => {
    render(<GBPPostGenerator />);
    expect(screen.getByText(/Client ID:/i)).toBeTruthy();
  });

  /**
   * ENTITY-CONTINUITY-FILE §3 asks the operator to confirm a reconnect by
   * watching the refresh-token fingerprint change. That only works if the UI
   * actually renders it — a field returned by getAuthStatus and shown nowhere
   * is a writer with no reader, which is the same defect class as the button
   * this file exists for. So assert the consumer, not just the producer.
   */
  it("renders the refresh-token fingerprint when the server supplies one", () => {
    h.authStatus = {
      connected: true,
      clientIdFingerprint: "…nt.com",
      refreshTokenFingerprint: "sha256:ef9fea01",
    };
    render(<GBPPostGenerator />);
    expect(screen.getByText(/sha256:ef9fea01/)).toBeTruthy();
  });

  it("does not confuse the constant client-ID fingerprint with the token fingerprint", () => {
    // The client ID never changes, so if the UI showed only it, a reconnect that
    // silently failed would look identical to one that succeeded.
    h.authStatus = {
      connected: true,
      clientIdFingerprint: "…nt.com",
      refreshTokenFingerprint: "sha256:ef9fea01",
    };
    render(<GBPPostGenerator />);
    const clientLine = screen.getByText(/Client ID:/i).textContent ?? "";
    const tokenLine = screen.getByText(/Token:/i).textContent ?? "";
    expect(clientLine).not.toBe(tokenLine);
    expect(tokenLine).toContain("sha256:");
  });

  it("omits the token fingerprint rather than rendering a blank when absent", () => {
    h.authStatus = { connected: true, clientIdFingerprint: "…nt.com" };
    render(<GBPPostGenerator />);
    expect(screen.getByText(/Client ID:/i)).toBeTruthy();
    expect(screen.queryByText(/Token:/i)).toBeNull();
  });

  it("REACHES gbp.getAuthUrl when clicked while connected", async () => {
    render(<GBPPostGenerator />);
    fireEvent.click(screen.getByText(/RECONNECT/i));
    await waitFor(() => expect(h.getAuthUrl).toHaveBeenCalledTimes(1));
  });

  it("does not disable the control merely because a token exists", () => {
    render(<GBPPostGenerator />);
    const btn = screen.getByText(/RECONNECT/i).closest("button");
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});
