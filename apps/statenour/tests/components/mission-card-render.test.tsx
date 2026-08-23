/**
 * What the mission header ACTUALLY renders. Not what the source text contains.
 *
 * WHY THIS FILE EXISTS. The first version of this guard asserted four regexes
 * against the raw text of mission-card.tsx — that `hasEndState ? (` appeared,
 * that `{openTasks.length} open` appeared, and so on. Every one of those still
 * matches if you SWAP THE TERNARY BRANCHES:
 *
 *     hasEndState ? (<span>{openTasks.length} open</span>)
 *                 : (<span>{progress}%</span>)
 *
 * That mutation ships the exact inversion of the fix — the misleading 79% back
 * onto the life-area bucket, the honest open-count onto real projects — and the
 * source assertions all pass. A guard that cannot tell a fix from its opposite
 * is not a guard.
 *
 * The harness is the repo's existing one: `renderToStaticMarkup` under
 * `environment: "node"`, no jsdom (precedent and rationale in
 * tests/components/observability-tiles.test.tsx:6-26). MissionCard needs only
 * the mission-dispatch context; its task rows sit behind `{expanded && (` at
 * mission-card.tsx:404, so `defaultExpanded={false}` keeps the render to the
 * header under test.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MissionCard } from "@/components/missions/mission-card";
import { MissionDispatchProvider } from "@/app/(mastery)/missions/context/mission-dispatch-context";
import type { Project, Task } from "@/components/actions/shared";

const BUCKET: Project = {
  id: "m1",
  title: "GENERAL BUSINESS & NICKS TIRE",
  status: "ACTIVE",
} as Project;

const PROJECT: Project = { ...BUCKET, deadline: "2026-09-01T00:00:00Z" } as Project;

// The live counts: 26 done, 7 open → 79%.
const TASKS: Task[] = [
  ...Array.from({ length: 26 }, (_, i) => ({ id: `d${i}`, status: "DONE" }) as Task),
  ...Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, status: "READY" }) as Task),
];

function render(mission: Project, tasks: Task[] = TASKS) {
  return renderToStaticMarkup(
    <MissionDispatchProvider actions={{} as never}>
      <MissionCard mission={mission} tasks={tasks} defaultExpanded={false} />
    </MissionDispatchProvider>,
  );
}

describe("mission header · rendered output", () => {
  it("THE ARTEFACT: a bucket shows the open count and NO percentage", () => {
    const html = render(BUCKET);
    expect(html).toContain("7 open");
    expect(html, "79% is the figure that made a never-ending bucket read as nearly done").not.toContain("79%");
  });

  it("POSITIVE CONTROL: a mission with a deadline still shows the percentage", () => {
    // This is the assertion the source-text version could not make. Together
    // with the one above it pins the DIRECTION of the ternary, so swapping the
    // branches fails here even though every regex still matches.
    const html = render(PROJECT);
    expect(html).toContain("79%");
    expect(html).not.toContain("7 open");
  });

  it("the progress BAR renders only for a mission that can finish", () => {
    // width:79% is the inline style on the fill element. A bar filling toward a
    // target nobody set is a picture of a claim the data does not make.
    expect(render(PROJECT)).toMatch(/width:\s*79%/);
    expect(render(BUCKET)).not.toMatch(/width:\s*\d+%/);
  });

  it("an empty mission shows neither — the wave-AA-audit rule still holds", () => {
    const html = render(BUCKET, []);
    expect(html).not.toContain("0%");
    expect(html).not.toContain("0 open");
  });

  it("the open count is reachable without hover", () => {
    // statenour is a standalone iOS PWA (AGENTS.md → Frontend conventions).
    // A title= tooltip is dead on a touch device, so the number the operator
    // needs must be in the text, not only in an attribute.
    const html = render(BUCKET);
    const textOnly = html.replace(/<[^>]*>/g, " ");
    expect(textOnly).toContain("7 open");
  });
});
