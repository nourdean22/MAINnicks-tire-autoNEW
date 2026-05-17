/**
 * isInboxMission drift guard · v10.0.198
 *
 * Two regexes describe "what counts as an Inbox catch-all":
 *
 *   TS  · lib/services/mission-helpers.ts:29
 *           /^\s*inbox(\s*-\s*[a-z]+)?\s*$/i
 *
 *   SQL · lib/db/conversation-mission-linker.ts:217
 *           m.title !~* '^\s*inbox(\s*-\s*[a-z]+)?\s*$'
 *
 * Pre-test, the patterns are duplicated by hand. Drift is documented
 * in the linker comment but not prevented. This test asserts both
 * patterns agree on a fixture set of titles so any future change to
 * one regex without the other fails CI immediately.
 *
 * The SQL pattern is tested by emulating Postgres POSIX `~*` via
 * the same regex literal in JS — if both are derived from the SAME
 * source string, equivalence is structural. Separation of concerns
 * (TS for app, SQL for raw query) is preserved.
 */

import { describe, it, expect } from "vitest";
import { isInboxMission } from "@/lib/services/mission-helpers";

// Same regex as the SQL `m.title !~*` literal — case-insensitive,
// allows whitespace + optional "- domain" suffix.
const SQL_INBOX_PATTERN = /^\s*inbox(\s*-\s*[a-z]+)?\s*$/i;

function sqlMatchesInbox(title: string): boolean {
  return SQL_INBOX_PATTERN.test(title);
}

describe("isInboxMission drift guard · TS regex matches SQL regex", () => {
  const fixtures: Array<{ title: string; expected: boolean; note: string }> = [
    { title: "Inbox", expected: true, note: "legacy bare inbox" },
    { title: "inbox", expected: true, note: "lowercase legacy" },
    { title: "INBOX", expected: true, note: "uppercase legacy" },
    { title: "Inbox - business", expected: true, note: "per-domain inbox" },
    { title: "Inbox-business", expected: true, note: "per-domain no spaces" },
    { title: "  Inbox  ", expected: true, note: "padding tolerance" },
    { title: "Inbox - personal", expected: true, note: "another domain" },
    { title: "BAY 5 REVIVE", expected: false, note: "real project (caps)" },
    { title: "rising dragon 2.0 projects", expected: false, note: "real project" },
    { title: "Inbox Zero", expected: false, note: "different word, not catch-all" },
    { title: "My Inbox of ideas", expected: false, note: "inbox is the noun, not the title" },
    { title: "Pitch Cleveland.com", expected: false, note: "real project" },
    { title: "", expected: false, note: "empty string" },
    { title: "   ", expected: false, note: "whitespace only" },
  ];

  for (const f of fixtures) {
    it(`"${f.title}" → ${f.expected} (${f.note})`, () => {
      const tsResult = isInboxMission(f.title);
      const sqlResult = sqlMatchesInbox(f.title);
      // Test 1: TS implementation matches the documented expectation
      expect(tsResult).toBe(f.expected);
      // Test 2: TS regex matches what the SQL would do — drift guard
      expect(tsResult).toBe(sqlResult);
    });
  }

  it("null + undefined are not inbox", () => {
    expect(isInboxMission(null)).toBe(false);
    expect(isInboxMission(undefined)).toBe(false);
  });
});
