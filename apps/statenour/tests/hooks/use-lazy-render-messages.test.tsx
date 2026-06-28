import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useLazyRenderMessages } from "@/hooks/chat/use-lazy-render-messages";

interface TestMessage {
  id: string;
}

function Probe({ messages, isStreaming }: { messages: TestMessage[]; isStreaming: boolean }) {
  const { renderedMessages, hasHidden } = useLazyRenderMessages(messages, isStreaming);
  return (
    <div
      data-rendered-count={renderedMessages.length}
      data-hidden={String(hasHidden)}
    />
  );
}

describe("useLazyRenderMessages Hook", () => {
  it("renders all messages when below threshold", () => {
    const messages = [{ id: "1" }, { id: "2" }];
    const markup = renderToStaticMarkup(<Probe messages={messages} isStreaming={false} />);
    expect(markup).toContain('data-hidden="false"');
    expect(markup).toContain('data-rendered-count="2"');
  });
});
