/**
 * 2026-06-06 · Reject pronouns / generic descriptors as person names.
 * The Nick agent sometimes emitted person.update { name: "her" } (or "the
 * caller"), creating ghost PersonProfile rows in the operator's Power Atlas.
 * A person must have a real name — never a pronoun or bare role-word.
 */
const NON_NAME_TOKENS = new Set<string>([
  "her", "him", "she", "he", "they", "them", "it", "i", "me", "we", "us",
  "you", "his", "hers", "their", "theirs", "myself", "himself", "herself",
  "someone", "somebody", "anyone", "anybody", "everyone", "nobody",
  "this", "that", "person", "people", "guy", "girl", "woman", "man",
  "lady", "dude", "customer", "caller", "client", "lead", "stranger",
  "unknown", "n/a", "na", "tbd", "none", "null", "undefined", "the",
]);

export function isNonName(raw: string): boolean {
  const name = raw.trim().toLowerCase();
  if (!name) return true;
  if (!/[a-z]/.test(name)) return true; // no letters at all
  if (NON_NAME_TOKENS.has(name)) return true; // bare pronoun / descriptor
  // "the caller", "a woman", "that guy", "this person", "some lady"
  const art = name.match(/^(?:the|a|an|this|that|some|any)\s+([a-z]+)$/);
  if (art && NON_NAME_TOKENS.has(art[1])) return true;
  return false;
}
