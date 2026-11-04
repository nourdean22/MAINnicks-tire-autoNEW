/**
 * W8b (audit B9) · the chat capture reply says who the entry reached and who it did not: "People: Dania · not on
 * People: Mo". Before, a refused name vanished and he had no way to know the line never landed on anyone.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai/chat/handlers/shared", () => ({ buildFastStream: vi.fn() }));

import { captureReplyLines } from "@/lib/ai/chat/handlers/brain-dump";

const base = { brainDumpId: "d1", entryType: "reflection", tasksCreated: 0, insightsStored: 0, commitmentsFound: 0, summary: null };

describe("captureReplyLines", () => {
  it("lists linked people and refused names on one line", () => {
    const lines = captureReplyLines({ ...base, peopleLinked: { linked: 2, contacts: 1, failed: 0, names: ["Dania", "Sam"], rejected: ["Mo"] } });
    expect(lines).toContain("**People:** Dania, Sam · not on People: Mo");
  });

  it("only refused names: says so, never an empty 'People:'", () => {
    const lines = captureReplyLines({ ...base, peopleLinked: { linked: 0, contacts: 0, failed: 0, names: [], rejected: ["Mo"] } });
    expect(lines).toContain("**People:** none linked · not on People: Mo");
  });

  it("a failed contact write is said, not hidden behind the names", () => {
    const lines = captureReplyLines({ ...base, peopleLinked: { linked: 1, contacts: 0, failed: 1, names: ["Dania"], rejected: [] } });
    expect(lines.join("\n")).toMatch(/Dania.*contact not saved/);
  });

  it("no people in the entry: no people line at all; the counts line still works", () => {
    const lines = captureReplyLines({ ...base, tasksCreated: 2, peopleLinked: { linked: 0, contacts: 0, failed: 0, names: [], rejected: [] } });
    expect(lines.some((l) => l.startsWith("**People:**"))).toBe(false);
    expect(lines).toContain("**Extracted:** 2 tasks");
  });

  // Manager round 1, item 5: a link that failed or did not run must not read as "named no one".
  it("no link result at all says it couldn't link", () => {
    expect(captureReplyLines(base)).toContain("**People:** couldn't link");
  });
});
