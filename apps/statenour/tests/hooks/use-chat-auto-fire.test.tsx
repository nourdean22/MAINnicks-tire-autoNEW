import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useChatAutoFire } from "@/hooks/chat/use-chat-auto-fire";

function Probe() {
  const { pendingAutoFire } = useChatAutoFire({
    messages: [],
    isStreaming: false,
    sendOrQueue: () => {},
  });
  return <div data-pending={String(pendingAutoFire)} />;
}

describe("useChatAutoFire Hook", () => {
  it("defaults to null pending plan on mount", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-pending="null"');
  });
});
