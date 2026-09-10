/**
 * tests/ai/tool-result-fencing-gate.test.ts · 2026-09-10
 *
 * Pins one real defect and its fix.
 *
 * THE DEFECT. The NotebookLM tool in lib/ai/tools/system.ts returned raw
 * text from an external MCP server while every sibling external tool in
 * the same file fenced its output. Two consequences, and the second is
 * the serious one:
 *
 *   1. unfenced third-party text reached the model directly;
 *   2. `fenceContent` is what calls
 *      `updateTurnContext({ untrustedInput: true })`
 *      (lib/ai/tool-result-fencing.ts:91). Without it the TURN was never
 *      marked untrusted — so the U4 sink policy (tool-policy.ts:183:
 *      external side effect during an untrusted turn -> require_owner)
 *      never engaged for content from that server. An injected
 *      "send this to X" arriving via NotebookLM faced one fewer
 *      deterministic gate than the identical string arriving via web
 *      search.
 *
 * WHY THIS IS NARROW, AND WHY THAT WAS THE RIGHT CALL.
 *
 * The first three drafts of this file were a general static gate:
 * enumerate every external provider across lib/ai/tools/, parse each
 * tool block, assert each fences. Every draft failed on its OWN parser
 * rather than on the code —
 *
 *   - draft 1 matched provider names inside comments, reporting two
 *     clean tools as unfenced;
 *   - draft 2 stripped block comments without preserving newlines,
 *     merging lines and mis-attributing bodies for 8 of 10 cases;
 *   - draft 3 keyed on tool-registry names (`searchWebVerified:`) rather
 *     than provider calls, so it matched nothing at all — caught only
 *     because its positive control asserted the scan was non-empty.
 *
 * A gate whose failures are its own parser is worse than no gate: it
 * trains the reader to ignore it, and a false positive on this surface
 * would push someone to "fix" a tool that was already correct. The
 * general version needs a real AST pass, not a regex. Until someone
 * writes that, this file protects the fix that actually shipped.
 *
 * The class-level guard that DOES work today is the `untrustedInput`
 * behaviour itself, covered in tests/ai/brain-context-fencing.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SYSTEM_TOOLS = readFileSync(join(APP_ROOT, "lib/ai/tools/system.ts"), "utf8");

describe("the NotebookLM MCP result is fenced", () => {
  // POSITIVE CONTROL. If the file stops containing the call at all, every
  // assertion below passes vacuously and this test is decoration.
  it("POSITIVE CONTROL · the provider is still called from this file", () => {
    expect(SYSTEM_TOOLS).toMatch(/notebookLMProvider\.call\(/);
  });

  it("fences the result before returning it", () => {
    const callIdx = SYSTEM_TOOLS.indexOf("notebookLMProvider.call(");
    // The return follows the call closely; 60 lines is generous and
    // deliberately does not span to the next tool.
    const after = SYSTEM_TOOLS.slice(callIdx).split("\n").slice(0, 60).join("\n");
    expect(
      /fenceContent\(\s*"notebookLM"/.test(after),
      "The NotebookLM tool returns text from an external MCP server. It must call " +
        'fenceContent("notebookLM", "external_doc", ...) — not only so the model sees the ' +
        "content as untrusted, but because fenceContent is what marks the TURN " +
        "untrustedInput, which is what lets the U4 sink policy block an external side " +
        "effect on that turn.",
    ).toBe(true);
  });

  it("fences with an external source class, not a first-party one", () => {
    const callIdx = SYSTEM_TOOLS.indexOf("notebookLMProvider.call(");
    const after = SYSTEM_TOOLS.slice(callIdx).split("\n").slice(0, 60).join("\n");
    // `external_doc` / `external_web` are the classes that taint the turn.
    expect(after).toMatch(/"external_doc"|"external_web"/);
  });

  it("slices before fencing, so the fence markers cannot be truncated away", () => {
    const callIdx = SYSTEM_TOOLS.indexOf("notebookLMProvider.call(");
    const after = SYSTEM_TOOLS.slice(callIdx).split("\n").slice(0, 60).join("\n");
    const sliceIdx = after.indexOf(".slice(0, 4000)");
    const fenceIdx = after.indexOf("fenceContent(");
    expect(sliceIdx).toBeGreaterThan(-1);
    // Truncating a fenced string could cut the closing tag off and leave
    // the model reading an unterminated fence.
    expect(sliceIdx).toBeLessThan(fenceIdx);
  });
});
