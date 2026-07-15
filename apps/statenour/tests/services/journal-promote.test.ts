/**
 * promoteJournalTake · loop-closure wave (audit 2026-07-15).
 *
 * Pins:
 *   1. nextAction promote → domain-anchored task + nextActionPromoted flag
 *   2. re-promoting the same layer throws ALREADY_PROMOTED (idempotent)
 *   3. idea promote → "Explore: …" INBOX task + ideaPromoted flag
 *   4. challenge promote → challengePromoted flag
 *   5. missing take row → NOT_FOUND
 *   6. promoting an absent layer → NOTHING_TO_PROMOTE
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findUnique: (args: unknown) => mockFindUnique(args),
      update: (args: unknown) => mockUpdate(args),
    },
  },
}));

const mockCreateTask = vi.fn();
vi.mock("@/lib/services/tasks", () => ({
  createTask: (args: unknown) => mockCreateTask(args),
}));

const mockResolveInbox = vi.fn();
const mockResolveAnchor = vi.fn();
vi.mock("@/lib/services/missions", () => ({
  resolveInboxMissionId: () => mockResolveInbox(),
  resolveGeneralAnchorId: (d: unknown) => mockResolveAnchor(d),
}));

import { promoteJournalTake, JournalPromoteError } from "@/lib/services/journal-promote";

const takeRow = (content: Record<string, unknown>) => ({
  id: "bm-1",
  content: JSON.stringify(content),
});

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockCreateTask.mockReset();
  mockResolveInbox.mockReset();
  mockResolveAnchor.mockReset();
  mockResolveInbox.mockResolvedValue("m-inbox");
  mockResolveAnchor.mockResolvedValue("m-health");
  mockCreateTask.mockResolvedValue({ id: "task-1" });
  mockUpdate.mockResolvedValue({});
});

describe("promoteJournalTake", () => {
  it("promotes a nextAction to a domain-anchored task and stamps the flag", async () => {
    mockFindUnique.mockResolvedValue(
      takeRow({ nextAction: { action: "Do the 10x10 outside", domain: "health" } }),
    );

    const r = await promoteJournalTake("e-1", "nextAction");

    expect(r).toEqual({ ok: true, taskId: "task-1" });
    expect(mockCreateTask).toHaveBeenCalledWith({
      title: "Do the 10x10 outside",
      missionId: "m-health",
      status: "INBOX",
    });
    const written = JSON.parse(
      (mockUpdate.mock.calls[0][0] as { data: { content: string } }).data.content,
    );
    expect(written.nextAction.nextActionPromoted).toBe(true);
  });

  it("throws ALREADY_PROMOTED when the layer flag is already set", async () => {
    mockFindUnique.mockResolvedValue(
      takeRow({ nextAction: { action: "x", nextActionPromoted: true } }),
    );

    await expect(promoteJournalTake("e-1", "nextAction")).rejects.toMatchObject({
      code: "ALREADY_PROMOTED",
    });
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("promotes an idea to an Explore INBOX task and stamps ideaPromoted", async () => {
    mockFindUnique.mockResolvedValue(
      takeRow({ idea: "Turn solo outings into solo performances" }),
    );

    const r = await promoteJournalTake("e-2", "idea");

    expect(r.ok).toBe(true);
    expect(mockCreateTask).toHaveBeenCalledWith({
      title: "Explore: Turn solo outings into solo performances",
      missionId: "m-inbox",
      status: "INBOX",
    });
    const written = JSON.parse(
      (mockUpdate.mock.calls[0][0] as { data: { content: string } }).data.content,
    );
    expect(written.ideaPromoted).toBe(true);
  });

  it("promotes a challenge and stamps challengePromoted", async () => {
    mockFindUnique.mockResolvedValue(
      takeRow({ challenge: "Why punish yourself for rest?" }),
    );

    const r = await promoteJournalTake("e-3", "challenge");

    expect(r.ok).toBe(true);
    const written = JSON.parse(
      (mockUpdate.mock.calls[0][0] as { data: { content: string } }).data.content,
    );
    expect(written.challengePromoted).toBe(true);
  });

  it("throws NOT_FOUND when the take row is missing", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(promoteJournalTake("e-404", "idea")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NOTHING_TO_PROMOTE when the requested layer is absent", async () => {
    mockFindUnique.mockResolvedValue(takeRow({ idea: "only an idea here" }));

    await expect(promoteJournalTake("e-5", "challenge")).rejects.toMatchObject({
      code: "NOTHING_TO_PROMOTE",
    });
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("exposes a typed error class", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(promoteJournalTake("e-404")).rejects.toBeInstanceOf(JournalPromoteError);
  });
});
