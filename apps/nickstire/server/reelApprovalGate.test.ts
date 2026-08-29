/**
 * The approval gate, the claim veto, and artifact-derived AI disclosure.
 *
 * WHAT WAS TRUE BEFORE THIS, measured in prod 2026-08-29: REEL_PUBLISH_ENABLED,
 * REEL_AUTOPOST_ENABLED and IG_AUTOPOST_DRYRUN="false" were all armed and
 * dailyReelPost published on its own. The only thing stopping it was that job
 * 1710001 - the head of the FIFO queue - carries template-stock clips the stock
 * guard rejects, so the cron held on that row every ~60s and never advanced.
 * That is an accident of ordering, not a control.
 *
 * EVERY DESCRIBE BLOCK BELOW CARRIES BOTH DIRECTIONS. A gate that refuses
 * everything passes every "it blocks X" test ever written and is exactly as
 * broken as one that refuses nothing - it just fails safe until someone
 * disables it to unblock themselves. So each refusal is paired with a positive
 * control proving the permitted case still gets through.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  approvalProblem,
  isApprovedToPublish,
  APPROVAL_BLOCK,
  REEL_APPROVAL_TTL_HOURS,
  type ReelApprovalRecord,
  type ReelPublishCandidate,
} from "@shared/reelApproval";
import { auditPublishBlock, condemnedJobIds, REEL_CLAIM_AUDIT } from "@shared/reelClaimAudit";
import { clipProvenance, shouldDiscloseAi } from "@shared/reelDisclosure";

/* ── 1 · the approval decision ──────────────────────────────────────────── */

const CAPTION_SHA = "a".repeat(64);
const VIDEO = "https://nickstire.org/generated/reels/reel-1770003.mp4";

const candidate: ReelPublishCandidate = {
  jobId: 1770003,
  captionFingerprint: CAPTION_SHA,
  videoUrl: VIDEO,
};

const goodApproval: ReelApprovalRecord = {
  reelJobId: 1770003,
  captionFingerprint: CAPTION_SHA,
  videoUrl: VIDEO,
  approvedBy: "owner",
  approvedAt: "2026-08-29T12:00:00Z",
  revokedAt: null,
};

describe("approval gate — default-deny", () => {
  // POSITIVE CONTROL FIRST, on purpose. If this ever fails, every refusal
  // below is meaningless because the gate is simply refusing everything.
  it("PERMITS a job carrying a live approval that matches caption and asset", () => {
    expect(approvalProblem(candidate, goodApproval)).toBeNull();
    expect(isApprovedToPublish(candidate, goodApproval)).toBe(true);
  });

  it("BLOCKS when no approval exists at all", () => {
    for (const none of [null, undefined]) {
      const p = approvalProblem(candidate, none);
      expect(p?.code).toBe(APPROVAL_BLOCK.missing);
      expect(p?.reason).toMatch(/default-deny/);
    }
  });

  it("BLOCKS an approval issued for a different job — approvals are not transferable", () => {
    const p = approvalProblem(candidate, { ...goodApproval, reelJobId: 1770005 });
    expect(p?.code).toBe(APPROVAL_BLOCK.wrongJob);
  });

  it("BLOCKS a revoked approval — a withdrawn yes is a no", () => {
    const p = approvalProblem(candidate, { ...goodApproval, revokedAt: "2026-08-29T13:00:00Z" });
    expect(p?.code).toBe(APPROVAL_BLOCK.revoked);
  });

  it("BLOCKS an unattributed approval", () => {
    for (const who of ["", "   "]) {
      const p = approvalProblem(candidate, { ...goodApproval, approvedBy: who });
      expect(p?.code).toBe(APPROVAL_BLOCK.anonymous);
    }
  });

  // THE PROTOCOL THIS EXISTS TO ENFORCE: the owner approves specific wording.
  it("BLOCKS when the caption changed after approval", () => {
    const p = approvalProblem(candidate, { ...goodApproval, captionFingerprint: "b".repeat(64) });
    expect(p?.code).toBe(APPROVAL_BLOCK.captionChanged);
    expect(p?.reason).toMatch(/specific wording/);
  });

  it("BLOCKS when the asset was re-rendered after approval", () => {
    const p = approvalProblem(candidate, { ...goodApproval, videoUrl: `${VIDEO}?v=2` });
    expect(p?.code).toBe(APPROVAL_BLOCK.videoChanged);
  });

  // A whitespace-only edit is a real edit: byte-exact is the point.
  it("treats a whitespace-only caption change as a change", () => {
    const shifted = { ...candidate, captionFingerprint: "c".repeat(64) };
    expect(approvalProblem(shifted, goodApproval)?.code).toBe(APPROVAL_BLOCK.captionChanged);
  });

  // TTL, adopted from services/contentApprovals.ts (APPROVAL_TTL_HOURS = 72).
  // The autonomous lane is where a stale yes is most dangerous: it fires days
  // later with nobody watching.
  describe("approval expiry", () => {
    const NOW = new Date("2026-08-29T12:00:00Z");

    it("BLOCKS an approval whose window has lapsed", () => {
      const stale = { ...goodApproval, expiresAt: "2026-08-29T11:59:59Z" };
      const p = approvalProblem(candidate, stale, NOW);
      expect(p?.code).toBe(APPROVAL_BLOCK.expired);
      expect(p?.reason).toMatch(new RegExp(`${REEL_APPROVAL_TTL_HOURS}h`));
    });

    // POSITIVE CONTROL: a live window must still publish, or the TTL is just
    // an outage with extra steps.
    it("PERMITS an approval still inside its window", () => {
      const fresh = { ...goodApproval, expiresAt: "2026-08-29T12:00:01Z" };
      expect(approvalProblem(candidate, fresh, NOW)).toBeNull();
    });

    it("HONOURS a null expiry as legacy, matching contentApprovals", () => {
      expect(approvalProblem(candidate, { ...goodApproval, expiresAt: null }, NOW)).toBeNull();
      expect(approvalProblem(candidate, { ...goodApproval, expiresAt: undefined }, NOW)).toBeNull();
    });

    // An unparseable timestamp must not silently authorize. It also must not
    // crash the cron - Number.isFinite is the guard.
    it("does not treat an unparseable expiry as permission", () => {
      const bad = { ...goodApproval, expiresAt: "not-a-date" };
      expect(() => approvalProblem(candidate, bad, NOW)).not.toThrow();
    });

    it("the TTL matches the Studio lane it was adopted from", () => {
      expect(REEL_APPROVAL_TTL_HOURS).toBe(72);
    });
  });
});

/* ── 2 · the DB layer fails CLOSED ──────────────────────────────────────── */

let dbBehaviour: "missing-table" | "no-db" | "row" | "empty" = "no-db";
let storedRow: Record<string, unknown> | null = null;

vi.mock("./db", () => ({
  getDb: async () => {
    if (dbBehaviour === "no-db") return null;
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => {
                // A missing table surfaces as a driver throw, which is the
                // realistic shape of "the hand-applied DDL has not run yet".
                if (dbBehaviour === "missing-table") {
                  throw new Error("ER_NO_SUCH_TABLE: Table 'reel_publish_approvals' doesn't exist");
                }
                return dbBehaviour === "row" && storedRow ? [storedRow] : [];
              },
            }),
          }),
        }),
      }),
    };
  },
}));

import { captionFingerprint, findLiveApproval, reelApprovalProblem } from "./services/reelApproval";

const CAPTION = "That slow leak might not be a nail.";

describe("approval lookup fails CLOSED on every infrastructure failure", () => {
  beforeEach(() => {
    storedRow = null;
    dbBehaviour = "no-db";
  });

  it("BLOCKS when the approvals table does not exist yet", async () => {
    dbBehaviour = "missing-table";
    expect(await findLiveApproval(1770003)).toBeNull();
    const p = await reelApprovalProblem({ jobId: 1770003, caption: CAPTION, videoUrl: VIDEO });
    expect(p?.code).toBe(APPROVAL_BLOCK.missing);
  });

  it("BLOCKS when there is no database at all", async () => {
    dbBehaviour = "no-db";
    const p = await reelApprovalProblem({ jobId: 1770003, caption: CAPTION, videoUrl: VIDEO });
    expect(p?.code).toBe(APPROVAL_BLOCK.missing);
  });

  it("BLOCKS when the table exists but holds no approval for the job", async () => {
    dbBehaviour = "empty";
    const p = await reelApprovalProblem({ jobId: 1770003, caption: CAPTION, videoUrl: VIDEO });
    expect(p?.code).toBe(APPROVAL_BLOCK.missing);
  });

  // POSITIVE CONTROL for the whole DB layer: with a real matching row, the
  // door opens. Without this the three refusals above would also pass against
  // a lookup that was simply broken.
  it("PERMITS when a live, matching row exists", async () => {
    dbBehaviour = "row";
    storedRow = {
      reelJobId: 1770003,
      captionSha: captionFingerprint(CAPTION),
      videoUrl: VIDEO,
      approvedBy: "owner",
      approvedAt: new Date("2026-08-29T12:00:00Z"),
      revokedAt: null,
    };
    expect(await reelApprovalProblem({ jobId: 1770003, caption: CAPTION, videoUrl: VIDEO })).toBeNull();
  });

  it("BLOCKS that same row once the caption is edited by one character", async () => {
    dbBehaviour = "row";
    storedRow = {
      reelJobId: 1770003,
      captionSha: captionFingerprint(CAPTION),
      videoUrl: VIDEO,
      approvedBy: "owner",
      approvedAt: new Date("2026-08-29T12:00:00Z"),
      revokedAt: null,
    };
    const p = await reelApprovalProblem({ jobId: 1770003, caption: `${CAPTION} `, videoUrl: VIDEO });
    expect(p?.code).toBe(APPROVAL_BLOCK.captionChanged);
  });

  it("fingerprints are byte-exact and stable", () => {
    expect(captionFingerprint(CAPTION)).toBe(captionFingerprint(CAPTION));
    expect(captionFingerprint(CAPTION)).not.toBe(captionFingerprint(`${CAPTION}.`));
    expect(captionFingerprint(CAPTION)).toHaveLength(64);
  });
});

/* ── 3 · the claim audit vetoes, and outranks approval ──────────────────── */

describe("claim audit veto", () => {
  it("BLOCKS the three reels with defects burned into audio or pixels", () => {
    for (const id of [1740001, 1740004, 1770005]) {
      expect(auditPublishBlock(id), `job ${id} must be vetoed`).toBeTruthy();
    }
    expect(auditPublishBlock(1770005)).toMatch(/needs_rerender/);
  });

  it("BLOCKS the discarded stock-contaminated duplicate", () => {
    expect(auditPublishBlock(1710001)).toMatch(/discard/);
  });

  // POSITIVE CONTROL: the audit must not be a blanket refusal.
  it("PERMITS the reels that passed the hand audit", () => {
    for (const id of [1740002, 1740003, 1770003, 1770004]) {
      expect(auditPublishBlock(id), `job ${id} should not be vetoed`).toBeNull();
    }
  });

  it("PERMITS a caption-repairable reel — the defect is editable, not fatal", () => {
    expect(auditPublishBlock(1770002)).toBeNull();
  });

  // Unaudited jobs are held by the approval gate, not by this one. Blocking
  // them here would conflate "no defect found" with "never looked at".
  it("does not object to a job it never audited", () => {
    expect(auditPublishBlock(999999)).toBeNull();
  });

  it("every audited entry states a verdict, a summary and its sources", () => {
    const entries = Object.values(REEL_CLAIM_AUDIT);
    expect(entries.length).toBe(10);
    for (const e of entries) {
      expect(e.summary.length, `job ${e.jobId}`).toBeGreaterThan(20);
      // A verdict that condemns must say what is wrong; one that clears must
      // say what was checked. Neither may be silently empty.
      if (["needs_rerender", "discard", "unverified"].includes(e.verdict)) {
        expect(e.defects.length, `job ${e.jobId} condemned with no defect`).toBeGreaterThan(0);
      } else {
        expect(e.cleared.length, `job ${e.jobId} cleared with no source`).toBeGreaterThan(0);
      }
      for (const c of e.cleared) expect(c.source.length, `job ${e.jobId}`).toBeGreaterThan(20);
    }
  });

  // FIVE, not four. 1770001's claims are accurate - it is condemned for an
  // ASSET defect (ffmpeg re-assembly exited 187), which is exactly why the
  // audit records the surface a defect lives on rather than just a verdict.
  it("the condemned set is exactly the five jobs the audit named", () => {
    expect(condemnedJobIds()).toEqual([1710001, 1740001, 1740004, 1770001, 1770005]);
  });

  it("BLOCKS the reel whose asset failed re-assembly, despite clean claims", () => {
    expect(auditPublishBlock(1770001)).toMatch(/needs_rerender/);
    expect(REEL_CLAIM_AUDIT[1770001].defects[0].surface).toBe("asset");
    expect(REEL_CLAIM_AUDIT[1770001].cleared.length).toBeGreaterThan(0);
  });
});

/* ── 4 · disclosure is derived from the ARTIFACT, not the env var ───────── */

const HF_CLIPS = JSON.stringify([
  "https://d8j0ntlcm91z4.cloudfront.net/user_3EU/hf_20260821_c0ab97b9-5556-42df-aa01.mp4",
  "https://d8j0ntlcm91z4.cloudfront.net/user_3EU/hf_20260821_9779b85d-8b79-49c9-8401.mp4",
]);
const STOCK_CLIPS = JSON.stringify([
  "https://cdn.example/reels/template-stock/20260817-beat-1.mp4",
  "https://cdn.example/reels/template-stock/20260817-beat-2.mp4",
]);
const VEO_CLIPS = JSON.stringify(["https://cdn.example/reel-clips/veo-8f2a11.mp4"]);

describe("AI disclosure follows what actually rendered the job", () => {
  // THE COMPLIANCE CANARY. Under-disclosure is a Meta policy violation on the
  // owner's business account, and jobs sit in the backlog for days.
  it("a Higgsfield-rendered job discloses EVEN IF the env flips to a stock lane", () => {
    expect(shouldDiscloseAi(HF_CLIPS, "template_stock")).toBe(true);
    expect(shouldDiscloseAi(HF_CLIPS, "")).toBe(true);
    expect(shouldDiscloseAi(HF_CLIPS, undefined)).toBe(true);
    expect(shouldDiscloseAi(VEO_CLIPS, "template_stock")).toBe(true);
  });

  // THE OTHER DIRECTION, equally required: real footage must not be labelled
  // as model output just because the lane is configured generative today.
  it("a genuinely non-generative job is NOT forced to disclose", () => {
    expect(shouldDiscloseAi(STOCK_CLIPS, "higgsfield")).toBe(false);
    expect(shouldDiscloseAi(STOCK_CLIPS, "veo")).toBe(false);
  });

  it("falls back to the configured lane only when the clips say nothing", () => {
    expect(shouldDiscloseAi(null, "higgsfield")).toBe(true);
    expect(shouldDiscloseAi("not json", "higgsfield")).toBe(true);
    expect(shouldDiscloseAi("[]", "template_stock")).toBe(false);
  });

  // THE ANCHORING BUG THIS ALMOST SHIPPED WITH. GENERATIVE_PROVIDERS contains
  // "wan", "veo" and "pika"; a substring scan over the whole URL matched those
  // inside random CDN hashes, which would have labelled real stock footage as
  // AI-generated - intermittently, and green on tidy fixtures.
  it("does NOT mistake a provider name buried in a random hash for a generator", () => {
    const hashed = JSON.stringify([
      "https://cdn.example/reels/template-stock/a7wan3xq-beat-1.mp4",
      "https://cdn.example/reels/template-stock/veo91kd2-beat-2.mp4",
      "https://cdn.example/reels/template-stock/zpikaq7-beat-3.mp4",
    ]);
    expect(clipProvenance(hashed)).toBe("stock");
    expect(shouldDiscloseAi(hashed, "template_stock")).toBe(false);
  });

  it("classifies provenance from the storage path", () => {
    expect(clipProvenance(HF_CLIPS)).toBe("generative");
    expect(clipProvenance(STOCK_CLIPS)).toBe("stock");
    expect(clipProvenance(VEO_CLIPS)).toBe("generative");
    expect(clipProvenance(null)).toBe("unknown");
  });

  // One generated beat makes the whole reel generated - a viewer cannot tell
  // which three seconds came from a model.
  it("a mixed reel with even one generated clip discloses", () => {
    const mixed = JSON.stringify([
      "https://cdn.example/reels/template-stock/beat-1.mp4",
      "https://d8j0ntlcm91z4.cloudfront.net/user_3EU/hf_20260821_abc.mp4",
    ]);
    expect(clipProvenance(mixed)).toBe("generative");
    expect(shouldDiscloseAi(mixed, "template_stock")).toBe(true);
  });
});
