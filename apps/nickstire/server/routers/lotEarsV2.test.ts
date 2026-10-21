/**
 * ears-v2 visibility (job 2026-10-21-shop-ears-v2), through the real lot router.
 *  (h) lot.conversations: the detailed account and the flags are the OWNER's; other admin roles
 *      get business facts without quotes, no account and no flag at all.
 *  (i) lot.worthKnowing: owner only; the ET day is bucketed in SQL.
 *  (k) lot.officeDigest: owner only, so a digest built from accounts and flags never reaches a
 *      manager (the in-process memo cannot serve one to a role that is refused before it).
 * Synthetic text only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: null as null | "owner" | "manager" | "throw",
  execute: vi.fn(),
  llm: vi.fn(),
}));

vi.mock("../_core/llm", async (orig) => ({ ...(await orig<Record<string, unknown>>()), invokeLLM: h.llm }));

vi.mock("../lib/db-helper", () => ({
  db: async () => ({ execute: h.execute }),
  dbTyped: async () => ({ execute: h.execute }),
  requireDb: async () => ({ execute: h.execute }),
}));

vi.mock("../services/officeVisual", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/officeVisual")>()),
  officeVisualColumnReady: vi.fn(async () => false),
  officeVisualColumnPresent: vi.fn(async () => false),
  conversationEpisodeColumnPresent: vi.fn(async () => true),
}));

vi.mock("../services/adminSecurity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/adminSecurity")>()),
  getAdminSecurityState: vi.fn(async () => {
    if (h.role === "throw") throw new Error("admin_security read timed out");
    return h.role === null ? null
      : { adminRole: h.role, mfaEnabled: false, mfaVerifiedAt: null, mfaAgeMinutes: null, encryptedSecret: null };
  }),
}));

import { lotRouter } from "./lot";
import type { TrpcContext } from "../_core/context";
import { officeHourDigest } from "../services/officeDigest";

function caller(adminRole: "owner" | "manager" | "throw") {
  h.role = adminRole;
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

const FLAG = { kind: "NEGATIVE_TALK", value: "you charge way too much", evidenceSegment: 2, evidenceText: "Honestly, you charge way too much here!", confidence: 0.9 };
const BUSINESS = { kind: "REQUESTED_WORK", value: "tire rotation", evidenceSegment: 0, evidenceText: "can you rotate my tires", confidence: 0.9 };
const ACCOUNT = "A customer asked for a tire rotation and said the prices are too high (inferred: comparing with another shop).";

beforeEach(() => {
  h.execute.mockReset();
  h.llm.mockReset();
});

describe("(h) lot.conversations: account and flags are the owner's", () => {
  const row = { episodeId: "ep-1", source: "eufy-office", transcriptStatus: "DONE", durationSeconds: 30, transcript: [], segmentCount: 3, facts: [BUSINESS, FLAG], gist: ACCOUNT };

  it("manager: gist null, no flag fact, no flag kinds, business facts without quotes", async () => {
    h.execute.mockResolvedValue([[row], []]);
    const r = await caller("manager").conversations();
    if (!r.ok) throw new Error(r.reason);
    const c = r.conversations[0];
    expect(c.gist).toBeNull();
    expect(c.flagKinds).toEqual([]);
    expect(c.facts).toEqual([{ kind: "REQUESTED_WORK", value: "tire rotation", evidenceText: "", confidence: 0.9 }]);
    expect(c.factCount).toBe(1);
    const json = JSON.stringify(r);
    expect(json).not.toContain("way too much");
    expect(json).not.toContain("NEGATIVE_TALK");
    expect(json).not.toContain("prices are too high");
  });

  it("owner: everything", async () => {
    h.execute.mockResolvedValue([[row], []]);
    const r = await caller("owner").conversations();
    if (!r.ok) throw new Error(r.reason);
    const c = r.conversations[0];
    expect(c.gist).toBe(ACCOUNT);
    expect(c.flagKinds).toEqual(["NEGATIVE_TALK"]);
    expect(c.facts.map((f) => f.kind)).toEqual(["REQUESTED_WORK", "NEGATIVE_TALK"]);
    expect(c.facts[1].evidenceText).toBe(FLAG.evidenceText);
    expect(c.factCount).toBe(2);
  });
});

describe("(i) lot.worthKnowing", () => {
  const bounds = (day = "2026-10-21") => [[{ day, startEpoch: 1792555200, endEpoch: 1792641600 }], []];
  function install(rows: unknown[], dayRow: unknown = bounds()) {
    h.execute.mockImplementation(async (q: unknown) => {
      const t = flat(q).text;
      if (t.includes("AS startEpoch")) return dayRow;
      if (t.includes("FROM conversation_episodes")) return [rows, []];
      throw new Error(`unexpected ${t.slice(0, 80)}`);
    });
  }

  it("a manager is refused in words and nothing is read", async () => {
    expect(await caller("manager").worthKnowing()).toEqual({ ok: false, reason: "Only the owner can see this." });
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("owner, default day: today in ET, bucketed in SQL; one item per flag, newest first, labelled by camera", async () => {
    install([
      { episodeId: "ep-2", source: "eufy-office", startedAtMs: 1792600000000, facts: [FLAG, { ...FLAG, kind: "SAFETY", value: "watch the jack" }], gist: ACCOUNT },
      { episodeId: "ep-1", source: "lot-outside", startedAtMs: 1792590000000, facts: [BUSINESS], gist: "Business only." },
      { episodeId: "ep-0", source: "eufy-office", startedAtMs: 1792580000000, facts: [{ ...FLAG, kind: "STAFF_CONFLICT", value: "not my job" }], gist: null },
    ]);
    const r = await caller("owner").worthKnowing();
    if (!r.ok) throw new Error(r.reason);
    expect(r.day).toBe("2026-10-21");
    expect(r.items).toEqual([
      { episodeId: "ep-2", source: "eufy-office", cameraLabel: "Office", startedAtMs: 1792600000000, kind: "NEGATIVE_TALK", quote: "you charge way too much", account: ACCOUNT },
      { episodeId: "ep-2", source: "eufy-office", cameraLabel: "Office", startedAtMs: 1792600000000, kind: "SAFETY", quote: "watch the jack", account: ACCOUNT },
      { episodeId: "ep-0", source: "eufy-office", cameraLabel: "Office", startedAtMs: 1792580000000, kind: "STAFF_CONFLICT", quote: "not my job", account: null },
    ]);
    const [dayQ, rowsQ] = h.execute.mock.calls.map((c) => flat(c[0]));
    expect(dayQ.text).toContain("DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))");
    expect(dayQ.text).toContain("'America/New_York', '+00:00'");
    expect(rowsQ.text).toContain("ORDER BY COALESCE(startedAt, createdAt) DESC");
    expect(rowsQ.params).toEqual(expect.arrayContaining([1792555200, 1792641600]));
  });

  it("an explicit day is passed to SQL as the day, and a malformed day is rejected", async () => {
    install([], bounds("2026-10-20"));
    const r = await caller("owner").worthKnowing({ day: "2026-10-20" });
    expect(r).toEqual({ ok: true, day: "2026-10-20", items: [], truncated: false });
    expect(flat(h.execute.mock.calls[0][0]).params).toContain("2026-10-20");
    await expect(caller("owner").worthKnowing({ day: "10/20/2026" })).rejects.toThrow();
  });

  it("P1-c (Codex on #3213): only rows holding a flag are read, filtered in SQL BEFORE the bound, so a busy day cannot push an older flag out", async () => {
    install([]);
    await caller("owner").worthKnowing();
    const rowsQ = flat(h.execute.mock.calls[1][0]);
    for (const kind of ["NEGATIVE_TALK", "CUSTOMER_COMPLAINT", "STAFF_CONFLICT", "SAFETY", "LEAVING_OR_COMPETITOR", "MONEY_OR_DISCOUNT"]) {
      expect(rowsQ.params).toContain(JSON.stringify(kind));
    }
    expect(rowsQ.text).toContain("JSON_CONTAINS(JSON_EXTRACT(facts, '$[*].kind'), ?)");
    // the flag filter sits in the WHERE, ahead of ORDER BY / LIMIT
    expect(rowsQ.text.indexOf("JSON_CONTAINS")).toBeLessThan(rowsQ.text.indexOf("ORDER BY"));
    expect(rowsQ.text).toMatch(/LIMIT 201$/);
  });

  it("P1-c: more than 200 flagged conversations says truncated: true instead of cutting silently", async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ episodeId: `ep-${i}`, source: "eufy-office", startedAtMs: 1792600000000 - i, facts: [FLAG], gist: null }));
    install(many);
    const r = await caller("owner").worthKnowing();
    if (!r.ok) throw new Error(r.reason);
    expect(r.truncated).toBe(true);
    expect(r.items).toHaveLength(200);
    install(many.slice(0, 200));
    const full = await caller("owner").worthKnowing();
    expect(full).toMatchObject({ ok: true, truncated: false });
  });

  it("unknown day bounds (timezone tables missing) or a failed read is ok:false, never an empty day", async () => {
    install([], [[{ day: null, startEpoch: null, endEpoch: null }], []]);
    expect((await caller("owner").worthKnowing()).ok).toBe(false);
    h.execute.mockRejectedValue(new Error("read timed out"));
    expect((await caller("owner").worthKnowing()).ok).toBe(false);
  });
});

describe("(k) lot.officeDigest is owner only", () => {
  it("a manager is refused before any read, so the memo cannot serve an owner-built digest", async () => {
    expect(await caller("manager").officeDigest({ hours: 1 })).toEqual({ ok: false, reason: "Only the owner can see this." });
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("CONTROL: the owner still gets the digest", async () => {
    h.execute.mockImplementation(async (q: unknown) => {
      const t = flat(q).text;
      if (t.includes("AS nowHour")) return [[{ nowHour: 497944 }], []];
      return [[], []];
    });
    const r = await caller("owner").officeDigest({ hours: 1 });
    expect(r).toMatchObject({ ok: true });
  });
});

describe("skeptic review of #3213: an UNVERIFIED owner (role read threw) does not open words", () => {
  const row = { episodeId: "ep-1", source: "eufy-office", transcriptStatus: "DONE", durationSeconds: 30, transcript: [], segmentCount: 3, facts: [BUSINESS, FLAG], gist: ACCOUNT };

  it("S1: lot.conversations is manager-shaped when the role read threw (reads stay open)", async () => {
    h.execute.mockResolvedValue([[row], []]);
    const r = await caller("throw").conversations();
    if (!r.ok) throw new Error(r.reason);
    expect(r.wordsVisible).toBe(false);
    const c = r.conversations[0];
    expect(c.gist).toBeNull();
    expect(c.flagKinds).toEqual([]);
    expect(c.facts).toEqual([{ kind: "REQUESTED_WORK", value: "tire rotation", evidenceText: "", confidence: 0.9 }]);
    expect(JSON.stringify(r)).not.toContain("way too much");
  });

  it("S1: transcript, worthKnowing and officeDigest are refused when the role read threw", async () => {
    expect(await caller("throw").conversationTranscript({ episodeId: "ep-1" })).toEqual({ ok: false, reason: "Only the owner can read what was said." });
    expect(await caller("throw").worthKnowing()).toEqual({ ok: false, reason: "Only the owner can see this." });
    expect(await caller("throw").officeDigest({ hours: 1 })).toEqual({ ok: false, reason: "Only the owner can see this." });
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("S1 CONTROL: an owner whose row was read gets the words", async () => {
    h.execute.mockResolvedValue([[row], []]);
    const r = await caller("owner").conversations();
    if (!r.ok) throw new Error(r.reason);
    expect(r.wordsVisible).toBe(true);
    expect(r.conversations[0].gist).toBe(ACCOUNT);
  });
});

describe("skeptic review of #3213: the office digest", () => {
  it("S4: an hour of noise-only clips stays THIN, with no model call", async () => {
    const nowHour = 497950;
    h.execute.mockImplementation(async (q: unknown) => {
      const t = flat(q).text;
      if (t.includes("AS nowHour")) return [[{ nowHour }], []];
      if (t.includes("FROM conversation_episodes")) {
        return [[{ episodeId: "n1", durationSeconds: 8, facts: [], transcriptStatus: "DONE", hourIdx: nowHour, gist: "Only shop noise, no speech." }], []];
      }
      return [[], []];
    });
    const r = await caller("owner").officeDigest({ hours: 1 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.hours[0].status).toBe("THIN");
    expect(h.llm).not.toHaveBeenCalled();
  });

  it("S6: the digest keeps guess labels, and a long gist is cut before an open (inferred:", async () => {
    h.llm.mockResolvedValue({ id: "t", created: 0, model: "m", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ digest: "d", topics: [] }) }, finish_reason: "stop" }] });
    await officeHourDigest(1792600000000 + 7 * 3_600_000, false, [{ episodeId: "s6-ep", gist: "a".repeat(280) + " (inferred: a long guess that runs past the line here)", facts: [] }]);
    const [system, user] = h.llm.mock.calls[0][0].messages as Array<{ content: string }>;
    expect(system.content).toContain("never state a guess as heard");
    const gistLine = user.content.split("\n").find((l) => l.startsWith("- gist:"))!;
    expect(gistLine).not.toContain("(inferred:");
    expect(gistLine.endsWith(" (cut)")).toBe(true);
  });
});