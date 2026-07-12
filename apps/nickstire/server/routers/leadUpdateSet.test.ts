/**
 * Regression tests for the lead.update column mapping — specifically the
 * "status→contacted implies the contacted flag + a first-contact timestamp"
 * atomicity guard. Before this guard, dragging a Kanban card to "Contacted"
 * (a status-only update) left the row at `contacted=0, contactedAt=null`.
 */
import { describe, it, expect } from "vitest";
import { SQL } from "drizzle-orm";
import { buildLeadContactStatusSet } from "./leadUpdateSet";

const NOW = new Date("2026-07-12T12:00:00.000Z");

describe("buildLeadContactStatusSet — contacted atomicity", () => {
  it("Kanban status-only move to 'contacted' sets the flag + stamps timestamps", () => {
    // The Kanban dropdown sends only { status } (LeadsSection handleStatusChange).
    const set = buildLeadContactStatusSet({ status: "contacted" }, NOW);
    expect(set.status).toBe("contacted");
    expect(set.contacted).toBe(1);
    expect(set.lastFollowUpAt).toEqual(NOW);
    // contactedAt is a COALESCE(existing, now) SQL expression so an earlier
    // first-contact time is never clobbered on re-confirmation.
    expect(set.contactedAt).toBeInstanceOf(SQL);
  });

  it("does NOT clobber an explicit contact (Mark-Contacted button path)", () => {
    const set = buildLeadContactStatusSet(
      { status: "contacted", contacted: 1, contactNotes: "Called, scheduling tomorrow" },
      NOW,
    );
    expect(set.contacted).toBe(1);
    // Explicit contacted:1 → a concrete Date, not the COALESCE guard.
    expect(set.contactedAt).toBeInstanceOf(Date);
    expect(set.contactedAt).toEqual(NOW);
    expect(set.contactNotes).toBe("Called, scheduling tomorrow");
    expect(set.lastFollowUpAt).toEqual(NOW);
  });

  it("REOPEN ({ status:'new', contacted:0 }) is untouched — no auto-stamp", () => {
    const set = buildLeadContactStatusSet({ status: "new", contacted: 0 }, NOW);
    expect(set.status).toBe("new");
    expect(set.contacted).toBe(0);
    expect(set.contactedAt).toBeUndefined();
    expect(set.lastFollowUpAt).toBeUndefined();
  });

  it("moving to 'lost' does not fabricate a contact", () => {
    const set = buildLeadContactStatusSet({ status: "lost" }, NOW);
    expect(set.status).toBe("lost");
    expect(set.contacted).toBeUndefined();
    expect(set.contactedAt).toBeUndefined();
  });

  it("a pure note update stamps lastFollowUpAt without touching status", () => {
    const set = buildLeadContactStatusSet({ contactNotes: "Left voicemail" }, NOW);
    expect(set.status).toBeUndefined();
    expect(set.contacted).toBeUndefined();
    expect(set.contactNotes).toBe("Left voicemail");
    expect(set.lastFollowUpAt).toEqual(NOW);
  });
});
