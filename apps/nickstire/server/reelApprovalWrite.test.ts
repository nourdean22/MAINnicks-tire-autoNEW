/**
 * The reel approval WRITE path (the handle on a default-deny door).
 *
 * WHY THIS FILE EXISTS. #2000 shipped `reel_publish_approvals` with a
 * fail-closed gate and no writer: three readers, zero inserts. The gate's own
 * canary asserted it blocks, which it did — perfectly, forever, because no row
 * could ever be created. A control that can only ever say no is exactly as
 * broken as one that only says yes, and it ships green.
 *
 * So the load-bearing assertion here is NOT "the writer refuses bad input" —
 * that direction was never in doubt. It is that a recorded approval is one the
 * GATE ACTUALLY ACCEPTS. `feeds_the_real_gate` plants the known positive: it
 * runs the row this module wrote through the same `approvalProblem` the publish
 * door calls, and requires null. Without it, binding to the wrong caption (the
 * Studio composed caption rather than `reel_jobs.caption`) would produce a
 * beautiful UI, a green suite, and a reel that stays held forever.
 *
 * The paired canary immediately after it mutates the caption and requires the
 * gate to block, so "accepts everything" cannot pass either.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { approvalProblem, APPROVAL_BLOCK, REEL_APPROVAL_TTL_HOURS } from "@shared/reelApproval";

type Op =
  | { kind: "update"; set: Record<string, unknown>; inTx: boolean }
  | { kind: "insert"; values: Record<string, unknown>; inTx: boolean };

const ops: Op[] = [];
let selectQueue: unknown[][] = [];
/** Depth of the fake transaction, so ops can record whether they were inside one. */
let txDepth = 0;
/** Set to make the fake insert throw, simulating a mid-transaction failure. */
let insertShouldThrow = false;

function makeSelectChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
  chain.then = (res: (v: unknown) => void) => res(selectQueue.shift() ?? []);
  return chain;
}

const database = {
  select: () => makeSelectChain(),
  update: () => ({
    set: (set: Record<string, unknown>) => ({
      where: () => {
        ops.push({ kind: "update", set, inTx: txDepth > 0 });
        return Promise.resolve([{ affectedRows: 1 }, []]);
      },
    }),
  }),
  insert: () => ({
    values: (values: Record<string, unknown>) => {
      if (insertShouldThrow) return Promise.reject(new Error("simulated insert failure"));
      ops.push({ kind: "insert", values, inTx: txDepth > 0 });
      return Promise.resolve();
    },
  }),
  /**
   * The fake cannot roll back — so the tests assert the MECHANISM (both writes
   * are issued inside the transaction scope) rather than pretending to observe
   * a rollback a mock could never perform. Asserting a rollback here would be
   * asserting the mock, not the code.
   */
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    txDepth += 1;
    try {
      return await fn(database);
    } finally {
      txDepth -= 1;
    }
  },
};

let dbAvailable = true;
vi.mock("./db", () => ({ getDb: async () => (dbAvailable ? database : null) }));

/** An assembled job exactly as `reel_jobs` stores it. */
const JOB_ID = 4242;
const CAPTION = "Your brakes are on a diet.\n\nA free check tells you how much is left.";
const VIDEO = "https://nickstire.org/generated/reel-4242.mp4";
const assembledRow = {
  id: JOB_ID,
  status: "assembled",
  caption: CAPTION,
  mp4Url: VIDEO,
  error: null,
};

async function svc() {
  return import("./services/reelApproval");
}

/** The row the insert produced, shaped as `findLiveApproval` would return it. */
function insertedApprovalRecord() {
  const ins = ops.find((o): o is Extract<Op, { kind: "insert" }> => o.kind === "insert");
  if (!ins) throw new Error("no approval row was inserted");
  return {
    reelJobId: ins.values.reelJobId as number,
    captionFingerprint: ins.values.captionSha as string,
    videoUrl: ins.values.videoUrl as string,
    approvedBy: ins.values.approvedBy as string,
    approvedAt: new Date(),
    expiresAt: ins.values.expiresAt as Date,
    revokedAt: null,
  };
}

beforeEach(() => {
  ops.length = 0;
  selectQueue = [];
  dbAvailable = true;
  txDepth = 0;
  insertShouldThrow = false;
});

describe("recordReelApproval", () => {
  it("feeds_the_real_gate: the row it writes is one approvalProblem ACCEPTS", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]); // loadReelPublishSubject
    const sha = captionFingerprint(CAPTION);

    await recordReelApproval({
      jobId: JOB_ID,
      approvedBy: "admin:1",
      expectedCaptionSha: sha,
      expectedVideoUrl: VIDEO,
    });

    // THE POINT OF THE WHOLE FILE: run what we wrote through the publish door's
    // own decision function, against the values the cron will actually send
    // (reel_jobs.caption / reel_jobs.mp4Url — dailyReelPost.ts:555,567).
    const verdict = approvalProblem(
      { jobId: JOB_ID, captionFingerprint: sha, videoUrl: VIDEO },
      insertedApprovalRecord(),
    );
    expect(verdict, "a recorded approval must let the gate through — otherwise the writer is a no-op").toBeNull();
  });

  it("canary: the same row STILL blocks once the caption changes by one byte", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]);
    await recordReelApproval({
      jobId: JOB_ID,
      approvedBy: "admin:1",
      expectedCaptionSha: captionFingerprint(CAPTION),
      expectedVideoUrl: VIDEO,
    });

    const verdict = approvalProblem(
      { jobId: JOB_ID, captionFingerprint: captionFingerprint(`${CAPTION} `), videoUrl: VIDEO },
      insertedApprovalRecord(),
    );
    expect(verdict?.code).toBe(APPROVAL_BLOCK.captionChanged);
  });

  it("canary: the same row STILL blocks once the asset is re-rendered", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]);
    await recordReelApproval({
      jobId: JOB_ID,
      approvedBy: "admin:1",
      expectedCaptionSha: captionFingerprint(CAPTION),
      expectedVideoUrl: VIDEO,
    });

    const verdict = approvalProblem(
      { jobId: JOB_ID, captionFingerprint: captionFingerprint(CAPTION), videoUrl: `${VIDEO}?v=2` },
      insertedApprovalRecord(),
    );
    expect(verdict?.code).toBe(APPROVAL_BLOCK.videoChanged);
  });

  it("binds to reel_jobs.caption, not to a caller-supplied string", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]);
    await recordReelApproval({
      jobId: JOB_ID,
      approvedBy: "admin:1",
      expectedCaptionSha: captionFingerprint(CAPTION),
      expectedVideoUrl: VIDEO,
    });
    const ins = ops.find((o): o is Extract<Op, { kind: "insert" }> => o.kind === "insert")!;
    expect(ins.values.captionSha).toBe(captionFingerprint(CAPTION));
    expect(ins.values.videoUrl).toBe(VIDEO);
  });

  it("stamps a 72h expiry, matching the Studio lane's TTL", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]);
    const before = Date.now();
    const res = await recordReelApproval({
      jobId: JOB_ID,
      approvedBy: "admin:1",
      expectedCaptionSha: captionFingerprint(CAPTION),
      expectedVideoUrl: VIDEO,
    });
    const hours = (res.expiresAt.getTime() - before) / 3600_000;
    expect(hours).toBeGreaterThan(REEL_APPROVAL_TTL_HOURS - 0.1);
    expect(hours).toBeLessThan(REEL_APPROVAL_TTL_HOURS + 0.1);
  });

  it("supersedes a prior live approval instead of stacking a second one", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]);
    await recordReelApproval({
      jobId: JOB_ID,
      approvedBy: "admin:9",
      expectedCaptionSha: captionFingerprint(CAPTION),
      expectedVideoUrl: VIDEO,
    });
    // The revoke-then-insert ORDER is load-bearing: inserting first would leave
    // a window where two contradictory yeses are both live.
    expect(ops.map((o) => o.kind)).toEqual(["update", "insert"]);
    expect(String((ops[0] as Extract<Op, { kind: "update" }>).set.revokedBy)).toContain("superseded");
  });

  it("supersede and insert are ONE transaction, so a failed re-approval keeps the old yes", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]);
    await recordReelApproval({
      jobId: JOB_ID,
      approvedBy: "admin:9",
      expectedCaptionSha: captionFingerprint(CAPTION),
      expectedVideoUrl: VIDEO,
    });
    // Un-transacted, a revoke that lands before a failing insert leaves the job
    // with NO live approval: the operator silently loses the yes they already
    // had. Fail-closed, which is exactly why it would go unnoticed.
    expect(ops.every((o) => o.inTx), "both writes must be inside the transaction").toBe(true);
  });

  it("a mid-transaction insert failure surfaces instead of half-applying", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]);
    insertShouldThrow = true;
    await expect(
      recordReelApproval({
        jobId: JOB_ID,
        approvedBy: "admin:9",
        expectedCaptionSha: captionFingerprint(CAPTION),
        expectedVideoUrl: VIDEO,
      }),
    ).rejects.toThrow(/simulated insert failure/);
    // No approval row was written. The revoke that preceded it is inside the
    // same transaction, so a real database rolls it back — which is the whole
    // reason the two statements had to be paired.
    expect(ops.some((o) => o.kind === "insert")).toBe(false);
  });

  it("refuses a review that went stale between render and tap", async () => {
    const { recordReelApproval } = await svc();
    selectQueue.push([assembledRow]);
    await expect(
      recordReelApproval({
        jobId: JOB_ID,
        approvedBy: "admin:1",
        expectedCaptionSha: "0".repeat(64), // what the operator saw, no longer live
        expectedVideoUrl: VIDEO,
      }),
    ).rejects.toMatchObject({ code: "stale_review" });
    expect(ops, "nothing may be written when the review is stale").toHaveLength(0);
  });

  it("refuses a job that is not assembled", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([{ ...assembledRow, status: "generating" }]);
    await expect(
      recordReelApproval({
        jobId: JOB_ID,
        approvedBy: "admin:1",
        expectedCaptionSha: captionFingerprint(CAPTION),
        expectedVideoUrl: VIDEO,
      }),
    ).rejects.toMatchObject({ code: "job_not_assembled" });
    expect(ops).toHaveLength(0);
  });

  it("refuses an unattributed approval, which the gate would reject anyway", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    await expect(
      recordReelApproval({
        jobId: JOB_ID,
        approvedBy: "   ",
        expectedCaptionSha: captionFingerprint(CAPTION),
        expectedVideoUrl: VIDEO,
      }),
    ).rejects.toMatchObject({ code: "no_approver" });
    expect(ops).toHaveLength(0);
  });

  it("refuses to write anything when the database is unavailable", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    dbAvailable = false;
    await expect(
      recordReelApproval({
        jobId: JOB_ID,
        approvedBy: "admin:1",
        expectedCaptionSha: captionFingerprint(CAPTION),
        expectedVideoUrl: VIDEO,
      }),
    ).rejects.toMatchObject({ code: "no_database" });
    expect(ops).toHaveLength(0);
  });

  it("cannot approve a reel the claim audit condemns", async () => {
    const { condemnedJobIds } = await import("@shared/reelClaimAudit");
    const condemned = condemnedJobIds();
    expect(condemned.length, "the audit must condemn at least one job or this asserts nothing").toBeGreaterThan(0);

    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([{ ...assembledRow, id: condemned[0] }]);
    await expect(
      recordReelApproval({
        jobId: condemned[0],
        approvedBy: "admin:1",
        expectedCaptionSha: captionFingerprint(CAPTION),
        expectedVideoUrl: VIDEO,
      }),
    ).rejects.toMatchObject({ code: "content_vetoed" });
    expect(ops, "an operator must not be able to approve away a false claim").toHaveLength(0);
  });
});

/**
 * WIDTH CONTRACT — TiDB runs STRICT_TRANS_TABLES, so a value that does not fit
 * its column is REJECTED and the row is LOST. For this table that means the
 * approval silently never exists and the reel stays held forever.
 *
 * Caught for real: the first draft built the id as `rappr_${randomUUID()}` =
 * 42 chars into `id varchar(36)`. Every approval would have failed on the very
 * first tap. The widths are read OUT OF THE MIGRATION rather than restated here
 * so this test cannot drift from the DDL that actually shapes the table.
 */
describe("column width contract (drizzle/0112)", () => {
  const ddl = readFileSync(
    resolve(__dirname, "../drizzle/0112_reel_publish_approvals.sql"),
    "utf8",
  );
  const widthOf = (column: string): number => {
    const m = new RegExp("`" + column + "` (?:var)?char\\((\\d+)\\)").exec(ddl);
    if (!m) throw new Error(`0112 does not declare a width for ${column}`);
    return Number(m[1]);
  };

  it("the generated approval id fits `id`", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]);
    await recordReelApproval({
      jobId: JOB_ID,
      approvedBy: "admin:1",
      expectedCaptionSha: captionFingerprint(CAPTION),
      expectedVideoUrl: VIDEO,
    });
    const ins = ops.find((o): o is Extract<Op, { kind: "insert" }> => o.kind === "insert")!;
    expect(String(ins.values.id).length).toBeLessThanOrEqual(widthOf("id"));
  });

  it("the caption fingerprint fits `caption_sha` exactly", async () => {
    const { captionFingerprint } = await svc();
    expect(captionFingerprint(CAPTION).length).toBe(widthOf("caption_sha"));
  });

  it("a long approver is truncated to fit `approved_by`", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]);
    await recordReelApproval({
      jobId: JOB_ID,
      approvedBy: "admin:".concat("9".repeat(400)),
      expectedCaptionSha: captionFingerprint(CAPTION),
      expectedVideoUrl: VIDEO,
    });
    const ins = ops.find((o): o is Extract<Op, { kind: "insert" }> => o.kind === "insert")!;
    expect(String(ins.values.approvedBy).length).toBeLessThanOrEqual(widthOf("approved_by"));
  });

  it("the supersede marker fits `revoked_by`", async () => {
    const { recordReelApproval, captionFingerprint } = await svc();
    selectQueue.push([assembledRow]);
    await recordReelApproval({
      jobId: JOB_ID,
      approvedBy: "admin:".concat("9".repeat(400)),
      expectedCaptionSha: captionFingerprint(CAPTION),
      expectedVideoUrl: VIDEO,
    });
    const upd = ops.find((o): o is Extract<Op, { kind: "update" }> => o.kind === "update")!;
    expect(String(upd.set.revokedBy).length).toBeLessThanOrEqual(widthOf("revoked_by"));
  });
});

describe("revokeReelApproval", () => {
  it("withdraws rather than deletes, and names who withdrew it", async () => {
    const { revokeReelApproval } = await svc();
    const res = await revokeReelApproval({ jobId: JOB_ID, revokedBy: "admin:1" });
    expect(res.revoked).toBe(1);
    expect(ops).toHaveLength(1);
    const upd = ops[0] as Extract<Op, { kind: "update" }>;
    expect(upd.set.revokedBy).toBe("admin:1");
    expect(upd.set.revokedAt).toBeInstanceOf(Date);
  });

  it("refuses an unattributed revocation", async () => {
    const { revokeReelApproval } = await svc();
    await expect(revokeReelApproval({ jobId: JOB_ID, revokedBy: "" })).rejects.toMatchObject({
      code: "no_approver",
    });
    expect(ops).toHaveLength(0);
  });
});
