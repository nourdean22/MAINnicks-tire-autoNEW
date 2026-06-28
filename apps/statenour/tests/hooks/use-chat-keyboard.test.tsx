import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useChatKeyboard } from "@/hooks/chat/use-chat-keyboard";

function Probe() {
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  useChatKeyboard({
    inputRef,
    isLoading: false,
    onSend: () => {},
    onCancel: () => {},
    setError: () => {},
    setShowHistory: () => {},
    messages: [],
  });
  return <div />;
}

describe("useChatKeyboard Hook", () => {
  it("renders without crashing", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toBe("<div></div>");
  });
});
