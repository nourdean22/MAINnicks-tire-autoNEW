/**
 * useChatStall — the 90s stall abort is the ONLY bound on a chat turn in this
 * app (maxDuration is a Vercel route-segment config and is inert on Railway),
 * so if its handler declines to fire, a dead turn spins forever with no error.
 *
 * That is exactly what shipped: the handler reconstructed the last user
 * message's text and returned early when it came back empty — BEFORE stop()
 * and setError() — even though the reconstructed text was never used for
 * anything. Operator-reported 2026-08-09: long messages "won't respond or get
 * stuck". Removed in the same commit as this test.
 *
 * WHY A SOURCE ASSERTION. statenour's vitest environment is "node"
 * (vitest.config.ts:9) with no jsdom, so a hook whose behavior lives in a
 * useEffect cannot be driven — the sibling use-stall-detection.test.tsx uses
 * renderToStaticMarkup, which never runs effects and can therefore only assert
 * the synchronous initial return. Pinning the source is the strongest check
 * available here, and it pins the MECHANISM (no early return before the two
 * calls) rather than merely exercising the module.
 *
 * COMMENT-STRIPPED ON PURPose. This repo has been burned by a file-text
 * negative that matched its own explanatory comment
 * (apps/nickstire — "a file-text negative matches its own comment"), and the
 * fix comment in use-chat-stall.ts deliberately QUOTES the deleted guard so
 * the next reader understands it. Asserting over raw text would therefore
 * pass or fail on prose. Every check below runs on code with comments removed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(process.cwd(), "hooks/chat/use-chat-stall.ts"), "utf8");

/** Strip block and line comments so assertions read CODE, never prose. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The body of the stallHandlerRef.current assignment, comments removed. */
function stallHandlerBody(): string {
  const code = codeOnly(SRC);
  const start = code.indexOf("stallHandlerRef.current =");
  expect(start, "stallHandlerRef.current assignment not found — hook was restructured").toBeGreaterThan(-1);
  const open = code.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced braces in stall handler");
}

describe("useChatStall — the stall handler must always fire", () => {
  it("stops the stream and surfaces an error", () => {
    const body = stallHandlerBody();
    expect(body).toMatch(/\bstop\(\)/);
    expect(body).toMatch(/\bsetError\(/);
  });

  it("has NO early return before stop() and setError() — a stall is a stall regardless of what the user typed", () => {
    const body = stallHandlerBody();
    const stopAt = body.search(/\bstop\(\)/);
    const returnAt = body.search(/\breturn\b/);
    // A `return` is only acceptable if it comes after the two calls (or not at all).
    if (returnAt !== -1) {
      expect(
        returnAt,
        "an early `return` sits before stop() in the stall handler — this is the 2026-08-09 " +
          "silent-hang bug: the 90s abort fires, does nothing, and the turn spins forever",
      ).toBeGreaterThan(stopAt);
    }
  });

  it("does not gate the handler on reconstructing the user's message text", () => {
    const body = stallHandlerBody();
    // The removed guard derived text from the last user message's parts and
    // used it ONLY as a condition. Re-introducing any read of `messages`
    // inside the handler is the shape that regressed.
    expect(
      body,
      "the stall handler reads `messages` again — that is how the removed guard was built; " +
        "the handler needs only stop + setError",
    ).not.toMatch(/\bmessages\b/);
  });

  it("keeps the abort threshold at 180s and the warn threshold at 30s", () => {
    const code = codeOnly(SRC);
    // Pins the documented tuning. If these move, the change should be
    // deliberate — the server side has no deadline of its own, so this IS the
    // app's only timeout. (History: 6s/22s → 90s after the v11.1 image-gen
    // incident, where a 22s abort auto-killed slow image generations and
    // immediately retried, spawning a duplicate-image storm.)
    //
    // 2026-08-16 · 90s → 180s. This pin did its job: it failed CI on the change
    // and forced the rationale to be written down rather than assumed.
    //
    // The abort is COUPLED to prepare-tools' maxOutputTokens, which was raised
    // the same day (2000 → 6000 standard, 4500 → 10000 deep) to stop a THINKING
    // model being truncated mid-answer. Measured on the live pin
    // (scripts/probe-empty-responses.ts, 12 calls): 13.2 ms/token mean, 16.1
    // worst. Projected wall time — and remember this clock starts at SUBMIT, so
    // server pre-stream time counts against it:
    //
    //     2000 tok (old)      26s mean /  32s worst   safe under 90s
    //     3300 tok (typical)  44s mean /  53s worst   safe under 90s
    //     6000 tok (standard) 79s mean /  97s worst   EXCEEDED 90s
    //    10000 tok (deep)    132s mean / 161s worst   FAR EXCEEDED 90s
    //
    // ...and those are bare-prompt figures: no ~40k system prompt, no tool
    // round-trips. Left at 90s, the budget raise would have converted truncated
    // answers into aborted ones — the same user-visible complaint with a harder
    // cause to find, since an abort and a completion are indistinguishable to
    // onFinish. Known residual: a deep turn genuinely consuming all 10000
    // tokens can still reach 180s.
    expect(code).toMatch(/warningMs\s*=\s*30_000/);
    expect(code).toMatch(/abortMs\s*=\s*180_000/);
  });
});
