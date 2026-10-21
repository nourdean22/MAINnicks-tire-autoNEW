/**
 * Job 2026-10-21-shop-eyes-ears-pro, through the real lot router:
 *  S1  lot.conversationTranscript -- the owner reads what was actually said; every other role,
 *      a missing row, a missing transcript and a dead database each say so in words.
 *      lot.conversations gains wordsVisible + segmentCount and still ships no text.
 *  S3  lot.now carries counterTrust (camera arrivals judged against billed jobs); a failed
 *      trust read is UNKNOWN and never fails the counter card.
 * Transcript lines are short synthetic text; no real conversation is quoted here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dbUp: true,
  role: null as null | "owner" | "manager",
  execute: vi.fn(),
}));

vi.mock("../lib/db-helper", () => ({
  db: async () => (h.dbUp ? { execute: h.execute } : null),
  dbTyped: async () => (h.dbUp ? { execute: h.execute } : null),
  requireDb: async () => ({ execute: h.execute }),
}));

vi.mock("../services/officeVisual", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/officeVisual")>()),
  officeVisualColumnReady: vi.fn(async () => false),
  officeVisualColumnPresent: vi.fn(async () => false),
  conversationEpisodeColumnPresent: vi.fn(async () => true),
}));

// The admin middleware reads the stored role here; null = no row = pre-RBAC owner fallback.
vi.mock("../services/adminSecurity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/adminSecurity")>()),
  getAdminSecurityState: vi.fn(async () => h.role === null ? null
    : { adminRole: h.role, mfaEnabled: false, mfaVerifiedAt: null, mfaAgeMinutes: null, encryptedSecret: null }),
}));

import { lotRouter } from "./lot";
import type { TrpcContext } from "../_core/context";

function caller(adminRole?: "owner" | "manager") {
  h.role = adminRole ?? null;
  return lotRouter.createCaller({
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext);
}

function flat(q: unknown): { text: string; params: unknown[] } {
  const text: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
      else { params.push(c); text.push("?"); }
    }
  };
  walk((q as { queryChunks: unknown[] }).queryChunks);
  return { text: text.join("").replace(/\s+/g, " ").trim(), params };
}

const seg = (index: number, start: number, text: string, speaker = "SPEAKER_00") => ({ index, start, end: start + 2, text, speaker });
const episode = (transcript: unknown, durationSeconds: unknown = 30) => [[{ episodeId: "ep-1", durationSeconds, transcript }], []];

beforeEach(() => {
  h.dbUp = true;
  h.execute.mockReset();
});

describe("lot.conversationTranscript (S1)", () => {
  it("the owner gets the words, ordered by start, without speaker labels", async () => {
    h.execute.mockResolvedValueOnce(episode([seg(1, 5, "we have that size in stock"), seg(0, 1, "customer asked about tires")], 12));
    const r = await caller("owner").conversationTranscript({ episodeId: "ep-1" });
    expect(r).toEqual({
      ok: true,
      episodeId: "ep-1",
      durationSeconds: 12,
      truncated: false,
      segments: [
        { start: 1, end: 3, text: "customer asked about tires" },
        { start: 5, end: 7, text: "we have that size in stock" },
      ],
    });
    expect(JSON.stringify(r)).not.toContain("SPEAKER");
    const q = flat(h.execute.mock.calls[0][0]);
    expect(q.text).toContain("FROM conversation_episodes WHERE episodeId = ?");
    expect(q.params).toContain("ep-1");
  });

  it("the pre-RBAC owner fallback (no role row) is the owner too", async () => {
    h.execute.mockResolvedValueOnce(episode([seg(0, 0, "customer asked about tires")]));
    expect(await caller().conversationTranscript({ episodeId: "ep-1" })).toMatchObject({ ok: true });
  });

  it("a manager is refused in words and the transcript is never read", async () => {
    const r = await caller("manager").conversationTranscript({ episodeId: "ep-1" });
    expect(r).toEqual({ ok: false, reason: "Only the owner can read what was said." });
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("no row is 'Conversation not found.'", async () => {
    h.execute.mockResolvedValueOnce([[], []]);
    expect(await caller("owner").conversationTranscript({ episodeId: "ep-x" })).toEqual({ ok: false, reason: "Conversation not found." });
  });

  it("transcript NULL (never transcribed) is refused in words, never an empty conversation", async () => {
    h.execute.mockResolvedValueOnce(episode(null));
    expect(await caller("owner").conversationTranscript({ episodeId: "ep-1" })).toEqual({
      ok: false, reason: "No transcript was stored for this conversation.",
    });
  });

  it("transcript [] (transcribed, nothing said) is ok with no segments", async () => {
    h.execute.mockResolvedValueOnce(episode([]));
    expect(await caller("owner").conversationTranscript({ episodeId: "ep-1" })).toEqual({
      ok: true, episodeId: "ep-1", durationSeconds: 30, truncated: false, segments: [],
    });
  });

  it("a transcript stored as a JSON string is read the same way", async () => {
    h.execute.mockResolvedValueOnce(episode(JSON.stringify([seg(0, 0, "customer asked about tires")])));
    const r = await caller("owner").conversationTranscript({ episodeId: "ep-1" });
    expect(r).toMatchObject({ ok: true, segments: [{ start: 0, end: 2, text: "customer asked about tires" }] });
  });

  it("an unreadable stored transcript is refused, never shown as silence", async () => {
    h.execute.mockResolvedValueOnce(episode("{not json"));
    const r = await caller("owner").conversationTranscript({ episodeId: "ep-1" });
    expect(r.ok).toBe(false);
  });

  it("caps at 80 segments and 500 chars per segment, and says so with truncated: true", async () => {
    const many = Array.from({ length: 81 }, (_, i) => seg(i, i * 3, `line ${i}`));
    h.execute.mockResolvedValueOnce(episode(many));
    const r = await caller("owner").conversationTranscript({ episodeId: "ep-1" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.segments).toHaveLength(80);
    expect(r.truncated).toBe(true);

    h.execute.mockResolvedValueOnce(episode([seg(0, 0, "a".repeat(501))]));
    const long = await caller("owner").conversationTranscript({ episodeId: "ep-1" });
    if (!long.ok) throw new Error(long.reason);
    expect(long.segments[0].text).toHaveLength(500);
    expect(long.truncated).toBe(true);

    // control: exactly at both caps is not truncated
    h.execute.mockResolvedValueOnce(episode(Array.from({ length: 80 }, (_, i) => seg(i, i, i === 0 ? "a".repeat(500) : "ok"))));
    const exact = await caller("owner").conversationTranscript({ episodeId: "ep-1" });
    expect(exact).toMatchObject({ ok: true, truncated: false });
  });

  it("no database is 'database unavailable'", async () => {
    h.dbUp = false;
    expect(await caller("owner").conversationTranscript({ episodeId: "ep-1" })).toEqual({ ok: false, reason: "database unavailable" });
  });

  it("rejects an empty or oversized episode id at the input", async () => {
    await expect(caller("owner").conversationTranscript({ episodeId: "" })).rejects.toThrow();
    await expect(caller("owner").conversationTranscript({ episodeId: "x".repeat(65) })).rejects.toThrow();
  });
});

describe("lot.conversations: wordsVisible + segmentCount, still no text (S1)", () => {
  const listRow = (segmentCount: unknown) => ({
    episodeId: "ep-1", source: "office", transcriptStatus: "DONE", durationSeconds: 30,
    transcript: [seg(0, 0, "customer asked about tires")], segmentCount, facts: [], gist: "small talk",
  });

  it("owner: wordsVisible true; segmentCount comes from JSON_LENGTH(transcript); null stays null", async () => {
    h.execute.mockResolvedValue([[listRow(4), { ...listRow(null), episodeId: "ep-2", transcript: null }], []]);
    const r = await caller("owner").conversations();
    if (!r.ok) throw new Error(r.reason);
    expect(r.wordsVisible).toBe(true);
    expect(r.conversations.map((c) => c.segmentCount)).toEqual([4, null]);
    expect(flat(h.execute.mock.calls.at(-1)![0]).text).toContain("JSON_LENGTH(transcript) AS segmentCount");
    expect(JSON.stringify(r)).not.toContain("customer asked about tires");
  });

  it("manager: wordsVisible false", async () => {
    h.execute.mockResolvedValue([[listRow(4)], []]);
    const r = await caller("manager").conversations();
    if (!r.ok) throw new Error(r.reason);
    expect(r.wordsVisible).toBe(false);
  });
});

describe("lot.now: counterTrust (S3)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const aggRow = { total: 50, onProperty: 0, arrivalsToday: 0, staleSeconds: 30 };
  function install(trust: () => Promise<unknown>) {
    h.execute.mockImplementation(async (q: unknown) => {
      const t = flat(q).text;
      if (t.includes("FROM invoices")) return trust();
      if (t.includes("AS total")) return [[aggRow], []];
      return [[], []];
    });
  }

  it("carries the verdict with its counts and window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 11, 10, 17, 0, 0)));
    install(async () => [[{ fromDay: "2026-12-03", toDay: "2026-12-09", arrivals: 1, billed: 30 }], []]);
    const r = await caller("owner").now();
    if (!r.ok) throw new Error(r.reason);
    expect(r.counterTrust).toMatchObject({ level: "UNDERCOUNTING", arrivals: 1, billed: 30, days: 7, fromDay: "2026-12-03", toDay: "2026-12-09" });
    expect(r.counts.arrivalsToday).toBe(0);
  });

  it("a failed trust read is UNKNOWN and lot.now still answers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 11, 11, 17, 0, 0)));
    install(async () => { throw new Error("invoices read failed"); });
    const r = await caller("owner").now();
    if (!r.ok) throw new Error(r.reason);
    expect(r.counterTrust).toMatchObject({ level: "UNKNOWN", arrivals: null, billed: null });
  });
});
