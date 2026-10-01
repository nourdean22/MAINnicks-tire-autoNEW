/**
 * Creative Assistant cards on Today — the three states must stay distinct.
 *
 * A failed query renders "unknown, not empty"; a server read that failed
 * (inputs.<source> = "error: …") is named under the cards as missing-not-
 * absent; a card's `why` lines are printed verbatim, because the card is
 * only worth anything if the operator can see what it was ranked on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { instagramAdmin: { getCreativeAssistant: { useQuery: () => h.result } } },
}));

import { CreativeAssistantCards } from "../pages/admin/instagram/CreativeAssistantCards";

const card = (over: Record<string, unknown> = {}) => ({
  type: "opportunity",
  title: "e-check not ready",
  format: "carousel",
  why: ['GSC "e-check not ready" 412 impressions, +38% 7d, position 11', "last covered 43 days ago"],
  confidence: "high",
  confidenceReason: "2 independent demand sources and not covered recently",
  firstAction: 'Open Create as a carousel: "e-check not ready"',
  topic: "e-check not ready",
  ...over,
});

const payload = (cards: unknown[], inputs: Record<string, number | string> = { topicSignals: 7, ledger: 4 }) => ({
  data: { cards, inputs, generatedAt: "2026-10-01T12:00:00.000Z" },
  isLoading: false, isError: false, error: null,
});

afterEach(cleanup);
beforeEach(() => { h.result = payload([card()]); });

describe("a loaded assistant", () => {
  it("prints the card title, format chip, every why line, confidence and the first action", () => {
    render(<CreativeAssistantCards onNavigate={() => {}} />);
    expect(screen.getByText("e-check not ready")).toBeTruthy();
    expect(screen.getByText("carousel")).toBeTruthy();
    expect(screen.getByText('GSC "e-check not ready" 412 impressions, +38% 7d, position 11')).toBeTruthy();
    expect(screen.getByText("last covered 43 days ago")).toBeTruthy();
    expect(screen.getByText(/high confidence/i)).toBeTruthy();
    expect(screen.getByText('Open Create as a carousel: "e-check not ready"')).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the first action navigates to Create with a 48px target", () => {
    const onNavigate = vi.fn();
    render(<CreativeAssistantCards onNavigate={onNavigate} />);
    const button = screen.getByRole("button", { name: /Open Create as a carousel/ });
    expect(button.className).toContain("min-h-12");
    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledWith("create");
  });

  it("names a source the server could not read as missing, not absent", () => {
    h.result = payload([card()], { topicSignals: 7, ledger: "error: timeout" });
    render(<CreativeAssistantCards onNavigate={() => {}} />);
    expect(screen.getByText(/Could not read ledger/)).toBeTruthy();
    expect(screen.getByText(/missing, not absent/)).toBeTruthy();
  });

  it("an empty card set after a clean read is a real nothing", () => {
    h.result = payload([]);
    render(<CreativeAssistantCards onNavigate={() => {}} />);
    expect(screen.getByText(/Nothing stood out from today/)).toBeTruthy();
    expect(screen.queryByText(/incomplete/)).toBeNull();
  });
});

describe("a failed query is UNKNOWN, not empty", () => {
  it("renders the outage in its own words and no cards", () => {
    h.result = { data: undefined, isLoading: false, isError: true, error: { message: "FORBIDDEN" } };
    render(<CreativeAssistantCards onNavigate={() => {}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/unknown.*not empty/);
    expect(screen.getByRole("alert").textContent).toContain("FORBIDDEN");
    expect(screen.queryByText(/Nothing stood out/)).toBeNull();
  });
});
