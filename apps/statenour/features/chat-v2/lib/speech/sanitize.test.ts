import { describe, expect, it } from "vitest";
import { sanitizeForSpeech } from "./sanitize";

describe("sanitizeForSpeech", () => {
  it("strips emphasis markers but keeps the words", () => {
    expect(sanitizeForSpeech("**Threat Level** is *elevated* and __rising__ ~~fast~~")).toBe(
      "Threat Level is elevated and rising fast",
    );
  });

  it("strips heading syntax", () => {
    expect(sanitizeForSpeech("### Recommendation\nCall them back")).toBe("Recommendation Call them back");
  });

  it("replaces a fenced code block with an announcement", () => {
    const out = sanitizeForSpeech("Run this:\n```bash\nnpm install --save-dev vitest\n```\nThen retry.");
    expect(out).toBe("Run this: Code block omitted. Then retry.");
    expect(out).not.toContain("npm install");
  });

  it("replaces an UNCLOSED fence (flush tail) with the announcement", () => {
    const out = sanitizeForSpeech("```js\nlet x = 1;");
    expect(out).toBe("Code block omitted.");
  });

  it("keeps inline code content — ordinary words are speakable", () => {
    expect(sanitizeForSpeech("run `pnpm verify` before pushing")).toBe("run pnpm verify before pushing");
  });

  it("speaks link labels and drops destinations and bare URLs", () => {
    expect(sanitizeForSpeech("See [the dashboard](https://x.com/d?q=1) or https://raw.example.com/x.html today")).toBe(
      "See the dashboard or today",
    );
  });

  it("reads table rows as cells and drops separator rows", () => {
    const out = sanitizeForSpeech("| Name | Owed |\n|---|---|\n| Smith | $400 |");
    expect(out).toBe("Name, Owed Smith, $400");
  });

  it("strips bullets, keeps ordered-list numbers, drops hrules and blockquote markers", () => {
    const out = sanitizeForSpeech("- first thing\n1. second thing\n---\n> quoted line");
    expect(out).toBe("first thing 1. second thing quoted line");
  });

  it("drops footnote and citation artifacts", () => {
    expect(sanitizeForSpeech("Revenue rose[^1] sharply【3:2†report】 today")).toBe("Revenue rose sharply today");
  });

  it("strips HTML tags and decodes common entities", () => {
    expect(sanitizeForSpeech("<div>parts &amp; labor</div>")).toBe("parts and labor");
  });

  it("returns empty string when nothing speakable remains (caller skips)", () => {
    expect(sanitizeForSpeech("---")).toBe("");
    expect(sanitizeForSpeech("https://only-a-url.example.com/x")).toBe("");
    // positive control — real prose survives
    expect(sanitizeForSpeech("plain sentence")).toBe("plain sentence");
  });

  it("preserves decimals, money, and ordinary punctuation", () => {
    expect(sanitizeForSpeech("Margin is 7.4% on $1,390.50 — act today.")).toBe(
      "Margin is 7.4% on $1,390.50 — act today.",
    );
  });
});
