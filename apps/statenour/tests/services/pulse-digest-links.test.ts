/**
 * Truth sweep review F8: the pulse digest linked a contradiction insight to `/brain?resolve=<key>`,
 * a parameter nothing on /brain reads (the nick-command-line comment says the same of the old
 * /search door). Home and the ticker end the same link in `#contradictions`; the digest item must
 * land on that panel too.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { linkForInsightActor } from "@/lib/services/pulse-digest";

describe("linkForInsightActor", () => {
  it("a contradiction insight opens the contradictions panel, the same target Home and the ticker use", () => {
    expect(linkForInsightActor("contradiction-scan")).toBe("/brain?tab=memory#contradictions");
  });
  it("never emits a resolve= parameter (nothing reads it)", () => {
    for (const actor of ["contradiction", "CONTRADICTION_DETECTOR", "skill", "system", "unknown", null, undefined]) {
      expect(linkForInsightActor(actor)).not.toContain("resolve=");
    }
  });
  it("control: the other actors keep their doors", () => {
    expect(linkForInsightActor("system")).toBe("/system");
    expect(linkForInsightActor("cron-watcher")).toBe("/system");
    expect(linkForInsightActor("belief-decay")).toBe("/brain");
    expect(linkForInsightActor(undefined)).toBe("/brain");
  });
});
