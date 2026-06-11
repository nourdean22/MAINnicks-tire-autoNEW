/**
 * Level-Up Directive card · source-side contract lock · 2026-06-10.
 *
 * The vitest env is Node (no jsdom · no testing-library) and the card
 * depends on the tRPC context, so — matching the house precedent in
 * mobile-a11y.test.tsx (ReasoningTrace) — its render contracts are
 * locked source-side. Behavior (ranking, reasons, CTA targets) is fully
 * pinned by tests/lib/mastery/level-up-directive.test.ts; this file
 * locks what the COMPONENT must keep doing with that output:
 * self-hiding honestly, the Missing-data empty state, shared query
 * keys, and PWA-safe primitives.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const src = readFileSync(
  path.join(REPO_ROOT, "components/mastery/level-up-directive-card.tsx"),
  "utf-8",
);

describe("LevelUpDirectiveCard · render + honesty contracts (source-side)", () => {
  it("shares the exact query keys the page already uses (no duplicate fetch shapes)", () => {
    // Same procedure + staleTime as <CharacterSheet>.
    expect(src).toMatch(
      /trpc\.operator\.characterSheet\.useQuery\(undefined,\s*\{\s*staleTime: 60_000/,
    );
    // Same key GoalBoard's utils.task.goals.fetch(undefined) populates.
    expect(src).toMatch(/trpc\.task\.goals\.useQuery\(undefined/);
    // Same input BodySection fetches — key must stay {range:"90d"}.
    expect(src).toMatch(/bodyTracking\.useQuery\(\s*\{ range: "90d" \}/);
  });

  it("self-hides on loading/transient error and never throws into the page", () => {
    expect(src).toMatch(
      /if \(sheetQ\.isLoading \|\| goalsQ\.isLoading \|\| bodyQ\.isLoading\) return null;/,
    );
    expect(src).toMatch(/if \(sheetQ\.error\) return null;/);
  });

  it("renders the honest Missing-data empty state instead of a fabricated pick", () => {
    expect(src).toContain("Missing data — no stat history to rank yet");
  });

  it("renders the truth-hierarchy fields: reason, XP math, CTA from rep.href", () => {
    expect(src).toContain("{directive.reason}");
    expect(src).toMatch(/XP → Lvl \{stat\.level \+ 1\}/);
    expect(src).toMatch(/href=\{directive\.rep\.href\}/);
    expect(src).toContain('aria-label="level-up directive"');
  });

  it("uses no iOS-PWA-dead primitives (confirm/alert/prompt) and next/link for the CTA", () => {
    expect(src).not.toMatch(/window\.(confirm|alert|prompt)/);
    expect(src).toMatch(/import Link from "next\/link"/);
  });

  it("the selector is fed pace verdicts from the house computePace, not re-derived math", () => {
    expect(src).toMatch(/import \{ computePace \} from "@\/lib\/brain\/goal-pace"/);
  });
});
