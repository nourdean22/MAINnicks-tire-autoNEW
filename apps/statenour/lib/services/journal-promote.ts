/**
 * Journal-to-Action promotion · audit 2026-07-15 (loop-closure wave).
 *
 * The journal's AI "take" (journal_brain_take BrainMemory row) carries
 * three promotable layers: nextAction, idea, challenge. Pre-wave, only
 * nextAction had a promotion seam (trpc journal.promoteNextAction) and
 * NOTHING called it — the /journal insights panel created tasks via raw
 * task.create with accept-state in a client-side Set, so the
 * nextActionPromoted flag was never written and the home hub kept
 * resurfacing already-accepted actions (duplicate tasks on remount).
 *
 * This service is the single write path: promote a take layer → create
 * an INBOX task → stamp the per-layer promoted flag on the take row
 * (idempotent — a second promote of the same layer throws
 * ALREADY_PROMOTED). The tRPC router is a thin adapter over this.
 */

import { prisma } from "@/lib/prisma";
import { createTask } from "@/lib/services/tasks";
import { resolveInboxMissionId, resolveGeneralAnchorId } from "@/lib/services/missions";

export type JournalTakeKind = "nextAction" | "idea" | "challenge";

export type JournalPromoteErrorCode =
  | "NOT_FOUND"
  | "BAD_CONTENT"
  | "NOTHING_TO_PROMOTE"
  | "ALREADY_PROMOTED"
  | "TASK_FAILED";

export class JournalPromoteError extends Error {
  constructor(
    public readonly code: JournalPromoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "JournalPromoteError";
  }
}

/** Shape of the journal_brain_take content JSON (journal-brain.ts). */
interface TakeContent {
  idea?: string | null;
  ideaPromoted?: boolean;
  challenge?: string | null;
  challengePromoted?: boolean;
  nextAction?: {
    action?: string;
    domain?: string | null;
    nextActionPromoted?: boolean;
  } | null;
}

const TAKE_KEY = (entryId: string) => `journal-take:${entryId}`;

export async function promoteJournalTake(
  entryId: string,
  kind: JournalTakeKind = "nextAction",
): Promise<{ ok: true; taskId: string }> {
  const takeRow = await prisma.brainMemory.findUnique({
    where: {
      category_key: { category: "journal_brain_take", key: TAKE_KEY(entryId) },
    },
  });
  if (!takeRow) {
    throw new JournalPromoteError("NOT_FOUND", "Journal take not found");
  }

  let content: TakeContent;
  try {
    content = JSON.parse(takeRow.content) as TakeContent;
  } catch {
    throw new JournalPromoteError("BAD_CONTENT", "Malformed journal take content");
  }

  let title: string;
  let domain: string | null = null;

  if (kind === "nextAction") {
    const na = content.nextAction;
    if (!na || typeof na.action !== "string" || na.action.length === 0) {
      throw new JournalPromoteError(
        "NOTHING_TO_PROMOTE",
        "No next action defined in this journal take",
      );
    }
    if (na.nextActionPromoted === true) {
      throw new JournalPromoteError(
        "ALREADY_PROMOTED",
        "Next action already promoted to task",
      );
    }
    title = na.action;
    domain = na.domain ?? null;
  } else if (kind === "idea") {
    if (!content.idea) {
      throw new JournalPromoteError("NOTHING_TO_PROMOTE", "No idea in this journal take");
    }
    if (content.ideaPromoted === true) {
      throw new JournalPromoteError("ALREADY_PROMOTED", "Idea already promoted to task");
    }
    title = `Explore: ${content.idea}`.slice(0, 150);
  } else {
    if (!content.challenge) {
      throw new JournalPromoteError(
        "NOTHING_TO_PROMOTE",
        "No challenge in this journal take",
      );
    }
    if (content.challengePromoted === true) {
      throw new JournalPromoteError(
        "ALREADY_PROMOTED",
        "Challenge already promoted to task",
      );
    }
    title = `Answer the challenge: ${content.challenge}`.slice(0, 150);
  }

  // Domain-anchored mission for next actions; INBOX for everything else
  // (mirrors the original promoteNextAction routing).
  let missionId: string;
  if (kind === "nextAction" && domain) {
    try {
      const anchorId = await resolveGeneralAnchorId(domain as never);
      missionId = anchorId ?? (await resolveInboxMissionId());
    } catch {
      missionId = await resolveInboxMissionId();
    }
  } else {
    missionId = await resolveInboxMissionId();
  }

  const task = await createTask({ title, missionId, status: "INBOX" });
  if (!task) {
    throw new JournalPromoteError("TASK_FAILED", "Failed to create task");
  }

  if (kind === "nextAction") {
    content.nextAction!.nextActionPromoted = true;
  } else if (kind === "idea") {
    content.ideaPromoted = true;
  } else {
    content.challengePromoted = true;
  }

  await prisma.brainMemory.update({
    where: {
      category_key: { category: "journal_brain_take", key: TAKE_KEY(entryId) },
    },
    data: { content: JSON.stringify(content) },
  });

  return { ok: true, taskId: task.id };
}
