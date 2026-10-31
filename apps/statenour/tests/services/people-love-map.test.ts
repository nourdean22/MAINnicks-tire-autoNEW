/**
 * People W2c (2026-10-30): one love-map question a day for a person Nour has
 * written nothing about (Gottman's "love maps": knowing the other person's
 * world). Pure functions, no DB, no model.
 *
 *  - only people with no notes are asked about; a person with notes is never
 *    asked again, so the question stops by itself as profiles fill;
 *  - the pick holds still for the New York day and rotates across days;
 *  - an answer is appended to the notes, never written over them.
 */
import { describe, expect, it } from "vitest";

import {
  LOVE_MAP_QUESTIONS,
  appendLoveMapAnswer,
  pickLoveMapQuestion,
} from "@/lib/services/people/love-map";

const people = [
  { id: "p3", name: "Ana", leverageNotes: null },
  { id: "p1", name: "Sam Rivers", leverageNotes: "" },
  { id: "p2", name: "Lee", leverageNotes: "works nights" },
];

describe("pickLoveMapQuestion", () => {
  it("asks only about someone with no notes, and names them in the question", () => {
    const q = pickLoveMapQuestion(people, "2026-10-30");
    expect(q).not.toBeNull();
    expect(["p1", "p3"]).toContain(q!.personId);
    expect(q!.question).toContain(q!.name);
    expect(LOVE_MAP_QUESTIONS.map((t) => t.replace("{name}", q!.name))).toContain(q!.question);
  });

  it("returns null when everyone has notes", () => {
    expect(pickLoveMapQuestion([{ id: "p2", name: "Lee", leverageNotes: "works nights" }], "2026-10-30")).toBeNull();
    expect(pickLoveMapQuestion([], "2026-10-30")).toBeNull();
  });

  it("holds still for the day whatever the input order", () => {
    const a = pickLoveMapQuestion(people, "2026-10-30");
    const b = pickLoveMapQuestion([...people].reverse(), "2026-10-30");
    expect(b).toEqual(a);
  });

  it("reaches every person without notes across consecutive days", () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 10; d++) {
      seen.add(pickLoveMapQuestion(people, `2026-11-${String(d).padStart(2, "0")}`)!.personId);
    }
    expect([...seen].sort()).toEqual(["p1", "p3"]);
  });
});

describe("appendLoveMapAnswer", () => {
  it("starts the notes when there were none", () => {
    expect(appendLoveMapAnswer(null, "What is Ana working toward?", "  her license ")).toBe(
      "What is Ana working toward? her license",
    );
  });

  it("adds a line under existing notes, never replaces them", () => {
    expect(appendLoveMapAnswer("works nights", "Q?", "a")).toBe("works nights\nQ? a");
  });

  it("refuses an empty answer and anything that would cut the notes past 2000 characters", () => {
    expect(appendLoveMapAnswer(null, "Q?", "   ")).toBeNull();
    expect(appendLoveMapAnswer("x".repeat(1995), "Q?", "long answer")).toBeNull();
  });
});
