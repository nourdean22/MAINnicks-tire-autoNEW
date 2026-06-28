import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useChatDeepLink } from "@/hooks/chat/use-chat-deep-link";
import { ReadonlyURLSearchParams } from "next/navigation";

function Probe() {
  const mockParams = {
    get: (key: string) => null,
  } as unknown as ReadonlyURLSearchParams;

  useChatDeepLink({
    params: mockParams,
    messageCount: 0,
    activeConversationId: null,
    sendOrQueue: () => {},
    loadConversation: () => {},
  });

  return <div />;
}

describe("useChatDeepLink Hook", () => {
  it("renders without crashing", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toBe("<div></div>");
  });
});
