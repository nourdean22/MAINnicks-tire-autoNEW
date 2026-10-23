/**
 * The board sorts by the deck's live order (deck.taskOrder), so reorder
 * controls that swap the stored autoPriority could never change what is shown
 * (Codex P1, PR 3257). Ruling: the card carries no reorder controls (reorder*
 * had 0 taps in 14 days); the server procedure stays.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionCard } from "@/components/missions/mission-card";
import { MissionDispatchProvider } from "@/app/(mastery)/missions/context/mission-dispatch-context";
import type { Project, Task } from "@/components/actions/shared";

const MISSION = { id: "m1", title: "Project A", status: "ACTIVE", deadline: "2026-12-01T00:00:00Z" } as Project;
const TASKS = [{ id: "o1", status: "READY" }, { id: "o2", status: "READY" }] as Task[];

describe("MissionCard · no reorder controls", () => {
  it("a card in the middle of the board renders no move up / move down control", () => {
    const html = renderToStaticMarkup(
      <MissionDispatchProvider actions={{} as never}>
        <MissionCard mission={MISSION} tasks={TASKS} defaultExpanded={false} {...({ missionIdx: 1, totalMissions: 3 } as object)} />
      </MissionDispatchProvider>,
    );
    expect(html).toContain("Project A"); // the card rendered (positive control)
    expect(html).not.toMatch(/move (mission .* )?(up|down)/i);
  });
});
