/**
 * Action Center "Publish" wire (2026-07-25).
 *
 * Verified live: three assembled reels (canary/autopost briefIds) had NO
 * inventory draft — the assembly writeback UPDATE matched zero rows silently —
 * and one had a draft that was already published. "Publish through the normal
 * gates" pointed at an empty gate, and the button was disabled "not wired
 * yet". These pin the reconcile mutation that makes the button real, and the
 * pipeline healer that stops future strandings.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

type Op =
  | { kind: "update"; table: unknown; set: Record<string, unknown> }
  | { kind: "insert"; table: unknown; values: Record<string, unknown> };

const ops: Op[] = [];
const selectQueue: unknown[][] = [];
const updateResults: number[] = [];

function makeSelectChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
  chain.then = (resolveFn: (v: unknown) => void) => resolveFn(selectQueue.shift() ?? []);
  return chain;
}

const database = {
  select: () => makeSelectChain(),
  update: (table: unknown) => ({
    set: (set: Record<string, unknown>) => ({
      where: () => {
        ops.push({ kind: "update", table, set });
        const affectedRows = updateResults.length ? (updateResults.shift() as number) : 1;
        return Promise.resolve([{ affectedRows }, []]);
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      ops.push({ kind: "insert", table, values });
      return Promise.resolve();
    },
  }),
};

vi.mock("./lib/db-helper", () => ({
  db: async () => database,
  dbTyped: async () => database,
  requireDb: async () => database,
}));
vi.mock("./db", () => ({
  getDb: async () => database,
  getDbTyped: async () => database,
}));

import { appRouter } from "./routers";
import { reelJobs, socialContentInventory } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin",
      loginMethod: "manus", role: "admin",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const admin = () => appRouter.createCaller(ctx());

const job = (over: Record<string, unknown> = {}) => ({
  id: 900001,
  status: "assembled",
  briefId: "canary-1784339416857",
  mp4Url: "https://cdn.example.com/reel.mp4",
  payload: JSON.stringify({ brief: { topic: "Winter tires", selectedCaption: "Cold roads need real tread." } }),
  updatedAt: new Date(),
  ...over,
});

beforeEach(() => {
  ops.length = 0;
  selectQueue.length = 0;
  updateResults.length = 0;
});

describe("reconcileAssembledReel — the Publish wire", () => {
  it("CREATES the missing draft (review_ready) when the gate is empty — the stranded-canary case", async () => {
    selectQueue.push([job()]);   // job load
    selectQueue.push([]);        // no existing draft
    updateResults.push(0);       // healer's UPDATE matches nothing
    await expect(admin().contentAdmin.reconcileAssembledReel({ jobId: 900001 }))
      .resolves.toEqual({ outcome: "staged", draftId: "canary-1784339416857" });
    const insert = ops.find((o): o is Extract<Op, { kind: "insert" }> => o.kind === "insert" && o.table === socialContentInventory);
    expect(insert?.values.status).toBe("review_ready");
    expect(insert?.values.contentType).toBe("reel");
    expect(insert?.values.hookText).toBe("Cold roads need real tread.");
  });

  it("closes the GHOST when the draft already published (job never heard)", async () => {
    selectQueue.push([job({ id: 810001, briefId: "draft_d9fc" })]);
    selectQueue.push([{ status: "published" }]);
    await expect(admin().contentAdmin.reconcileAssembledReel({ jobId: 810001 }))
      .resolves.toEqual({ outcome: "job_marked_published", draftId: "draft_d9fc" });
    const upd = ops.find((o): o is Extract<Op, { kind: "update" }> => o.kind === "update" && o.table === reelJobs);
    expect(upd?.set.status).toBe("published");
  });

  it("is a no-op when the draft is already mid-flow in the gate", async () => {
    selectQueue.push([job()]);
    selectQueue.push([{ status: "review_ready" }]);
    await expect(admin().contentAdmin.reconcileAssembledReel({ jobId: 900001 }))
      .resolves.toMatchObject({ outcome: "already_staged", draftStatus: "review_ready" });
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
  });

  it("REFUSES an ambiguous job — staging it would arm a duplicate of a possibly-live reel", async () => {
    selectQueue.push([job({ id: 750002, status: "publish_ambiguous" })]);
    await expect(admin().contentAdmin.reconcileAssembledReel({ jobId: 750002 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ops).toHaveLength(0);
  });
});

describe("the stranding cannot recur (source pins)", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("the pipeline's assembly writeback goes through the update-then-insert healer", () => {
    expect(read("server/services/reelPipeline.ts")).toMatch(/ensureReelDraftForJob\(d, \{ briefId: job\.briefId, mp4Url, brief \}\)/);
  });

  it("the Action Center's publish action is WIRED for assembled jobs and refused (with a visible reason) for ambiguous ones", () => {
    const a = read("client/src/pages/admin/instagram/ActionCenter.tsx");
    expect(a).toMatch(/a\.id === "publish" && job\.status === "assembled"/);
    expect(a).toMatch(/resolve ambiguity first/);
    expect(a).toMatch(/reconcile\.mutate\(\{ jobId: job\.jobId \}\)/);
  });

  it("stalled renders only for a real wait, never 'stalled 0h'", () => {
    expect(read("client/src/pages/admin/instagram/ActionCenter.tsx")).toMatch(/job\.stalledHours >= 1/);
  });

  it("Publish honors ?igpub= so the wire can land on the Reels segment", () => {
    expect(read("client/src/pages/admin/instagram/QueueV2.tsx")).toMatch(/get\("igpub"\)/);
  });
});
