/**
 * DECIDE never reads "0 to decide" over a failed read (lens review 2026-10-23).
 * A failed captures or rescue read lands in deck.unmeasured while the count
 * stays 0; the line must say the count is unknown, and the section must stay.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/missions/task-pending-classification-chip", () => ({ TaskPendingClassificationChip: () => null }));

import { DeckDecide } from "@/components/missions/deck-decide";

const base = {
  triage: { rows: [], totalCount: 0 },
  waiting: [],
  closed: { count: 0, rows: [] },
  tasks: [],
  onEditTask: () => {},
  onSnoozeTask: async () => true,
  onDeleteTask: async () => {},
  onUnblock: () => {},
  onRetry: () => {},
};

describe("DeckDecide · unmeasured sources", () => {
  it("a failed captures read: the line says the count is unknown, never 0, and the section renders", () => {
    const html = renderToStaticMarkup(<DeckDecide {...base} unmeasured={["captures"]} />);
    expect(html).toContain("decide");
    expect(html).toMatch(/Captures not read, count unknown/);
    expect(html).not.toMatch(/0 to decide/);
  });

  it("a failed rescue read names rescue", () => {
    const html = renderToStaticMarkup(<DeckDecide {...base} unmeasured={["rescue"]} />);
    expect(html).toMatch(/Rescue not read, count unknown/);
  });

  it("control: everything read and nothing queued renders nothing", () => {
    expect(renderToStaticMarkup(<DeckDecide {...base} unmeasured={[]} />)).toBe("");
  });
});
