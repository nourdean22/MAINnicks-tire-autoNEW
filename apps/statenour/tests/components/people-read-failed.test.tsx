/**
 * UI v3 Wave 0, honesty fix (b): /people when the people-intelligence read fails.
 *
 * THE DEFECT. The failure branch printed "people-intelligence unavailable . tap
 * reload" and nothing on the page was tappable that said reload. On the phone,
 * where this screen is opened when something is already wrong, the operator was
 * told to act with no control to act on, and the line never said whether the
 * list was empty or unread.
 *
 * The fix is the repo's honest read-failure state (EmptyState, provenance
 * ERROR; skill empty-vs-error): it says the read failed, that this is not an
 * empty list, and offers a real 44px Retry wired to the polling hook's reload.
 * Rendered in jsdom with the page's children stubbed; only the failure branch
 * and its neighbours are the subject.
 */
// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Poll {
  data: unknown;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const h = vi.hoisted(() => ({
  poll: null as unknown as Poll,
  reload: (() => {}) as () => void,
}));

vi.mock("@/hooks/use-polling-fetch", () => ({ usePollingFetch: () => h.poll }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/hooks/use-inspector", () => ({
  useInspector: () => ({ openInspector: () => {}, closeInspector: () => {} }),
  useInspectorOwnership: () => {},
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    task: {
      personProfile: { useQuery: () => ({ data: undefined, isLoading: false, error: null }) },
      softDeletePerson: { useMutation: () => ({ isPending: false, mutate: () => {} }) },
    },
  },
}));
vi.mock("@/lib/telemetry/mission-surface", () => ({ useMissionSurfaceTelemetry: () => ({ event: () => {} }) }));
vi.mock("@/lib/utils/api-fetch", () => ({ rawFetch: async () => ({ items: [] }) }));
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));

const { none } = vi.hoisted(() => ({ none: () => null }));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: none }));
vi.mock("@/components/ui/sort-dropdown", () => ({ SortDropdown: none }));
vi.mock("@/components/relationships/nicks-relationships-brief", () => ({ NicksRelationshipsBrief: none }));
vi.mock("@/components/relationships/people-change-line", () => ({ PeopleChangeLine: none }));
vi.mock("@/components/relationships/todays-picks", () => ({ TodaysPicks: none }));
vi.mock("@/components/relationships/relationships-watchlist", () => ({ RelationshipsWatchlist: none }));
vi.mock("@/components/relationships/contextual-greene-sidebar", () => ({ ContextualGreeneSidebar: none }));
vi.mock("@/components/relationships/person-edit-drawer", () => ({ PersonEditDrawer: none }));
vi.mock("@/components/power-atlas/DossierEditor", () => ({ default: none }));
vi.mock("@/components/power-atlas/LedgerTimeline", () => ({ default: none }));
vi.mock("@/components/power-atlas/PowerBalanceGauge", () => ({ default: none }));
vi.mock("@/components/power-atlas/BlowUpModal", () => ({ default: none }));
vi.mock("@/components/power-atlas/LogLedgerModal", () => ({ default: none }));
vi.mock("@/components/power-atlas/AlphaMoments", () => ({ default: none }));
vi.mock("@/components/power-atlas/ArcProjection", () => ({ default: none }));
vi.mock("@/components/power-atlas/PowerPlaysModal", () => ({ default: none }));
vi.mock("@/components/power-atlas/SocialProof", () => ({ default: none }));
vi.mock("@/components/power-atlas/ReciprocityCard", () => ({ default: none }));
vi.mock("@/components/power-atlas/ToneShiftCard", () => ({ default: none }));
vi.mock("@/components/power-atlas/TopicGoalOverlapCard", () => ({ default: none }));
vi.mock("@/components/power-atlas/PowerPlaysHistory", () => ({ default: none }));
vi.mock("@/components/power-atlas/PersonInsights", () => ({
  PendingClassificationBanner: none,
  RelationshipXpChip: none,
  OpenPromisesPanel: none,
}));

import RelationshipsPage from "@/app/(mastery)/people/page";

const PEOPLE = {
  people: [
    {
      id: "p1",
      name: "Sam",
      role: "mentor",
      relationship: "weekly call",
      trustScore: 0.8,
      leverageNotes: null,
      lastInteraction: "2026-10-10T00:00:00.000Z",
      interactionCount: 4,
      daysSinceInteraction: 5,
      isNeglected: false,
    },
  ],
  totals: { total: 1, neglected: 0, high_trust: 1, sparse: 0 },
  generatedAt: "2026-10-15T00:00:00.000Z",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mountPage(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RelationshipsPage />);
  });
  return container;
}

const retryButton = (el: HTMLElement) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Retry") as HTMLButtonElement | undefined;

beforeEach(() => {
  h.reload = vi.fn();
  h.poll = { data: null, loading: false, error: null, reload: h.reload };
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("/people when the people read fails", () => {
  it("says the read failed (not that the list is empty), drops 'tap reload', and Retry calls reload", async () => {
    h.poll = { data: null, loading: false, error: "500 Internal Server Error", reload: h.reload };
    const el = await mountPage();
    const text = el.textContent ?? "";

    expect(text, "the dead instruction is still on screen").not.toContain("tap reload");
    expect(text).not.toContain("people-intelligence unavailable");
    expect(el.querySelector('[data-provenance="ERROR"]'), "no honest ERROR state rendered").toBeTruthy();
    // A failure that arrives after the page loads must be announced, not just painted.
    expect(el.querySelector('[role="alert"] [data-provenance="ERROR"]'), "the failure is not in a live region").toBeTruthy();
    expect(text).toMatch(/read failed/i);
    expect(text).toMatch(/not an empty list/i);
    expect(text, "a failed read must not render the empty-list copy").not.toContain("No people profiles yet");

    const retry = retryButton(el);
    expect(retry, "there is nothing to tap").toBeTruthy();
    expect(retry!.type).toBe("button");
    expect(retry!.className).toContain("min-h-[44px]");

    await act(async () => {
      retry!.click();
    });
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  // usePollingFetch builds "<status> <statusText> <middle dot> <first 160 chars of the body>". The body is a
  // JSON envelope or a gateway HTML page and must never reach the screen.
  const MID = String.fromCharCode(0xb7);
  const JSON_ERR = `500 Internal Server Error ${MID} {"ok":false,"error":"relation people_view does not exist","stack":"at queryRaw (/app/lib/db.ts:88)"}`;
  const HTML_ERR = `502 Bad Gateway ${MID} <html><head><title>502 Bad Gateway</title></head><body><center>nginx/1.25 upstream timed out</center></body></html>`;
  const BODY_BITS = ['{"ok"', "people_view", "queryRaw", "<html>", "<center>", "nginx", "upstream timed out"];

  it("shows only the status under the state, never the response body (JSON and HTML fixtures)", async () => {
    for (const [err, status] of [[JSON_ERR, "500 Internal Server Error"], [HTML_ERR, "502 Bad Gateway"]] as const) {
      h.poll = { data: null, loading: false, error: err, reload: h.reload };
      const el = await mountPage();
      const text = el.textContent ?? "";
      expect(text, "the status line is missing").toContain(status);
      for (const bit of BODY_BITS) expect(text, `response body leaked: ${bit}`).not.toContain(bit);
      expect(text).not.toContain(MID);
      await act(async () => root!.unmount());
      container?.remove();
      root = null;
    }
  });

  it("a THROWN failure (network down, no HTTP response) shows a fixed generic line, never the exception text", async () => {
    // usePollingFetch stores err.message for a thrown fetch: "Failed to fetch" (Chrome), "Load failed" (Safari), ...
    for (const raw of ["Failed to fetch", "TypeError: Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.", "boom " + MID + " 500 sneaky"]) {
      h.poll = { data: null, loading: false, error: raw, reload: h.reload };
      const el = await mountPage();
      const text = el.textContent ?? "";
      expect(text, raw).toContain("Could not reach the server");
      for (const leak of ["Failed to fetch", "TypeError", "Load failed", "NetworkError", "boom", "sneaky"]) expect(text, `${raw} leaked ${leak}`).not.toContain(leak);
      await act(async () => root!.unmount());
      container?.remove();
      root = null;
    }
  });

  it("an HTTP status with no status text still shows its code; a refresh that failed by throwing says so generically", async () => {
    h.poll = { data: null, loading: false, error: "503 " + MID + " <html>x</html>", reload: h.reload };
    let el = await mountPage();
    expect(el.textContent).toContain("503");
    expect(el.textContent).not.toContain("<html>");
    await act(async () => root!.unmount());
    container?.remove();
    h.poll = { data: PEOPLE, loading: false, error: "TypeError: Failed to fetch", reload: h.reload };
    el = await mountPage();
    expect(el.querySelector('[role="status"]')!.textContent).toContain("Refresh failed, showing the last list");
    expect(el.textContent).not.toContain("TypeError");
  });

  it("a failed refresh over a list already on screen keeps the list and SAYS it may be old, without the body", async () => {
    h.poll = { data: PEOPLE, loading: false, error: JSON_ERR, reload: h.reload };
    const el = await mountPage();
    const note = el.querySelector('[role="status"]');
    expect(note, "a failed refresh renders as if the list were current").toBeTruthy();
    expect(note!.textContent).toContain("Refresh failed, showing the last list");
    expect(note!.textContent).toContain("500 Internal Server Error");
    expect(el.textContent).toContain("Sam");
    for (const bit of BODY_BITS) expect(el.textContent, `response body leaked: ${bit}`).not.toContain(bit);
  });
});

describe("/people POSITIVE CONTROLS: the failure state shows only on a failed read with nothing to show", () => {
  it("a loaded list has no error state and no Retry", async () => {
    h.poll = { data: PEOPLE, loading: false, error: null, reload: h.reload };
    const el = await mountPage();
    expect(el.querySelector('[data-provenance="ERROR"]')).toBeNull();
    expect(retryButton(el)).toBeUndefined();
    expect(el.textContent).toContain("Sam");
  });

  it("a failed refresh over data already on screen keeps the data and shows no full error state", async () => {
    h.poll = { data: PEOPLE, loading: false, error: "500 Internal Server Error", reload: h.reload };
    const el = await mountPage();
    expect(el.querySelector('[data-provenance="ERROR"]')).toBeNull();
    expect(el.textContent).toContain("Sam");
  });

  it("no refresh-failed note when nothing failed, and none on a failed first load (that has the full state)", async () => {
    h.poll = { data: PEOPLE, loading: false, error: null, reload: h.reload };
    let el = await mountPage();
    expect(el.textContent).not.toContain("Refresh failed");
    await act(async () => root!.unmount());
    container?.remove();
    h.poll = { data: null, loading: false, error: "500 Internal Server Error", reload: h.reload };
    el = await mountPage();
    expect(el.textContent).not.toContain("Refresh failed");
    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it("a first load in flight shows no error", async () => {
    h.poll = { data: null, loading: true, error: null, reload: h.reload };
    const el = await mountPage();
    expect(el.querySelector('[data-provenance="ERROR"]')).toBeNull();
  });

  it("a measured empty list says empty, and is not dressed as a failure", async () => {
    h.poll = { data: { ...PEOPLE, people: [], totals: { total: 0, neglected: 0, high_trust: 0, sparse: 0 } }, loading: false, error: null, reload: h.reload };
    const el = await mountPage();
    expect(el.textContent).toContain("No people profiles yet");
    expect(el.querySelector('[data-provenance="ERROR"]')).toBeNull();
    expect(retryButton(el)).toBeUndefined();
  });
});
