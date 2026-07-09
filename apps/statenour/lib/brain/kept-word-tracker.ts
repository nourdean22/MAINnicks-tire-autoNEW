/**
 * 2026-05-27 · Power Atlas Phase 2 · Kept-word tracker.
 *
 * Scans the last 24h of operator chat messages for promises made TO
 * the operator BY named people (the operator quotes the person in
 * chat: "Mike said he'll send the docs tomorrow"). Extracts via AI
 * classifier · upserts one BrainMemory(category="kept_word") row
 * per (personId, chatMessageId) so re-runs are idempotent.
 *
 * The accrued promise log feeds `deriveTrustFromKeptWord(personId)`
 * which the future trust-score-refresh consumer uses to set
 * `PersonProfile.trustScore` from the kept/broken ratio (≥3 data
 * points required before a derivation lands · pure read · no
 * side-effects).
 *
 * Idempotency · the unique (category, key) constraint on BrainMemory
 * + upsert pattern means re-scanning the same chat window cannot
 * double-count.
 *
 * Telegram · this writer is silent · the operator reads results on
 * /relationships, not the phone.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

interface ExtractedPromise {
  personName: string;
  promise: string;
  dueHint: string | null;
}

/**
 * Scan the last 24h of operator-authored chat messages for promises
 * made by known people. Returns counters for cron reporting.
 *
 * @returns scanned · messages examined · newPromises · rows upserted
 *          · resolved · status-transitions to "kept"/"broken" (reserved
 *          for the resolver wave · always 0 in v1).
 */
export async function scanKeptWords(): Promise<{
  scanned: number;
  newPromises: number;
  resolved: number;
}> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const messages = await prisma.chatMessage.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      conversationId: true,
      createdAt: true,
    },
  });
  if (messages.length === 0) {
    return { scanned: 0, newPromises: 0, resolved: 0 };
  }

  const people = await prisma.personProfile.findMany({
    where: { status: { not: "blown_up" }, deletedAt: null },
    select: { id: true, name: true },
  });
  if (people.length === 0) {
    return { scanned: messages.length, newPromises: 0, resolved: 0 };
  }

  let newPromises = 0;
  const resolved = 0;
  let classifierFailures = 0;
  const classifierErrors: unknown[] = [];

  for (const msg of messages) {
    if (msg.role !== "user") continue; // operator quotes someone
    const contentLower = msg.content.toLowerCase();
    const mentionedPeople = people.filter((p) =>
      contentLower.includes(p.name.toLowerCase()),
    );
    if (mentionedPeople.length === 0) continue;

    // Quick filter · skip messages without promise-shape language
    if (
      !/will|going to|promise|i'll|i will|next week|tomorrow|by /i.test(
        msg.content,
      )
    )
      continue;

    try {
      const result = await tracedAiChat(
        { label: "kept-word-extract", source: "cron" },
        [
          {
            role: "system",
            content:
              "Extract promises made by named persons to the operator. Output ONLY JSON: {promises: [{personName, promise, dueHint}]}. dueHint is freetext or null. If no promises, return {promises:[]}.",
          },
          { role: "user", content: msg.content.slice(0, 2000) },
        ],
        "reason",
      );
      const raw = (result.content ?? "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "");
      const parsed = JSON.parse(raw) as { promises: ExtractedPromise[] };
      for (const promise of parsed.promises ?? []) {
        const matchedPerson = people.find(
          (p) =>
            p.name.toLowerCase() === promise.personName.toLowerCase(),
        );
        if (!matchedPerson) continue;
        await prisma.brainMemory.upsert({
          where: {
            category_key: {
              category: BRAIN_CATEGORIES.KEPT_WORD,
              key: `${matchedPerson.id}:${msg.id}`,
            },
          },
          create: {
            category: BRAIN_CATEGORIES.KEPT_WORD,
            key: `${matchedPerson.id}:${msg.id}`,
            content: JSON.stringify({
              promise: promise.promise,
              dueHint: promise.dueHint,
              extractedAt: new Date().toISOString(),
              status: "open",
            }),
            confidence: 0.85,
            source: "cron:kept-word-scan",
            // Power Atlas fix 2026-06-02: every reader (contextual-greene-laws,
            // /relationships watchlist, morning-brief) filters on
            // metadata.personId / metadata.status — but the create block never
            // wrote metadata, so `openPromises` was permanently 0. personId is
            // already encoded in the key; mirror it + status into metadata so
            // all metadata-readers resolve. (No resolver wave yet → status is
            // always "open" here; the resolver will update it when it lands.)
            metadata: {
              personId: matchedPerson.id,
              promise: promise.promise,
              dueHint: promise.dueHint,
              status: "open",
            },
          },
          update: {},
        });
        newPromises++;
      }
    } catch (err) {
      // skip · classifier failure on one message doesn't block others
      classifierFailures++;
      classifierErrors.push(err);
    }
  }

  if (classifierFailures > 0) {
    logError("brain.kept-word-tracker", new Error(`${classifierFailures} classifier failures skipped`), { fn: "scanKeptWords", errors: classifierErrors.map(String) });
  }

  return { scanned: messages.length, newPromises, resolved };
}

/**
 * Derive a per-person trust score from kept/broken ratio.
 * Pure function · no side effects · used by future trust-score
 * refresh consumers. Returns null when fewer than 3 resolved data
 * points exist (signal too thin · don't move the operator's number
 * without enough evidence).
 */
export async function deriveTrustFromKeptWord(
  personId: string,
): Promise<number | null> {
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.KEPT_WORD,
      key: { startsWith: `${personId}:` },
    },
    select: { content: true },
  });
  if (rows.length === 0) return null;
  let kept = 0;
  let broken = 0;
  let malformedCount = 0;
  const malformedErrors: unknown[] = [];
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as { status: string };
      if (parsed.status === "kept") kept++;
      else if (parsed.status === "broken") broken++;
    } catch (err) {
      // ignore malformed rows
      malformedCount++;
      malformedErrors.push(err);
    }
  }
  
  if (malformedCount > 0) {
    logError("brain.kept-word-tracker", new Error(`${malformedCount} malformed rows skipped`), { fn: "deriveTrustFromKeptWord", personId, errors: malformedErrors.map(String) });
  }
  const total = kept + broken;
  if (total < 3) return null; // need ≥3 data points
  return kept / total;
}
