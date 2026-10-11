// @vitest-environment jsdom
/**
 * tests/hooks/use-chat-stream-glue.test.tsx · task P2-B6 items 1 and 7.
 *
 * The pure helpers (bindPersistedMessage, stopTurn, stoppedLabel) were tested;
 * the hook that wires them was not, so deleting the binding effect or the
 * trace check left every test green. This mounts useChatStream for real
 * (react-dom/client in jsdom, effects run) with the SDK's useChat and the
 * transport stubbed at their edges, and drives the callbacks the transport
 * and the stall detector receive.
 *
 *   · binding effect: applies only after the stream settles, drops a payload
 *     from another turn, and moves a pending Stop label to the DB id.
 *   · item 1 glue: the transport asks which bubble a named resume should
 *     merge into; the answer is the last message when it is a reply.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ChatRuntimeController } from "@/features/chat-v2/types/chat-runtime-controller";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Msg = { id: string; role: string; parts: Array<{ type: string; text?: string }> };
type TransportOpts = {
  lastTraceIdRef: { current: string | null };
  onMessagePersisted: (p: { id: string; content: string; traceId: string | null }) => void;
  resumeIntoMessageId?: () => string | undefined;
  onResumePartial: () => void;
};

const h = vi.hoisted(() => ({
  chat: {} as Record<string, unknown>,
  transport: undefined as unknown,
  stall: undefined as unknown,
}));
vi.mock("@ai-sdk/react", () => ({ useChat: () => h.chat }));
vi.mock("@/hooks/chat/use-chat-transport", () => ({
  useChatTransport: (opts: unknown) => {
    h.transport = opts;
    return {};
  },
}));
vi.mock("@/hooks/chat/use-chat-stall", () => ({
  useChatStall: (opts: unknown) => {
    h.stall = opts;
    return { stallStatus: "ok" };
  },
}));
vi.mock("@/hooks/chat/use-streaming-error-guard", () => ({ useStreamingErrorGuard: () => {} }));
vi.mock("@/components/chat/page-context-bridge", () => ({
  readPageContext: () => null,
  onPageContextChanged: () => () => {},
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));

import { toast } from "sonner";
import { useChatStream } from "@/features/chat-v2/hooks/use-chat-stream";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

const transport = () => h.transport as TransportOpts;
const user: Msg = { id: "u1", role: "user", parts: [{ type: "text", text: "question" }] };
const reply: Msg = { id: "live-1", role: "assistant", parts: [{ type: "text", text: "streamed" }] };

let ctl: ChatRuntimeController;
// The hook's controller leaves the component through a prop callback, not an outer reassignment.
function Probe({ onCtl }: { onCtl: (c: ChatRuntimeController) => void }) {
  onCtl(useChatStream());
  return null;
}
const captureCtl = (c: ChatRuntimeController) => { ctl = c; };

let container: HTMLDivElement;
let root: Root;
const render = () => act(() => root.render(<Probe onCtl={captureCtl} />));
const setMessages = vi.fn();

function settle() {
  h.chat.status = "ready";
  render();
}

beforeEach(() => {
  setMessages.mockReset();
  h.chat = {
    status: "streaming",
    messages: [user, reply],
    error: undefined,
    setMessages,
    stop: vi.fn(),
    resumeStream: vi.fn(),
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
  };
  useChatUiStore.setState({ activeConversationId: "c1", privateMode: false });
  container = document.createElement("div");
  root = createRoot(container);
  render();
  transport().lastTraceIdRef.current = "T1";
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("the binding effect", () => {
  it("binds the reply to its DB row only after the stream settles", () => {
    act(() => transport().onMessagePersisted({ id: "db-1", content: "stored text", traceId: "T1" }));
    render();
    expect(setMessages, "mid-stream: the SDK would push a second bubble").not.toHaveBeenCalled();

    settle();

    expect(setMessages).toHaveBeenCalledTimes(1);
    const bound = (setMessages.mock.calls[0][0] as (m: Msg[]) => Msg[])([user, reply]);
    expect(bound.at(-1)).toMatchObject({ id: "db-1", parts: [{ type: "text", text: "stored text" }] });
  });

  it("a payload parsed before the stream starts (a resume reads its body ahead of the SDK) waits for the settle", () => {
    h.chat.status = "ready";
    render();
    act(() => transport().onMessagePersisted({ id: "db-1", content: "stored", traceId: "T1" }));
    h.chat.status = "submitted";
    render();
    expect(setMessages, "binding before the replay lands renames the bubble the replay targets").not.toHaveBeenCalled();

    settle();

    expect(setMessages).toHaveBeenCalledTimes(1);
  });

  it("drops a payload from another turn", () => {
    act(() => transport().onMessagePersisted({ id: "db-old", content: "old", traceId: "T0" }));
    settle();
    expect(setMessages).not.toHaveBeenCalled();
  });

  it("applies a payload once, not again on the next settle", () => {
    act(() => transport().onMessagePersisted({ id: "db-1", content: "stored", traceId: "T1" }));
    settle();
    h.chat.status = "streaming";
    render();
    settle();
    expect(setMessages).toHaveBeenCalledTimes(1);
  });

  it("moves a Stop label from the live id to the DB id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => ctl.stopTurn());

    expect(fetchMock).toHaveBeenCalledWith("/api/ai/chat/c1/stream", expect.objectContaining({ method: "DELETE" }));
    expect(h.chat.stop).toHaveBeenCalledTimes(1);
    expect(ctl.stopped).toEqual({ messageId: "live-1", outcome: "stopped" });

    act(() => transport().onMessagePersisted({ id: "db-1", content: "stored", traceId: "T1" }));
    settle();

    expect(ctl.stopped).toEqual({ messageId: "db-1", outcome: "stopped" });
  });

  it("a refused stop settles as unconfirmed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 409 })));
    await act(async () => ctl.stopTurn());
    expect(ctl.stopped).toEqual({ messageId: "live-1", outcome: "unconfirmed" });
  });
});

describe("item 1 glue · which bubble a named resume merges into", () => {
  it("the last message, when it is a reply", () => {
    expect(transport().resumeIntoMessageId?.()).toBe("live-1");
  });

  it("none when the last message is the operator's (no token had arrived)", () => {
    h.chat.messages = [user];
    render();
    expect(transport().resumeIntoMessageId?.()).toBeUndefined();
  });

  it("CONTROL: the stall toast's Reconnect resumes and never regenerates", () => {
    const stall = h.stall as { setError: (m: string | null) => void };
    act(() => stall.setError("Nick stopped responding"));
    const opts = vi.mocked(toast.error).mock.calls.at(-1)![1] as { action: { onClick: () => void } };
    act(() => opts.action.onClick());
    expect(h.chat.resumeStream).toHaveBeenCalledTimes(1);
    expect(h.chat.regenerate).not.toHaveBeenCalled();
  });
});

// P2-B6 fix round · a resume replaces the live bubble with an empty one (ai@6)
// and replays text only, so its tool parts vanish. The auto-retry guard reads
// "no tool fired" from those parts; a failed reattach must never regenerate a
// turn whose tools already fired and may still be running server-side.
describe("auto-retry never turns a failed reattach into a resend", () => {
  const toolReply: Msg = {
    id: "live-1",
    role: "assistant",
    parts: [{ type: "tool-telegram_send" }, { type: "text", text: "sent" }],
  };
  const merged: Msg = { id: "live-1", role: "assistant", parts: [{ type: "text", text: "sent" }] };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function reconnect() {
    const stall = h.stall as { setError: (m: string | null) => void };
    act(() => stall.setError("Nick stopped responding"));
    const opts = vi.mocked(toast.error).mock.calls.at(-1)![1] as { action: { onClick: () => void } };
    act(() => opts.action.onClick());
  }

  function networkKill() {
    h.chat.status = "error";
    h.chat.error = new Error("Load failed");
    render();
    act(() => vi.advanceTimersByTime(10_000));
  }

  it("Reconnect, the merge drops the tool part, the GET dies: no regenerate", () => {
    act(() => void ctl.sendText("send it to telegram"));
    h.chat.messages = [user, toolReply];
    render();
    reconnect();
    h.chat.messages = [user, merged];
    networkKill();
    expect(h.chat.resumeStream).toHaveBeenCalledTimes(1);
    expect(h.chat.regenerate).not.toHaveBeenCalled();
  });

  it("the automatic partial re-resume is a reattach too", () => {
    act(() => void ctl.sendText("send it to telegram"));
    act(() => transport().onResumePartial());
    act(() => vi.advanceTimersByTime(1_500));
    expect(h.chat.resumeStream).toHaveBeenCalledTimes(1);
    h.chat.messages = [user, merged];
    networkKill();
    expect(h.chat.regenerate).not.toHaveBeenCalled();
  });

  it("a failed mount-time resume (useChat resume:true) never regenerates", () => {
    h.chat.messages = [user, merged];
    networkKill();
    expect(h.chat.regenerate).not.toHaveBeenCalled();
  });

  it.each([
    ["sendText", () => ctl.sendText("next")],
    ["append", () => ctl.append({ text: "next" })],
    ["regenerate", () => ctl.regenerate()],
  ] as const)("CONTROL: after a Reconnect, %s re-arms the auto-retry for a dropped send", (_name, send) => {
    reconnect();
    act(() => void send());
    const manual = vi.mocked(h.chat.regenerate as () => void).mock.calls.length;
    h.chat.messages = [user, reply];
    networkKill();
    expect(vi.mocked(h.chat.regenerate as () => void).mock.calls.length - manual).toBe(1);
  });
});

// P2-B6 fix round 2 · the 1.5 s partial re-resume belongs to the turn that was
// tailing. A send, a stop or an unmount inside that window must cancel it, or
// it resumes against the NEW turn and marks that turn's request a reattach.
describe("the partial re-resume timer dies with its turn", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const partial = () => act(() => transport().onResumePartial());
  const resumes = () => vi.mocked(h.chat.resumeStream as () => void).mock.calls.length;

  it("CONTROL: with no send, it resumes once after 1.5 s", () => {
    partial();
    act(() => vi.advanceTimersByTime(1_499));
    expect(resumes()).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(resumes()).toBe(1);
  });

  it.each([
    ["sendText", () => ctl.sendText("next")],
    ["append", () => ctl.append({ text: "next" })],
    ["regenerate", () => ctl.regenerate()],
    ["stop", () => ctl.stop()],
    ["stopTurn", () => ctl.stopTurn()],
  ] as const)("%s inside the window cancels it", (_name, act_) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    partial();
    act(() => void act_());
    act(() => vi.advanceTimersByTime(5_000));
    expect(resumes()).toBe(0);
  });

  it("two partials inside the window leave one pending re-resume, and a send cancels it", () => {
    partial();
    partial();
    act(() => void ctl.sendText("next"));
    act(() => vi.advanceTimersByTime(5_000));
    expect(resumes()).toBe(0);
  });

  it("unmount inside the window cancels it", () => {
    partial();
    act(() => root.unmount());
    act(() => vi.advanceTimersByTime(5_000));
    expect(resumes()).toBe(0);
    root = createRoot(container);
    render();
  });

  it("a send inside the window keeps the new turn's dropped send auto-retryable", () => {
    partial();
    act(() => void ctl.sendText("next"));
    act(() => vi.advanceTimersByTime(1_500));
    h.chat.messages = [user, reply];
    h.chat.status = "error";
    h.chat.error = new Error("Load failed");
    render();
    act(() => vi.advanceTimersByTime(10_000));
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
  });
});
