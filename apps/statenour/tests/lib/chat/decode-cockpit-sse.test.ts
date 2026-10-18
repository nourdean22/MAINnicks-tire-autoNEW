/**
 * decodeCockpitSseResponse (lib/chat/decode-cockpit-sse.ts), the decoder the
 * main chat transport and the home command line share. The main chat's own
 * tests (tests/hooks/use-chat-transport*.test.ts) drive it through the hook;
 * these pin the module on its own.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeCockpitSseResponse } from "@/lib/chat/decode-cockpit-sse";

function sse(pieces: Array<string | Uint8Array>, headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < pieces.length) {
        const p = pieces[i++];
        controller.enqueue(typeof p === "string" ? encoder.encode(p) : p);
      } else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream", ...headers } });
}

async function readBytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}
const readText = async (res: Response) => new TextDecoder().decode(await readBytes(res));
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

afterEach(() => vi.restoreAllMocks());

describe("decodeCockpitSseResponse", () => {
  it("decodes a chunk whose event: and data: lines arrive in separate reads", async () => {
    const res = decodeCockpitSseResponse(sse(["event: chunk\n", `data: ${JSON.stringify(b64("split-frame"))}\n\n`]), {
      isResume: false,
    });
    expect(await readText(res)).toBe("split-frame");
  });

  it("decodes URL-safe base64 with its padding stripped", async () => {
    const raw = new Uint8Array([0xfb, 0xff, 0xbf, 0x68, 0x69]);
    const std = Buffer.from(raw).toString("base64");
    expect(std).toBe("+/+/aGk="); // positive control: the input really has +, / and padding
    const urlSafe = std.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res = decodeCockpitSseResponse(sse([`event: chunk\ndata: ${JSON.stringify(urlSafe)}\n\n`]), { isResume: false });
    expect([...(await readBytes(res))]).toEqual([...raw]);
  });

  it("forwards a bare data: frame as-is", async () => {
    const frame = 'data: {"type":"text-delta","id":"t1","delta":"hi"}';
    const res = decodeCockpitSseResponse(sse([`${frame}\n\n`]), { isResume: false });
    expect(await readText(res)).toBe(`${frame}\n\n`);
  });

  it("ignores heartbeat comment lines", async () => {
    const res = decodeCockpitSseResponse(
      sse([": ping-1792356119591\n\n", `event: chunk\ndata: ${JSON.stringify(b64("after-ping"))}\n\n`, ": ping-2\n\n"]),
      { isResume: false },
    );
    expect(await readText(res)).toBe("after-ping");
  });

  it("calls onDecodeError once however many chunks fail, and keeps decoding good ones", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onDecodeError = vi.fn();
    const res = decodeCockpitSseResponse(
      sse([
        'event: chunk\ndata: "!!!not base64!!!"\n\n',
        `event: chunk\ndata: ${JSON.stringify(b64("good"))}\n\n`,
        'event: chunk\ndata: "***"\n\n',
      ]),
      { isResume: false, onDecodeError },
    );
    expect(await readText(res)).toBe("good");
    expect(onDecodeError).toHaveBeenCalledTimes(1);
  });

  it("reports message.persisted with this response's trace id and re-emits named events", async () => {
    const onMessagePersisted = vi.fn();
    const seen: Array<{ type: string }> = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("cockpit-event", listener);
    const res = decodeCockpitSseResponse(
      sse(['event: message.persisted\ndata: {"id":"m1","content":"Stored reply."}\n\n'], { "X-Trace-Id": "tr-9" }),
      { isResume: false, onMessagePersisted },
    );
    expect(await readText(res)).toBe("");
    window.removeEventListener("cockpit-event", listener);
    expect(onMessagePersisted).toHaveBeenCalledWith({ id: "m1", content: "Stored reply.", traceId: "tr-9" });
    expect(seen.map((d) => d.type)).toEqual(["message.persisted"]);
  });
});
