/**
 * Goal chips on /missions (job 2026-11-02-nour-os-interconnect W3): what the
 * rows and the filter row RENDER, not what the source says.
 *
 *  · a task row shows `goal · <title>` when the task carries its OWN goal; an
 *    inherited goal is already on the mission card above it, so the row stays quiet;
 *  · the chip links to `/missions?goalId=<id>` (it sets the page filter, it does not
 *    leave the page) and is a 44 px tap target;
 *  · the filter row renders nothing when no goal has linked work, and its selected
 *    chip links back to the unfiltered page.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  // replace / scroll are next/link props, not DOM attributes.
  default: ({ href, children, replace: _r, scroll: _s, ...rest }: { href: string; children: React.ReactNode; replace?: boolean; scroll?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-inspector", () => ({ useInspector: () => ({ openInspector: () => {} }) }));

import { MissionTaskRow } from "@/components/missions/mission-task-row";
import { GoalFilterChips } from "@/components/missions/goal-filter-chips";
import { MissionDispatchProvider } from "@/app/(mastery)/missions/context/mission-dispatch-context";
import type { Task } from "@/components/actions/shared";

function row(task: Task) {
  return renderToStaticMarkup(
    <MissionDispatchProvider actions={{} as never}>
      <MissionTaskRow task={task} />
    </MissionDispatchProvider>,
  );
}

const base = { id: "t1", title: "Book the long run", status: "READY", missionId: "m1" };

describe("task row goal chip", () => {
  it("an own goal renders the chip, linked to the page filter, at 44 px", () => {
    const html = row({ ...base, goal: { id: "g-run", title: "Run a half marathon", source: "task" } } as unknown as Task);
    expect(html).toContain("goal · Run a half marathon");
    expect(html).toContain('href="/missions?goalId=g-run"');
    expect(html).toMatch(/<a[^>]*class="[^"]*min-h-11[^"]*"[^>]*>(<span[^>]*>)?goal · /);
  });

  it("an inherited goal stays off the row (the mission card already shows it)", () => {
    const html = row({ ...base, goal: { id: "g-run", title: "Run a half marathon", source: "mission" } } as unknown as Task);
    expect(html).not.toContain("goal ·");
  });

  it("an unread title says so instead of inventing one", () => {
    const html = row({ ...base, goal: { id: "g-run", title: null, source: "task" } } as unknown as Task);
    expect(html).toContain("goal · title not read");
  });

  it("POSITIVE CONTROL: no goal, no chip", () => {
    expect(row(base as unknown as Task)).not.toContain("goal ·");
  });
});

describe("goal filter row", () => {
  const options = [
    { id: "g-run", title: "Run a half marathon" },
    { id: "g-cash", title: "Save 10k" },
  ];

  it("renders nothing when no goal has linked work", () => {
    expect(renderToStaticMarkup(<GoalFilterChips options={[]} selectedId={null} goalsRead="ok" />)).toBe("");
  });

  it("each chip filters to its goal; the selected one clears back to /missions", () => {
    const html = renderToStaticMarkup(<GoalFilterChips options={options} selectedId="g-run" goalsRead="ok" />);
    expect(html).toContain('href="/missions"');
    expect(html).toContain('href="/missions?goalId=g-cash"');
    expect(html).toMatch(/aria-current="true"[^>]*>(<span[^>]*>)?Run a half marathon/);
    expect(html.match(/min-h-11/g)?.length).toBe(2);
  });

  it("a failed goals read says so on the row, never a silent empty", () => {
    const html = renderToStaticMarkup(<GoalFilterChips options={[]} selectedId={null} goalsRead="failed" />);
    expect(html).toContain("goal titles not read this pass");
  });
});
