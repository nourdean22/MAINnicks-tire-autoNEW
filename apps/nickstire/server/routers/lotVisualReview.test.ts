/**
 * lot.reviewConversationVisual — the operator's Right / Wrong on a "Saw:" line. It is the input
 * to the office camera's calibration loop, so it must land inside the stored `visual` JSON,
 * refuse cleanly when there is nothing to review, and drop the cached calibration so the next
 * vision call sees the correction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../lib/db-helper", () => ({
  db: async () => ({ execute }),
  dbTyped: async () => ({ execute }),
  requireDb: async () => ({ execute }),
}));

vi.mock("../services/officeVisual", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/officeVisual")>()),
  officeVisualColumnReady: vi.fn(),
  __resetOfficeVisualCalibration: vi.fn(),
}));

import { lotRouter } from "./lot";
import type { TrpcContext } from "../_core/context";
import { officeVisualColumnReady, __resetOfficeVisualCalibration } from "../services/officeVisual";

const ready = officeVisualColumnReady as unknown as ReturnType<typeof vi.fn>;
const resetCalibration = __resetOfficeVisualCalibration as unknown as ReturnType<typeof vi.fn>;

function caller() {
  return lotRouter.createCaller({
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext);
}

beforeEach(() => {
  vi.clearAllMocks();
  ready.mockResolvedValue(true);
  execute.mockResolvedValue([{ affectedRows: 1 }]);
});

describe("lot.reviewConversationVisual", () => {
  it("writes the verdict into visual.review with JSON_SET and drops cached calibration", async () => {
    const r = await caller().reviewConversationVisual({ episodeId: "ep-1", verdict: "wrong", note: "two customers" });
    expect(r).toMatchObject({ ok: true, review: { verdict: "wrong", note: "two customers" } });
    const q = JSON.stringify(execute.mock.calls[0][0]);
    expect(q).toContain("JSON_SET(visual, '$.review'");
    expect(q).toContain("two customers");
    expect(q).toContain("ep-1");
    expect(resetCalibration).toHaveBeenCalledTimes(1);
  });

  it("a 'correct' verdict never stores a note", async () => {
    const r = await caller().reviewConversationVisual({ episodeId: "ep-1", verdict: "correct", note: "ignored" });
    expect(r).toMatchObject({ ok: true, review: { verdict: "correct", note: null } });
  });

  it("refuses when no description is stored for the episode (reported 0 rows)", async () => {
    execute.mockResolvedValue([{ affectedRows: 0 }]);
    const r = await caller().reviewConversationVisual({ episodeId: "missing", verdict: "correct" });
    expect(r).toMatchObject({ ok: false });
    expect(resetCalibration).not.toHaveBeenCalled();
  });

  it("refuses before migration 0140 without touching the table", async () => {
    ready.mockResolvedValue(false);
    const r = await caller().reviewConversationVisual({ episodeId: "ep-1", verdict: "correct" });
    expect(r).toMatchObject({ ok: false, reason: "visual column not available" });
    expect(execute).not.toHaveBeenCalled();
  });
});
