/**
 * 2026-10-21 · Nour: the receptionist sounds like a robot. Short turns, one idea
 * per turn, no read-out policy blocks, every call steered to "come down now".
 * Pins the cadence rules, the price-question flow, the goodbyes, the no-dash
 * spoken lines, and the part-2 cleanups (no phone capture before a transfer).
 */
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT, FIRST_MESSAGE, VAPI_TOOLS } from "./services/vapi";
import { sliceBlock } from "./testUtils/sourceBlock";

const P = ASSISTANT_SYSTEM_PROMPT;
const section = (start: string, end: string | string[]) => sliceBlock(P, start, end, { label: "ASSISTANT_SYSTEM_PROMPT" });
const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const quoted = (s: string) => [...s.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]);
const DASH = /[–—]/;

describe("how the receptionist talks", () => {
  it("HOW YOU TALK sets the 12-word turn and bans the filler and praise reflexes", () => {
    const talk = section("# HOW YOU TALK", "\n# ");
    expect(talk).toContain("Aim for 12 spoken words or fewer per turn, two short sentences at most.");
    expect(talk).toContain("Never read a list or a policy out loud.");
    for (const w of ["Here's how it works", "Here's the thing", "Great!", "Perfect!", "Awesome!"]) expect(talk).toContain(w);
    expect(talk).toContain("no dashes in what you say");
  });

  it("'Here's how it works' appears only inside the ban, never as something to say", () => {
    expect(P.split("Here's how it works").length - 1).toBe(1);
    expect(JSON.stringify(VAPI_TOOLS)).not.toContain("Here's how it works");
  });

  it("every 'Sound like' example is 12 words or fewer", () => {
    const examples = quoted(section("Sound like:", "\nGentle"));
    expect(examples.length).toBeGreaterThanOrEqual(3);
    for (const e of examples) expect(words(e), e).toBeLessThanOrEqual(12);
  });

  it("no double-quoted line in the prompt, and not FIRST_MESSAGE, carries an em or en dash", () => {
    const dashed = quoted(P).filter((q) => DASH.test(q));
    expect(dashed).toEqual([]);
    expect(FIRST_MESSAGE).toBe("Nick's Tire and Auto, what can I do for you?");
  });

  it("the 'you there?' reassurance is two short sentences", () => {
    expect(P).toContain('"Yep, I\'m here. What can I do for you?"');
  });
});

describe("the job of every call: get them to come down", () => {
  it("has its own section that forbids invented scarcity", () => {
    const job = section("# THE JOB OF EVERY CALL", "\n# ");
    expect(job).toContain("get them to come down");
    expect(job).toMatch(/only/);
    expect(job).toMatch(/spots/);
    expect(job).toMatch(/wait times/);
    expect(job).toContain("Can you swing by today?");
  });

  it("a price question is two short turns ending in the come-down ask", () => {
    const price = section("PRICE QUESTION (any", "\n\n");
    expect(price).toContain("first come, first served");
    expect(price.toLowerCase()).toContain("swing by today");
    for (const q of quoted(price)) expect(words(q), q).toBeLessThanOrEqual(12);
  });

  it("FLOW 1 and FLOW 2 never ask for a number; the prompt says caller ID has it", () => {
    for (const flow of [section("## FLOW 1", "## FLOW 2"), section("## FLOW 2", "## FLOW 3")]) {
      expect(flow).not.toMatch(/best number/i);
      expect(flow).not.toMatch(/name and (best )?number/i);
    }
    expect(P).toMatch(/caller ID (gives|has) the(ir)? number/);
  });
});

describe("goodbyes survive a caller who is already hanging up", () => {
  it("FLOW 4 goodbyes are 6 words or fewer and end with a period", () => {
    const goodbyes = quoted(section("Goodbyes:", "\n"));
    expect(goodbyes.length).toBeGreaterThanOrEqual(2);
    for (const g of goodbyes) {
      expect(words(g), g).toBeLessThanOrEqual(6);
      expect(g.endsWith("."), g).toBe(true);
    }
  });

  it("an 'I'll call back' caller gets one short hook and a short goodbye", () => {
    const cb = section("## \"I'LL CALL BACK\"", "\n\n");
    const lines = quoted(cb);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(words(l), l).toBeLessThanOrEqual(10);
    const bye = lines.at(-1)!;
    expect(words(bye)).toBeLessThanOrEqual(6);
    expect(bye.endsWith(".")).toBe(true);
  });
});

describe("no phone capture before a tire transfer (part 2 cleanup)", () => {
  it("the transferCall tool line agrees with NO QUESTIONS BEFORE A TRANSFER", () => {
    const line = section("· transferCall", "\n");
    expect(line).not.toMatch(/phone-capture/);
    expect(line).toContain("no questions");
  });

  it("NO EMPTY TIRE TRANSFERS and the odd-size line grab size, not a phone", () => {
    const empty = section("NO EMPTY TIRE TRANSFERS", "\n");
    expect(empty).toContain("size + new/used + quantity");
    expect(empty).not.toMatch(/\bphone\b/);
    const odd = section("- ODD/uncommon", "\n");
    expect(odd).not.toMatch(/\bphone\b/);
    const core = P.split("\n# CORE\n")[1];
    expect(core, "the # CORE section").toBeDefined();
    expect(core).not.toMatch(/quantity\/phone/);
  });

  it("tireInquiry no longer requires a name or a phone", () => {
    const ti = (VAPI_TOOLS as unknown as Array<{ function?: { name?: string; parameters?: { required?: string[] } } }>).find((t) => t.function?.name === "tireInquiry")!;
    expect(ti.function!.parameters!.required).toEqual([]);
    expect(section("· tireInquiry", "\n")).not.toContain("AND phone");
  });
});

describe("the robot answer and shopInfo wording", () => {
  it("answers the robot question in a short line with no schedule promise", () => {
    expect(P).toContain('"I\'m Nick\'s AI receptionist. Want a real person? Just say so."');
    expect(P).not.toContain("schedule drop-offs");
  });

  it("shopInfo and its tool text say payment programs, not financing", () => {
    const tools = JSON.stringify(VAPI_TOOLS);
    expect(section("· shopInfo", "\n")).toContain("payment programs");
    expect(tools).not.toMatch(/financing/i);
  });
});
