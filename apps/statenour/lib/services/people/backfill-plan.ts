/**
 * People W1 backfill planner (2026-10-30). Pure: no DB, no model.
 *
 * It decides what `scripts/people-backfill.ts` WOULD write. The script prints
 * counts and `planToken(plan)`; an apply must present the same token, so only
 * the reviewed plan can be written. Exact or case-insensitive names only, never
 * a new person, never a bare mention (an "interacted" verdict from the digest).
 */
import { createHash } from "node:crypto";

import { isContactRow } from "./contact-rows";
import { nicknameOwners, type NicknamedPerson } from "@/lib/people/nicknames";

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
  /** Conversation start: with `at` (its end), the window the apply re-checks before it writes. */
  start: Date;
  at: Date;
  interactionKind: string | null;
  backfillKey: string;
}

/**
 * The name as a whole word, on Unicode boundaries: `\b` is ASCII-only, so a name
 * ending in "é" or "." never matched (Codex on 3419).
 */
export function nameMatcher(name: string, flags = "iu"): RegExp {
  const esc = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, flags);
}

/** One matcher per nickname that points at exactly one of these people, for a reader that already matches by name. */
export function nicknameMatchers<T extends NicknamedPerson>(people: readonly T[]): Array<{ person: T; re: RegExp }> {
  return [...nicknameOwners(people)].flatMap(([key, group]) => (group.length === 1 ? [{ person: group[0], re: nameMatcher(key) }] : []));
}

/** The text before a match when the match opens a sentence: nothing, or a stop or newline, then quotes and spaces. */
const SENTENCE_START = /(?:^|[.!?\n])["'\u201C\u2018(\s]*$/;

const opensSentence = (text: string, at: number) => SENTENCE_START.test(text.slice(0, at));

/**
 * Where a line talks about this person, for the excerpt: by namedInText's rule first, then any exact-case hit, then
 * any case (a line the model linked may spell the name in lower case). -1 when the name is not in the text.
 */
export function nameIndexIn(text: string, name: string): number {
  const exact = [...text.matchAll(nameMatcher(name, "gu"))];
  const counted = /\s/.test(name.trim()) ? exact[0] : exact.find((m) => !opensSentence(text, m.index));
  return (counted ?? exact[0])?.index ?? text.search(nameMatcher(name));
}

/**
 * Who a line names, for a link no model checks (W8b manager round 1): the composer's and the weekly review's save-time
 * link and the journal backfill. It errs toward linking no one:
 *   · case-sensitive: "I will call" is not Will (nameMatcher's "iu" stays for reading context, where a miss costs more);
 *   · a one-word name that opens a sentence does not count: "Will called" reads the same as "Will do";
 *   · a name more than one live profile answers to (any case) links nobody, counted in `ambiguous`;
 *   · longest names first, and a matched full name is blanked: "Sam Jones" is not also Sam.
 * The cost: "Dania called." alone links no one here; the model pass still can.
 * A nickname is his own word for one person, so it matches in any case, sentence start included ("mom called"), and
 * shares the rest: a nickname two people use links nobody, longest first, a two-word one is blanked.
 */
export function namedInText<T extends PersonRef & { metadata?: unknown }>(text: string, people: readonly T[]): { people: T[]; ambiguous: number } {
  const byName = new Map<string, T[]>();
  for (const p of people) {
    const key = p.name.trim().toLowerCase();
    if (key.length >= 2) byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const nicknames = nicknameOwners(people);
  const named = new Set<string>();
  let ambiguous = 0;
  let rest = text;
  for (const [key, group] of [...byName, ...nicknames].sort(([a], [b]) => b.length - a.length)) {
    const nickname = nicknames.has(key);
    const fullName = /\s/.test(key);
    const hit = nickname
      ? nameMatcher(key).test(rest)
      : group.some((p) => [...rest.matchAll(nameMatcher(p.name, "gu"))].some((m) => fullName || !opensSentence(rest, m.index)));
    if (fullName && nickname) rest = rest.replace(nameMatcher(key, "giu"), (m) => "_".repeat(m.length));
    else if (fullName) for (const p of group) rest = rest.replace(nameMatcher(p.name, "gu"), (m) => "_".repeat(m.length));
    if (!hit) continue;
    if (group.length > 1) ambiguous++;
    else named.add(group[0].id);
  }
  return { people: people.filter((p) => named.has(p.id)), ambiguous };
}

/**
 * Conversations worth digesting, oldest first: his own message names a tracked
 * person who has no digest row for that conversation yet. Per person, not per
 * conversation (Codex on 3419): one logged person must not hide the others.
 */
export function selectCandidates(
  userMsgs: ReadonlyArray<{ conversationId: string; content: string; createdAt: Date }>,
  people: readonly PersonRef[],
  digestRows: ReadonlyArray<{ personId: string; conversationId: string }>,
): Array<{ conversationId: string; firstMatchAt: Date }> {
  const logged = new Set(digestRows.map((r) => `${r.conversationId}:${r.personId}`));
  const matchers = people.map((p) => ({ id: p.id, re: nameMatcher(p.name) }));
  const firstMatch = new Map<string, Date>();
  for (const m of userMsgs) {
    if (firstMatch.has(m.conversationId)) continue;
    if (matchers.some((p) => !logged.has(`${m.conversationId}:${p.id}`) && p.re.test(m.content))) {
      firstMatch.set(m.conversationId, m.createdAt);
    }
  }
  return [...firstMatch.entries()]
    .sort((a, b) => a[1].getTime() - b[1].getTime())
    .map(([conversationId, firstMatchAt]) => ({ conversationId, firstMatchAt }));
}

const DIGEST_MAX = 30;

/**
 * At most 30 messages that include the turn that made this a candidate (10
 * before it, the rest after). digestConversation keeps only the LAST 30, so an
 * early report in a long conversation was never seen (Codex on 3419).
 */
export function digestWindow<T extends { createdAt: Date }>(messages: readonly T[], firstMatchAt: Date): T[] {
  const i = Math.max(0, messages.findIndex((m) => m.createdAt.getTime() >= firstMatchAt.getTime()));
  const start = Math.max(0, Math.min(i - 10, messages.length - DIGEST_MAX));
  return messages.slice(start, start + DIGEST_MAX);
}

export function planChatInteractions(
  conversations: readonly DigestedConversation[],
  people: readonly PersonRef[],
  ledger: ReadonlyArray<{ personId: string; createdAt: Date; metadata?: unknown }>,
) {
  // Only real contacts count as "already logged": a status flip or a synthetic mention is not one.
  const contacts = ledger.filter((r) => isContactRow({ metadata: r.metadata }));
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
      // A contact row already inside [start, end] wins. Bounded on both sides, which
      // recordInteractionOnce is NOT (it skips on any row after start), so the apply
      // must check this same bounded window itself (Codex on 3419).
      const logged = contacts.some(
        (r) => r.personId === p.id && r.createdAt >= c.start && r.createdAt <= c.end,
      );
      if (logged) {
        skipped.alreadyLogged++;
        continue;
      }
      seen.add(backfillKey);
      rows.push({ personId: p.id, conversationId: c.conversationId, start: c.start, at: c.end, interactionKind: m.interactionKind, backfillKey });
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
