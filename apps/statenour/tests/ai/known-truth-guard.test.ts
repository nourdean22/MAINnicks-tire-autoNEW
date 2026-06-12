/**
 * Known-truth guard tests — flags stale-active + evidence-free status
 * claims in Nick's replies, while leaving retired/reported/hedged/
 * evidenced forms safe. Pure, no model/DB.
 */
import { describe, it, expect } from "vitest";
import { checkKnownTruth } from "@/lib/ai/known-truth-guard";

const kinds = (s: string) => checkKnownTruth(s).map((f) => f.kind);

describe("known-truth · stale active claims (UNSAFE)", () => {
  it("'Statenour deploys to Vercel' → flagged", () => {
    expect(kinds("Statenour deploys to Vercel on every push.")).toContain("stale_active_claim");
  });
  it("'statenour-master is the production branch' → flagged", () => {
    expect(kinds("Remember, statenour-master is the production branch.")).toContain("stale_active_claim");
  });
  it("'push codex for prod' → flagged", () => {
    expect(kinds("You should push codex for prod deploys.")).toContain("stale_active_claim");
  });
});

describe("known-truth · retired/historical framing (SAFE)", () => {
  it("'Vercel is retired' → not flagged", () => {
    expect(checkKnownTruth("Vercel is retired; statenour runs on Railway now.")).toHaveLength(0);
  });
  it("'used to deploy to Vercel' → not flagged", () => {
    expect(kinds("Statenour used to deploy to Vercel, but that's deprecated.")).not.toContain("stale_active_claim");
  });
  it("'codex/ollama-local are retired' → not flagged", () => {
    expect(checkKnownTruth("codex and ollama-local are retired for prod.")).toHaveLength(0);
  });
});

describe("known-truth · evidence-free status (UNSAFE)", () => {
  it("bare 'tests passed' → flagged", () => {
    expect(kinds("Great — tests passed.")).toContain("evidence_free_status");
  });
  it("bare 'I deployed it' → flagged", () => {
    expect(kinds("I deployed it just now.")).toContain("evidence_free_status");
  });
  it("'build is green' with no evidence → flagged", () => {
    expect(kinds("The build is green.")).toContain("evidence_free_status");
  });
});

describe("known-truth · status with evidence / reported / hedged (SAFE)", () => {
  it("status WITH evidence → not flagged", () => {
    expect(checkKnownTruth("Deployed — railway status SUCCESS, 220/220 tests passing, commit 496f7cda.")).toHaveLength(0);
  });
  it("reported speech → not flagged (criterion #20)", () => {
    expect(checkKnownTruth("The other session reports it deployed and tests passed.")).toHaveLength(0);
  });
  it("'you said the tests passed' → not flagged", () => {
    expect(checkKnownTruth("You said the tests passed, so I'll proceed.")).toHaveLength(0);
  });
  it("future/hedge → not flagged", () => {
    expect(checkKnownTruth("I'll deploy once the build passes.")).toHaveLength(0);
  });
});

describe("known-truth · clean", () => {
  it("ordinary helpful reply → no flags", () => {
    expect(checkKnownTruth("Your top mission is UFC BBQ in 4 days; lock the headcount today.")).toHaveLength(0);
  });
});
