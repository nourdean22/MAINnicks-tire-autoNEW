/**
 * Live-wiring contract for the recommendation-novelty shadow
 * (lib/services/chat/deferred-background-work.ts → recordRecommendationNoveltyShadow).
 *
 * The recorder is dependency-injected and unit-tested; what a unit test cannot
 * see is whether the ONE production call site binds the deps the way the
 * contract needs (review on PR #2485: "cover the live wiring rather than only
 * an injected loader"). runDeferredBackgroundWork is a ~700-line function with
 * no harness, so this asserts the call site's SOURCE, on comment-stripped text
 * — a doc comment that merely mentions the right names must not pass.
 *
 * Every pattern has a mutation canary: the same regex applied to a minimally
 * broken copy of the source must NOT match, or the assertion is decorative.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WIRING = fileURLToPath(new URL("../../../lib/services/chat/deferred-background-work.ts", import.meta.url));
const RECORDER = fileURLToPath(new URL("../../../lib/ai/chat/recommendation-novelty-shadow.ts", import.meta.url));

/** Block comments, then line comments not preceded by a quote or a colon (keeps `https://` inside strings). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const wiring = stripComments(readFileSync(WIRING, "utf8"));
const recorder = stripComments(readFileSync(RECORDER, "utf8"));

/** The novelty call expression, from its name to the closing of its deps object. */
function noveltyCall(src: string): string {
  const start = src.indexOf("recordRecommendationNoveltyShadow(");
  expect(start, "novelty call site not found in comment-stripped source").toBeGreaterThan(-1);
  // The call ends at the first `);` after the deps object's `logError:` line.
  const end = src.indexOf(");", src.indexOf("logError:", start));
  return src.slice(start, end);
}

const CREATED_ID_IN_ARGS = /recordRecommendationNoveltyShadow\(\s*\{[^}]*\bcreatedAssistantId\b[^}]*\}/;
const REAL_LOADER = /loadPriors:\s*loadPriorRecommendations\b/;
const STRICT_WRITER = /recordMetric:\s*recordMetricStrict\b/;
const DEDUPE_READ =
  /alreadyRecorded:\s*async\s*\(\s*(\w+)\s*\)\s*=>\s*\{[\s\S]*?prisma\.systemMetric\.findFirst\(\{[\s\S]*?metric:\s*RECOMMENDATION_NOVELTY_METRIC\b[\s\S]*?path:\s*\["traceId"\],\s*equals:\s*\1\b/;

describe("novelty shadow · live wiring in deferred-background-work.ts", () => {
  const call = noveltyCall(wiring);

  it("P1 · the persisted reply id reaches the recorder's args", () => {
    expect(call).toMatch(CREATED_ID_IN_ARGS);
    // canary: drop the id from the args object and the assertion must fail
    const broken = call.replace(/\bcreatedAssistantId,\s*/, "");
    expect(broken).not.toMatch(CREATED_ID_IN_ARGS);
  });

  it("P1 · the loader is the real loadPriorRecommendations (whose exclusion has its own test)", () => {
    expect(call).toMatch(REAL_LOADER);
  });

  it("P2 · the dedupe reader queries system_metrics by the novelty metric and the trace id", () => {
    expect(call).toMatch(DEDUPE_READ);
    // canary: a reader that forgets the metric filter would match any trace's row
    const broken = call.replace(/metric:\s*RECOMMENDATION_NOVELTY_METRIC,?/, "");
    expect(broken).not.toMatch(DEDUPE_READ);
  });

  it("P2 · the writer is the STRICT one; the fail-soft writer must not be wired", () => {
    expect(call).toMatch(STRICT_WRITER);
    const broken = call.replace(/recordMetric:\s*recordMetricStrict\b/, "recordMetric: recordMetric");
    expect(broken).not.toMatch(STRICT_WRITER);
  });

  it("P2 · the recorder's deps demand a MetricWriteReceipt, so tsc — not this test — is the enforcement", () => {
    // Promise<void> (the fail-soft recordMetric) is not assignable to
    // Promise<MetricWriteReceipt>; the wiring file is inside the app's
    // typecheck, so swapping the writer fails `pnpm typecheck`.
    expect(recorder).toMatch(/recordMetric:\s*\([\s\S]*?\)\s*=>\s*Promise<MetricWriteReceipt>/);
    expect(recorder).not.toMatch(/=>\s*Promise<unknown>/);
  });

  it("control: the comment stripper removes commentary, so a mention in a comment cannot pass", () => {
    const decoy = "/* recordMetric: recordMetricStrict */\n// loadPriors: loadPriorRecommendations\nconst x = 1;";
    const stripped = stripComments(decoy);
    expect(stripped).not.toMatch(STRICT_WRITER);
    expect(stripped).not.toMatch(REAL_LOADER);
    expect(stripped).toContain("const x = 1;");
  });
});
