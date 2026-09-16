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
