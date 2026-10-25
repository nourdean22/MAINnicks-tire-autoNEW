/**
 * bdnick wave E2 (2026-10-24): Settings answers one decision, "change one behavior".
 *
 * THE DEFECTS (census 2026-10-23 section 3J). On a phone the page opened on a sidebar inside the page:
 * a "Domains" switcher that showed one of three domains at a time, an "Elsewhere" list repeating the
 * Command sheet's links, and a domain header with a generic Cpu / Zap glyph in a tile. Preferences (the
 * 8-axis style dials Nick reads) were parked in the Brain Self-model fold. The skill library's failed
 * read was a bare red line with no marker a fold could count, so Brain wrapped it in a second query.
 *
 * Pinned by what renders: three headed groups in one scroll, every panel mounted at once; no switcher,
 * no links, no icon; Preferences once, in "How Nick works"; and the skill library's own failed,
 * offline and stale markers, counted by the Brain fold that mounts it (the consumer).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ q: {} as Record<string, unknown> }));

vi.mock("@/lib/trpc/client", () => {
  const idle = { data: undefined, isError: false, isPending: true, isLoading: true, fetchStatus: "fetching", refetch: () => Promise.resolve() };
  const make = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, k: string) => {
        if (k === "useQuery") return () => h.q[path.join(".")] ?? idle;
        if (k === "useMutation") return () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false, variables: undefined });
        if (k === "useUtils" || k === "useContext") return () => make(["utils"]);
        if (k === "invalidate" || k === "fetch" || k === "refetch") return () => Promise.resolve();
        return make([...path, k]);
      },
    });
  return { trpc: make([]) };
});
vi.mock("sonner", () => ({ toast: { success: () => undefined, error: () => undefined } }));

const { stub } = vi.hoisted(() => ({
  stub: (name: string) =>
    function Stub() {
      return <section data-testblock={name}>{name}</section>;
    },
}));
vi.mock("@/components/settings/identity-panel", () => ({ IdentityPanel: stub("IdentityPanel") }));
vi.mock("@/components/settings/journal-brain-panel", () => ({ JournalBrainPanel: stub("JournalBrainPanel") }));
vi.mock("@/components/settings/notebooklm-context-zone", () => ({ NotebookLMContextZone: stub("NotebookLMContextZone") }));
vi.mock("@/components/settings/people-scoring-panel", () => ({ PeopleScoringPanel: stub("PeopleScoringPanel") }));
vi.mock("@/components/settings/ai-settings-panel", () => ({ AiSettingsPanel: stub("AiSettingsPanel") }));
vi.mock("@/components/settings/intelligence-flags-panel", () => ({ IntelligenceFlagsPanel: stub("IntelligenceFlagsPanel") }));
vi.mock("@/components/settings/operating-rhythm-toggle", () => ({ OperatingRhythmToggle: stub("OperatingRhythmToggle") }));
vi.mock("@/components/settings/push-notification-toggle", () => ({ PushNotificationToggle: stub("PushNotificationToggle") }));
vi.mock("@/components/settings/ticker-dismissal-card", () => ({ TickerDismissalReset: stub("TickerDismissalReset") }));
vi.mock("@/components/ultron/preferences-card", () => ({ PreferencesCard: stub("PreferencesCard") }));

import { SettingsConsole } from "@/components/settings/settings-console";
import { SkillLibraryPanel } from "@/components/settings/skill-library-panel";
import { BrainFold } from "@/components/brain/brain-fold";

let root: Root | null = null;
let el: HTMLDivElement;

async function mount(node: React.ReactNode) {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(node);
  });
  // the fold's shared observer takes its first measure on the next animation frame
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  return el;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  el?.remove();
  root = null;
  h.q = {};
});

const GROUPS: [string, string[]][] = [
  ["Identity and behavior", ["IdentityPanel", "JournalBrainPanel", "NotebookLMContextZone", "PeopleScoringPanel"]],
  ["How Nick works", ["AiSettingsPanel", "PreferencesCard", "IntelligenceFlagsPanel", "OperatingRhythmToggle"]],
  ["Notifications", ["PushNotificationToggle", "TickerDismissalReset"]],
];

describe("Settings: three headed groups in one scroll", () => {
  it("renders every group at once, each a labelled region with its own panels in order", async () => {
    await mount(<SettingsConsole />);
    const regions = [...el.querySelectorAll<HTMLElement>('section[role="region"]')];
    expect(regions.map((r) => r.querySelector("h2")?.textContent)).toEqual(GROUPS.map(([t]) => t));
    regions.forEach((region, i) => {
      const heading = region.querySelector("h2")!;
      expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
      const panels = [...region.querySelectorAll<HTMLElement>("[data-testblock]")].map((p) => p.dataset.testblock);
      expect(panels).toEqual(GROUPS[i][1]);
    });
  });

  it("has no domain switcher, no Elsewhere links and no icon tile", async () => {
    await mount(<SettingsConsole />);
    expect(el.querySelector("nav"), "a switcher nav is still rendered").toBeNull();
    expect(el.querySelectorAll("button[aria-pressed]"), "switcher buttons are still rendered").toHaveLength(0);
    expect(el.querySelectorAll("a[href]"), "Elsewhere links are still rendered").toHaveLength(0);
    expect(el.textContent).not.toMatch(/Elsewhere|Domains/);
    expect(el.querySelectorAll("svg"), "the domain icon tile is still rendered").toHaveLength(0);
  });

  it("mounts Preferences exactly once, in How Nick works", async () => {
    await mount(<SettingsConsole />);
    const hits = [...el.querySelectorAll('[data-testblock="PreferencesCard"]')];
    expect(hits).toHaveLength(1);
    expect(hits[0].closest("section[role='region']")?.querySelector("h2")?.textContent).toBe("How Nick works");
  });
});

const skillsOk = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  error: null,
  isError: false,
  isPending: false,
  isLoading: false,
  fetchStatus: "idle",
  dataUpdatedAt: Date.now(),
  refetch: () => Promise.resolve(),
  ...extra,
});

describe("Skill library carries its own read markers", () => {
  it("a failed read with no data renders the failed marker, counted as unreadable by the Brain fold", async () => {
    h.q["operator.skills"] = skillsOk(undefined, { isError: true, error: { message: "500" }, dataUpdatedAt: 0 });
    await mount(<BrainFold title="Self-model"><SkillLibraryPanel /></BrainFold>);
    expect(el.querySelector("[data-read-failed]"), "no failed marker").toBeTruthy();
    expect(el.textContent).toMatch(/couldn.t load/i);
    expect(el.querySelector("summary")!.textContent!.replace(/\s+/g, " ")).toMatch(/\(1 unreadable\)/);
  });

  it("a paused read before any data says offline, counted as offline", async () => {
    h.q["operator.skills"] = skillsOk(undefined, { isPending: true, fetchStatus: "paused", dataUpdatedAt: 0 });
    await mount(<BrainFold title="Self-model"><SkillLibraryPanel /></BrainFold>);
    expect(el.querySelector('[data-read-state="offline"]')).toBeTruthy();
    expect(el.querySelector("summary")!.textContent!.replace(/\s+/g, " ")).toMatch(/\(1 offline\)/);
  });

  it("a failed refresh over cached skills keeps the list under a stale note, counted as stale", async () => {
    h.q["operator.skills"] = skillsOk(
      { active: [{ key: "s1", trigger: "morning-block", action_sequence: ["plan"], success_rate: 0.8, times_fired: 6, times_succeeded: 5, polarity: "do", graduated: false, last_fired: new Date().toISOString(), created_at: new Date().toISOString() }], pending: [] },
      { isError: true, error: { message: "500" } },
    );
    await mount(<BrainFold title="Self-model"><SkillLibraryPanel /></BrainFold>);
    expect(el.querySelector('[data-read-state="stale"]')).toBeTruthy();
    expect(el.querySelector("[data-read-failed]"), "stale data drawn as a failure").toBeNull();
    expect(el.querySelector("summary")!.textContent!.replace(/\s+/g, " ")).toMatch(/\(1 stale\)/);
  });
});
