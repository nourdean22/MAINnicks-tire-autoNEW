/**
 * tests/components/nick-header-provider-picker.test.tsx · de-Venice lock.
 *
 * Locks that the NickHeaderV2 ⋯-menu "Provider Override" picker no
 * longer offers a Venice lane. The picker renders two rows —
 * ["auto","ollama","gemini"] and ["openai","anthropic"] — and the
 * ProviderOverride union (local + lib/chat/types.ts) carries no
 * "venice" member. A regression that re-adds Venice would let an
 * operator pin a dead lane.
 *
 * Two-pronged, matching the house no-jsdom precedent
 * (mobile-a11y.test.tsx / level-up-directive-card.test.ts — vitest env
 * is Node, no jsdom · no testing-library):
 *
 *   1. BEHAVIOR — render <NickHeaderV2/> via react-dom/server and prove
 *      it mounts clean with no /venice/i anywhere in the tree. (The
 *      menu itself is gated behind internal useState(false) and only
 *      opens on a real click — which needs a DOM we don't have — so the
 *      open-menu render is impossible to drive here. The closed render
 *      still proves the component + its imported ProviderOverride
 *      surface carry no Venice markup.)
 *   2. CONTRACT — assert source-side that the picker rows are exactly
 *      the de-Venice'd lanes, that OpenAI + Anthropic options ARE
 *      present, and that neither the component nor the shared
 *      ProviderOverride union mentions venice. This is the lock that
 *      survives even though the menu can't be opened in a Node render.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

// The health pill self-fetches via tRPC context — stub it to null so
// the header renders in isolation. Also stub the tRPC client so any
// transitive useQuery is inert.
vi.mock("@/components/chat/provider-health-pill", () => ({
  ProviderHealthPill: () => null,
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      providerHealth: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

import { NickHeaderV2 } from "@/components/chat/nick-header-v2";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
function readSource(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

describe("NickHeaderV2 provider picker · behavior (closed-menu render)", () => {
  it("mounts without crashing and emits no Venice markup", () => {
    const html = renderToStaticMarkup(
      <NickHeaderV2
        messageCount={3}
        mode="auto"
        providerOverride="auto"
        onProviderChange={() => {}}
        onModeChange={() => {}}
        providerHealthy
      />,
    );
    expect(html.length).toBeGreaterThan(0);
    // The ⋯ trigger renders even when the menu is closed.
    expect(html).toMatch(/aria-label="Chat options"/);
    // Nothing Venice may leak into the rendered tree.
    expect(html).not.toMatch(/venice/i);
  });
});

describe("NickHeaderV2 provider picker · source contract (de-Venice'd rows)", () => {
  const src = readSource("components/chat/nick-header-v2.tsx");

  it("renders the picker as exactly the four live lanes across two rows", () => {
    // Row 1: auto + the two free-tier lanes.
    expect(src).toMatch(/\(\["auto",\s*"ollama",\s*"gemini"\]\s*as const\)/);
    // Row 2: the two API lanes — openai + anthropic DO render.
    expect(src).toMatch(/\(\["openai",\s*"anthropic"\]\s*as const\)/);
    // Friendly labels prove OpenAI + Claude options surface to the user.
    expect(src).toContain('"OpenAI"');
    expect(src).toContain('"Claude"');
  });

  it("carries no venice string literal (option / union member) in the component", () => {
    // Provider options + union members always appear as a quoted
    // "venice" literal. The historical header doc-comment mentions
    // "Venice dot" as something that was REMOVED — that prose is not a
    // regression, so we lock the literal form (how a real option would
    // reappear) rather than banning the word in comments.
    expect(src).not.toMatch(/["']venice["']/i);
  });

  it("the local ProviderOverride union has no venice member", () => {
    expect(src).toMatch(
      /export type ProviderOverride =\s*"auto"\s*\|\s*"ollama"\s*\|\s*"gemini"\s*\|\s*"openai"\s*\|\s*"anthropic";/,
    );
  });

  it("the shared lib/chat/types.ts ProviderOverride union also drops venice", () => {
    const typesSrc = readSource("lib/chat/types.ts");
    expect(typesSrc).toMatch(
      /export type ProviderOverride =\s*"auto"\s*\|\s*"ollama"\s*\|\s*"gemini"\s*\|\s*"openai"\s*\|\s*"anthropic";/,
    );
    expect(typesSrc).not.toMatch(/venice/i);
  });
});
