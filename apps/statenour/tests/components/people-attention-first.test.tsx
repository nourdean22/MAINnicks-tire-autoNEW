/**
 * UI v3 Wave 4 (Mind), People: the attention list first (who needs Nour now), then the rest.
 *
 * THE DEFECTS. (1) The "who needs you" list (the watchlist: broken promises, 90-day silences,
 * imbalances, birthdays) sat third, under the change line and Nick's brief. (2) Its read swallowed
 * failures: `catch { setWatchlist([]) }` and an empty list rendered NOTHING, so a failed read and
 * "no one needs you" were the same blank screen (skill empty-vs-error).
 *
 * The fix, pinned by what renders: the list follows the verdict directly, as ruled rows with the
 * reason in words; loading, a failed read (with a 44 px Retry that reads again) and a real empty
 * each say which one they are. The W0 people-read Retry is untouched (people-read-failed.test.tsx).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  watch: vi.fn(),
}));

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
  totals: { total: 1, neglected: 1, high_trust: 1, sparse: 0 },
  generatedAt: "2026-10-15T00:00:00.000Z",
};

vi.mock("@/hooks/use-polling-fetch", () => ({
  usePollingFetch: () => ({ data: PEOPLE, loading: false, error: null, reload: () => {} }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children?: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
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
vi.mock("@/lib/utils/api-fetch", () => ({ rawFetch: (...args: unknown[]) => h.watch(...args) }));
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));

const { none, marker } = vi.hoisted(() => ({
  none: () => null,
  marker: (id: string) => () => <div data-testid={id} />,
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: none }));
vi.mock("@/components/ui/sort-dropdown", () => ({ SortDropdown: none }));
vi.mock("@/components/relationships/nicks-relationships-brief", () => ({ NicksRelationshipsBrief: marker("brief") }));
vi.mock("@/components/relationships/people-change-line", () => ({ PeopleChangeLine: marker("change-line") }));
vi.mock("@/components/relationships/todays-picks", () => ({ TodaysPicks: marker("picks") }));
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

const ITEMS = [
  { kind: "stale_90d", personId: "p2", personName: "Dana", summary: "no contact in 97 days", rank: 1 },
  { kind: "promise_broken", personId: "p3", personName: "Lee", summary: "promised the intro by Friday", rank: 0 },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mountPage(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RelationshipsPage />);
  });
  // let the watchlist read settle
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const attention = (el: HTMLElement) => el.querySelector('section[aria-labelledby="watchlist-heading"]');

beforeEach(() => {
  h.watch.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("/people: who needs you now comes first", () => {
  it("puts the attention list right under the verdict, ahead of the change line, the brief, the picks and the people list", async () => {
    h.watch.mockResolvedValue({ items: ITEMS });
    const el = await mountPage();
    const list = attention(el);
    expect(list, "no attention list").toBeTruthy();
    const verdict = el.querySelector('section[aria-labelledby="attention-heading"]')!;
    expect(before(verdict, list!), "the verdict should lead").toBe(true);
    for (const id of ["change-line", "brief", "picks"]) {
      expect(before(list!, el.querySelector(`[data-testid="${id}"]`)!), `${id} still renders above who needs you`).toBe(true);
    }
    expect(before(list!, el.querySelector('section[aria-labelledby="people-list-heading"]')!)).toBe(true);
  });

  it("renders ruled rows, most urgent first, with the reason in words and a 44 px target per person", async () => {
    h.watch.mockResolvedValue({ items: ITEMS });
    const el = await mountPage();
    const rows = [...attention(el)!.querySelectorAll("li a")] as HTMLAnchorElement[];
    expect(rows.map((r) => r.querySelector("[data-person]")?.textContent)).toEqual(["Lee", "Dana"]);
    expect(rows[0].textContent).toMatch(/promise broken/i);
    expect(rows[1].textContent).toMatch(/no contact/i);
    for (const r of rows) expect(r.className).toContain("min-h-[44px]");
    expect(attention(el)!.querySelector("ul")!.className, "rows are not ruled").toContain("divide-y");
  });

  it("a failed read says so (not 'no one'), and Retry reads again", async () => {
    h.watch.mockRejectedValueOnce(new Error("500 Internal Server Error")).mockResolvedValueOnce({ items: ITEMS });
    const el = await mountPage();
    const section = attention(el)!;
    expect(section, "a failed read rendered nothing").toBeTruthy();
    expect(section.textContent).toMatch(/couldn.t load/i);
    expect(section.textContent).toMatch(/not an empty list/i);
    expect(section.textContent).not.toMatch(/no one needs you/i);
    const retry = [...section.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Retry") as HTMLButtonElement;
    expect(retry, "nothing to tap").toBeTruthy();
    expect(retry.className).toContain("min-h-[44px]");
    await act(async () => retry.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.watch).toHaveBeenCalledTimes(2);
    expect(attention(el)!.textContent).toContain("Lee");
  });

  it("a read that succeeds with nobody says no one needs you, as a real zero", async () => {
    h.watch.mockResolvedValue({ items: [] });
    const el = await mountPage();
    expect(attention(el)?.textContent).toMatch(/no one needs you right now/i);
  });

  it("while the read is in flight it says it is reading, not that no one needs you", async () => {
    h.watch.mockReturnValue(new Promise(() => {}));
    const el = await mountPage();
    expect(attention(el)?.textContent).toMatch(/reading who needs you/i);
  });
});
