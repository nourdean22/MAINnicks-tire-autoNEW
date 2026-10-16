// @vitest-environment jsdom
/**
 * UI v3 W3b round 3 (A4): the glue the round-2 suite could not see. Four mutants of use-chat-stream.ts
 * survived every test green: the re-attach after a detached send removed (M1), detachPageContext not
 * setting its flag (M2), setHold(null) removed from resetTurn / append / a check that went (M3), and
 * setHold(RETRY_STILL_CHECKING) removed (M4). This mounts the hook with a page context the bridge
 * really returns and reads the REQUEST BODY at the moment each send goes out (the transport's
 * bodyRef), so the chip's state is never the thing asserted; the body is. Red lines for the four
 * mutants are in the round-3 RETURN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ChatRuntimeController } from "@/features/chat-v2/types/chat-runtime-controller";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Msg = { id: string; role: string; parts: Array<{ type: string; text?: string }>; streamingState?: string; tokenUsage?: unknown };
type TransportOpts = { lastTraceIdRef: { current: string | null }; transportBodyRef: { current: Record<string, unknown> } };

const h = vi.hoisted(() => ({
  chat: {} as Record<string, unknown>,
  transport: undefined as unknown,
  context: { contextRoute: "/decisions/abc", lastDecisionId: "dec_1", ts: 0 } as Record<string, unknown>,
}));
vi.mock("@ai-sdk/react", () => ({ useChat: () => h.chat }));
vi.mock("@/hooks/chat/use-chat-transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/chat/use-chat-transport")>()),
  useChatTransport: (opts: unknown) => {
    h.transport = opts;
    return {};
  },
}));
vi.mock("@/hooks/chat/use-chat-stall", () => ({ useChatStall: () => ({ stallStatus: "ok" }) }));
vi.mock("@/hooks/chat/use-streaming-error-guard", () => ({ useStreamingErrorGuard: () => {} }));
// The bridge holds a page context: a decision page's anchors and its route.
vi.mock("@/components/chat/page-context-bridge", () => ({
  readPageContext: () => h.context,
  onPageContextChanged: () => () => {},
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));

import { useChatStream } from "@/features/chat-v2/hooks/use-chat-stream";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";
import { RETRY_STILL_CHECKING } from "@/features/chat-v2/lib/saved-turn";

const transport = () => h.transport as TransportOpts;
const user: Msg = { id: "u1", role: "user", parts: [{ type: "text", text: "question" }] };
const reply: Msg = { id: "a1", role: "assistant", parts: [{ type: "text", text: "answer" }] };
/** A saved turn that is safe to replay: text only, settled receipts, the trace that failed. */
const savedSafe = [user, { ...reply, streamingState: "complete", tokenUsage: { toolReceipts: [], traceId: "T2" } }];

let ctl: ContainerCtl;
type ContainerCtl = ChatRuntimeController;
let hookOptions: Parameters<typeof useChatStream>[0];
function Probe({ onCtl }: { onCtl: (c: ChatRuntimeController) => void }) {
  onCtl(useChatStream(hookOptions));
  return null;
}
let container: HTMLDivElement;
let root: Root;
const render = () => act(() => root.render(<Probe onCtl={(c) => { ctl = c; }} />));

/** The request body as it was when each send or replay left: a copy, because the hook mutates one ref in place. */
let bodies: Array<{ via: "send" | "replay"; body: Record<string, unknown> }>;
const anchors = (body: Record<string, unknown>) => ({ lastDecisionId: body.lastDecisionId, contextRoute: body.contextRoute });
const CLEAN = { lastDecisionId: undefined, contextRoute: undefined };
const ATTACHED = { lastDecisionId: "dec_1", contextRoute: "/decisions/abc" };

beforeEach(() => {
  bodies = [];
  h.chat = {
    status: "ready",
    messages: [user, reply],
    error: undefined,
    setMessages: vi.fn(),
    stop: vi.fn(),
    resumeStream: vi.fn(),
    sendMessage: vi.fn(() => { bodies.push({ via: "send", body: { ...transport().transportBodyRef.current } }); }),
    regenerate: vi.fn(() => { bodies.push({ via: "replay", body: { ...transport().transportBodyRef.current } }); }),
    clearError: vi.fn(() => {
      h.chat.error = undefined;
      h.chat.status = "ready";
    }),
  };
  hookOptions = undefined;
  useChatUiStore.setState({ activeConversationId: "c1", privateMode: false });
  container = document.createElement("div");
  root = createRoot(container);
  render();
});
afterEach(() => {
  act(() => root.unmount());
});

describe("the page-context chip's detach covers exactly one user send (M1, M2)", () => {
  it("attached by default: the body carries the anchors and the chip names the route", () => {
    expect(anchors(transport().transportBodyRef.current)).toEqual(ATTACHED);
    expect(ctl.pageContext).toEqual({ route: "/decisions/abc" });
  });

  it("the detached send goes out clean, its replay stays clean, the NEXT send carries the anchors again", async () => {
    act(() => ctl.detachPageContext());
    render();

    // The body first: the chip is a mirror, the body is what the server receives.
    await act(async () => { await ctl.sendText("first, without the page"); });
    expect(bodies.at(-1)?.via).toBe("send");
    expect(anchors(bodies.at(-1)!.body), "M2: the detached send must not carry the anchors").toEqual(CLEAN);
    expect(ctl.pageContext, "the chip is gone while detached").toBeNull();

    // Retry of that turn (no error, nothing in flight: the direct replay) stays as the turn was sent.
    await act(async () => { await ctl.regenerate(); });
    expect(bodies.at(-1)?.via).toBe("replay");
    expect(anchors(bodies.at(-1)!.body), "the replay of the detached turn must stay clean").toEqual(CLEAN);

    await act(async () => { await ctl.sendText("second, with the page"); });
    expect(bodies.at(-1)?.via).toBe("send");
    expect(anchors(bodies.at(-1)!.body), "M1: the send after the detached one must re-attach").toEqual(ATTACHED);
    render();
    expect(ctl.pageContext, "and the chip is back").toEqual({ route: "/decisions/abc" });
  });
});

/** A stream error the server owns (it answered with T2 since the send), so Retry reads the saved turn first. */
function erroredTurn(read: (id: string, signal?: AbortSignal) => Promise<unknown>) {
  hookOptions = { readSavedTurn: read as never };
  h.chat.status = "error";
  h.chat.error = new Error("stream failed");
  render();
  transport().lastTraceIdRef.current = "T2";
}
const never = () => new Promise<never>(() => {});
/** Two taps while the read is still out: the second one holds with RETRY_STILL_CHECKING. */
async function holdStillChecking() {
  act(() => void ctl.regenerate());
  await act(async () => { await ctl.regenerate(); });
  render();
  expect(ctl.hold, "M4: the second tap must hold with RETRY_STILL_CHECKING").toBe(RETRY_STILL_CHECKING);
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("the Retry hold is set by a second tap and cleared by what moves on (M3, M4)", () => {
  it("a second tap while the saved turn is being read holds with RETRY_STILL_CHECKING (M4)", async () => {
    erroredTurn(never);
    await holdStillChecking();
  });

  it("resetTurn clears the hold (M3)", async () => {
    erroredTurn(never);
    await holdStillChecking();
    act(() => ctl.resetTurn());
    render();
    expect(ctl.hold).toBeNull();
  });

  it("append clears the hold (M3)", async () => {
    erroredTurn(never);
    await holdStillChecking();
    await act(async () => { await ctl.append({ text: "a new message" }); });
    render();
    expect(ctl.hold).toBeNull();
  });

  it("a check that comes back GO clears the hold and replays (M3)", async () => {
    let settle!: (rows: unknown) => void;
    erroredTurn(() => new Promise((resolve) => { settle = resolve; }));
    await holdStillChecking();
    await act(async () => {
      settle(savedSafe);
      await flush();
    });
    render();
    expect(h.chat.regenerate, "the first tap's check went: the replay ran").toHaveBeenCalledTimes(1);
    expect(ctl.hold).toBeNull();
  });
});

// Round 3 (A5): the two refusals safeRegenerate says itself reach the hold, and a "still checking"
// hold left behind by a check that came back STALE is cleared by the next replay that goes (the
// direct one, and the killed-turn reattach).
describe("round 3 (A5): refusals mirror into the hold; a stale hold does not outlive a replay", () => {
  it("a side-effecting turn's refusal is held, not only toasted", async () => {
    h.chat.messages = [user, { id: "a2", role: "assistant", parts: [{ type: "tool-createQuickQuote" }, { type: "text", text: "Sent." }] }];
    render();
    await act(async () => { await ctl.regenerate(); });
    render();
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(ctl.hold).toBe("That reply may have run an action, so it can't be replayed. Send a new message instead.");
  });

  it("a private turn's refusal is held too", async () => {
    useChatUiStore.setState({ privateMode: true });
    render();
    await act(async () => { await ctl.sendText("a private question"); });
    useChatUiStore.setState({ privateMode: false });
    render();
    await act(async () => { await ctl.regenerate(); });
    render();
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(ctl.hold).toBe("That turn was private. Turn Private Lab back on to retry it.");
  });

  it("a check that comes back STALE leaves the second tap's hold; the next direct replay clears it", async () => {
    let settle!: (rows: unknown) => void;
    erroredTurn(() => new Promise((resolve) => { settle = resolve; }));
    await holdStillChecking();
    // the operator moved on while the read was out: the turn key the tap saw no longer matches
    h.chat.messages = [user, reply, { id: "u2", role: "user", parts: [{ type: "text", text: "another" }] }];
    render();
    await act(async () => {
      settle(savedSafe);
      await flush();
    });
    render();
    expect(h.chat.regenerate, "stale: nothing replayed").not.toHaveBeenCalled();
    expect(ctl.hold, "the stale hold is still there (nothing cleared it yet)").toBe(RETRY_STILL_CHECKING);

    // the error settled and Retry lands on a plain turn: the direct replay
    h.chat.error = undefined;
    h.chat.status = "ready";
    h.chat.messages = [user, reply];
    render();
    await act(async () => { await ctl.regenerate(); });
    render();
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    expect(ctl.hold).toBeNull();
  });

  it("the killed-turn reattach clears a stale hold too", async () => {
    // a send first: the mount-time resume flag is cleared by every send, and the kill effect ignores a resume
    await act(async () => { await ctl.sendText("question"); });
    erroredTurn(never);
    await holdStillChecking();
    // the POST was answered (T2 since the send), then the network died: the server owns the turn
    h.chat.error = new Error("Failed to fetch");
    render();
    await act(async () => { await ctl.regenerate(); });
    render();
    expect(h.chat.resumeStream, "Retry reattached instead of replaying").toHaveBeenCalled();
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(ctl.hold).toBeNull();
  });
});
