import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useChatEditing } from "@/hooks/chat/use-chat-editing";

vi.mock("@/hooks/use-draft-autosave", () => ({
  useDraftAutosave: () => ({
    clearDraft: () => {},
    restore: () => null,
  }),
}));

function Probe() {
  const { editingMsgId, editValue } = useChatEditing();
  return (
    <div
      data-id={String(editingMsgId)}
      data-val={editValue}
    />
  );
}

describe("useChatEditing Hook", () => {
  it("defaults to empty edit states on mount", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-id="null"');
    expect(markup).toContain('data-val=""');
  });
});
