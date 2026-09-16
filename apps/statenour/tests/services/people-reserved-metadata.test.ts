/**
 * A contact writer may not stamp the markers that EXCLUDE a row from the
 * counters (2026-09-16, W8 · Codex P2 on #2348).
 *
 * `task.logLedger` takes `metadata: z.record(z.string(), z.unknown())` and
 * hands it straight to `recordInteraction`, which creates the row AND
 * increments `interactionCount`. If that metadata carries `synthetic: true`
 * or `kind: "status_flip"`, `isContactRow` then excludes the very row that
 * bumped the counter: the profile counts a contact the ledger does not have.
 * The next delete or reconcile silently drops the count, and #2348's
 * invariant — counters are a pure function of the contact rows — is false
 * between those two moments.
 *
 * The markers are not free-form: each has exactly one legitimate writer, and
 * neither goes through the seam. `status_flip` is written directly by
 * `task.flipPersonStatus`; `synthetic: true` belongs to the retired 2026-05-29
 * backfill. So a contact writer carrying one is always a bug, and the seam
 * rejects it rather than silently stripping it — stripping would discard the
 * caller's stated intent and leave the contradiction invisible.
 *
 * Positive control: before the fix `assertWritableMetadata` did not exist and
 * `recordInteraction` accepted both markers.
 */
import { describe, expect, it } from "vitest";

import {
  RESERVED_LEDGER_METADATA_KEYS,
  ReservedLedgerMetadataError,
  assertWritableMetadata,
  isContactRow,
  writableLedgerMetadata,
} from "@/lib/services/people/contact-rows";

describe("assertWritableMetadata · a contact writer cannot stamp a non-contact marker", () => {
  it("rejects synthetic: true", () => {
    expect(() => assertWritableMetadata({ synthetic: true })).toThrow(ReservedLedgerMetadataError);
  });

  it("rejects kind: status_flip", () => {
    expect(() => assertWritableMetadata({ kind: "status_flip", before: "active", after: "cooling" })).toThrow(
      ReservedLedgerMetadataError,
    );
  });

  it("names the offending key so the caller can fix it", () => {
    try {
      assertWritableMetadata({ synthetic: true });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReservedLedgerMetadataError);
      expect((e as ReservedLedgerMetadataError).key).toBe("synthetic");
    }
  });

  it("allows undefined, null, empty and ordinary metadata", () => {
    expect(() => assertWritableMetadata(undefined)).not.toThrow();
    expect(() => assertWritableMetadata(null)).not.toThrow();
    expect(() => assertWritableMetadata({})).not.toThrow();
    expect(() => assertWritableMetadata({ chatMessageId: "m1", kind: "checkin" })).not.toThrow();
    expect(() => assertWritableMetadata({ synthetic: false })).not.toThrow();
  });

  it("guards exactly the keys isContactRow excludes on — one definition, not two", () => {
    for (const { key, value } of RESERVED_LEDGER_METADATA_KEYS) {
      // the predicate excludes it…
      expect(isContactRow({ metadata: { [key]: value } }), `${key} should be excluded`).toBe(false);
      // …so the writer must refuse it.
      expect(() => assertWritableMetadata({ [key]: value }), `${key} should be rejected`).toThrow(
        ReservedLedgerMetadataError,
      );
    }
  });
});

/**
 * THE EDGE GUARD HAD NO TEST, found 2026-09-16 auditing this wave's own diff.
 *
 * The rule has three expressions: `isContactRow` excludes the row,
 * `assertWritableMetadata` refuses to write it, and this zod schema rejects it
 * at the tRPC edge so the operator gets a BAD_REQUEST naming the key rather
 * than the seam's throw as an internal error. Only the first two were tested.
 *
 * That gap was invisible BY CONSTRUCTION, which is what makes it worth a test
 * rather than a shrug: the schema sits in front of `recordInteraction`, which
 * runs `assertWritableMetadata` anyway — so a broken schema still produced a
 * rejected write, just with a worse error. A duplicated guard where only one
 * copy is exercised is a guard you cannot trust and cannot notice losing.
 */
describe("writableLedgerMetadata · the same rule at the tRPC edge", () => {
  it("rejects each reserved marker and names the key in the issue path", () => {
    for (const { key, value } of RESERVED_LEDGER_METADATA_KEYS) {
      const r = writableLedgerMetadata.safeParse({ [key]: value });
      expect(r.success, `${key} should be rejected at the edge`).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.path.join(".") === key), `issue path should name ${key}`).toBe(true);
      }
    }
  });

  it("accepts ordinary metadata and an empty object", () => {
    expect(writableLedgerMetadata.safeParse({}).success).toBe(true);
    expect(writableLedgerMetadata.safeParse({ chatMessageId: "m1", kind: "checkin" }).success).toBe(true);
    expect(writableLedgerMetadata.safeParse({ synthetic: false }).success).toBe(true);
  });

  it("agrees with the runtime guard on EVERY input, so the two cannot drift apart", () => {
    // The real invariant is not "each rejects bad input" but "they reject the
    // SAME input". Drift between an edge validator and the seam behind it is
    // how a caller gets a 200 from one layer and a 500 from the next.
    const cases: unknown[] = [
      {},
      { chatMessageId: "m1" },
      { kind: "checkin" },
      { synthetic: false },
      { synthetic: true },
      { kind: "status_flip" },
      { kind: "status_flip", before: "active" },
      { synthetic: true, kind: "checkin" },
    ];
    for (const c of cases) {
      const edgeRejects = !writableLedgerMetadata.safeParse(c).success;
      let seamRejects = false;
      try {
        assertWritableMetadata(c);
      } catch {
        seamRejects = true;
      }
      expect(edgeRejects, `edge and seam disagree on ${JSON.stringify(c)}`).toBe(seamRejects);
    }
  });
});
