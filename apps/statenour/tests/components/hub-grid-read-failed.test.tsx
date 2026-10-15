/**
 * /system hub grid: a failed rollup read says "unknown", and the Brain tile
 * lands where its words point (audit 2026-10-10 · 09-F7, 02-F18).
 *
 * THE DEFECT. SystemHubGrid's own comment recorded it: "A failed fetch leaves
 * `data` null and every card falls back to its '—' chip, exactly as the prior
 * swallowed catch." So a FAILED read and a read still in flight rendered the
 * same dash on every live card. SYSTEM.md §9: unknown carries the word.
 *
 * And the "Brain Categories" tile linked bare /brain (which opens the Map tab)
 * while promising "people intelligence", which /brain does not show.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const stub = vi.hoisted(() => ({
  hub: { data: undefined as unknown, isError: false } as { data: unknown; isError: boolean },
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: { system: { hub: { useQuery: () => stub.hub } } },
}));

import { CARDS, SystemHubGrid } from "@/components/system/hub-grid";

const render = () => renderToStaticMarkup(<SystemHubGrid />);
const count = (html: string, needle: string) => html.split(needle).length - 1;

// The cards whose chip is computed from the rollup (the rest are static verbs
// like "browse" that make no claim about the payload).
const LIVE = CARDS.filter((c) => c.chip(null).severity === "unknown" && c.chip(null).label === "n/a");

beforeEach(() => {
  stub.hub = { data: undefined, isError: false };
});

describe("hub grid · a failed rollup read is unknown, not a dash", () => {
  it("the subject is real: several cards read the rollup", () => {
    expect(LIVE.length).toBeGreaterThanOrEqual(5);
  });

  it("a failed read prints the word unknown on every live card", () => {
    stub.hub = { data: undefined, isError: true };
    const html = render();
    expect(count(html, ">unknown</span>")).toBe(LIVE.length);
    expect(html).not.toContain(">n/a</span>");
  });

  it("POSITIVE CONTROL: a read still in flight is not called a failure", () => {
    const html = render();
    expect(html).not.toContain(">unknown</span>");
  });

  it("static verb chips are untouched by a failed read", () => {
    stub.hub = { data: undefined, isError: true };
    expect(render()).toContain(">browse</span>");
  });
});

describe("hub grid · the Brain tile lands where it says", () => {
  const brain = CARDS.find((c) => c.title === "Brain Categories");

  it("opens the memory tab, not the bare /brain Map", () => {
    expect(brain?.href).toBe("/brain?tab=memory");
  });

  it("does not promise people intelligence", () => {
    expect(brain?.description).not.toMatch(/people/i);
  });
});
