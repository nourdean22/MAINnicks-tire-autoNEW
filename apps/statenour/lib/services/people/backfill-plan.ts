/**
 * People W1 backfill planner (2026-10-30). Pure: no DB, no model.
 *
 * It decides what `scripts/people-backfill.ts` WOULD write. The script prints
 * counts and `planToken(plan)`; an apply must present the same token, so only
 * the reviewed plan can be written. Exact or case-insensitive names only, never
 * a new person, never a bare mention (an "interacted" verdict from the digest).
 */
import { createHash } from "node:crypto";

export interface PersonRef {
  id: string;
  name: string;
}

const SELF = /^(me|myself|self|i)$/i;

/** The one live profile with this name (case-insensitive); null when none or ambiguous. */
export function matchPersonExact(name: string | null | undefined, people: readonly PersonRef[]): PersonRef | null {
  const want = name?.trim().toLowerCase();
  if (!want) return null;
  const hits = people.filter((p) => p.name.trim().toLowerCase() === want);
  return hits.length === 1 ? hits[0] : null;
}

export interface PromiseTask {
  id: string;
  personId: string | null;
  promiseTo: string | null;
}

export function planPromiseLinks(tasks: readonly PromiseTask[], people: readonly PersonRef[]) {
  const rows: Array<{ taskId: string; personId: string }> = [];
  let untrackedNames = 0;
  for (const t of tasks) {
    const name = t.promiseTo?.trim();
    if (t.personId || !name || SELF.test(name)) continue;
    const p = matchPersonExact(name, people);
    if (p) rows.push({ taskId: t.id, personId: p.id });
    else untrackedNames++;
  }
  return { rows, untrackedNames };
}

export interface DigestedConversation {
  conversationId: string;
  start: Date;
  end: Date;
  mentioned: Array<{ name: string; interacted: boolean; interactionKind: string | null }>;
}

export interface PlannedChatRow {
  personId: string;
  conversationId: string;
  at: Date;
  interactionKind: string | null;
  backfillKey: string;
}

export function planChatInteractions(
  conversations: readonly DigestedConversation[],
  people: readonly PersonRef[],
  ledger: ReadonlyArray<{ personId: string; createdAt: Date }>,
) {
  const rows: PlannedChatRow[] = [];
  const skipped = { mentionOnly: 0, unmatched: 0, alreadyLogged: 0, duplicate: 0 };
  const seen = new Set<string>();
  for (const c of conversations) {
    for (const m of c.mentioned) {
      if (!m.interacted) {
        skipped.mentionOnly++;
        continue;
      }
      const p = matchPersonExact(m.name, people);
      if (!p) {
        skipped.unmatched++;
        continue;
      }
      const backfillKey = `bf:chat:${c.conversationId}:${p.id}`;
      if (seen.has(backfillKey)) {
        skipped.duplicate++;
        continue;
      }
      // Same rule as recordInteractionOnce: a row already inside the window wins.
      const logged = ledger.some(
        (r) => r.personId === p.id && r.createdAt >= c.start && r.createdAt <= c.end,
      );
      if (logged) {
        skipped.alreadyLogged++;
        continue;
      }
      seen.add(backfillKey);
      rows.push({ personId: p.id, conversationId: c.conversationId, at: c.end, interactionKind: m.interactionKind, backfillKey });
    }
  }
  return { rows, skipped };
}

/** Short, order-independent fingerprint of the ids a plan would write. */
export function planToken(plan: {
  chat: ReadonlyArray<{ backfillKey: string }>;
  tasks: ReadonlyArray<{ taskId: string; personId: string }>;
}): string {
  const ids = [
    ...plan.chat.map((r) => r.backfillKey),
    ...plan.tasks.map((r) => `bf:task:${r.taskId}:${r.personId}`),
  ].sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 12);
}
