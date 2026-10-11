/**
 * Home command line live regions (audit 09-F5, home part).
 *
 * The reply area was role="log", which is polite-live by default, so a screen reader announced every
 * streamed token as it arrived. Now the log is aria-live="off" and one always-mounted role="status"
 * line carries the finished reply once: empty while streaming, "Nick: <reply>" when done.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const chat = vi.hoisted(() => ({
  status: "ready" as string,
  messages: [] as Array<{ id: string; role: string; parts: Array<{ type: string; text: string }> }>,
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({ messages: chat.messages, sendMessage: vi.fn(), status: chat.status }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: { operator: { nickRemembersContext: { useQuery: () => ({ data: undefined }) } } },
}));

import { NickCommandLine } from "@/components/home/nick-command-line";

const msg = (id: string, role: string, text: string) => ({ id, role, parts: [{ type: "text", text }] });
const render = () => renderToStaticMarkup(<NickCommandLine />);
const statusRegion = (html: string) => html.match(/<[a-z]+[^>]*role="status"[^>]*>([\s\S]*?)<\/[a-z]+>/)?.[1];
const logTag = (html: string) => html.match(/<div[^>]*role="log"[^>]*>/)?.[0] ?? "";

afterEach(() => {
  chat.status = "ready";
  chat.messages = [];
});

describe("NickCommandLine live regions (09-F5)", () => {
  it("while streaming, the log is not live and the status line is empty", () => {
    chat.status = "streaming";
    chat.messages = [msg("u1", "user", "plan my day"), msg("a1", "assistant", "First, the half-written")];
    const html = render();
    expect(logTag(html)).toContain('aria-live="off"');
    expect(statusRegion(html)).toBe("");
  });

  it("when the reply is done, the status line carries it once", () => {
    chat.messages = [msg("u1", "user", "plan my day"), msg("a1", "assistant", "Ship the brief first.")];
    const html = render();
    expect(statusRegion(html)).toBe("Nick: Ship the brief first.");
    expect(html.split("Nick: Ship the brief first.").length - 1).toBe(1);
  });

  it("CONTROL: the status line is mounted before any message exists (a live region must exist before it changes)", () => {
    const html = render();
    expect(statusRegion(html)).toBe("");
    expect(logTag(html)).toBe("");
  });
});
