/**
 * v10.0.231 · pin the looksLikeBrainDump gate · this is the heuristic
 * that prevents chat questions from ending up as phantom INBOX tasks.
 * If the gate regresses, every long chat message starts spawning tasks
 * again. The contract has to stay tight.
 */
import { describe, it, expect } from "vitest";
import { looksLikeBrainDump } from "@/lib/services/chat/persist-assistant-turn";

describe("looksLikeBrainDump · questions (must NOT ingest)", () => {
  it("rejects messages ending in `?`", () => {
    expect(looksLikeBrainDump("How do I configure Stripe webhooks?")).toBe(false);
    expect(looksLikeBrainDump("Is the deploy live yet?")).toBe(false);
  });

  it("rejects 5W1H leading words", () => {
    expect(looksLikeBrainDump("What is the best framework for X")).toBe(false);
    expect(looksLikeBrainDump("Who handles billing on the team")).toBe(false);
    expect(looksLikeBrainDump("When did we last review the pricing")).toBe(false);
    expect(looksLikeBrainDump("Where does the API key get stored")).toBe(false);
    expect(looksLikeBrainDump("Why is the build slow")).toBe(false);
    expect(looksLikeBrainDump("How does authentication work")).toBe(false);
    expect(looksLikeBrainDump("Which provider is fastest")).toBe(false);
  });

  it("rejects modal-verb leading words (can/could/would/should)", () => {
    expect(looksLikeBrainDump("Can you set up the database for me")).toBe(false);
    expect(looksLikeBrainDump("Could we move the deploy to friday")).toBe(false);
    expect(looksLikeBrainDump("Would the system handle 10x load")).toBe(false);
    expect(looksLikeBrainDump("Should I refactor this module")).toBe(false);
    expect(looksLikeBrainDump("Will the cron run tonight")).toBe(false);
  });

  it("rejects copula questions (is/are/was/were)", () => {
    expect(looksLikeBrainDump("Is the API rate limited per user")).toBe(false);
    expect(looksLikeBrainDump("Are we using prisma 6")).toBe(false);
    expect(looksLikeBrainDump("Was the last deploy clean")).toBe(false);
  });

  it("rejects do/does/did", () => {
    expect(looksLikeBrainDump("Do we have monitoring on the cron jobs")).toBe(false);
    expect(looksLikeBrainDump("Does the tracker cap traffic")).toBe(false);
    expect(looksLikeBrainDump("Did the migration finish")).toBe(false);
  });

  it("rejects command-shaped messages to Nick", () => {
    expect(looksLikeBrainDump("Show me last week's revenue")).toBe(false);
    expect(looksLikeBrainDump("Find the customer with the highest LTV")).toBe(false);
    expect(looksLikeBrainDump("List all active missions")).toBe(false);
    expect(looksLikeBrainDump("Look up our supplier prices")).toBe(false);
    expect(looksLikeBrainDump("Check the deploy status")).toBe(false);
    expect(looksLikeBrainDump("Generate three options for the headline")).toBe(false);
    expect(looksLikeBrainDump("Write a short summary of yesterday")).toBe(false);
    expect(looksLikeBrainDump("Summarize the team meeting")).toBe(false);
  });

  it("handles case insensitivity", () => {
    expect(looksLikeBrainDump("HOW does this work")).toBe(false);
    expect(looksLikeBrainDump("hOw does this work")).toBe(false);
  });
});

describe("looksLikeBrainDump · brain dumps (must ingest)", () => {
  it("accepts declarative thoughts", () => {
    expect(looksLikeBrainDump(
      "Just realized that the customer churn pattern correlates with the second touchpoint quality, not the price. Need to look into our follow-up cadence.",
    )).toBe(true);
  });

  it("accepts I/we/my-led plans", () => {
    expect(looksLikeBrainDump(
      "I'm going to restructure the morning routine — wake at 6, run, then 90 min deep work block before email.",
    )).toBe(true);
    expect(looksLikeBrainDump(
      "We need to redesign the onboarding email sequence. The drop-off after step 2 is brutal.",
    )).toBe(true);
    expect(looksLikeBrainDump(
      "My take after the conversation with Dani: the issue isn't capacity, it's clarity on which mission gets the next 6 weeks.",
    )).toBe(true);
  });

  it("accepts decisions / commitments / observations", () => {
    expect(looksLikeBrainDump(
      "Decided to drop the third tier from pricing. Two tiers, simpler, easier to explain.",
    )).toBe(true);
    expect(looksLikeBrainDump(
      "The Q3 plan needs to land before the founder retreat — three weeks out.",
    )).toBe(true);
    expect(looksLikeBrainDump(
      "Talking with the new hire today made me realize our docs are way out of date.",
    )).toBe(true);
  });
});

describe("looksLikeBrainDump · edge cases", () => {
  it("rejects empty / whitespace", () => {
    expect(looksLikeBrainDump("")).toBe(false);
    expect(looksLikeBrainDump("   ")).toBe(false);
  });

  it("treats sentence-end `?` deep inside as not-question (paragraph commentary)", () => {
    // A real brain dump with a quoted question buried in the middle
    // should still ingest. The tail-window check only flags trailing `?`.
    const longDump = "Reviewed the customer call yesterday. Key insight: the rep asked 'why do you need this?' three times before they got the real reason. Going to update the playbook to lead with that question. Need to roll it out by friday.";
    expect(looksLikeBrainDump(longDump)).toBe(true);
  });

  it("rejects question-shaped even after long preamble", () => {
    expect(
      looksLikeBrainDump("Hey Nick — quick one — what are the best Postgres extensions for full-text search?"),
    ).toBe(false);
  });
});
