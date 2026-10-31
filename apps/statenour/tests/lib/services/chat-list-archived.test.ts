/** U6 (2026-10-31) · chat.list can read the archived rows (the drawer's Archived tab). */
import { describe, it, expect, vi } from "vitest";

const findMany = vi.fn(async (_a: unknown) => []);
vi.mock("@/lib/prisma", () => ({ prisma: { chatConversation: { findMany: (a: unknown) => findMany(a) } } }));

import { listConversations } from "@/lib/services/chat-conversation-read";

describe("listConversations · archived", () => {
  it("archived: true reads only archived rows", async () => {
    await listConversations({ archived: true });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { archivedAt: { not: null } } }));
  });
  it("CONTROL: the default still hides archived rows", async () => {
    await listConversations({});
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { archivedAt: null } }));
  });
});
