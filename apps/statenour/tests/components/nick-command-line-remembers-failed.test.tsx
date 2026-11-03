// @vitest-environment jsdom
/**
 * Map gap 6 (job 2026-11-02-nour-os-interconnect W2): with the command line focused and empty, a failed
 * "Nick remembers" read says so; a clean read (even an empty one) says nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const q = vi.hoisted(() => ({ value: { data: undefined as unknown, isError: false } }));
vi.mock("@ai-sdk/react", () => ({ useChat: () => ({ messages: [], sendMessage: vi.fn(), setMessages: vi.fn(), status: "ready" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: { operator: { nickRemembersContext: { useQuery: () => q.value } } },
}));

import { NickCommandLine } from "@/components/home/nick-command-line";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const renderFocused = () => {
  act(() => root.render(<NickCommandLine />));
  const ta = host.querySelector("textarea") as HTMLTextAreaElement;
  act(() => ta.focus());
  return host.textContent ?? "";
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("NickCommandLine: a failed Nick-remembers read", () => {
  it("names the failed source while focused and empty", () => {
    q.value = { data: { anticipatedQuestions: [], followUps: [], failed: ["conversation digests"] }, isError: false };
    expect(renderFocused()).toContain("Couldn't read what Nick remembers (conversation digests)");
  });
  it("a failed query shows the short line", () => {
    q.value = { data: undefined, isError: true };
    expect(renderFocused()).toContain("Couldn't read what Nick remembers");
  });
  it("a clean empty read shows nothing", () => {
    q.value = { data: { anticipatedQuestions: [], followUps: [], failed: [] }, isError: false };
    expect(renderFocused()).not.toContain("Couldn't read");
  });
});
