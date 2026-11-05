/**
 * The sender and the server's schema meet here, on the real functions. A body the schema refuses would make a
 * working PC read "Silent", so an over-cap PC must still fit. Written red first.
 */
import { describe, expect, it } from "vitest";
import { harnessSnapshotSchema } from "@/lib/services/harness-status";
// @ts-expect-error plain .mjs sender with no types
import { buildSnapshot } from "../../../../scripts/agent-os/harness-snapshot.mjs";

const pr = (n: number) => ({ number: n, title: `t${n} ${"x".repeat(300)}`, branch: `b${"y".repeat(200)}`, checks: "PENDING" });
const merged = (n: number) => ({ number: n, title: "m", mergedAt: "2026-11-05T04:59:16Z", sha: "64e82ce16e39269d031b935568c4610b3310f3e4" });
const clean = {
  sha: () => "726f3baad4ebd545fd42e80b36ef1984943747f0",
  ramFreeMb: () => 4239,
  heavy: () => "free",
  chrome: () => "busy",
  sessionsActive: () => 4,
  worktrees: () => 69,
  health: () => ({ ok: true, problems: [] }),
  graph: () => ({ serverUp: null, builtCommit: "64e82ce1", behind: 2 }),
  vaultGraph: () => ({ exists: false, builtAt: null }),
  prs: () => [pr(1)],
  merged: () => [merged(1)],
  mainSha: () => "726f3baad4ebd545fd42e80b36ef1984943747f0",
  bdnick: () => "b75472b4d9aa5217efc405f6c2693809ae4c9711",
  nickstire: () => "b75472b4d9aa5217efc405f6c2693809ae4c9711",
};
const accepted = (body: unknown) => {
  const parsed = harnessSnapshotSchema.safeParse(body);
  expect(parsed.error?.issues ?? []).toEqual([]);
  return parsed.success;
};

describe("sender output through the server schema", () => {
  it("POSITIVE CONTROL: the schema refuses a body over the PR cap", async () => {
    const body = (await buildSnapshot("nattynour", clean)) as { prs: unknown[] };
    expect(harnessSnapshotSchema.safeParse({ ...body, prs: Array.from({ length: 61 }, (_, i) => ({ number: i + 1, title: "t", branch: "b", checks: "NONE" })) }).success).toBe(false);
  });

  it("a normal snapshot is accepted", async () => {
    expect(accepted(await buildSnapshot("nattynour", clean))).toBe(true);
  });

  it("61 PRs, 16 merges and 13 problems are capped by the sender, not refused", async () => {
    const body = (await buildSnapshot("nattynour", {
      ...clean,
      prs: () => Array.from({ length: 61 }, (_, i) => pr(i + 1)),
      merged: () => Array.from({ length: 16 }, (_, i) => merged(i + 1)),
      health: () => ({ ok: false, problems: Array.from({ length: 13 }, (_, i) => `task ${"n".repeat(80)}${i} MISSING`) }),
    })) as { prs: unknown[]; merged: unknown[]; health: { problems: unknown[] } };
    expect(accepted(body)).toBe(true);
    expect(body.prs).toHaveLength(60);
    expect(body.merged).toHaveLength(15);
    expect(body.health.problems).toHaveLength(12);
  });

  it("every source failing with a long local error is accepted, every reason scrubbed", async () => {
    const failing = Object.fromEntries(
      Object.keys(clean).map((name) => [
        name,
        () => {
          throw new Error(`spawn C:\\Users\\someone\\x.exe failed ${"z".repeat(400)}`);
        },
      ]),
    );
    const body = (await buildSnapshot("mechanics", failing)) as { unread: Record<string, string> };
    expect(accepted(body)).toBe(true);
    expect(Object.keys(body.unread)).toHaveLength(Object.keys(clean).length);
  });

  it("the schema refuses an unread map bigger than the sender can make", async () => {
    const body = await buildSnapshot("nattynour", clean);
    const unread = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    expect(harnessSnapshotSchema.safeParse({ ...(body as object), unread }).success).toBe(false);
  });
});
