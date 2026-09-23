/**
 * `tool_telemetry.tool_name` is a UNIQUE key, so anything that reaches it
 * becomes a tool as far as every reader is concerned.
 *
 * THE PRODUCTION ROW THAT FORCED THIS. One row of 50 held 101 characters of an
 * entire tool-call payload — arguments, newlines, and a stray `</arg_value>`
 * closing tag — where the name belongs. Nothing in this repo emits that
 * encoding (`arg_value` appears nowhere in lib/ or app/), so it arrived from the
 * model's output through a provider/SDK parse. We cannot fix that parser from
 * here; the boundary has to hold.
 *
 * The cost was not one junk row: a real `searchColdMemory` invocation was
 * attributed to the garbage key, so that tool's totalCalls is short by at least
 * one — and the usage census, the never-chosen analysis and the
 * description-rewrite cron's `lastErrors` evidence all read this table.
 */
import { describe, it, expect } from "vitest";
import {
  isRecordableToolName,
  describeRejectedToolName,
} from "@/lib/ai/tool-telemetry";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

/** Byte-for-byte the value measured in production on 2026-09-17. */
const THE_ROW = 'searchColdMemory({\n  query: "nicks tire instagram post",\n  scope: "ingest",\n  limit: 5\n})</arg_value>';

describe("isRecordableToolName", () => {
  it("CANARY: rejects the exact 101-char payload found in production", () => {
    expect(THE_ROW.length).toBe(101); // the fixture is the real thing, not a paraphrase
    expect(isRecordableToolName(THE_ROW)).toBe(false);
  });

  it("POSITIVE CONTROL: accepts EVERY name in the live catalog", () => {
    // Without this, a guard that rejected everything would satisfy the canary
    // above and silently stop all telemetry — trading a corrupt table for an
    // empty one, which reads as "no tool was ever called".
    const rejected = TOOL_CATALOG.map((t) => (t as { name: string }).name).filter(
      (n) => !isRecordableToolName(n),
    );
    expect(rejected, "the guard would drop real catalog tools").toEqual([]);
    expect(TOOL_CATALOG.length).toBeGreaterThan(150); // the catalog was actually loaded
  });

  it("accepts the historical dotted keys already in the table", () => {
    // `arsenal.webSearch`, `person.update`, `memory.remember` predate today's
    // naming. They are real invocations and must not be reclassified as junk by
    // a guard added afterwards.
    for (const n of ["arsenal.webSearch", "person.update", "memory.remember", "getGoals"]) {
      expect(isRecordableToolName(n), `${n} is a real historical key`).toBe(true);
    }
  });

  it.each([
    ["embedded newline", "getTasks\nmore"],
    ["call syntax", "getTasks({a:1})"],
    ["closing tag", "getTasks</arg_value>"],
    ["leading digit", "7tools"],
    ["empty", ""],
    ["whitespace", "   "],
    ["over length", "a".repeat(65)],
  ])("rejects %s", (_label, value) => {
    expect(isRecordableToolName(value)).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}], [["getTasks"]]])(
    "rejects the non-string %s without throwing",
    (value) => {
      expect(isRecordableToolName(value)).toBe(false);
    },
  );
});

/**
 * REJECTING A PAYLOAD MUST NOT PUBLISH IT.
 *
 * The first cut of this guard logged `JSON.stringify(name.slice(0, 160))`.
 * `logError` persists its `message` VERBATIM into `ErrorLog.message` and also
 * console-logs it, while `redactSensitive` covers only the structured `extra`
 * object — never the message. So a malformed call carrying a customer phone
 * number, message body, search query or token would have moved that payload out
 * of the rejected telemetry key and into the database and infra logs.
 *
 * Not hypothetical: the production specimen already contained real operator
 * content (`query: "nicks tire instagram post"`). A guard that keeps junk out of
 * one table must not pipe it into another.
 */
describe("describeRejectedToolName · metadata only", () => {
  // Built by joining, not as one literal with escapes — a `\n` escape written
  // through a shell heredoc becomes a REAL newline and breaks the file, which
  // it already did once in this session.
  // ⚠ `-FAKE`, NOT A RANDOM-LOOKING SUFFIX. The first version used
  // `sk-live-abc123` and `gitleaks` failed the PR on it: rule
  // `generic-api-key`, entropy 3.66. That is a TRUE positive from the scanner's
  // point of view — it cannot know a secret-shaped string in a test is
  // synthetic, and a scanner taught to ignore test files would be worthless,
  // since that is exactly where a real key gets pasted by accident.
  //
  // This matches the convention already in the repo
  // (tests/lib/error-log-redaction.test.ts): keep the PREFIX so the value is
  // still token-shaped for the assertions, and make the body obviously fake so
  // the entropy stays below the rule.
  const FAKE_TOKEN = "sk-live-FAKE";
  const SENSITIVE = [
    "sendSms({",
    // 555 is the reserved-for-fiction exchange, so this is not a real number.
    '  to: "+12165551234",',
    '  body: "Your car is ready, Mrs. Alvarez",',
    `  token: "${FAKE_TOKEN}"`,
    "})</arg_value>",
  ].join("\n");

  it("CANARY: no fragment of the payload appears in the description", () => {
    const d = describeRejectedToolName(SENSITIVE);
    const blob = JSON.stringify(d);
    for (const secret of [
      "2165551234",
      "Alvarez",
      "sk-live",
      "Your car is ready",
      "sendSms",
      "arg_value",
    ]) {
      expect(blob, `the description leaked "${secret}"`).not.toContain(secret);
    }
  });

  it("still says enough to act on: reason, length, type, and a stable digest", () => {
    // POSITIVE CONTROL — a describer that returned nothing would satisfy the
    // canary above while making the refusal unactionable.
    const d = describeRejectedToolName(SENSITIVE);
    expect(d.reason).toBe("contains-newline");
    expect(d.length).toBe(SENSITIVE.length);
    expect(d.type).toBe("string");
    expect(d.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("the digest is STABLE for the same value and differs for another", () => {
    // Its only job is correlating repeats, so equality both ways is the contract.
    expect(describeRejectedToolName(SENSITIVE).digest).toBe(
      describeRejectedToolName(SENSITIVE).digest,
    );
    expect(describeRejectedToolName(SENSITIVE).digest).not.toBe(
      describeRejectedToolName(SENSITIVE + "x").digest,
    );
  });

  it.each([
    ["getTasks({a:1})", "contains-call-syntax"],
    ["7tools", "bad-first-char"],
    ["", "empty"],
    ["a".repeat(80), "too-long"],
    ["has space", "disallowed-characters"],
  ])("classifies %s as %s", (value, reason) => {
    expect(describeRejectedToolName(value).reason).toBe(reason);
  });

  it("handles a non-string without throwing or stringifying it", () => {
    const d = describeRejectedToolName({ secret: "tok-123" } as unknown);
    expect(d.reason).toBe("not-a-string");
    expect(JSON.stringify(d)).not.toContain("tok-123");
  });
});
