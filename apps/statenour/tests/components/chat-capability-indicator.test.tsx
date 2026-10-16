/**
 * tests/components/chat-capability-indicator.test.tsx · audit 09-F14 (task B6).
 *
 * The header badge span a Loader2 for as long as `badge.unknown` was true,
 * and a FAILED provider-health read is "unknown" forever: the badge spun on
 * every load after the read errored, a working signal for work that had
 * stopped. Only a read still in flight may animate. The same shape sat on
 * the tools read: an errored tools query left "checking capabilities"
 * spinning, so it is pinned here too.
 *
 * Rendered markup, not source text: the consumer end of capabilityBadge().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

type Query = { data?: unknown; isError: boolean };
let providers: Query;
let tools: Query;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      providerHealth: { useQuery: () => providers },
      toolsHealth: { useQuery: () => tools },
    },
  },
}));

import { ChatCapabilityIndicator } from "@/features/chat-v2/components/chat-capability-indicator";
import { capabilityBadge, capabilityWord } from "@/features/chat-v2/lib/capability-label";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

const healthyTools = { summary: { totalTools: 10, degraded: 0, down: 0 } };

beforeEach(() => {
  useChatUiStore.setState({ connection: "online" });
  providers = { data: undefined, isError: false };
  tools = { data: undefined, isError: false };
});

describe("ChatCapabilityIndicator · a failed read never spins", () => {
  it("provider-health errored: static 'AI health unknown', no animation", () => {
    providers = { data: undefined, isError: true };
    tools = { data: healthyTools, isError: false };
    const markup = renderToStaticMarkup(<ChatCapabilityIndicator />);
    expect(markup).toContain("AI health unknown");
    expect(markup).not.toContain("animate-spin");
  });

  it("tools-health errored with green providers: says tool health unknown, no animation", () => {
    providers = { data: { overallTone: "green" }, isError: false };
    tools = { data: undefined, isError: true };
    const markup = renderToStaticMarkup(<ChatCapabilityIndicator />);
    expect(markup).toContain("tool health unknown");
    expect(markup).not.toContain("checking capabilities");
    expect(markup).not.toContain("animate-spin");
  });

  it("positive control: a read still in flight DOES spin", () => {
    const markup = renderToStaticMarkup(<ChatCapabilityIndicator />);
    expect(markup).toContain("checking capabilities");
    expect(markup).toContain("animate-spin");
  });
});

describe("capabilityBadge · `checking` is true only while a read is in flight", () => {
  it("loading providers: checking", () => {
    expect(capabilityBadge({ connection: "online", providerTone: undefined, providerErrored: false }).checking).toBe(true);
  });

  it("errored providers: not checking (the read is over)", () => {
    expect(capabilityBadge({ connection: "online", providerTone: undefined, providerErrored: true }).checking).toBe(false);
  });

  it("green providers, tools loading: checking", () => {
    expect(capabilityBadge({ connection: "online", providerTone: "green", providerErrored: false }).checking).toBe(true);
  });

  it("green providers, tools errored: tool health unknown, cautious, not checking", () => {
    const b = capabilityBadge({ connection: "online", providerTone: "green", providerErrored: false, toolsErrored: true });
    expect(b).toMatchObject({ label: "tool health unknown", cautious: true, unknown: true, checking: false });
  });

  it("measured states never check", () => {
    const b = capabilityBadge({
      connection: "online",
      providerTone: "green",
      providerErrored: false,
      toolSummary: healthyTools.summary,
    });
    expect(b.checking).toBe(false);
  });
});

// W3b: the header shows a 10px dot and ONE word at md and up; the full label stays in the
// accessible name and a visually hidden span. The word never claims more than the label does.
// Round 2 (lens B): the visible words are the label itself in sentence case, so label-in-name holds
// for every state and a down count is never flattened into "Degraded".
describe("capabilityWord · the label's own words, sentence case", () => {
  const word = (input: Parameters<typeof capabilityBadge>[0]) => capabilityWord(capabilityBadge(input).label);
  it("measured and healthy: Ready", () => {
    expect(word({ connection: "online", providerTone: "green", providerErrored: false, toolSummary: healthyTools.summary })).toBe("Ready");
  });
  it("a read in flight keeps its words", () => {
    expect(word({ connection: "online", providerTone: undefined, providerErrored: false })).toBe("Checking capabilities");
  });
  it("a failed read says unknown, never Ready and never a diagnosis", () => {
    expect(word({ connection: "online", providerTone: undefined, providerErrored: true })).toBe("AI health unknown");
    expect(word({ connection: "online", providerTone: "green", providerErrored: false, toolsErrored: true })).toBe("Tool health unknown");
  });
  it("each measured problem keeps its own words (red providers included)", () => {
    expect(word({ connection: "online", providerTone: "red", providerErrored: false })).toBe("AI offline");
    expect(word({ connection: "online", providerTone: "amber", providerErrored: false })).toBe("Fallback active");
    expect(word({ connection: "degraded", providerTone: "green", providerErrored: false, toolSummary: healthyTools.summary })).toBe("Chat degraded");
    expect(word({ connection: "offline", providerTone: "green", providerErrored: false })).toBe("Chat offline");
  });
});

describe("ChatCapabilityIndicator · W3b dot and words", () => {
  it("Ready: the full words in the accessible name and title, the word visible at md-up only, a 44px box", () => {
    providers = { data: { overallTone: "green" }, isError: false };
    tools = { data: healthyTools, isError: false };
    const markup = renderToStaticMarkup(<ChatCapabilityIndicator />);
    expect(markup).toContain('href="/system/health"');
    expect(markup).toMatch(/aria-label="ready \(capability health\)"/);
    expect(markup).toMatch(/title="ready"/);
    expect(markup).toMatch(/hidden md:inline[^>]*>Ready</);
    expect(markup).toMatch(/class="inline-flex min-h-11 min-w-11 items-center justify-center/);
    expect(markup).not.toContain("animate-spin");
  });

  it("a measured problem shows its words at every width, with the down count, never a colour-only dot", () => {
    providers = { data: { overallTone: "green" }, isError: false };
    tools = { data: { summary: { totalTools: 10, degraded: 0, down: 2 } }, isError: false };
    const markup = renderToStaticMarkup(<ChatCapabilityIndicator />);
    expect(markup).toMatch(/aria-label="tools limited · 2 down \(capability health\)"/);
    expect(markup).toMatch(/<span aria-hidden="true">Tools limited · 2 down<\/span>/);
    expect(markup).not.toMatch(/hidden md:inline/);
  });
});
