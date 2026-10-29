/**
 * /system/crons, UI v3 W5c (2026-10-29 sync audit, finding 5): Run fires a job once, outside its
 * schedule, against live data, so it asks first in the DOM (never window.confirm); the kill switch and
 * Run are 44 px targets (iOS tap floor).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ run: vi.fn(async () => ({ ok: true, durationMs: 12 })) }));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ systemAutomation: { cronDeck: { invalidate: async () => {} } } }),
    systemAutomation: {
      cronDeck: {
        useQuery: () => ({
          data: {
            rows: [
              {
                name: "nightly-sweep",
                schedule: "0 3 * * *",
                mode: "active",
                category: "hygiene",
                description: "sweeps",
                enabled: true,
                lastSuccessAt: null,
                lastFailAt: null,
                success14d: 3,
                fail14d: 0,
                successRate: 100,
                recentDurations: [],
                lastRunAt: null,
                lastRunMs: null,
                lastStatus: null,
                nextRunAt: null,
                drift: null,
              },
            ],
            summary: { active: 1, disabled: 0, folded: 0, retired: 0, runs24h: 1, failures24h: 0, drifted: 0 },
            generatedAt: new Date().toISOString(),
          },
          isPending: false,
          isFetching: false,
          refetch: () => {},
        }),
      },
      setCronEnabled: { useMutation: () => ({ mutateAsync: async () => ({}) }) },
      runManifestCron: { useMutation: () => ({ mutateAsync: h.run }) },
    },
  },
}));
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));
vi.mock("@/components/system/knowledge-refresh-panel", () => ({ KnowledgeRefreshPanel: () => null }));
vi.mock("@/components/system/cron-fold-tree", () => ({ CronFoldTree: () => null }));
vi.mock("@/components/ui/sort-dropdown", () => ({ SortDropdown: () => null }));
vi.mock("@/hooks/use-inspector", () => ({ useInspector: () => ({ openInspector: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import CronsPage from "@/app/(mastery)/system/crons/page";

let root: Root | null = null;
let host: HTMLDivElement;
const all = (sel: string) => Array.from(document.body.querySelectorAll<HTMLButtonElement>(sel));
const byText = (sel: string, name: RegExp) => all(sel).find((b) => name.test(b.textContent ?? ""));

beforeEach(() => {
  h.run.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<CronsPage />));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe("/system/crons run now", () => {
  it("Run asks first: Cancel runs nothing, Run now in the dialog runs the job", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    await act(async () => byText("main button", /^Run$/)!.click());
    expect(h.run).not.toHaveBeenCalled();
    await act(async () => byText('[role="dialog"] button, [role="alertdialog"] button', /^Cancel$/)!.click());
    expect(h.run).not.toHaveBeenCalled();
    await act(async () => byText("main button", /^Run$/)!.click());
    await act(async () => byText('[role="dialog"] button, [role="alertdialog"] button', /^Run now$/)!.click());
    expect(h.run).toHaveBeenCalledWith({ jobName: "nightly-sweep" });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("the kill switch, Run and the category filters are 44 px targets", () => {
    const sw = all('main [role="switch"]')[0]!;
    expect(sw.className).toContain("min-h-[44px]");
    expect(byText("main button", /^Run$/)!.className).toContain("min-h-[44px]");
    expect(byText("main button", /^All$/)!.className).toContain("min-h-[44px]");
  });
});
