import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useChatSpeedRibbon } from "@/hooks/chat/use-chat-speed-ribbon";

function Probe() {
  const { showSpeedRibbon } = useChatSpeedRibbon();
  return <div data-show={String(showSpeedRibbon)} />;
}

describe("useChatSpeedRibbon Hook", () => {
  it("defaults to false on mount", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-show="false"');
  });
});
