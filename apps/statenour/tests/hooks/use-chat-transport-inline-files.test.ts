/**
 * U5 (2026-10-30) · a chat send carries inline file bytes only on the newest user message.
 *
 * Before: every photo rode along with every later turn as a data: URL, so a few photo turns pushed
 * the request past proxy.ts's 10 MB body limit and the route read the cut body as "Invalid JSON".
 * Drives the REAL prepareSendMessagesRequest (capture pattern from use-chat-transport-window.test.ts),
 * and pins the raised proxy limit in next.config.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let capturedOpts: Record<string, unknown> | undefined;

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(opts: Record<string, unknown>) {
      capturedOpts = opts;
    }
  },
}));

import { useChatTransport } from "@/hooks/chat/use-chat-transport";
import { withoutOlderInlineFiles } from "@/lib/ai/chat/attachment-cap";

type Msg = { id: string; role: string; parts: Array<Record<string, unknown>> };
type Prepare = (o: {
  id: string;
  messages: Msg[];
  body: Record<string, unknown>;
  trigger: string;
  messageId: string | undefined;
}) => { body: { messages: Msg[] } };

function prepare(): Prepare {
  capturedOpts = undefined;
  function Probe() {
    useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef: { current: {} },
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      setDeeperContext: () => {},
    } as never);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  const fn = capturedOpts?.prepareSendMessagesRequest;
  if (typeof fn !== "function") throw new Error("prepareSendMessagesRequest was not set");
  return fn as Prepare;
}

const photo = (name: string) => ({ type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,QUJD", filename: name });
const thread = (): Msg[] => [
  { id: "u1", role: "user", parts: [{ type: "text", text: "first" }, photo("old.jpg")] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] },
  { id: "u2", role: "user", parts: [{ type: "text", text: "second" }, photo("new.jpg")] },
];

describe("chat send · inline files only on the newest user message", () => {
  it("the request keeps the newest photo and swaps the older one for a note", () => {
    const { body } = prepare()({ id: "chat-v2", messages: thread(), body: {}, trigger: "submit-message", messageId: undefined });
    const [u1, , u2] = body.messages;
    expect(u1.parts).toEqual([{ type: "text", text: "first" }, { type: "text", text: "[Attachment sent earlier: old.jpg. Not resent.]" }]);
    expect(u2.parts[1]).toEqual(photo("new.jpg"));
    expect(JSON.stringify(body.messages).match(/data:/g)).toHaveLength(1);
  });

  it("a regenerate (assistant last) still keeps the newest user message's photo", () => {
    const msgs = [...thread(), { id: "a2", role: "assistant", parts: [{ type: "text", text: "hm" }] }];
    const out = withoutOlderInlineFiles(msgs);
    expect(out[2].parts[1]).toEqual(photo("new.jpg"));
    expect(out[0].parts[1]).toMatchObject({ type: "text" });
  });

  it("a hosted (https) file and a message without files are left as they are", () => {
    const hosted = { id: "u0", role: "user", parts: [{ type: "file", mediaType: "image/png", url: "https://x.test/a.png" }] };
    const msgs = [hosted, ...thread()];
    const out = withoutOlderInlineFiles(msgs);
    expect(out[0]).toBe(hosted);
    expect(out[2]).toBe(msgs[2]);
  });

  it("next.config.ts raises the proxy body limit past the 10 MB default", () => {
    const src = readFileSync(join(__dirname, "..", "..", "next.config.ts"), "utf8");
    expect(src).toMatch(/proxyClientMaxBodySize:\s*"32mb"/);
  });
});
