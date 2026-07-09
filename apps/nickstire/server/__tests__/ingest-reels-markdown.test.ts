import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../../scripts/ingest-reels-markdown";

const MOCK_MD = `
# Nick's Tire & Auto — 30-Day Reels Plan

## Day 1 — Bad Tire? Do Not Wait
- **Avatar:** Budget-minded driver
- **Video script:** Voiceover: "Bad tire? Don't wait until it blows."
- **Shot list:** Close-up of bald tire. Tire on balancer. New tire rolled.
- **Video prompt:** "Vertical 9:16 cinematic Reel. Realistic auto shop footage. Close-up of bald tire."
- **On-screen text:** "BAD TIRE?" | "WALK IN 7 DAYS"
- **Caption:** "Bad tire? Don't wait."
- **Pinned comment:** "Need tires today? Walk in 7 days."
- **Hashtags:** #ClevelandTires #UsedTiresCleveland

## Day 02 — The Brake Pad Reality Check
- **Avatar:** Safety driver
- **Video script:** Voiceover: "This is what a brake pad looks like."
- **Shot list:** Worn pad. New pad. Rotor close-up. Wheel removed.
- **Video prompt:** "Vertical 9:16 close-up. Worn brake pad beside new brake pad."
- **On-screen text:** "SQUEALING?" | "THAT'S THE WARNING"
- **Caption:** "That squeal is not just annoying."
- **Hashtags:** #BrakeRepairCleveland
`;

describe("Reels Markdown Parser", () => {
  it("should correctly parse multiple days", () => {
    const result = parseMarkdown(MOCK_MD);
    
    expect(result.errors).toHaveLength(0);
    expect(result.parsed).toBe(2);
    expect(result.valid).toBe(2);

    const day1 = result.results[0];
    expect(day1.day).toBe(1);
    expect(day1.title).toBe("Bad Tire? Do Not Wait");
    expect(day1.slug).toBe("bad-tire-do-not-wait");
    expect(day1.id).toBe("nicks-30day-reels-day-01-bad-tire-do-not-wait");
    expect(day1.voiceoverScript).toBe("\"Bad tire? Don't wait until it blows.\"");
    expect(day1.hashtags).toEqual(["#ClevelandTires", "#UsedTiresCleveland"]);
    
    // Check beats length (>= 3)
    expect(day1.storyboardBeats.length).toBeGreaterThanOrEqual(3);
    expect(day1.storyboardBeats[0].visual).toContain("Close-up of bald tire");
    expect(day1.storyboardBeats[0].onScreenText).toBe("\"BAD TIRE?\" | \"WALK IN 7 DAYS\"");

    const day2 = result.results[1];
    expect(day2.day).toBe(2);
    expect(day2.title).toBe("The Brake Pad Reality Check");
    expect(day2.storyboardBeats.length).toBeGreaterThanOrEqual(3);
  });

  it("should fail validation if required fields are missing", () => {
    const BAD_MD = `
## Day 3 - Incomplete Day
- **Avatar:** Budget
- **Video script:** Voiceover: "Something"
    `;
    const result = parseMarkdown(BAD_MD);
    
    expect(result.parsed).toBe(1);
    expect(result.valid).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("missing required fields");
  });

  it("should enforce caption length limits", () => {
    const longString = "A".repeat(2300);
    const LONG_MD = `
## Day 4 - Long Caption
- **Video script:** Voiceover: "Short"
- **Shot list:** Shot 1. Shot 2. Shot 3.
- **Video prompt:** "Prompt"
- **Caption:** "${longString}"
- **Hashtags:** #Tags
    `;
    
    const result = parseMarkdown(LONG_MD);
    expect(result.valid).toBe(0);
    expect(result.errors[0]).toContain("caption exceeds 2200 characters");
  });
});
