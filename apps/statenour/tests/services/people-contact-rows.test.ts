/**
 * contact-rows · the one definition of "this ledger row is a contact"
 * (2026-09-16, W6). Two row kinds are excluded: the 2026-05-29 synthetic
 * mention backfill (`metadata.synthetic === true`) and status-flip audit
 * rows (`metadata.kind === "status_flip"`). Everything else — including the
 * 15 prod rows whose metadata is NULL — counts.
 *
 * Positive control: with `isContactRow` mutated to `return true`, the
 * synthetic and status-flip cases go red.
 */
import { describe, expect, it } from "vitest";

import { CONTACT_ROW_SQL, isContactRow } from "@/lib/services/people/contact-rows";

describe("isContactRow", () => {
  it("NULL, empty and ordinary metadata are contacts (15 of the 23 prod rows carry NULL)", () => {
    expect(isContactRow({ metadata: null })).toBe(true);
    expect(isContactRow({ metadata: undefined })).toBe(true);
    expect(isContactRow({ metadata: {} })).toBe(true);
    expect(isContactRow({ metadata: { via: "nick_action", kind: "in_person" } })).toBe(true);
    expect(isContactRow({ metadata: { via: "conversation_digest", auto: true } })).toBe(true);
    expect(isContactRow({ metadata: ["not", "an", "object"] })).toBe(true);
  });

  it("a synthetic backfill row is a mention, not a contact", () => {
    expect(
      isContactRow({
        metadata: { synthetic: true, backfilledAt: "2026-05-29T14:17:48.228Z", chatMessageId: "x" },
      }),
    ).toBe(false);
    // Only the boolean marker the backfill wrote counts — never a look-alike string.
    expect(isContactRow({ metadata: { synthetic: "true" } })).toBe(true);
    expect(isContactRow({ metadata: { synthetic: false } })).toBe(true);
  });

  it("a status-flip audit row is not a contact", () => {
    expect(isContactRow({ metadata: { kind: "status_flip", before: "active", after: "cooling" } })).toBe(false);
    expect(isContactRow({ metadata: { kind: "call" } })).toBe(true);
  });
});

describe("CONTACT_ROW_SQL — the SQL twin", () => {
  it("coalesces both markers so a NULL metadata row still counts", () => {
    expect(CONTACT_ROW_SQL).toContain("coalesce((l.metadata->>'synthetic')::boolean, false) = false");
    expect(CONTACT_ROW_SQL).toContain("coalesce(l.metadata->>'kind', '') <> 'status_flip'");
  });
});
