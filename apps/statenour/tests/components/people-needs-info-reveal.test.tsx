/**
 * Codex round on PR 3258, P2 #1: "Needs info" filters the list to the people the count counted, so a
 * person who is NOT sparse (notes written, role known) vanished from it, even while selected: the
 * selection arrives through the URL (or revealPerson), lifts the cap, and the row the page then tries to
 * scroll to was filtered out. The selected person is exempt from the filter.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: string, name: string, role: string, leverageNotes: string | null) => ({
  id,
  name,
  role,
  relationship: "r",
  trustScore: 0.5,
  leverageNotes,
  lastInteraction: "2026-10-10T00:00:00.000Z",
  interactionCount: 2,
  daysSinceInteraction: 5,
  isNeglected: false,
});

const PEOPLE = {
  // p1 is sparse (no notes); p2 is not (role known, notes written).
  people: [person("p1", "Sam", "mentor", null), person("p2", "Dana", "client", "owes a favour")],
  totals: { total: 2, neglected: 0, high_trust: 0, sparse: 1 },
  generatedAt: "2026-10-15T00:00:00.000Z",
};

vi.mock("@/hooks/use-polling-fetch", () => ({
  usePollingFetch: () => ({ data: PEOPLE, loading: false, error: null, reload: () => {} }),
}));
// The selection is the URL: ?inspect=person:p2.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("inspect=person:p2") }));
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("/people: Needs info keeps the selected person on screen", () => {
  it("Needs info on with a non-sparse person selected: their row still renders beside the sparse ones", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<RelationshipsPage />);
    });
    expect(container.querySelector("#person-p1")).not.toBeNull();
    expect(container.querySelector("#person-p2")).not.toBeNull();

    const needsInfo = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Needs info")) as HTMLButtonElement;
    expect(needsInfo, "no Needs info button").toBeTruthy();
    await act(async () => needsInfo.click());

    expect(needsInfo.getAttribute("aria-pressed")).toBe("true");
    // p1 is sparse: counted, listed. p2 is not sparse but is selected: listed, so scrollIntoView finds it.
    expect(container.querySelector("#person-p1")).not.toBeNull();
    expect(container.querySelector("#person-p2")).not.toBeNull();
  });
});
