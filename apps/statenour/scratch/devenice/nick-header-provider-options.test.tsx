import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { NickHeaderV2 } from "../../components/chat/nick-header-v2";

// One-line note: Assertions asserting that 'venice' is omitted from the provider picker go green only after F3 source fix is applied.

// Mock Lucide icons
vi.mock("lucide-react", () => ({
  MoreHorizontal: () => <div data-testid="more-icon" />,
  Plus: () => <div />,
  History: () => <div />,
  Volume2: () => <div />,
  VolumeX: () => <div />,
  Mic: () => <div />,
  MicOff: () => <div />,
  Eye: () => <div />,
  ChevronDown: () => <div />,
  Download: () => <div />,
  FileJson: () => <div />,
  Terminal: () => <div />,
  Heart: () => <div />,
  Crown: () => <div />,
  Check: () => <div />,
  Radio: () => <div />,
  Zap: () => <div />,
  ZapOff: () => <div />,
  Shuffle: () => <div />,
  Brain: () => <div />,
}));

// Mock ProviderHealthPill
vi.mock("@/components/chat/provider-health-pill", () => ({
  ProviderHealthPill: () => <div data-testid="health-pill" />,
}));

// Mock react's useState for the component to force the menu to be open
vi.mock("react", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useState: (init: any) => {
      if (init === false) {
        return [true, () => {}];
      }
      return [init, () => {}];
    },
  };
});

describe("NickHeaderV2 provider override picker options", () => {
  it("renders exactly the supported providers and does not render venice", () => {
    const onProviderChange = vi.fn();
    const html = renderToString(
      <NickHeaderV2
        conversationId="test-conv"
        messageCount={1}
        providerOverride="auto"
        onProviderChange={onProviderChange}
      />
    );

    // Check header section titles
    expect(html).toContain("Provider Override");

    // Venice should NOT be visible in the picker
    // We search case-insensitively for venice in the HTML
    expect(html.toLowerCase()).not.toContain("venice");

    // Check supported ones are present (case-insensitive or exact)
    expect(html.toLowerCase()).toContain("auto");
    expect(html.toLowerCase()).toContain("ollama");
    expect(html.toLowerCase()).toContain("gemini");
    expect(html.toLowerCase()).toContain("openai");
    // "Claude" is mapped to anthropic or rendered as Claude (let's check case-insensitive)
    expect(html.toLowerCase()).toContain("claude");
  });
});
