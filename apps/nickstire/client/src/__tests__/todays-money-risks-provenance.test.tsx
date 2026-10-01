/**
 * Q-23 phase 4 · the "Money At Risk" card (Admin > Intelligence HQ).
 *
 * `overviewMediumBundle` reports each read in `slices`. A failed leads or
 * callbacks slice arrives as `null`, which the derivation reads as an empty
 * list, so the card used to draw a leads failure as "no stale leads" and a
 * failure of both as no card at all, the same picture as a clean day.
 *
 * Pinned here:
 *   - a failed slice renders UNMEASURED, "unknown, not zero";
 *   - both slices failed still renders a card (never the clean-day null);
 *   - the item count reads "at least N" while a slice is unread;
 *   - every number wears a provenance tag;
 *   - all slices read and nothing at risk still renders nothing.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminDashboard: {
      overviewMediumBundle: {
        useQuery: () => ({ data: h.data, isLoading: false, isError: false }),
      },
    },
  },
}));

vi.mock("../pages/admin/shared", () => ({ navigateToAdminSection: vi.fn() }));

import { TodaysMoneyRisks } from "../pages/admin/today/TodaysMoneyRisks";

afterEach(cleanup);

const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const staleLead = { status: "new", createdAt: ago(6 * HOUR), name: "Canary Lead", estimatedValueCents: 45_000 };
const waitingCallback = { status: "new", createdAt: ago(5 * HOUR), name: "Canary Caller" };

type Slice = { available: boolean; error: string | null };
const ok: Slice = { available: true, error: null };
const down: Slice = { available: false, error: "read failed" };

function bundle(opts: {
  leads: unknown[] | null;
  callbacks: unknown[] | null;
  slices?: { leads: Slice; callbacks: Slice } | undefined;
}) {
  return { leads: opts.leads, callbacks: opts.callbacks, slices: opts.slices };
}

function tags(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-provenance]")).map(
    (el) => el.getAttribute("data-provenance") ?? "",
  );
}

describe("TodaysMoneyRisks · unread slices and provenance", () => {
  it("a failed leads slice renders UNMEASURED, not an absent line", () => {
    h.data = bundle({ leads: null, callbacks: [waitingCallback], slices: { leads: down, callbacks: ok } });
    const { container } = render(<TodaysMoneyRisks />);
    const row = container.querySelector('[data-unread="leads"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toMatch(/unknown, not zero/);
    expect(row?.querySelector("[data-provenance]")?.getAttribute("data-provenance")).toBe("UNMEASURED");
    // The readable half is still shown, and its total is a floor.
    expect(container.textContent).toMatch(/at least 1 unresolved item\b/);
  });

  it("both slices failed still draws a card, never the clean-day null", () => {
    h.data = bundle({ leads: null, callbacks: null, slices: { leads: down, callbacks: down } });
    const { container } = render(<TodaysMoneyRisks />);
    expect(container.textContent).toMatch(/could not be read in full/);
    expect(container.querySelector('[data-unread="leads"]')).not.toBeNull();
    expect(container.querySelector('[data-unread="callbacks"]')).not.toBeNull();
    expect(tags(container)).toEqual(["UNMEASURED", "UNMEASURED"]);
    // No oldest-item line and no "Check X first" button with nothing to point at.
    expect(container.textContent).not.toMatch(/Oldest ·/);
    expect(container.querySelector("button")).toBeNull();
  });

  it("every number on a fully read card wears a tag", () => {
    h.data = bundle({ leads: [staleLead], callbacks: [waitingCallback], slices: { leads: ok, callbacks: ok } });
    const { container } = render(<TodaysMoneyRisks />);
    // stale leads (counted), callbacks (counted), quoted dollars (stored quotes).
    expect(tags(container)).toEqual(["MEASURED", "MEASURED", "MEASURED"]);
    expect(container.textContent).toMatch(/across 2 unresolved items/);
    expect(container.textContent).not.toMatch(/at least/);
    expect(container.querySelector("[data-unread]")).toBeNull();
  });

  it("all slices read and nothing at risk renders nothing", () => {
    h.data = bundle({ leads: [], callbacks: [], slices: { leads: ok, callbacks: ok } });
    const { container } = render(<TodaysMoneyRisks />);
    expect(container.innerHTML).toBe("");
  });

  it("a server without the slices map keeps the old behaviour", () => {
    h.data = bundle({ leads: [], callbacks: [], slices: undefined });
    const { container } = render(<TodaysMoneyRisks />);
    expect(container.innerHTML).toBe("");
  });
});
