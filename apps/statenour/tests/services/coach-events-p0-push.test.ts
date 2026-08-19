/**
 * P0 coach events page the phone · 2026-08-19.
 *
 * The data-source canary's cron comment says "The canary now SCREAMS" —
 * but recordCoachEvent only wrote an in-app BrainMemory banner, so a P0
 * "Data feeder down" sat in a dashboard until the operator happened to
 * open the app. The operator DOES receive Web Push on their phone (the
 * morning brief, drift alerts, and deep-research completions already
 * ride lib/notifications/push.ts) — these tests pin the bridge:
 *
 *   · priority P0 → one fire-and-forget sendPush (level critical,
 *     tag = the coach dedup key so re-fires REPLACE, never stack)
 *   · P1/P2 → no push (advisory events must not train the operator
 *     to swipe pushes away)
 *   · a push failure never fails the coach write
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  sendPush: vi.fn().mockResolvedValue({ sent: 1, failed: 0 }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { upsert: h.upsert } },
}));
vi.mock("@/lib/notifications/push", () => ({
  sendPush: h.sendPush,
}));

import { recordCoachEvent } from "@/lib/services/coach-events";

beforeEach(() => {
  h.upsert.mockReset();
  h.sendPush.mockClear();
  h.sendPush.mockResolvedValue({ sent: 1, failed: 0 });
  h.upsert.mockImplementation(async (args: any) => ({
    id: "row-1",
    content: args.create.content,
    metadata: args.create.metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
});

describe("recordCoachEvent · P0 web-push bridge", () => {
  it("pages the phone on P0 with critical level and the coach key as replace-tag", async () => {
    const ev = await recordCoachEvent({
      kind: "system-alert",
      subjectId: "data-source-health",
      priority: "P0",
      title: "Data feeder down · 2 probes failing",
      body: "A business-data feeder is unreachable.",
      deepLink: "/system/health",
    });

    expect(ev).not.toBeNull();
    await vi.waitFor(() => expect(h.sendPush).toHaveBeenCalledTimes(1));
    expect(h.sendPush).toHaveBeenCalledWith({
      title: "Data feeder down · 2 probes failing",
      body: "A business-data feeder is unreachable.",
      level: "critical",
      url: "/system/health",
      tag: "coach:system-alert:data-source-health",
    });
  });

  it("does NOT push P1 or P2 events", async () => {
    await recordCoachEvent({
      kind: "system-alert",
      subjectId: "advisory",
      priority: "P1",
      title: "A personal-data feeder is erroring",
    });
    await recordCoachEvent({
      kind: "prune-candidate",
      subjectId: "goal-1",
      priority: "P2",
      title: "Goal looks stale",
    });
    // Give the (non-existent) fire-and-forget chain a tick to prove absence.
    await new Promise((r) => setImmediate(r));
    expect(h.sendPush).not.toHaveBeenCalled();
  });

  it("a push failure never fails the coach write", async () => {
    h.sendPush.mockRejectedValue(new Error("VAPID key missing"));
    const ev = await recordCoachEvent({
      kind: "system-alert",
      subjectId: "global",
      priority: "P0",
      title: "Something is down",
    });
    expect(ev).not.toBeNull();
    // let the rejected fire-and-forget settle inside its catch
    await new Promise((r) => setImmediate(r));
  });

  it("falls back body→title and url→/system/health when unset", async () => {
    await recordCoachEvent({
      kind: "system-alert",
      subjectId: "global",
      priority: "P0",
      title: "Cron fleet silent",
    });
    await vi.waitFor(() =>
      expect(h.sendPush).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "Cron fleet silent",
          url: "/system/health",
        }),
      ),
    );
  });
});
