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
  role: null as null | "owner" | "manager",
  execute: vi.fn(),
}));

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
  getAdminSecurityState: vi.fn(async () => h.role === null ? null
    : { adminRole: h.role, mfaEnabled: false, mfaVerifiedAt: null, mfaAgeMinutes: null, encryptedSecret: null }),
}));

import { lotRouter } from "./lot";
import type { TrpcContext } from "../_core/context";

function caller(adminRole: "owner" | "manager") {
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
    expect(r).toEqual({ ok: true, day: "2026-10-20", items: [] });
    expect(flat(h.execute.mock.calls[0][0]).params).toContain("2026-10-20");
    await expect(caller("owner").worthKnowing({ day: "10/20/2026" })).rejects.toThrow();
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
