/**
 * No customer name or phone in voice-agent logs. PROTECTED-CORE rule 5 and
 * AGENTS.md ("keep PII out of logs — the linter never reads your log output"):
 * lint:pii matches shapes, so a `name: input.name` field inside a log call —
 * which ships the caller's name to Railway's log store on every call — passes
 * it. This scans every log.info/warn/error call in the voice-agent router,
 * argument list included, for the customer's name or phone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every `log.<level>(…)` call's full argument text, parens balanced. */
function logCalls(src: string): string[] {
  const out: string[] = [];
  const re = /\blog\.(info|warn|error|debug)\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

/**
 * A RAW value: `name: input.name` or `${input.phone}`. Not flagged: a boolean
 * (`nameGiven: Boolean(input.name)`) or the repo's last-4 mask
 * (`input.phone.slice(-4)`), which is how this file already logs phones.
 */
const PII_FIELD = /(:\s*|\$\{\s*)input\??\.(name|phone|customerName|customerPhone)\b(?!\.slice\(-4\))/;

describe("voice-agent logs carry no customer name or phone", () => {
  it("POSITIVE CONTROL: the scanner sees a multi-line log call and its raw name or phone", () => {
    const calls = logCalls('log.info("captured", {\n  name: input.name,\n  size: input.tireSize,\n});');
    expect(calls).toHaveLength(1);
    expect(PII_FIELD.test(calls[0]!)).toBe(true);
    expect(PII_FIELD.test("log.warn(`failed for ${input.phone}`)")).toBe(true);
    // …and passes the shapes that carry no identifier.
    expect(PII_FIELD.test("log.info('x', { nameGiven: Boolean(input.name), phone: input.phone.slice(-4) })")).toBe(false);
  });

  it("server/routers/voiceAgent.ts", () => {
    const src = readFileSync(join(process.cwd(), "server/routers/voiceAgent.ts"), "utf-8");
    const calls = logCalls(src);
    expect(calls.length).toBeGreaterThan(10); // the scanner found the file's log calls, not nothing
    expect(calls.filter((c) => PII_FIELD.test(c))).toEqual([]);
  });
});
