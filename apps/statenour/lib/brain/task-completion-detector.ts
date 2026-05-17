/**
 * Task Completion Detector — parses user chat turns for completion
 * language ("just finished X", "done with Y", "knocked out Z") and
 * fuzzy-matches against open tasks. Apr 19.
 *
 * When a match is found, returns a candidate task id + confidence so
 * the chat route can propose auto-marking it DONE. We don't mark
 * automatically — Nour confirms in the UI (one tap).
 *
 * Matching strategy:
 *   1. Regex extraction of completion + object phrases
 *   2. Token-overlap scoring against READY/DOING task titles
 *   3. Min confidence threshold 0.4
 *   4. Top-1 match (only propose when clearly one task matches)
 */

import { prisma } from "@/lib/prisma";

// Regex patterns that flag "I just did something" language.
const COMPLETION_TRIGGERS = [
  /\b(just|finally|already) (finished|completed|done with|wrapped up|knocked out|handled|closed|shipped)\b/i,
  /\b(i|we) (got|just got) (it|that|this|x) done\b/i,
  /\b(marking|checking off|checking out)\b.*\b(done|complete|off)\b/i,
  /\b(that'?s|thats) done\b/i,
  /\bjust (sent|called|texted|delivered|replied|emailed|paid|scheduled|booked)\b/i,
];

function tokenize(text: string): Set<string> {
  const STOP = new Set([
    "the","a","an","and","or","but","for","of","to","in","on","at","by","with","from","as",
    "is","are","was","be","been","being","my","our","i","we","you","me","it","this","that",
    "these","those","just","about","some","any","did","done","got","had","has","have","will",
    "would","should","can","could","might","may","also","too","very","really","only",
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
}

export interface CompletionCandidate {
  taskId: string;
  title: string;
  confidence: number;
  userPhrase: string;
}

/**
 * Detect whether a user turn signals task completion + which task.
 * Returns null when no clear match.
 */
export async function detectTaskCompletion(
  userText: string,
): Promise<CompletionCandidate | null> {
  if (userText.length < 6 || userText.length > 500) return null;

  // Step 1: does the text carry completion language?
  const triggered = COMPLETION_TRIGGERS.some((p) => p.test(userText));
  if (!triggered) return null;

  // Step 2: token-overlap against open tasks
  const openTasks = await prisma.task
    .findMany({
      where: { status: { in: ["READY", "DOING"] } },
      select: { id: true, title: true },
      take: 80,
    })
    .catch(() => [] as Array<{ id: string; title: string }>);
  if (openTasks.length === 0) return null;

  const userTokens = tokenize(userText);
  let best: { id: string; title: string; score: number } | null = null;
  for (const t of openTasks) {
    const titleTokens = tokenize(t.title);
    const score = overlapScore(userTokens, titleTokens);
    if (score > 0.3 && (!best || score > best.score)) {
      best = { id: t.id, title: t.title, score };
    }
  }

  if (!best || best.score < 0.4) return null;

  return {
    taskId: best.id,
    title: best.title,
    confidence: best.score,
    userPhrase: userText.slice(0, 160),
  };
}

/**
 * Auto-DONE when confidence is very high. For ambiguous matches the
 * chat route UI proposes it as a chip for Nour to confirm.
 *
 * v10.0.46 — fixed silently-dead feature. Pre-fix this called
 * `await fetch("/api/tasks/...")` from a server-side module
 * (lib/brain/), which Next.js resolves against `localhost:undefined`
 * and dies — every call hit the bare `catch` and returned
 * `{ completed: false }`. Now writes to Prisma directly. Removes
 * the round-trip through HTTP entirely; the route handler did
 * essentially the same write.
 */
export async function autoCompleteIfConfident(
  userText: string,
  threshold = 0.8,
): Promise<{ completed: boolean; taskId?: string; title?: string }> {
  const match = await detectTaskCompletion(userText);
  if (!match || match.confidence < threshold) return { completed: false };
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.task.update({
      where: { id: match.taskId },
      data: {
        status: "DONE",
        lastCompletedAt: new Date(),
        // streakCount handling for DAILY tasks lives in the
        // service-layer `completeTask`; keep direct write narrow
        // here to avoid double-bumping.
      },
    });
    return { completed: true, taskId: match.taskId, title: match.title };
  } catch {
    return { completed: false };
  }
}
