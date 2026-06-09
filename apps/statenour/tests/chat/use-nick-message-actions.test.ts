import { describe, it, expect } from "vitest";
import { deriveTaskTitle, resolveConfirmedTitle } from "@/hooks/chat/use-nick-message-actions";

// P9 · the "Create task from an AI message" flow now shows an editable confirm.
// These pure helpers carry the title-derivation + the confirm-gate decision, so
// the junk-title prevention is provable without rendering the hook.

describe("deriveTaskTitle", () => {
  it("takes the first sentence as the proposed title", () => {
    expect(deriveTaskTitle("Call the vendor. Then email Sam.")).toBe("Call the vendor");
    expect(deriveTaskTitle("Buy milk! And eggs.")).toBe("Buy milk");
    expect(deriveTaskTitle("Is it ready? Maybe later.")).toBe("Is it ready");
  });

  it("falls back to a 120-char slice when there is no sentence break", () => {
    expect(deriveTaskTitle("just one line no punctuation")).toBe("just one line no punctuation");
    expect(deriveTaskTitle("a".repeat(200))).toBe("a".repeat(120));
  });

  it("handles empty text without throwing", () => {
    expect(deriveTaskTitle("")).toBe("");
  });
});

describe("resolveConfirmedTitle (the confirm gate)", () => {
  it("returns null when the operator cancels — nothing gets created", () => {
    expect(resolveConfirmedTitle(null)).toBeNull();
  });

  it("returns null for a blank / whitespace-only edit — never creates an empty task", () => {
    expect(resolveConfirmedTitle("")).toBeNull();
    expect(resolveConfirmedTitle("   ")).toBeNull();
  });

  it("returns the trimmed edited title when the operator confirms", () => {
    expect(resolveConfirmedTitle("Call the vendor")).toBe("Call the vendor");
    expect(resolveConfirmedTitle("  Email Sam about the rims  ")).toBe("Email Sam about the rims");
  });
});
