/**
 * People W2c (2026-10-30): one "love map" question a day about a person Nour
 * has written nothing about. Gottman's love maps are what you know of the
 * other person's world; Flipped Interaction asks one question at a time.
 *
 * Only people with no notes are candidates, so the question stops by itself as
 * profiles fill (the /people "needs info" count is the measure). The pick holds
 * still for the New York day and rotates across days. Fixed question strings,
 * no model call; the answer is appended to the notes, never written over them.
 */

export const LOVE_MAP_QUESTIONS = [
  "What is {name} working toward right now?",
  "What is weighing on {name} lately?",
  "Who matters most to {name}?",
  "What would make {name}'s week?",
  "How did you and {name} meet?",
  "What does {name} need from you these days?",
] as const;

const NOTES_MAX = 2000;

export interface LoveMapCandidate {
  id: string;
  name: string;
  leverageNotes: string | null;
}

export interface LoveMapQuestion {
  personId: string;
  name: string;
  question: string;
  dayKey: string;
}

/** Days since the epoch for a YYYY-MM-DD key, so consecutive days rotate. */
const dayNumber = (dayKey: string): number => Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / 86_400_000);

export function pickLoveMapQuestion(people: readonly LoveMapCandidate[], dayKey: string): LoveMapQuestion | null {
  const pool = people.filter((p) => !p.leverageNotes?.trim()).sort((a, b) => a.id.localeCompare(b.id));
  if (pool.length === 0) return null;
  const n = dayNumber(dayKey);
  const person = pool[n % pool.length];
  // The question moves once per full pass, so a person gets a different one each time round.
  const template = LOVE_MAP_QUESTIONS[Math.floor(n / pool.length) % LOVE_MAP_QUESTIONS.length];
  return { personId: person.id, name: person.name, question: template.replace("{name}", person.name), dayKey };
}

/** The notes after the answer, or null when the answer is empty or would push the notes past the cap. */
export function appendLoveMapAnswer(existing: string | null, question: string, answer: string): string | null {
  const a = answer.trim();
  if (!a) return null;
  const line = `${question} ${a}`;
  const next = existing?.trim() ? `${existing.trimEnd()}\n${line}` : line;
  return next.length > NOTES_MAX ? null : next;
}
