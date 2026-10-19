// @vitest-environment jsdom
/**
 * UI v3 W5a: the palette's System rows are built from the hub's CARDS, one source of truth, so a
 * new hub tile cannot miss the palette. Before W5a the System group was 13 hand-written rows and
 * four live hub tiles (Fleet Truth, Arrival Intel, Schema History, Chat States) had no palette door,
 * nor did Intelligence. Lab tiles get a row that says "Lab".
 *
 * Two halves: the pure row builder (hubPaletteRows), and the palette itself rendered in jsdom and
 * opened by its event, so the consumer is asserted, not only the producer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/trpc/vanilla-client", () => ({ trpcVanilla: {} }));
vi.mock("@/hooks/use-inspector", () => ({ useInspector: () => ({ openInspector: vi.fn() }) }));
vi.mock("@/lib/utils/api-fetch", () => ({ apiFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })) }));

import { CARDS, hubPaletteRows } from "@/components/system/hub-cards";
import { NAV } from "@/components/layout/nav-items";
import { CommandPalette, COMMAND_PALETTE_OPEN_EVENT } from "@/components/command-palette";

/** Every href a Navigate row reaches (NAV entries and their tabs), as the palette builds them. */
const navHrefs = new Set(
  NAV.flatMap((e) => [e.href, ...(e.tabs ?? []).map((t) => `${e.href}?tab=${encodeURIComponent(t.key)}`)]),
);

/** The System and Diagnostics rows as they were hand-written on main a34b7149d: id -> keywords. */
const OLD_KEYWORDS: Record<string, string[]> = {
  "sys-crons": ["cron", "schedule", "job", "kill", "manual", "silent", "slow", "diagnose"],
  "sys-errors": ["error", "log", "stack", "fingerprint"],
  "sys-logs": ["log", "request", "stream", "api", "generation"],
  "sys-ai-cost": ["cost", "nick", "tokens", "budget", "burn"],
  "sys-actions": ["action", "autonomous", "rule", "audit", "approval"],
  "sys-health": ["health", "diagnostics", "probe", "env", "vectors", "backlog", "push", "pull", "oauth", "pulse", "stale", "cron", "rescan", "diagnose", "all"],
  "sys-calibration": ["calibration", "quality", "state", "mood", "hit rate", "suggestion", "judge", "eval", "operator state"],
  "sys-alerts": ["alert", "inspect", "category", "coach"],
  "sys-inbox": ["inbox", "quarantine", "memory", "contradiction", "review"],
  "sys-tools": ["tool", "registry", "govern", "permission", "capability"],
  "sys-proactive": ["proactive", "push", "preview", "dry run", "telemetry"],
  "sys-cockpit": ["cockpit", "observability", "trace", "metric", "decay", "prompt version"],
  "sys-ui-lab": ["ui", "lab", "gallery", "inspector", "fixture", "metric", "evidence", "reality mode"],
  "diag-stale": ["stale", "purge", "clean", "orphan", "dismissed"],
};

const rows = hubPaletteRows(navHrefs);

describe("hubPaletteRows · the System group comes from the hub list", () => {
  it("the subject is real: the hub has twenty tiles and most become rows", () => {
    expect(CARDS.length).toBe(20);
    expect(rows.length).toBeGreaterThanOrEqual(18);
  });

  it("every hub href has exactly one palette door (a System row or a Navigate row)", () => {
    for (const c of CARDS) {
      const doors = rows.filter((r) => r.href === c.href).length + (navHrefs.has(c.href) ? 1 : 0);
      expect(doors, c.href).toBe(1);
    }
  });

  it("the doors that were missing now exist", () => {
    for (const href of ["/system/fleet", "/system/camera", "/system/schema-history", "/system/chat-states", "/intelligence/brief"]) {
      expect(rows.some((r) => r.href === href), href).toBe(true);
    }
  });

  it("a Lab card's row says Lab, and only Lab cards' rows do", () => {
    for (const r of rows) {
      const card = CARDS.find((c) => c.href === r.href)!;
      expect(r.label.startsWith("Lab · "), r.href).toBe(Boolean(card.lab));
    }
    expect(rows.filter((r) => r.lab).map((r) => r.href).sort()).toEqual(["/system/chat-states", "/system/ui-lab"]);
  });

  it("today's ids and keywords still match, so Recently Used and typed searches keep working", () => {
    for (const [id, keywords] of Object.entries(OLD_KEYWORDS)) {
      const r = rows.find((x) => x.id === id);
      expect(r, id).toBeDefined();
      for (const k of keywords) expect(r!.keywords, `${id}:${k}`).toContain(k);
    }
  });

  it("ids are unique", () => {
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the calibration row keeps the State Calibration name and none of the other page's words (10-X3)", () => {
    const r = rows.find((x) => x.href === "/system/calibration")!;
    expect(r.label).toContain("State Calibration");
    expect([r.label, ...r.keywords].join(" ")).not.toMatch(/drift|coverage|\blens\b|accuracy/i);
  });

  it("POSITIVE CONTROL: a card a Navigate row already reaches gets no second door", () => {
    expect(rows.some((r) => r.href === "/brain?tab=memory")).toBe(false);
    expect(hubPaletteRows(new Set()).some((r) => r.href === "/brain?tab=memory")).toBe(true);
  });
});

/* ------------------------------ the consumer ------------------------------ */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  h.push.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<CommandPalette />));
  act(() => {
    window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const item = (text: string) =>
  [...document.querySelectorAll<HTMLElement>("[cmdk-item]")].find((el) => el.textContent?.trim() === text) ?? null;

describe("command palette · renders the hub rows", () => {
  it("the subject is real: the palette opened and lists rows", () => {
    expect(document.querySelectorAll("[cmdk-item]").length).toBeGreaterThan(20);
  });

  it("every System row from the hub list is on screen", () => {
    for (const r of rows) expect(item(r.label), r.label).not.toBeNull();
  });

  it("a new door opens its page", () => {
    act(() => item("Fleet Truth")!.click());
    expect(h.push).toHaveBeenCalledWith("/system/fleet");
  });

  it("a Lab row opens its page and says Lab", () => {
    act(() => item("Lab · Chat States")!.click());
    expect(h.push).toHaveBeenCalledWith("/system/chat-states");
  });
});
