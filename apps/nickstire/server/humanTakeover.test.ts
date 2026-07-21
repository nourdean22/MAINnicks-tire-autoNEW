/**
 * Human-takeover detection: the AI must never auto-send over a live operator, and
 * must fail OPEN (a broken check reverts to normal AI behavior, never mass-mutes).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: h.getDb }));

import { isConversationHumanHeld } from "./services/humanTakeover";

/** A db stub whose execute resolves to the mysql2 tuple [rows, fields]. */
function dbReturning(rows: unknown[]) {
  return { execute: vi.fn().mockResolvedValue([rows, []]) };
}

describe("isConversationHumanHeld", () => {
  beforeEach(() => h.getDb.mockReset());

  it("is true when a recent operator manual reply exists for the conversation", async () => {
    h.getDb.mockResolvedValue(dbReturning([{ "1": 1 }]));
    expect(await isConversationHumanHeld(42)).toBe(true);
  });

  it("is false when no recent operator reply exists (AI may answer)", async () => {
    h.getDb.mockResolvedValue(dbReturning([]));
    expect(await isConversationHumanHeld(42)).toBe(false);
  });

  it("fails OPEN when the DB is unavailable — never mutes the AI on a blip", async () => {
    h.getDb.mockResolvedValue(null);
    expect(await isConversationHumanHeld(42)).toBe(false);
  });

  it("fails OPEN when the query throws", async () => {
    h.getDb.mockResolvedValue({ execute: vi.fn().mockRejectedValue(new Error("db down")) });
    expect(await isConversationHumanHeld(42)).toBe(false);
  });
});
