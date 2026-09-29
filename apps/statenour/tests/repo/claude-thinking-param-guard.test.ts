/**
 * tests/repo/claude-thinking-param-guard.test.ts · 2026-09-29
 *
 * The Telegram photo route sent `thinking: { type: "disabled" }` to whatever
 * model ANTHROPIC_MODEL named. Opus 5.5, Sonnet 5.5 and Fable reject that
 * with a 400, and the route's only failure trace was
 * "photo analysis: Anthropic HTTP 400", with no model and no reason, so a
 * model flip would silently degrade every photo to caption-only analysis.
 * The route is a 2,000-line webhook with no behavioural harness, so this
 * pins the two properties by source, the same way ai-cost-choke-point does:
 *   1. no raw Messages API caller hard-codes `disabled`; each asks
 *      claudeThinkingOffParams (behaviour in tests/ai/claude5-compat.test.ts),
 *   2. the failure log carries the model id, Anthropic's error type and a
 *      200-capped message, and none of the request's content.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const HARD_CODED_DISABLED = /thinking:\s*\{\s*type:\s*["']disabled["']\s*\}/;

describe("raw Messages API callers pick the thinking form per model", () => {
  it("positive control: the matcher catches the old literal", () => {
    expect(HARD_CODED_DISABLED.test('            thinking: { type: "disabled" },')).toBe(true);
    expect(HARD_CODED_DISABLED.test("    ...claudeThinkingOffParams(ANTHROPIC_VISION_MODEL),")).toBe(false);
  });

  it.each(["app/api/telegram/webhook/route.ts", "lib/ai/vision-input.ts"])("%s", (file) => {
    const src = read(file);
    expect(src).not.toMatch(HARD_CODED_DISABLED);
    expect(src).toMatch(/\.\.\.claudeThinkingOffParams\(/);
  });
});

describe("Telegram photo analysis: the failure log says why", () => {
  const route = read("app/api/telegram/webhook/route.ts");
  const start = route.indexOf("// Primary: Anthropic Claude (native vision support)");
  const end = route.indexOf("// Last resort: text-only analysis based on caption");
  const block = route.slice(start, end);

  it("the photo block is where the test thinks it is", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toMatch(/api\.anthropic\.com\/v1\/messages/);
  });

  it("the HTTP-error log carries model, status, error type and a 200-capped message", () => {
    const httpLog = block.slice(block.indexOf("Anthropic HTTP error"));
    const obj = httpLog.slice(0, httpLog.indexOf("});"));
    expect(obj).toMatch(/model: photoModel/);
    expect(obj).toMatch(/status: aRes\.status/);
    expect(obj).toMatch(/errorType:/);
    expect(obj).toMatch(/message: \(errBody\?\.error\?\.message \?\? ""\)\.slice\(0, 200\)/);
  });

  it("the thrown-error log carries model, error name and a 200-capped message", () => {
    const thrownLog = block.slice(block.indexOf("Anthropic request failed"));
    const obj = thrownLog.slice(0, thrownLog.indexOf("});"));
    expect(obj).toMatch(/model: photoModel/);
    expect(obj).toMatch(/errorType: err instanceof Error \? err\.name/);
    expect(obj).toMatch(/\.slice\(0, 200\)/);
  });

  it("neither log carries the key, the image or the caption", () => {
    const logs = block
      .split("console.warn(")
      .slice(1)
      .map((l) => l.slice(0, l.indexOf(");")));
    expect(logs).toHaveLength(2);
    for (const l of logs) {
      expect(l).not.toMatch(/anthropicKey|base64|caption|imageBuffer|imageUrl|botToken/);
    }
  });
});

describe("the AI-SDK lane wraps by capability, not by the frontier-only predicate (#2768)", () => {
  it("createAnthropicModel picks its middleware with claudeCompatMiddlewareFor", () => {
    const provider = read("lib/ai/provider.ts");
    const body = provider.slice(
      provider.indexOf("function createAnthropicModel("),
      provider.indexOf("function createOpenAIModel("),
    );
    expect(body.length).toBeGreaterThan(0);
    // isClaude5ThinkingModel excludes claude-sonnet-5 (the default), which
    // 400s on the classifier's temperature; the wrap must not key on it.
    expect(body).not.toMatch(/isClaude5ThinkingModel\(/);
    expect(body).toMatch(/claudeCompatMiddlewareFor\(modelId\)/);
    expect(body).toMatch(/wrapLanguageModel\(\{ model, middleware: compat \}\)/);
  });
});
