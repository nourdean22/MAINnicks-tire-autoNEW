/**
 * A suggested next step for a goal with none (job 2026-10-30-goals-system W3): the newest
 * action item the journal already extracted from an entry linked to this goal, that is not
 * already a task. Offered with one tap on the goal card, never created on its own.
 */
import { describe, expect, it } from "vitest";

import { pickJournalStep } from "@/lib/services/goal-next-step";

const dump = (id: string, actionItems: unknown, createdAt = "2026-10-29T12:00:00.000Z") => ({
  id,
  createdAt: new Date(createdAt),
  extractedItems: JSON.stringify({ actionItems }),
});

describe("pickJournalStep", () => {
  it("takes the newest entry's first action item that is not already a task", () => {
    const step = pickJournalStep(
      [
        dump("old", [{ title: "Older step" }], "2026-10-20T12:00:00.000Z"),
        dump("new", [{ title: "Book the dyno slot" }, { title: "Call the supplier" }]),
      ],
      ["book the dyno slot"],
    );
    expect(step).toEqual({ title: "Call the supplier", dumpId: "new" });
  });

  it("skips unreadable JSON, a missing list and titles too short to act on", () => {
    const rows = [
      { id: "bad", createdAt: new Date("2026-10-29T12:00:00.000Z"), extractedItems: "{not json" },
      { id: "none", createdAt: new Date("2026-10-28T12:00:00.000Z"), extractedItems: null },
      dump("short", [{ title: "ok" }, "plain string"], "2026-10-27T12:00:00.000Z"),
      dump("good", [{ title: "Draft the hiring post" }], "2026-10-26T12:00:00.000Z"),
    ];
    expect(pickJournalStep(rows, [])).toEqual({ title: "Draft the hiring post", dumpId: "good" });
  });

  it("returns null when nothing qualifies (never invents a step)", () => {
    expect(pickJournalStep([dump("a", [])], [])).toBeNull();
    expect(pickJournalStep([], [])).toBeNull();
  });

  it("a title journal-ingest trimmed, re-spaced or cut to 150 + an ellipsis still counts as taken (W3 review P2)", () => {
    const long = "Call the supplier about the Friday order and ask whether the 245/40R18 set can ship by Thursday so the customer car is back on the road before the weekend rush";
    const sanitized = long.slice(0, 150) + "…";
    expect(pickJournalStep([dump("d", [{ title: long }])], [sanitized])).toBeNull();
    expect(pickJournalStep([dump("d", [{ title: "  Book the\n dyno   slot " }])], ["Book the dyno slot"])).toBeNull();
  });
});
