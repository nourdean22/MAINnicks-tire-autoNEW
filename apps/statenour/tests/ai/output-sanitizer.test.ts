/**
 * Output sanitizer regression corpus · v10.0.335 · Phase 1 of glitch
 * taxonomy hardening (Category 2 · model output leakage).
 *
 * Each entry locks in a known leakage pattern so it can NEVER recur.
 * When a new leakage pattern is found in the wild, ADD it here as a
 * failing test, fix the sanitizer, then ship — the regression armor
 * is the test, not the fix.
 *
 * Pattern source attribution:
 *   · turn-10 · the v10.0.332 XML pseudo-template fix · cmou6xugm chat
 *   · venice-glm · think-tag emission seen in production logs
 *   · early Anthropic · "As an AI assistant" disclaimer leakage
 *   · OpenAI legacy · "Certainly!" / "I'd be happy to" filler
 */

import { describe, expect, it } from "vitest";
import { sanitizeResponse, hasFiller } from "@/lib/ai/output-sanitizer";

describe("output-sanitizer · XML pseudo-template stripping (Cat 2)", () => {
  it("strips markdown-fenced <request><instruction> wrapper, preserves inner text", () => {
    const input = [
      "```xml",
      "<request>",
      "<instruction>Generate an infographic-style illustration with tire icons</instruction>",
      "</request>",
      "```",
    ].join("\n");
    const out = sanitizeResponse(input);
    expect(out.cleaned).toBe(
      "Generate an infographic-style illustration with tire icons",
    );
    expect(out.trimmed).toBeGreaterThan(0);
  });

  it("strips bare <request><instruction> wrapper without fence", () => {
    const input = `<request>\n<instruction>Make a clean storefront photo</instruction>\n</request>`;
    const out = sanitizeResponse(input);
    expect(out.cleaned).toBe("Make a clean storefront photo");
  });

  it("strips standalone <instruction> tag", () => {
    const input = `<instruction>Do the thing</instruction>`;
    const out = sanitizeResponse(input);
    expect(out.cleaned).toBe("Do the thing");
  });

  it("strips multi-line <instruction> contents preserving line breaks inside", () => {
    const input = [
      "<request>",
      "<instruction>",
      "Step 1: Sketch the layout.",
      "Step 2: Add the brand colors.",
      "</instruction>",
      "</request>",
    ].join("\n");
    const out = sanitizeResponse(input);
    expect(out.cleaned).toContain("Step 1: Sketch the layout.");
    expect(out.cleaned).toContain("Step 2: Add the brand colors.");
    expect(out.cleaned).not.toContain("<request>");
    expect(out.cleaned).not.toContain("<instruction>");
  });

  it("does NOT strip legitimate code blocks containing similar-looking tags", () => {
    // Code blocks teaching about XML SHOULD survive — only the literal
    // template-leakage pattern with <request><instruction> nesting fires.
    const input = [
      "Here's how to write XML in your config:",
      "",
      "```xml",
      "<config>",
      "  <name>example</name>",
      "</config>",
      "```",
    ].join("\n");
    const out = sanitizeResponse(input);
    expect(out.cleaned).toContain("<config>");
    expect(out.cleaned).toContain("<name>example</name>");
  });

  it("handles the exact turn-10 production leak (verbatim)", () => {
    // Real assistant output from cmou6xugm conversation, turn 10.
    const input = [
      "```xml",
      "<request>",
      "<instruction>Generate an infographic-style illustration featuring various automotive components arranged artistically. Include icons of popular tire brands, vehicle types, and essential tools like jack stands, lug wrenches, and air compressors. Add colorful charts displaying statistics such as fuel efficiency, performance metrics, and maintenance schedules.</instruction>",
      "</request>",
      "```",
    ].join("\n");
    const out = sanitizeResponse(input);
    expect(out.cleaned).toContain("Generate an infographic-style illustration");
    expect(out.cleaned).toContain("jack stands, lug wrenches");
    expect(out.cleaned).not.toContain("<request>");
    expect(out.cleaned).not.toContain("<instruction>");
    expect(out.cleaned).not.toContain("```xml");
  });
});

describe("output-sanitizer · leading filler stripping (Cat 2)", () => {
  it("strips 'Certainly!' lead", () => {
    expect(sanitizeResponse("Certainly! Here is the answer.").cleaned).toBe(
      "Here is the answer.",
    );
  });

  it("strips 'Of course!' lead", () => {
    expect(sanitizeResponse("Of course! The price is $50.").cleaned).toBe(
      "The price is $50.",
    );
  });

  it("strips 'Absolutely!' lead", () => {
    expect(sanitizeResponse("Absolutely. Let me explain.").cleaned).toBe(
      "Let me explain.",
    );
  });

  it("strips 'Sure!' lead", () => {
    expect(sanitizeResponse("Sure! Tires arrive Friday.").cleaned).toBe(
      "Tires arrive Friday.",
    );
  });

  it("strips 'Sure thing!' lead", () => {
    expect(sanitizeResponse("Sure thing! Booked for 2pm.").cleaned).toBe(
      "Booked for 2pm.",
    );
  });

  it("strips 'Great question' lead", () => {
    expect(
      sanitizeResponse("Great question. Tire pressure should be 32psi.").cleaned,
    ).toBe("Tire pressure should be 32psi.");
  });

  it("strips 'Happy to help' lead", () => {
    expect(sanitizeResponse("Happy to help. Brakes need fluid.").cleaned).toBe(
      "Brakes need fluid.",
    );
  });

  it("strips 'I'd be happy to' lead", () => {
    expect(
      sanitizeResponse("I'd be happy to walk you through it. Step 1: park.").cleaned,
    ).toBe("Step 1: park.");
  });

  it("strips 'As an AI' disclaimer lead", () => {
    expect(
      sanitizeResponse("As an AI, I cannot do that. But here's an idea.").cleaned,
    ).toBe("But here's an idea.");
  });

  it("strips 'As a language model' lead + the entire disclaimer sentence (greedy by design)", () => {
    // The lead-filler pattern intentionally consumes up to the next period
    // boundary because "As a language model X. Real content Y" almost always
    // means X is meta/disclaimer and Y is the actual answer. Tests this
    // intentional behavior.
    expect(
      sanitizeResponse(
        "As a language model, I cannot diagnose vehicles. But the brakes need fluid.",
      ).cleaned,
    ).toBe("But the brakes need fluid.");
  });

  it("strips multiple stacked leads (walks the list)", () => {
    expect(
      sanitizeResponse("Sure! Of course! Absolutely. Tires fit.").cleaned,
    ).toBe("Tires fit.");
  });
});

describe("output-sanitizer · anywhere filler stripping (Cat 2)", () => {
  it("strips 'I hope this helps' from anywhere", () => {
    expect(
      sanitizeResponse("Tires fit. I hope this helps. Want a quote?").cleaned,
    ).toBe("Tires fit. Want a quote?");
  });

  it("strips 'feel free to ask' tail", () => {
    expect(
      sanitizeResponse(
        "Brakes are $200. Feel free to ask if anything's unclear.",
      ).cleaned,
    ).toBe("Brakes are $200.");
  });

  it("strips 'I'm here to help' interjection", () => {
    expect(
      sanitizeResponse("Tires arrive Tuesday. I'm here to help. Anything else?").cleaned,
    ).toBe("Tires arrive Tuesday. Anything else?");
  });

  it("strips 'as an AI' mid-sentence disclaimer", () => {
    expect(
      sanitizeResponse("Tire pressure, as an AI, should be 32psi.").cleaned,
    ).toBe("Tire pressure, should be 32psi.");
  });

  it("strips 'It seems like' hedging", () => {
    expect(
      sanitizeResponse("It seems like, the tire is flat.").cleaned,
    ).toBe("the tire is flat.");
  });

  it("strips 'I think' hedge", () => {
    expect(
      sanitizeResponse("I think the brakes need replacing.").cleaned,
    ).toBe("the brakes need replacing.");
  });

  it("strips 'based on my analysis' filler", () => {
    expect(
      sanitizeResponse("Based on my analysis, tires fit.").cleaned,
    ).toBe("tires fit.");
  });

  it("strips 'in conclusion' opener", () => {
    expect(
      sanitizeResponse("Brake pads cost $50.\nIn conclusion, the total is $200.")
        .cleaned,
    ).toContain("the total is $200.");
  });

  it("strips 'in this response' self-reference", () => {
    expect(
      sanitizeResponse("In this response, I'll cover three things.").cleaned,
    ).toBe("I'll cover three things.");
  });
});

describe("output-sanitizer · whitespace normalization (Cat 2)", () => {
  it("collapses 3+ blank lines to 2", () => {
    const input = "Line 1\n\n\n\nLine 2";
    expect(sanitizeResponse(input).cleaned).toBe("Line 1\n\nLine 2");
  });

  it("strips trailing whitespace per line", () => {
    const input = "Line 1   \nLine 2  ";
    expect(sanitizeResponse(input).cleaned).toBe("Line 1\nLine 2");
  });

  it("fixes 'word .' to 'word.'", () => {
    expect(sanitizeResponse("Brake pads cost $50 .").cleaned).toBe(
      "Brake pads cost $50.",
    );
  });

  it("trims leading + trailing whitespace overall", () => {
    expect(sanitizeResponse("  Tires fit.  \n\n").cleaned).toBe("Tires fit.");
  });
});

describe("output-sanitizer · pass-through cases (no false positives)", () => {
  it("leaves clean Nick-voice text unchanged", () => {
    const input =
      "Tire size 245/40R18. In stock. Pickup Friday after 2pm. Cash or card.";
    expect(sanitizeResponse(input).cleaned).toBe(input);
  });

  it("leaves technical XML in code blocks unchanged", () => {
    const input = "Pom file: `<dependency>...</dependency>` works fine.";
    expect(sanitizeResponse(input).cleaned).toContain("<dependency>");
  });

  it("preserves Nour-style staccato sentence rhythm", () => {
    const input = "Booked. Confirmed. Two weeks out. Mention the email.";
    expect(sanitizeResponse(input).cleaned).toBe(input);
  });

  it("preserves currency + dates", () => {
    const input = "$245.99 due 2026-05-12. Pay before noon.";
    expect(sanitizeResponse(input).cleaned).toBe(input);
  });

  it("preserves emojis used intentionally", () => {
    const input = "Tires ready 🔧 · pickup window 9-5";
    expect(sanitizeResponse(input).cleaned).toBe(input);
  });

  it("returns empty + 0 trimmed for empty input", () => {
    const out = sanitizeResponse("");
    expect(out.cleaned).toBe("");
    expect(out.trimmed).toBe(0);
  });

  it("handles non-string input defensively", () => {
    const out = sanitizeResponse(undefined as unknown as string);
    expect(out.cleaned).toBe("");
    expect(out.trimmed).toBe(0);
  });
});

describe("output-sanitizer · hasFiller detection", () => {
  it("flags leading filler", () => {
    expect(hasFiller("Certainly! Here is...")).toBe(true);
  });

  it("flags anywhere filler", () => {
    expect(hasFiller("Tires fit. I hope this helps.")).toBe(true);
  });

  it("returns false for clean text", () => {
    expect(hasFiller("Tires arrive Tuesday.")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(hasFiller("")).toBe(false);
  });
});

describe("output-sanitizer · combined pattern stress tests", () => {
  it("strips XML wrapper + leading filler + anywhere filler in one pass", () => {
    const input = [
      "```xml",
      "<request>",
      "<instruction>Sure! Make me a poster. I hope this helps.</instruction>",
      "</request>",
      "```",
    ].join("\n");
    const out = sanitizeResponse(input);
    // After: XML stripped → "Sure! Make me a poster. I hope this helps."
    // After: leading "Sure!" stripped → "Make me a poster. I hope this helps."
    // After: anywhere "I hope this helps." stripped → "Make me a poster."
    expect(out.cleaned).toBe("Make me a poster.");
  });

  it("compounds leading filler chain · ends at disclaimer-sentence boundary", () => {
    // "Sure!" → "Of course!" → "As an AI, ..." → strips up to next period.
    // With "tires fit." as the disclaimer-sentence content, the whole
    // string gets consumed (intentional · operator should write content
    // after a real disclaimer-end). Tested with multi-sentence input below.
    expect(
      sanitizeResponse(
        "Sure! Of course! As an AI, I'm a language model. Tires fit size 245.",
      ).cleaned,
    ).toBe("Tires fit size 245.");
  });
});
