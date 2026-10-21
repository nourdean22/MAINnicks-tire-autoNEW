/**
 * AI referrals card on Admin -> Leads (job 2026-10-21-ai-referrals).
 *
 * Nour, 2026-10-21: two customers came in because AI assistants sent them. The card counts
 * them (logged at the counter) beside website arrivals from an assistant, and logs a new one
 * in two taps. What these tests pin:
 *   - a failed half (logged: null or web: null) shows "?" and "not checked" for THAT half only;
 *   - a paused query (offline PWA: no data, no error) is unknown, never 0;
 *   - Save calls aiReferrals.log once, is disabled while pending, closes and invalidates the
 *     summary on success, and keeps the sheet open with the server's message on failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import React from "react";

type Summary = {
  windowDays: 30;
  logged: { total: number; byAssistant: Record<string, number> } | null;
  web: { total: number; byAssistant: Record<string, number>; bySurface: { bookings: number; leads: number; calls: number } } | null;
};
type MutOpts = { onSuccess?: (d: unknown, v: unknown) => void; onError?: (e: Error, v: unknown) => void };

const h = vi.hoisted(() => ({
  summary: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    fetchStatus: "idle" as "idle" | "fetching" | "paused",
  },
  pending: false,
  outcome: "success" as "success" | "error" | "hold",
  logCalls: [] as unknown[],
  invalidate: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ aiReferrals: { summary: { invalidate: h.invalidate } } }),
    aiReferrals: {
      summary: { useQuery: () => ({ ...h.summary, refetch: h.refetch }) },
      log: {
        useMutation: (opts: MutOpts) => ({
          isPending: h.pending,
          mutate: (vars: unknown) => {
            h.logCalls.push(vars);
            if (h.outcome === "success") opts.onSuccess?.({ ok: true }, vars);
            if (h.outcome === "error") opts.onError?.(new Error("Database unavailable, not saved"), vars);
          },
        }),
      },
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AiReferralsCard } from "../pages/admin/leads/AiReferralsCard";

const LOADED: Summary = {
  windowDays: 30,
  logged: { total: 2, byAssistant: { chatgpt: 1, meta_ai: 1 } },
  web: { total: 1, byAssistant: { perplexity: 1 }, bySurface: { bookings: 1, leads: 0, calls: 0 } },
};

function setSummary(data: Summary | undefined, extra: Partial<typeof h.summary> = {}) {
  h.summary = { data, isLoading: false, isError: false, error: null, fetchStatus: "idle", ...extra };
}

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /log a customer an ai sent/i }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  setSummary(LOADED);
  h.pending = false;
  h.outcome = "success";
  h.logCalls = [];
  h.invalidate.mockClear();
  h.refetch.mockClear();
});
afterEach(cleanup);

describe("AiReferralsCard: what the summary says", () => {
  it("loaded: shows both counts and the non-zero per-assistant breakdown", () => {
    render(<AiReferralsCard />);
    expect(screen.getByText("AI referrals, last 30 days")).toBeTruthy();
    const counter = screen.getByTestId("ai-referrals-logged");
    expect(counter.textContent).toContain("2");
    expect(counter.textContent).toContain("logged at the counter");
    expect(counter.textContent).toContain("ChatGPT 1");
    expect(counter.textContent).toContain("Meta AI / Muse 1");
    const web = screen.getByTestId("ai-referrals-web");
    expect(web.textContent).toContain("1");
    expect(web.textContent).toContain("arrived on the website from an assistant");
    expect(web.textContent).toContain("Perplexity 1");
    // Only non-zero entries, and no unknown marker anywhere.
    expect(screen.queryByText(/Gemini/)).toBeNull();
    expect(screen.queryByText(/not checked/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("logged = null, web ok: only the counter half is unknown", () => {
    setSummary({ ...LOADED, logged: null });
    render(<AiReferralsCard />);
    const counter = screen.getByTestId("ai-referrals-logged");
    expect(counter.textContent).toContain("?");
    expect(counter.textContent).toMatch(/not checked/i);
    expect(counter.textContent).not.toMatch(/\b0\b/);
    const web = screen.getByTestId("ai-referrals-web");
    expect(web.textContent).toContain("1");
    expect(web.textContent).not.toMatch(/not checked/i);
    // A failed half is not "nothing logged yet", and it can be retried.
    expect(screen.queryByText(/none logged yet/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("paused query (offline PWA: no data, no error) is unknown, never 0", () => {
    setSummary(undefined, { fetchStatus: "paused" });
    render(<AiReferralsCard />);
    for (const id of ["ai-referrals-logged", "ai-referrals-web"]) {
      const half = screen.getByTestId(id);
      expect(half.textContent).toContain("?");
      expect(half.textContent).toMatch(/not checked/i);
      expect(half.textContent).not.toMatch(/\b0\b/);
    }
    expect(screen.queryByText(/none logged yet/i)).toBeNull();
  });

  it("failed query: both halves unknown, with a Retry that refetches", () => {
    setSummary(undefined, { isError: true, error: new Error("boom") });
    render(<AiReferralsCard />);
    expect(screen.getByTestId("ai-referrals-logged").textContent).toMatch(/not checked/i);
    expect(screen.getByTestId("ai-referrals-web").textContent).toMatch(/not checked/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("loading: a quiet placeholder, not zeros", () => {
    setSummary(undefined, { isLoading: true, fetchStatus: "fetching" });
    render(<AiReferralsCard />);
    expect(screen.queryByTestId("ai-referrals-logged")).toBeNull();
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("measured zero on both halves: says none logged yet and keeps the Log button", () => {
    setSummary({
      windowDays: 30,
      logged: { total: 0, byAssistant: {} },
      web: { total: 0, byAssistant: {}, bySurface: { bookings: 0, leads: 0, calls: 0 } },
    });
    render(<AiReferralsCard />);
    expect(screen.getByText(/none logged yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /log a customer an ai sent/i })).toBeTruthy();
  });
});

describe("AiReferralsCard: logging a customer", () => {
  it("Save is disabled until an assistant is chosen; success logs once, closes and invalidates", () => {
    render(<AiReferralsCard />);
    const sheet = openSheet();
    const save = within(sheet).getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole("button", { name: "ChatGPT" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Tires" }));
    expect(save.disabled).toBe(false);
    act(() => { fireEvent.click(save); });
    expect(h.logCalls).toEqual([{ assistant: "chatgpt", topic: "tires" }]);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("topic is optional: no topic chip means no topic field", () => {
    render(<AiReferralsCard />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Meta AI / Muse" }));
    act(() => { fireEvent.click(within(sheet).getByRole("button", { name: /^save$/i })); });
    expect(h.logCalls).toEqual([{ assistant: "meta_ai" }]);
  });

  it("error: the sheet stays open with the server's message and Save can retry", () => {
    h.outcome = "error";
    render(<AiReferralsCard />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Gemini" }));
    act(() => { fireEvent.click(within(sheet).getByRole("button", { name: /^save$/i })); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Database unavailable, not saved");
    expect(h.invalidate).not.toHaveBeenCalled();
    const save = within(screen.getByRole("dialog")).getByRole("button", { name: /save|try again/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    h.outcome = "success";
    act(() => { fireEvent.click(save); });
    expect(h.logCalls).toHaveLength(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Save is disabled while the log is pending (no double log)", () => {
    render(<AiReferralsCard />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Claude" }));
    h.outcome = "hold";
    act(() => { fireEvent.click(within(sheet).getByRole("button", { name: /^save$/i })); });
    expect(h.logCalls).toHaveLength(1);
    // The mutation reports pending on the next render.
    h.pending = true;
    cleanup();
    render(<AiReferralsCard />);
    const reopened = openSheet();
    fireEvent.click(within(reopened).getByRole("button", { name: "Claude" }));
    const save = within(reopened).getByRole("button", { name: /saving/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(h.logCalls).toHaveLength(1);
  });

  it("Cancel closes the sheet without logging", () => {
    render(<AiReferralsCard />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "ChatGPT" }));
    fireEvent.click(within(sheet).getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.logCalls).toHaveLength(0);
  });

  it("Escape closes the sheet", () => {
    render(<AiReferralsCard />);
    const sheet = openSheet();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
