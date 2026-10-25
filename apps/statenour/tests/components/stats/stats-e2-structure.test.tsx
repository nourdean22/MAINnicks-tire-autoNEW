/**
 * bdnick wave E2 (2026-10-24): Stats answers one decision, "am I on track".
 *
 * THE DEFECTS (census 2026-10-23 section 3I). The verdict sentence sat above the tabs while the
 * Journey lens, the same "how am I trending" answer, sat in four bordered panels at the very bottom of
 * the page. Mastery opened on three same-height cards (identity arc, recurring enemies, graduated
 * skills: 200 / 210 / 210 px skeletons), two of which HID a failed read (`return null`). Calibration,
 * prediction streaks and Ghost Nick were parked in the Brain Self-model fold, away from the Goals tab
 * that owns calibration.
 *
 * Pinned by what renders: the verdict block leads and carries the Journey XP line; Mastery is ONE row
 * list with three headed groups and no card; the Goals tab mounts the three moved Brain cards once each
 * beside the calibration section; and every group of the list says loading, failed, offline and stale
 * in words (a failed read never renders as "nothing yet").
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ search: "", q: {} as Record<string, unknown> }));

vi.mock("@/lib/trpc/client", () => {
  const idle = { data: undefined, isError: false, isPending: true, isLoading: true, fetchStatus: "fetching", refetch: () => Promise.resolve() };
  const make = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, k: string) => {
        if (k === "useQuery") return () => h.q[path.join(".")] ?? idle;
        if (k === "useMutation") return () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false });
        if (k === "useUtils" || k === "useContext") return () => make(["utils"]);
        if (k === "invalidate" || k === "fetch" || k === "refetch") return () => Promise.resolve();
        return make([...path, k]);
      },
    });
  return { trpc: make([]) };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => "/stats",
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("next/dynamic", () => ({
  default: (_loader: unknown, opts?: { loading?: () => ReactNode }) => {
    const Lazy = () => <>{opts?.loading ? opts.loading() : null}</>;
    return Lazy;
  },
}));
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));

const { stub } = vi.hoisted(() => ({
  stub: (name: string) =>
    function Stub() {
      return <section data-testblock={name}>{name}</section>;
    },
}));
vi.mock("@/components/mastery/character-sheet", () => ({ CharacterSheet: stub("CharacterSheet") }));
vi.mock("@/components/mastery/level-up-directive-card", () => ({ LevelUpDirectiveCard: stub("LevelUpDirectiveCard") }));
vi.mock("@/components/goals/goal-board", () => ({ GoalBoard: stub("GoalBoard") }));
vi.mock("@/components/stats/forecast-duel", () => ({ ForecastDuel: stub("ForecastDuel") }));
vi.mock("@/components/mastery/coach-event-banner", () => ({ CoachEventBanner: (p: { showReadState?: boolean }) => <i data-coach-read-state={String(!!p.showReadState)} /> }));
vi.mock("@/components/mastery/mission-breadcrumb", () => ({ MissionBreadcrumb: () => null }));
vi.mock("@/components/mastery/nick-side-pane", () => ({ NickSidePane: () => null }));
vi.mock("@/components/stats/calibration-tile", () => ({ CalibrationTile: stub("CalibrationTile") }));
vi.mock("@/components/brain/prediction-streaks-card", () => ({ PredictionStreaksCard: stub("PredictionStreaksCard") }));
vi.mock("@/components/ultron/ghost-nick/ghost-nick-strip", () => ({ GhostNickStrip: stub("GhostNickStrip") }));

vi.mock("sonner", () => ({ toast: { success: () => undefined, error: () => undefined } }));

import StatsPage from "@/app/(mastery)/stats/page";
import { CalibrationSection } from "@/components/stats/calibration-section";

const ok = (data: unknown) => ({ data, isError: false, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() });
const failed = { data: undefined, isError: true, error: { message: "500" }, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() };
const stale = (data: unknown) => ({ ...ok(data), isError: true, error: { message: "500" } });
const paused = { data: undefined, isError: false, isPending: true, isLoading: false, fetchStatus: "paused", refetch: () => Promise.resolve() };

const SHEET = [{ key: "focus", label: "Focus", shortLabel: "Focus", level: 7, rising7dXp: 40 }];
const lens = (xp: Record<string, unknown> = {}) => ({
  identity: { enoughData: true, since: "since 2026-08-01", source: "identity_snapshot", data: [{ axis: "Discipline", from: 40, to: 46, delta: 6 }] },
  xp: { enoughData: true, since: "30d vs prior 30d", source: "mastery_xp_event", data: { current30: 150, prior30: 100, growthPct: 50 }, ...xp },
  enemies: { enoughData: false, since: "all time", source: "t", data: [] },
  skills: { enoughData: false, since: "all time", source: "t", data: [] },
});
const READY = {
  "operator.characterSheet": ok(SHEET),
  "system.journeyLens": ok(lens()),
  "operator.identityProjection": ok({ trajectories: [{ axis: "discipline", label: "Discipline", currentValue: 46, projectedValue30d: 50, delta30d: 4, warning: null }] }),
  "operator.xpGrowthComparison": ok([{ stat: "writing", label: "Writing", gained30d: 0, gained60d: 0, gained90d: 10, gained180d: 30 }]),
  "systemBrain.antiPatterns": ok({ items: [{ key: "late-start", domain: "focus", lesson: "Start before 9.", revisitCount: 3 }] }),
  "operator.skills": ok({ active: [{ trigger: "morning-block", polarity: "do", action_sequence: ["plan", "write"], times_fired: 6, times_succeeded: 5, graduated: false }], pending: [] }),
};

let root: Root | null = null;
let el: HTMLDivElement;

async function mount(search: string, q: Record<string, unknown> = {}) {
  h.search = search;
  h.q = { ...READY, ...q };
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(<StatsPage />);
  });
  return el;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  el?.remove();
  root = null;
});

const list = () => el.querySelector("[data-mastery-list]") as HTMLElement | null;
const group = (name: string) =>
  [...el.querySelectorAll<HTMLElement>("[data-mastery-group]")].find((g) => g.dataset.masteryGroup === name) ?? null;
const count = (name: string) => el.querySelectorAll(`[data-testblock="${name}"]`).length;

describe("Stats leads with its one decision", () => {
  it("the verdict block is the first thing on the page and carries the Journey XP line", async () => {
    await mount("");
    const first = el.querySelector("main")!.firstElementChild!.firstElementChild!;
    expect(first.querySelector("[data-stats-verdict]"), "the verdict is not first").toBeTruthy();
    const journey = first.querySelector("[data-stats-journey]");
    expect(journey, "the Journey line is not inside the verdict").toBeTruthy();
    expect(journey!.textContent).toMatch(/150 XP in the last 30 days/);
    expect(journey!.textContent).toMatch(/100 the 30 before/);
    expect(journey!.textContent).toMatch(/\+50%/);
  });

  it("round 2: a failed refresh over a cached verdict keeps the sentence under a stale note, not the error block", async () => {
    await mount("", { "operator.characterSheet": stale(SHEET) });
    const block = el.querySelector("[data-stats-verdict-block]")!;
    expect(block.querySelector('[data-state-block="error"]'), "the cached sentence was replaced by the error block").toBeNull();
    expect(block.querySelector("[data-stats-verdict]")?.textContent).toMatch(/Total level 7/);
    const note = block.querySelector('[data-read-state="stale"]');
    expect(note, "no stale note").toBeTruthy();
    expect(note!.compareDocumentPosition(block.querySelector("[data-stats-verdict]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("round 2: the Goals tab asks the coach banner to say when its read failed", async () => {
    await mount("tab=goals");
    expect(el.querySelector("[data-coach-read-state]")?.getAttribute("data-coach-read-state")).toBe("true");
  });
  it("the old Journey panel is gone from the bottom of the page", async () => {
    await mount("");
    const outside = [...el.children].filter((c) => c.tagName !== "MAIN");
    expect(outside.map((c) => c.textContent).join(" ")).not.toMatch(/Journey/);
  });

  it("a failed Journey read says so inside the verdict, never a 0 XP month", async () => {
    await mount("", { "system.journeyLens": failed });
    const journey = el.querySelector("[data-stats-journey]")!;
    expect(journey.querySelector('[data-read-state="error"]'), "no failed state").toBeTruthy();
    expect(journey.textContent).not.toMatch(/\b0 XP\b/);
  });

  it("an unread XP window says unknown, a stale one keeps the numbers under a stale note, offline says offline", async () => {
    await mount("", { "system.journeyLens": ok(lens({ unknown: true, enoughData: false, data: { current30: 0, prior30: 0, growthPct: null } })) });
    expect(el.querySelector("[data-stats-journey]")!.textContent).toMatch(/couldn.t be read/i);
    await act(async () => root!.unmount());
    el.remove();
    await mount("", { "system.journeyLens": stale(lens()) });
    let journey = el.querySelector("[data-stats-journey]")!;
    expect(journey.querySelector('[data-read-state="stale"]')).toBeTruthy();
    expect(journey.textContent).toMatch(/150 XP/);
    await act(async () => root!.unmount());
    el.remove();
    await mount("", { "system.journeyLens": paused });
    journey = el.querySelector("[data-stats-journey]")!;
    expect(journey.querySelector('[data-read-state="offline"]')).toBeTruthy();
  });
});

describe("Mastery is one row list, not three cards", () => {
  it("renders one list with three headed groups in order, and no card", async () => {
    await mount("");
    expect(el.querySelectorAll("[data-mastery-list]")).toHaveLength(1);
    const names = [...list()!.querySelectorAll<HTMLElement>("[data-mastery-group]")].map((g) => g.dataset.masteryGroup);
    expect(names).toEqual(["identity", "enemies", "skills"]);
    for (const old of ["identity-arc-card", "recurring-enemies-card", "graduated-skills-card"]) {
      expect(el.querySelector(`[aria-label="${old}"]`), old).toBeNull();
    }
    expect(group("identity")!.textContent).toMatch(/Discipline/);
    expect(group("identity")!.textContent).toMatch(/Writing/); // a stalled stat is a row too
    expect(group("enemies")!.textContent).toMatch(/late-start/);
    expect(group("skills")!.textContent).toMatch(/morning-block/);
  });

  it("the list sits under today's move and above the character sheet", async () => {
    await mount("");
    const directive = el.querySelector('[data-testblock="LevelUpDirectiveCard"]')!;
    const sheet = el.querySelector('[data-testblock="CharacterSheet"]')!;
    expect(directive.compareDocumentPosition(list()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sheet.compareDocumentPosition(list()!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("a failed read in any group says so with the failed marker, never 'none yet' and never hidden", async () => {
    await mount("", { "systemBrain.antiPatterns": failed, "operator.skills": failed, "operator.identityProjection": failed });
    for (const name of ["identity", "enemies", "skills"]) {
      const g = group(name);
      expect(g, `${name} group hidden on a failed read`).toBeTruthy();
      expect(g!.querySelector("[data-read-failed], [data-read-state='error']"), name).toBeTruthy();
      expect(g!.textContent).not.toMatch(/\bno (recurring|graduated|trajector)/i);
    }
  });

  it("a stale group keeps its rows under a stale note; a paused one says offline; loading says reading", async () => {
    await mount("", { "operator.skills": stale({ active: [{ trigger: "morning-block", polarity: "do", action_sequence: [], times_fired: 6, times_succeeded: 5, graduated: false }], pending: [] }), "systemBrain.antiPatterns": paused });
    expect(group("skills")!.querySelector('[data-read-state="stale"]')).toBeTruthy();
    expect(group("skills")!.textContent).toMatch(/morning-block/);
    expect(group("enemies")!.querySelector('[data-read-state="offline"]')).toBeTruthy();
    expect(group("identity")!.textContent).not.toMatch(/reading/i);
    await act(async () => root!.unmount());
    el.remove();
    await mount("", { "operator.identityProjection": { ...paused, fetchStatus: "fetching", isLoading: true } });
    expect(group("identity")!.textContent).toMatch(/reading/i);
  });
});

describe("Goals holds the three cards moved from the Brain Self-model fold", () => {
  it("mounts calibration, prediction streaks and Ghost Nick once each, beside the calibration section", async () => {
    await mount("tab=goals");
    for (const name of ["CalibrationTile", "PredictionStreaksCard", "GhostNickStrip"]) expect(count(name), name).toBe(1);
    const calibration = el.querySelector("section#calibration")!;
    expect(calibration.querySelector('[data-testblock="CalibrationTile"]')).toBeTruthy();
    expect(calibration.querySelector('[data-testblock="PredictionStreaksCard"]')).toBeTruthy();
    expect(el.querySelector('section#forecast-duel [data-testblock="GhostNickStrip"]')).toBeTruthy();
  });

  it("they mount nowhere else on Stats", async () => {
    await mount("");
    for (const name of ["CalibrationTile", "PredictionStreaksCard", "GhostNickStrip"]) expect(count(name), name).toBe(0);
  });
});

describe("CalibrationSection says which state it is in (wave E2 fix)", () => {
  async function mountSection(q: unknown) {
    h.q = { "intelligence.calibrationReviews": q };
    el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<CalibrationSection />);
    });
  }
  const reviews = { pending: [], history: [], lessons: [], scoreboard: null };

  it("a paused read before any data says offline, never 'queue clear'", async () => {
    await mountSection(paused);
    expect(el.querySelector('[data-read-state="offline"]')).toBeTruthy();
    expect(el.textContent).not.toMatch(/queue clear/i);
  });

  it("a failed refresh over cached reviews keeps them under a stale note", async () => {
    await mountSection(stale(reviews));
    expect(el.querySelector('[data-read-state="stale"]')).toBeTruthy();
    expect(el.textContent).toMatch(/queue clear/i);
  });

  it("loading is words, not pulsing blocks; a failed read with no data says it failed", async () => {
    await mountSection({ ...paused, fetchStatus: "fetching", isLoading: true });
    expect(el.querySelector('[data-state-block="loading"]')).toBeTruthy();
    expect(el.querySelectorAll(".animate-pulse")).toHaveLength(0);
    await act(async () => root!.unmount());
    el.remove();
    await mountSection(failed);
    expect(el.textContent).toMatch(/failed to load/i);
    expect(el.textContent).not.toMatch(/queue clear/i);
  });
});