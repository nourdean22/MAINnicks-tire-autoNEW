/**
 * Home's "Nick remembers" read (operator.nickRemembersContext): today's anticipated questions and the
 * follow-ups the conversation digests flagged. Map gap 6 (job 2026-11-02-nour-os-interconnect W2): a
 * failed read used to return [] and read as "nothing to remember". Each read that throws is now named
 * in `failed`; its list stays empty because it is unknown, not because it is clear.
 */
import { prisma } from "@/lib/prisma";
import { readTodaysAnticipated } from "@/lib/brain/anticipated-questions";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("home/nick-remembers");

export async function readNickRemembers(): Promise<{ anticipatedQuestions: string[]; followUps: string[]; failed: string[] }> {
  const failed: string[] = [];
  const [anticipated, recentDigests] = await Promise.all([
    // W8b (audit B4): the store's own failure state, not a rejection it never produced (it swallowed and cached null).
    readTodaysAnticipated()
      .then((r) => {
        if (r.failed) failed.push("anticipated questions");
        return r.set;
      })
      .catch((err) => {
        log.warn("anticipated_read_failed", { err: err instanceof Error ? err.message : String(err) });
        failed.push("anticipated questions");
        return null;
      }),
    prisma.auditEvent
      .findMany({
        where: { eventType: "conversation_digest" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { payload: true },
      })
      .catch((err) => {
        log.warn("digest_read_failed", { err: err instanceof Error ? err.message : String(err) });
        failed.push("conversation digests");
        return [] as Array<{ payload: unknown }>;
      }),
  ]);

  const followUps: string[] = [];
  for (const row of recentDigests) {
    const payload = row.payload as { followUpNeeded?: unknown } | null;
    if (payload && typeof payload === "object" && typeof payload.followUpNeeded === "string" && payload.followUpNeeded.trim()) {
      followUps.push(payload.followUpNeeded.trim());
    }
  }
  return {
    anticipatedQuestions: anticipated ? anticipated.questions.map((q) => q.question) : [],
    followUps,
    failed: failed.sort(),
  };
}
