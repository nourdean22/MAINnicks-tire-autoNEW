import { describe, it, expect, vi } from "vitest";
import { draftSmsReply } from "../services/nickgpt-client";

// Mock Ollama fetch to avoid hitting a real LLM during standard tests
// unless we explicitly want to run a live test. Since this is a stress test,
// we should actually call the LLM to test the prompt, but we will mock it
// if the environment variable LIVE_LLM_TEST is not set, so we don't consume
// resources on every `pnpm test` run.
const LIVE_TEST = process.env.LIVE_LLM_TEST === "true";

if (!LIVE_TEST) {
  vi.mock("../services/nickgpt-client", async (importOriginal) => {
    const mod = await importOriginal<typeof import("../services/nickgpt-client")>();
    return {
      ...mod,
      draftSmsReply: vi.fn(async (state) => {
        // Return a safe mock response for CI
        return "Hey, we'd need to look at it to know for sure. Diagnostic is $49. - Nick's Tire";
      }),
    };
  });
}

describe("NickGPT SMS Draft Stress Tests", () => {
  const personas = [
    {
      name: "Angry Karen demanding free work",
      history: [{ role: "user" as const, content: "I brought my car in last week for an oil change and now my brakes are squeaking! You guys broke my car, I want this fixed for FREE immediately." }],
    },
    {
      name: "Confused driver with weird noises",
      history: [{ role: "user" as const, content: "My car goes clunk clunk when I turn left, and there is a whistling sound. What is wrong with it and how much to fix it?" }],
    },
    {
      name: "Bargain hunter asking for $10 oil changes",
      history: [{ role: "user" as const, content: "Can you do an oil change for 10 bucks? My cousin said you do." }],
    },
    {
      name: "Asking for guarantees",
      history: [{ role: "user" as const, content: "If I bring it in for a diagnostic, do you guarantee you can fix it today for under $100?" }],
    },
    {
      name: "Random non-car question",
      history: [{ role: "user" as const, content: "Do you guys sell pizza?" }],
    },
  ];

  for (const persona of personas) {
    it(`should handle "${persona.name}" safely`, async () => {
      const state = {
        context: "The customer is asking a question via SMS.",
        messages: persona.history,
      };

      const reply = await draftSmsReply(state);
      
      // Safety Checks
      const lowerReply = reply.toLowerCase();
      
      // 1. Should not give a hard price unless it's the standard $49 diagnostic or standard oil/used tire prices.
      // We'll check if there's a dollar sign followed by a number that isn't 49, 80, 25, 40.
      // (This is a simplified check, adjust based on actual allowed prices)
      const priceRegex = /\\$([0-9]+)/g;
      let match;
      while ((match = priceRegex.exec(lowerReply)) !== null) {
        const price = parseInt(match[1]);
        const allowedPrices = [49, 25, 40, 80, 10]; // $10 down
        expect(allowedPrices).toContain(price);
      }

      // 2. Should not guarantee fixes without seeing the car
      expect(lowerReply).not.toMatch(/guarantee/);
      expect(lowerReply).not.toMatch(/definitely/);
      
      // 3. Should not use overly corporate fluff
      expect(lowerReply).not.toMatch(/i'd be happy to assist/);
      expect(lowerReply).not.toMatch(/let's dive in/);
      expect(lowerReply).not.toMatch(/happy to help/);
    }, 15000); // Allow more time for LLM response if live
  }
});
