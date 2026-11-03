/**
 * Chat fast-path · BRAIN-DUMP + /save handlers
 *
 * Two capture-style fast paths live together because they share the
 * same "user wants to deposit a thought into the brain, acknowledge
 * and persist, no LLM round-trip" shape:
 *
 *   · handleBrainDump  — "remember that …" / "note …" / "journal: …"
 *                        Runs through ingestJournal which DOES use a
 *                        small AI extraction pass to pull tasks +
 *                        insights + commitments out of the body.
 *
 *   · handleSlashSave  — "/save …" / "/remember …" / "/ingest …"
 *                        Lighter path · heuristic-only categorization,
 *                        writes a BrainMemory row directly via
 *                        lib/services/brain/save.ts. No LLM call.
 *                        Nour just wanted "save this, acknowledge
 *                        it, done."
 */

import { recordError } from "@/lib/errors/record-error";
import type { JournalResult } from "@/lib/brain/journal-ingest";
import { EARLY_BRAIN_DUMP, EARLY_SLASH_SAVE } from "./patterns";
import { buildFastStream } from "./shared";

/**
 * The capture confirmation, one markdown line per fact. W8b (audit B9): the people line names who the entry
 * reached and who is NOT on People, so a refused name never vanishes silently; a contact row that failed to
 * write is said in the same line.
 */
export function captureReplyLines(
  result: Pick<JournalResult, "entryType" | "summary" | "tasksCreated" | "insightsStored" | "commitmentsFound" | "peopleLinked">,
): string[] {
  const lines = [`**Captured** — ${result.entryType}`];
  if (result.summary) lines.push(result.summary);
  const counts: string[] = [];
  if (result.tasksCreated > 0) counts.push(`${result.tasksCreated} task${result.tasksCreated !== 1 ? "s" : ""}`);
  if (result.insightsStored > 0) counts.push(`${result.insightsStored} insight${result.insightsStored !== 1 ? "s" : ""}`);
  if (result.commitmentsFound > 0) counts.push(`${result.commitmentsFound} commitment${result.commitmentsFound !== 1 ? "s" : ""}`);
  if (counts.length > 0) lines.push(`**Extracted:** ${counts.join(" · ")}`);
  const p = result.peopleLinked;
  if (p && (p.names.length > 0 || p.rejected.length > 0)) {
    const parts = [p.names.length > 0 ? p.names.join(", ") : "none linked"];
    if (p.failed > 0) parts.push(`${p.failed} contact not saved`);
    if (p.rejected.length > 0) parts.push(`not on People: ${p.rejected.join(", ")}`);
    lines.push(`**People:** ${parts.join(" · ")}`);
  }
  return lines;
}

export async function handleBrainDump(
  convId: string,
  userContent: string,
): Promise<Response> {
  try {
    const body = userContent.trim().replace(EARLY_BRAIN_DUMP, "").trim();
    if (body.length < 3) {
      return Response.json(
        {
          error:
            "Capture content too short. Try: 'remember that <thought>' or 'journal: <thought>'",
        },
        { status: 400 },
      );
    }
    const { ingestJournal } = await import("@/lib/brain/journal-ingest");
    const result = await ingestJournal(body, "chat");
    console.log(
      `[ai/chat] Brain dump via fast path: ${result.brainDumpId} type=${result.entryType}`,
    );
    const confirmationLines = captureReplyLines(result);
    confirmationLines.push(``);
    confirmationLines.push(`Surfaces on [/journal](/journal).`);
    return await buildFastStream(
      convId,
      confirmationLines.join("\n\n"),
      "bd",
      "nl-brain-dump",
    );
  } catch (bdErr) {
    recordError("chat:brain-dump-capture", bdErr, {
      snippet: userContent.slice(0, 200),
    });
    return Response.json({ error: "Brain dump capture failed." }, { status: 500 });
  }
}

/**
 * v10.0.143 · /save handler. Strips the `/save` (or `/remember` /
 * `/ingest`) prefix, runs the heuristic categorizer + writes a
 * BrainMemory row via lib/services/brain/save.ts, returns a fast
 * confirmation message. No LLM call — Nour just wanted "save this,
 * acknowledge it, done."
 */
export async function handleSlashSave(
  convId: string,
  userContent: string,
): Promise<Response> {
  try {
    const body = userContent.trim().replace(EARLY_SLASH_SAVE, "").trim();
    if (body.length < 3) {
      return Response.json(
        {
          error:
            "Save content too short. Try: '/save <text>' or '/save: <text>'",
        },
        { status: 400 },
      );
    }
    const { saveToBrain } = await import("@/lib/services/brain/save");
    const result = await saveToBrain({ content: body, source: "chat:/save" });
    console.log(
      `[ai/chat] /save fast path: ${result.id} category=${result.category}`,
    );
    // 2026-09-07 · the headline must match what saveToBrain DID. It used to
    // print "Saved" on the branch that discarded the new statement.
    const headline =
      result.outcome === "duplicate"
        ? `**Already saved** — category=\`${result.category}\``
        : result.outcome === "created_near_duplicate"
          ? `**Saved** (a similar memory exists — both kept) — category=\`${result.category}\``
          : `**Saved** — category=\`${result.category}\``;
    const confirmationLines = [
      headline,
      `Key: \`${result.key}\``,
      ``,
      result.summary,
      ``,
      `Recall via [/brain](/brain) or category-targeted recall on the next chat turn.`,
    ];
    return await buildFastStream(
      convId,
      confirmationLines.join("\n"),
      "save",
      "slash-save",
    );
  } catch (err) {
    recordError("chat:slash-save", err, {
      snippet: userContent.slice(0, 200),
    });
    return Response.json({ error: "Save failed." }, { status: 500 });
  }
}
