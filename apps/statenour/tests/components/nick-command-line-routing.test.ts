/**
 * NickCommandLine slash routing — the parse that replaced six mode buttons.
 * Every token must map to the EXACT prefix the old CognitivePartner mode
 * applied (engine unification depends on the prefixes being stable), and
 * non-commands must fall through to plain ask untouched.
 */
import { describe, it, expect } from "vitest";

import { parseSlash } from "@/components/home/nick-command-line";

describe("parseSlash", () => {
  it("plain text is a plain ask — no command, text untouched", () => {
    const r = parseSlash("what should I focus on?");
    expect(r.command).toBeNull();
    expect(r.text).toBe("what should I focus on?");
  });

  it("/task carries the old Create Task prefix", () => {
    const r = parseSlash("/task call the vendor about rims");
    expect(r.command?.key).toBe("task");
    expect(r.command?.prefix).toBe("Create a task: ");
    expect(r.text).toBe("call the vendor about rims");
  });

  it("/capture carries the old Capture prefix", () => {
    const r = parseSlash("/capture idea: weekly review template");
    expect(r.command?.prefix).toBe("Capture this into my brain: ");
    expect(r.text).toBe("idea: weekly review template");
  });

  it("/review carries the old Review prefix", () => {
    expect(parseSlash("/review this plan").command?.prefix).toBe(
      "Audit this and tell me the strongest move: ",
    );
  });

  it("/execute carries the old Execute prefix", () => {
    expect(parseSlash("/execute sync leads").command?.prefix).toBe("Execute this: ");
  });

  it("/search routes instead of chatting", () => {
    const r = parseSlash("/search gym commitments");
    expect(r.command?.routes).toBe(true);
    expect(r.text).toBe("gym commitments");
  });

  it("an unknown slash token is NOT swallowed — it goes to Nick verbatim", () => {
    const r = parseSlash("/wat is this");
    expect(r.command).toBeNull();
    expect(r.text).toBe("/wat is this");
  });

  it("a bare command with no argument yields empty text — submit no-ops on empty text, so no naked prefix ever reaches the pipeline", () => {
    expect(parseSlash("/task").text).toBe("");
    expect(parseSlash("/search").command?.routes).toBe(true);
    expect(parseSlash("/search").text).toBe("");
  });

  it("token match is case-insensitive; argument case is preserved", () => {
    const r = parseSlash("/Task Call Dania");
    expect(r.command?.key).toBe("task");
    expect(r.text).toBe("Call Dania");
  });
});
