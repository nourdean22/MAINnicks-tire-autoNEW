/**
 * Voice brain dump · 2026-10-29 (task upgrades phase 2, benchmark pick 1:
 * Todoist Ramble + Jarvis "talk, not type").
 *
 * Speak, review a list, one Save. The audio goes through the existing
 * /api/ai/transcribe route; this module splits the transcript into task rows
 * with one model call on the existing provider chain (no new paid service),
 * and on Save creates every reviewed row in the Inbox. Nothing is written
 * before Save. "by <when>" is read on the phone (components/missions/
 * voice-dump.tsx), not here: the quick-add parser's day math runs in local
 * time, and the server's local time is UTC, so "tomorrow" said at 9 pm ET
 * would land a day late.
 */
import { z } from "zod";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { ServiceError } from "@/lib/utils/service-error";
import { createTask } from "@/lib/services/tasks";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { resolveInboxMissionId } from "@/lib/services/missions";

export const DUMP_MAX_ROWS = 20;
export const DUMP_TITLE_MAX = 200;
/** What one split call reads. Longer is refused, never cut: a cut dump would drop tasks silently. */
export const DUMP_TRANSCRIPT_MAX = 6000;

export interface DumpRow {
  title: string;
  /** ISO, from a "by <when>" phrase the client's parser understood; null otherwise. */
  dueDate: string | null;
}

const rowShape = z.object({ title: z.string() });
const log = rootLogger.withSurface("services/voice-dump");

export async function splitBrainDump(transcript: string): Promise<{ items: Array<{ title: string }> }> {
  const text = transcript.trim();
  if (!text) return { items: [] };
  if (text.length > DUMP_TRANSCRIPT_MAX) {
    throw new ServiceError(`Too long to split in one go (over ${DUMP_TRANSCRIPT_MAX.toLocaleString("en-US")} characters). Record it in parts.`, 400);
  }

  const result = await tracedAiChat(
    { label: "voice-dump-split", source: "tool" },
    [
      {
        role: "system",
        content:
          "You split a spoken brain dump into separate to-do items. Return ONLY a JSON array, no markdown, no commentary.",
      },
      {
        role: "user",
        content: `Transcript:\n"""${text}"""\n\nSplit it into one item per separate thing to do. Rules:
- Keep the speaker's own words; fix only filler ("um", "like", "and then") and grammar.
- Start each title with the action. One action per item.
- Keep any deadline phrase in the title as "by <day>" (for example "by friday", "by tomorrow").
- Drop thoughts that are not things to do. Do not invent items.
Return: [{"title":"..."}]`,
      },
    ],
    "extract",
  );

  if (result.provider === "none" || result.provider === "emergency") {
    throw new ServiceError("The model is unavailable, so the dump was not split.", 503);
  }
  const parsed = extractJsonArray<unknown>(result.content);
  if (!parsed.ok) throw new ServiceError("The model returned something that is not a list.", 502);

  const items: Array<{ title: string }> = [];
  for (const raw of parsed.value) {
    const v = rowShape.safeParse(raw);
    const title = v.success ? v.data.title.trim().slice(0, DUMP_TITLE_MAX) : "";
    if (!title) continue;
    items.push({ title });
    if (items.length === DUMP_MAX_ROWS) break;
  }
  return { items };
}

/**
 * Rows are created one by one (createTask runs its own transaction). Each row's
 * outcome is returned, so the review list drops what was saved and keeps what
 * failed: pressing Save again retries only the failures and never duplicates.
 */
export async function saveBrainDump(rows: DumpRow[]): Promise<{ created: number; ids: string[]; failed: number[] }> {
  const missionId = await resolveInboxMissionId();
  const ids: string[] = [];
  const failed: number[] = [];
  for (const [i, row] of rows.entries()) {
    try {
      const vm = await createTask({
        title: row.title,
        missionId,
        status: "INBOX",
        ...(row.dueDate ? { dueDate: new Date(row.dueDate) } : {}),
      });
      if (!vm) throw new Error("create returned no task");
      ids.push(vm.id);
    } catch (err) {
      log.warn("dump_row_failed", { index: i, error: sanitizeError(err) });
      failed.push(i);
    }
  }
  return { created: ids.length, ids, failed };
}
