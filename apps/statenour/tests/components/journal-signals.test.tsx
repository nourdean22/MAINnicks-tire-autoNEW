/**
 * Journal Insights, wave E1 (2026-10-24): nine blocks around one composer became four things.
 *
 *   - ONE "Signals" row list holds the takes, Nick's self-assessment and the thread-pace strip.
 *   - The three thread-ops panels sit under ONE closed "Threads" disclosure.
 *   - The NotebookLM paste zone left the page (it is mounted once, in Settings).
 *
 * empty-vs-error: every merged block keeps its own loading, empty and failed state, and the closed
 * Threads disclosure says when something inside it is unreadable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Q = { data?: unknown; isError?: boolean; isLoading?: boolean; fetchStatus?: string };
const q = vi.hoisted(() => ({ map: {} as Record<string, Q> }));

vi.mock("@/lib/trpc/client", () => {
  const ok = { data: [], isError: false, isLoading: false, fetchStatus: "idle", refetch: () => {}, error: null };
  const procedure = (name: string) => ({
    useQuery: () => ({ ...ok, ...(q.map[name] ?? {}) }),
    useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }),
  });
  // Only the procedures the Journal column really reads. An unknown name throws, so a typo cannot be
  // answered with a healthy default (the old Proxy answered any procedure).
  const KNOWN = ["insightsPreview", "metacognition", "threads", "convergence", "suggestions", "promoteNextAction"];
  const journal = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (!KNOWN.includes(name)) throw new Error(`unexpected trpc.journal.${name}`);
        return procedure(name);
      },
    },
  );
  return { trpc: { journal } };
});
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/hooks/use-min-width", () => ({ useMinWidth: () => false }));
vi.mock("@/components/journal/nicks-journal-brief", () => ({ NicksJournalBrief: () => <section>panel-brief</section> }));
vi.mock("@/components/journal/todays-prompt", () => ({ TodaysPrompt: () => null }));
vi.mock("@/components/journal/thread-radar", () => ({ ThreadRadar: () => <section>panel-radar</section> }));
vi.mock("@/components/journal/thread-rail", () => ({ ThreadRail: () => <section>panel-rail</section> }));
vi.mock("@/components/journal/thread-suggestions", () => ({ ThreadSuggestions: () => <section>panel-suggestions</section> }));

import { JournalInsightsView } from "@/app/(mastery)/journal/_components/journal-insights-view";

const render = () => renderToStaticMarkup(<JournalInsightsView threadRefresh={0} setThreadRefresh={() => {}} />);
const region = (html: string, label: string) => {
  const start = html.indexOf(`aria-label="${label}"`);
  if (start < 0) return "";
  return html.slice(start, html.indexOf("</section>", start));
};
const COULD_NOT = "could not load. State unknown, not empty.";

afterEach(() => {
  q.map = {};
});

describe("Journal Signals row list", () => {
  it("renders ONE Signals section with three rows (takes, self-assessment, thread pace)", () => {
    const html = render();
    expect(html.match(/aria-label="Signals"/g)?.length).toBe(1);
    expect(region(html, "Signals").match(/<li\b/g)?.length).toBe(3);
  });

  it("measured empty is not failed: three honest empty lines, no could-not-load", () => {
    const sig = region(render(), "Signals");
    expect(sig).toContain("No takes extracted yet");
    expect(sig).toContain("No nightly self-assessment yet");
    expect(sig).toContain("No threads yet");
    expect(sig).not.toContain(COULD_NOT);
  });

  it("each merged block keeps its own failed state: a failed read is never an empty row", () => {
    q.map = {
      insightsPreview: { data: undefined, isError: true },
      metacognition: { data: undefined, isError: true },
      threads: { data: undefined, isError: true },
    };
    const sig = region(render(), "Signals");
    expect(sig.match(new RegExp(COULD_NOT.replace(/\./g, "\\."), "g"))?.length).toBe(3);
    expect(sig).not.toContain("No takes extracted yet");
    expect(sig).not.toContain("No nightly self-assessment yet");
    expect(sig).not.toContain("No threads yet");
  });

  it("a loading read shows a skeleton row, not the empty line", () => {
    q.map = { insightsPreview: { data: undefined, isLoading: true, fetchStatus: "fetching" } };
    const sig = region(render(), "Signals");
    expect(sig).toContain("data-skeleton");
    expect(sig).not.toContain("No takes extracted yet");
  });

  it("control: real takes still render with their accept button", () => {
    q.map = {
      insightsPreview: {
        data: [
          {
            id: "t1", entryId: "e1", updatedAt: "2026-10-20T12:00:00Z", entryTitle: "Morning pages", goalId: null,
            idea: null, challenge: null, nextAction: { action: "Call the supplier", domain: null },
            ideaPromoted: false, challengePromoted: false, nextActionPromoted: false,
            commitmentStatus: null, evidenceTier: null, takeConfidence: null,
          },
        ],
      },
    };
    const sig = region(render(), "Signals");
    expect(sig).toContain("Call the supplier");
    expect(sig).toContain("accept");
  });
});

describe("Journal Threads disclosure", () => {
  it("holds radar, rail and suggestions in ONE closed disclosure labelled Threads", () => {
    const html = render();
    expect(html.match(/<details/g)?.length).toBe(2); // Insights + Threads
    const at = html.indexOf('aria-label="Threads"');
    expect(at).toBeGreaterThan(-1);
    const tag = html.slice(html.lastIndexOf("<details", at), html.indexOf(">", at));
    expect(tag).not.toMatch(/\sopen/);
    const inside = html.slice(html.indexOf("</summary>", at));
    for (const panel of ["panel-radar", "panel-rail", "panel-suggestions"]) expect(inside).toContain(panel);
  });

  it("the NotebookLM zone is gone from the Journal column", () => {
    expect(render()).not.toContain("panel-notebook");
  });

  it("assert-the-consumer: the zone is mounted exactly once, in the Settings console", () => {
    const root = join(__dirname, "..", "..");
    const settings = readFileSync(join(root, "components/settings/settings-console.tsx"), "utf8");
    expect(settings.match(/<NotebookLMContextZone\s*\/>/g)?.length).toBe(1);
    const journalPage = readFileSync(join(root, "app/(mastery)/journal/_components/journal-insights-view.tsx"), "utf8");
    expect(journalPage).not.toMatch(/NotebookLMContextZone/);
    expect(existsSync(join(root, "components/settings/notebooklm-context-zone.tsx"))).toBe(true);
  });

  const threadsSummary = (html: string) => {
    const at = html.indexOf('aria-label="Threads"');
    return html.slice(html.indexOf("<summary", at), html.indexOf("</summary>", at));
  };
  const FAIL = { data: undefined, isError: true };

  it("the closed summary counts each of the three reads on its own", () => {
    q.map = { convergence: FAIL };
    expect(threadsSummary(render())).toMatch(/1 unreadable/);
    q.map = { suggestions: FAIL };
    expect(threadsSummary(render())).toMatch(/1 unreadable/);
    q.map = { threads: FAIL };
    expect(threadsSummary(render())).toMatch(/1 unreadable/);
    q.map = { threads: FAIL, suggestions: FAIL };
    expect(threadsSummary(render())).toMatch(/2 unreadable/);
  });

  it("the Insights summary says how many of the five reads failed, so a closed column is not 'fine'", () => {
    q.map = { insightsPreview: FAIL, metacognition: FAIL, threads: FAIL, convergence: FAIL, suggestions: FAIL };
    const html = render();
    const outer = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(outer).toContain("Insights");
    expect(outer).toMatch(/5 unreadable/);
    expect(outer).not.toMatch(/Insights \(\d+\)/);
  });

  it("control: a healthy column has no unreadable claim on either summary", () => {
    const html = render();
    expect(html.slice(html.indexOf("<summary"), html.indexOf("</summary>"))).not.toMatch(/unreadable/);
  });

  it("a stale read over an empty row keeps its stale note above the empty line", () => {
    q.map = {
      insightsPreview: { data: [], isError: true },
      metacognition: { data: {}, isError: true },
      threads: { data: [], isError: true },
    };
    const sig = region(render(), "Signals");
    expect(sig.match(/Last refresh failed\./g)?.length).toBe(3);
    expect(sig.indexOf("Last refresh failed.")).toBeLessThan(sig.indexOf("No takes extracted yet"));
    expect(sig).toContain("No nightly self-assessment yet");
    expect(sig).toContain("No threads yet");
  });

  it("control: when every thread read works the summary claims nothing unreadable", () => {
    const html = render();
    const at = html.indexOf('aria-label="Threads"');
    expect(at).toBeGreaterThan(-1);
    const summary = html.slice(html.indexOf("<summary", at), html.indexOf("</summary>", at));
    expect(summary).not.toMatch(/unreadable/);
  });
});
