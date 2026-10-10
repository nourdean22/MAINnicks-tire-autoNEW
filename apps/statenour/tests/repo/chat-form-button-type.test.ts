/**
 * Composer in-form buttons declare type="button".
 *
 * These components render inside the chat composer's `<form onSubmit>`. A
 * `<button>` with no `type` defaults to submit, so a pick or a remove click
 * also sent the draft (or ran the edit-resend delete). Behaviour is pinned in
 * tests/components/chat-in-form-buttons.test.tsx; this scan stops a new
 * typeless button landing in either file.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const FILES = ["components/chat/mention-dropdown.tsx", "components/chat/attachment-preview.tsx"];
const TYPE_BUTTON = /\stype="button"/;

/**
 * Opening `<button ...>` tags in JSX source. Scans to the tag's closing `>`
 * while skipping any `>` inside `{...}` expressions (`onClick={() => x()}`)
 * or quoted strings, so an attribute after an arrow function is still seen.
 */
function buttonOpenTags(source: string): string[] {
  const tags: string[] = [];
  const start = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(source))) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      } else if (c === ">" && depth === 0) {
        break;
      }
    }
    tags.push(source.slice(m.index, i + 1));
  }
  return tags;
}

const typeless = (source: string) => buttonOpenTags(source).filter((tag) => !TYPE_BUTTON.test(tag));

describe("chat composer in-form buttons declare their type", () => {
  it("canary: flags a typeless button, passes one typed after an arrow function", () => {
    expect(typeless('<button onClick={() => go()} className="a">x</button>')).toHaveLength(1);
    expect(typeless('<button\n  onClick={() => go()}\n  type="button"\n>x</button>')).toHaveLength(0);
    expect(typeless('<button type="submit">x</button>')).toHaveLength(1);
  });

  for (const file of FILES) {
    it(`every <button> in ${file} carries type="button"`, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(buttonOpenTags(source).length).toBeGreaterThan(0);
      expect(typeless(source)).toEqual([]);
    });
  }
});
