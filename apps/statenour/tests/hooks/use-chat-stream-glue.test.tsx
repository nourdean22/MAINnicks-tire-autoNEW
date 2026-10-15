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
  onResumeEmpty?: () => void;
  onConversationId?: (id: string) => void;
  onTraceId?: (id: string) => void;
};

const h = vi.hoisted(() => ({
  chat: {} as Record<string, unknown>,
  transport: undefined as unknown,
  stall: undefined as unknown,
}));
vi.mock("@ai-sdk/react", () => ({ useChat: () => h.chat }));
// The real isResumedMessage: the Retry gate (turn-side-effect.ts) reads it.
vi.mock("@/hooks/chat/use-chat-transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/chat/use-chat-transport")>()),
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
import { RETRY_HELD_NO_RECORD, RETRY_HELD_RAN, RETRY_HELD_RESENT_UNKNOWN, RETRY_HELD_UNCONFIRMED, RETRY_STILL_CHECKING } from "@/features/chat-v2/lib/saved-turn";

const transport = () => h.transport as TransportOpts;
const user: Msg = { id: "u1", role: "user", parts: [{ type: "text", text: "question" }] };
const reply: Msg = { id: "live-1", role: "assistant", parts: [{ type: "text", text: "streamed" }] };

let ctl: ChatRuntimeController;
// The hook's controller leaves the component through a prop callback, not an outer reassignment.
// Options for the next mount; tests that need the saved-turn reader set this before render().
let hookOptions: Parameters<typeof useChatStream>[0];
function Probe({ onCtl }: { onCtl: (c: ChatRuntimeController) => void }) {
  onCtl(useChatStream(hookOptions));
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
    // the SDK's own: drops the error and returns to ready
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
  ] as const)("CONTROL: after a Reconnect, %s re-arms the auto-retry for a dropped send", (_name, send) => {
    reconnect();
    act(() => void send());
    const manual = vi.mocked(h.chat.regenerate as () => void).mock.calls.length;
    h.chat.messages = [user, reply];
    networkKill();
    expect(vi.mocked(h.chat.regenerate as () => void).mock.calls.length - manual).toBe(1);
  });

  // A regenerate resends a turn the server already knows. If its POST dies before any response
  // header the client cannot tell whether the server started it (the server does not stop when the
  // client disconnects), so the auto retry no longer replays it blind: the saved turn decides.
  // This used to be a re-armed auto retry like the two sends above. This hook has no saved-turn
  // reader here, so the hold it reaches is "nothing saved to check" (RETRY_HELD_NO_RECORD); the
  // judge behind the hold is pinned in the "replay that dies before the server's response headers" tests.
  it("after a Reconnect, a regenerate whose POST dies before any header is held (no saved record to check), not auto-retried blind", async () => {
    vi.mocked(toast.error).mockClear();
    reconnect();
    vi.mocked(toast.error).mockClear();
    act(() => void ctl.regenerate());
    const manual = vi.mocked(h.chat.regenerate as () => void).mock.calls.length;
    h.chat.messages = [user, reply];
    networkKill();
    // let the hold's async check finish (microtasks only: the fake timers stay untouched)
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(vi.mocked(h.chat.regenerate as () => void).mock.calls.length - manual).toBe(0);
    expect(vi.mocked(toast.error).mock.calls.at(-1)?.[0], "the hold says why").toBe(RETRY_HELD_NO_RECORD);
  });
});

// R3-05 (04-F7 + 04-H4): every Retry path (error card, interrupted card, the
// cut-off and refused chips, the quality bar) reaches safeRegenerate, so the
// side-effect refusal lives there. After a reload the bubble has no tool parts:
// only tokenUsage.toolReceipts (top level, as use-conversations loads it) says
// what ran.
describe("Retry never re-runs a turn that ran a side-effecting tool", () => {
  // The shape the receipts writer stores: all eight fields (persist-assistant-message
  // + toolReceiptRows), never a bare { toolName, sideEffecting }.
  const storedReceipt = (toolName: string, sideEffecting: boolean, verifiable = true) => ({
    toolName,
    category: "personal_write",
    sideEffecting,
    verifiable,
    status: "success",
    verificationState: "PROVIDER_ACCEPTED",
    entityType: null,
    entityId: null,
  });
  const reloaded = (sideEffecting: boolean) => ({
    id: "db-2",
    role: "assistant",
    parts: [{ type: "text", text: "Sent the quote." }],
    tokenUsage: { toolReceipts: [sideEffecting ? storedReceipt("createQuickQuote", true) : storedReceipt("searchMemories", false)] },
  });

  it("refuses a reloaded turn whose receipts show a side effect, and says why", () => {
    h.chat.messages = [user, reloaded(true)];
    h.chat.status = "ready";
    render();
    vi.mocked(toast.error).mockClear();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: receipts with no side effect still regenerate", () => {
    h.chat.messages = [user, reloaded(false)];
    h.chat.status = "ready";
    render();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
  });

  it("refuses a resumed bubble (its parts cannot show what ran)", () => {
    h.chat.messages = [user, { ...reply, metadata: { resumed: true } }];
    h.chat.status = "ready";
    render();
    vi.mocked(toast.error).mockClear();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    // R3-15 (review finding 5): a resumed text-only bubble MAY have run one; never state it as fact.
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(
      "That reply may have run an action, so it can't be replayed. Send a new message instead.",
    );
  });

  it("refuses a live turn with a side-effecting tool part", () => {
    h.chat.messages = [user, { id: "live-1", role: "assistant", parts: [{ type: "tool-createQuickQuote" }, { type: "text", text: "Sent." }] }];
    h.chat.status = "ready";
    render();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).not.toHaveBeenCalled();
  });

  // The live check used the catalog's narrow `sideEffecting` flag. createTask,
  // completeTask and triggerBrief are personal_write tools with no flag, so a
  // live turn that wrote a task could be replayed and wrote it twice. The
  // receipt classifier (write when flagged OR a *_write category) is the one
  // the persisted receipts use, so the live check must agree with it.
  it.each(["createTask", "completeTask", "triggerBrief"])(
    "refuses a live turn with %s, a personal_write tool the catalog does not flag",
    (toolName) => {
      h.chat.messages = [user, { id: "live-1", role: "assistant", parts: [{ type: `tool-${toolName}` }, { type: "text", text: "Done." }] }];
      h.chat.status = "ready";
      render();
      vi.mocked(toast.error).mockClear();
      act(() => void ctl.regenerate());
      expect(h.chat.regenerate).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    },
  );

  // These executors write but are neither flagged, in a *_write category nor
  // (for the receipt classifier) named like a write; they counted as reads.
  it.each(["setMit", "clearMit", "setOKRs", "setWeeklyTargets", "scheduleFollowUp", "queueDeepResearch", "runPython"])(
    "refuses a live turn with %s, a tool that writes and used to count as a read",
    (toolName) => {
      h.chat.messages = [user, { id: "live-1", role: "assistant", parts: [{ type: `tool-${toolName}` }, { type: "text", text: "Done." }] }];
      h.chat.status = "ready";
      render();
      act(() => void ctl.regenerate());
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a tool the catalog has never heard of", { type: "tool-notInTheCatalog" }],
    ["a dynamic tool (its name is never in the catalog)", { type: "dynamic-tool", toolName: "pushToShop" }],
  ])("refuses a live turn with %s: unclassifiable counts as a write", (_label, toolPart) => {
    h.chat.messages = [user, { id: "live-1", role: "assistant", parts: [toolPart, { type: "text", text: "Done." }] }];
    h.chat.status = "ready";
    render();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).not.toHaveBeenCalled();
  });

  it("CONTROL: a live turn that only ran a read tool still regenerates", () => {
    h.chat.messages = [user, { id: "live-1", role: "assistant", parts: [{ type: "tool-getRevenueStats" }, { type: "text", text: "Revenue is up." }] }];
    h.chat.status = "ready";
    render();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
  });

  // R3-15: an errored row written before the errored-turn writer recorded
  // receipts has no tokenUsage, and an aborted or truncated row older than the
  // receipts writer has none either. No record of what ran means it may have
  // run: fail closed.
  it.each([
    ["errored", null],
    ["aborted", { traceId: "T0" }],
    ["truncated", { traceId: "T0" }],
  ])("refuses a reloaded %s turn with no receipt record", (streamingState, tokenUsage) => {
    h.chat.messages = [user, { id: "db-3", role: "assistant", parts: [{ type: "text", text: "Sent the SMS to Mike and then" }], streamingState, tokenUsage }];
    h.chat.status = "ready";
    render();
    vi.mocked(toast.error).mockClear();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: an errored turn whose receipts show no side effect still regenerates", () => {
    h.chat.messages = [user, { ...reloaded(false), streamingState: "errored" }];
    h.chat.status = "ready";
    render();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
  });

  // The errored-turn writer stores what it saw: toolReceipts rows shaped like a
  // finished turn's, or receiptsUnavailable when it cannot vouch for them.
  describe("an errored turn's own receipts decide Retry", () => {
    const receiptRow = (toolName: string, sideEffecting: boolean, verifiable = true) => ({
      toolName,
      category: "personal_write",
      sideEffecting,
      verifiable,
      status: "partial",
      verificationState: "UNKNOWN_COMPLETION",
      entityType: null,
      entityId: null,
    });
    const erroredRow = (tokenUsage: unknown, streamingState = "errored") => ({
      id: "db-5",
      role: "assistant",
      parts: [{ type: "text", text: "Created the task and then" }],
      streamingState,
      tokenUsage,
    });
    const retry = (row: unknown) => {
      h.chat.messages = [user, row];
      h.chat.status = "ready";
      render();
      vi.mocked(toast.error).mockClear();
      act(() => void ctl.regenerate());
    };

    it.each([
      ["receiptsUnavailable", erroredRow({ receiptsUnavailable: true })],
      // The marker alone refuses; it must not lean on the row reading as unfinished.
      ["receiptsUnavailable on a row that does not read as unfinished", erroredRow({ receiptsUnavailable: true }, "complete")],
      ["a write among its receipts", erroredRow({ toolReceipts: [receiptRow("searchMemories", false), receiptRow("createTask", true)] })],
      ["a receipt the classifier could not place", erroredRow({ toolReceipts: [receiptRow("notInTheCatalog", false, false)] })],
    ])("refuses an errored turn with %s", (_label, row) => {
      retry(row);
      expect(h.chat.regenerate).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["receipts that are all reads", erroredRow({ toolReceipts: [receiptRow("searchMemories", false), receiptRow("getRevenueStats", false)] })],
      ["an empty receipts list and plain text (no SDK tool ran, no action block)", erroredRow({ toolReceipts: [] })],
    ])("CONTROL: still regenerates an errored turn with %s", (_label, row) => {
      retry(row);
      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    });
  });

  // The gate trusted the flags stored in a receipt. Rows written before the
  // default-deny stored sideEffecting:false for the tools below although their
  // executors write, so Retry stayed open after a reload. Every receipt is now
  // re-classified by toolName through the registry as well, and a receipt whose
  // flags are missing, null or not booleans counts as a write.
  describe("a reloaded row is judged by tool name, not only by the flags it was stored with", () => {
    // The OLD persisted shape: classified by the old narrow rule, so no flag, no write category, no write.
    const oldRow = (toolName: string) => ({
      id: "db-old",
      role: "assistant",
      parts: [{ type: "text", text: "Done." }],
      streamingState: "complete",
      tokenUsage: {
        toolReceipts: [
          { toolName, category: "planning", sideEffecting: false, verifiable: true, status: "success", verificationState: "PROVIDER_ACCEPTED", entityType: null, entityId: null },
        ],
      },
    });
    const retry = (row: unknown) => {
      h.chat.messages = [user, row];
      h.chat.status = "ready";
      render();
      vi.mocked(toast.error).mockClear();
      act(() => void ctl.regenerate());
    };

    it.each(["setMit", "clearMit", "setOKRs", "setWeeklyTargets", "scheduleFollowUp", "queueDeepResearch", "runPython", "arsenalDeepResearch", "runSimulation"])(
      "refuses an old row whose %s receipt says sideEffecting:false",
      (toolName) => {
        retry(oldRow(toolName));
        expect(h.chat.regenerate).not.toHaveBeenCalled();
        expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
      },
    );

    it("refuses an old row for a tool name the catalog no longer has", () => {
      retry(oldRow("aToolThatWasRemoved"));
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });

    const stored = (receipt: unknown) => ({
      id: "db-m",
      role: "assistant",
      parts: [{ type: "text", text: "Here you go." }],
      streamingState: "complete",
      tokenUsage: { toolReceipts: [receipt] },
    });
    const read = { toolName: "searchMemories", category: "brain", sideEffecting: false, verifiable: true, status: "success", verificationState: "VERIFIED", entityType: null, entityId: null };

    it.each([
      ["sideEffecting is missing", { ...read, sideEffecting: undefined }],
      ["sideEffecting is null", { ...read, sideEffecting: null }],
      ["sideEffecting is the string 'false'", { ...read, sideEffecting: "false" }],
      ["verifiable is missing", { ...read, verifiable: undefined }],
      ["verifiable is null", { ...read, verifiable: null }],
      ["verifiable is the string 'true'", { ...read, verifiable: "true" }],
      ["toolName is missing", { ...read, toolName: undefined }],
      ["toolName is not a string", { ...read, toolName: 7 }],
      ["the receipt is null", null],
      ["the receipt is a string", "searchMemories"],
    ])("refuses a receipt where %s", (_label, receipt) => {
      retry(stored(receipt));
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });

    it("CONTROL: a full read receipt, and a full compute receipt, still regenerate", () => {
      retry(stored(read));
      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
      h.chat.regenerate = vi.fn();
      retry(stored({ ...read, toolName: "runCode", category: "ai_analysis" }));
      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    });

    it("one write among reads is enough to refuse", () => {
      retry({ ...stored(read), tokenUsage: { toolReceipts: [read, { ...read, toolName: "setMit", category: "planning" }] } });
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });
  });

  // A reply the visible text of which is empty is salvaged from reasoning
  // (salvage-event-text), and parseActions then executes an action block found
  // there, so the gate reads reasoning parts as well as text parts.
  describe("an action block in a reasoning part counts too", () => {
    const block = '```action\n{"type":"task.create","params":{"title":"Call Mike"}}\n```';
    it("refuses a reloaded row whose reasoning part carries a block and whose text is empty", () => {
      h.chat.messages = [user, { id: "db-r", role: "assistant", parts: [{ type: "reasoning", text: block }, { type: "text", text: "" }], streamingState: "complete", tokenUsage: { toolReceipts: [] } }];
      h.chat.status = "ready";
      render();
      act(() => void ctl.regenerate());
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });

    it("refuses a live bubble whose reasoning part carries a block", () => {
      h.chat.messages = [user, { id: "live-r", role: "assistant", parts: [{ type: "reasoning", text: block }] }];
      h.chat.status = "ready";
      render();
      act(() => void ctl.regenerate());
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });

    it("CONTROL: reasoning that merely talks about an action still regenerates", () => {
      h.chat.messages = [user, { id: "live-q", role: "assistant", parts: [{ type: "reasoning", text: "The next action is to answer plainly." }, { type: "text", text: "Done." }] }];
      h.chat.status = "ready";
      render();
      act(() => void ctl.regenerate());
      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    });
  });

  // A persisted row (it carries its own streamingState) with no receipts array is
  // UNKNOWN, not clean: every row from before receipts were stored, every
  // fast-path and specialist reply, and any row whose toolReceipts is not an
  // array. Over-refusal here is the accepted price of failing closed.
  describe("a persisted row with no receipts array is unknown", () => {
    const persisted = (extra: Record<string, unknown>) => ({
      id: "db-4",
      role: "assistant",
      parts: [{ type: "text", text: "Here is the plan." }],
      streamingState: "complete",
      ...extra,
    });
    const retry = (row: unknown) => {
      h.chat.messages = [user, row];
      h.chat.status = "ready";
      render();
      vi.mocked(toast.error).mockClear();
      act(() => void ctl.regenerate());
    };

    it.each([
      ["a complete row whose tokenUsage has no toolReceipts", persisted({ tokenUsage: { traceId: "T0" } })],
      ["a complete row with no tokenUsage at all", persisted({ tokenUsage: null })],
      ["a refused row with no receipts", persisted({ streamingState: "refused", tokenUsage: { traceId: "T0" } })],
      ["toolReceipts that is an object, not an array", persisted({ tokenUsage: { toolReceipts: { toolName: "createTask" } } })],
      ["toolReceipts that is a string", persisted({ tokenUsage: { toolReceipts: "none" } })],
    ])("refuses %s", (_label, row) => {
      retry(row);
      expect(h.chat.regenerate).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    });

    // Pinned separately from the rule above: these shapes carry no streamingState
    // (a bubble) or already hold an array, so only the marker and the malformed
    // value checks can refuse them.
    it("refuses the marker even beside a clean receipts array (a contradiction is not a green light)", () => {
      retry(persisted({ tokenUsage: { receiptsUnavailable: true, toolReceipts: [] } }));
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });

    it("refuses a bubble with no streamingState whose tokenUsage carries the marker", () => {
      retry({ id: "live-5", role: "assistant", parts: [{ type: "text", text: "Done." }], tokenUsage: { receiptsUnavailable: true } });
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });

    it.each([["an object", { toolName: "createTask" }], ["a string", "none"], ["a number", 0]])(
      "refuses a bubble with no streamingState whose toolReceipts is %s",
      (_label, toolReceipts) => {
        retry({ id: "live-6", role: "assistant", parts: [{ type: "text", text: "Done." }], tokenUsage: { toolReceipts } });
        expect(h.chat.regenerate).not.toHaveBeenCalled();
      },
    );

    it("CONTROL: a complete row whose receipts array is empty (a text-only reply) still regenerates", () => {
      retry(persisted({ tokenUsage: { toolReceipts: [] } }));
      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    });

    it("CONTROL: a live bubble (no streamingState, no tokenUsage) with text only still regenerates", () => {
      retry({ id: "live-9", role: "assistant", parts: [{ type: "text", text: "Here is the plan." }] });
      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    });
  });

  // A reply that carries an ```action block (or an [ACTION: {...}] marker) is
  // parsed and executed AFTER the stream, with no tool part and no receipt, so a
  // recorded [] does not mean nothing ran. The stored text keeps the block.
  describe("a reply whose text carries an action block is not replayable", () => {
    const FENCED = '```action\n{"type":"task.create","params":{"title":"Call Mike"}}\n```';
    const INLINE = 'Done. [ACTION: {"type":"decision.log","params":{"title":"x"}}]';
    const MALFORMED = '```action\n{"type": "task.create", "params": \n```';
    const retry = (row: unknown) => {
      h.chat.messages = [user, row];
      h.chat.status = "ready";
      render();
      vi.mocked(toast.error).mockClear();
      act(() => void ctl.regenerate());
    };

    it.each([
      ["a fenced block", FENCED],
      ["an inline marker", INLINE],
      ["a malformed block (it may still have been parsed)", MALFORMED],
    ])("refuses a reloaded row with %s even though toolReceipts is []", (_label, text) => {
      retry({ id: "db-6", role: "assistant", parts: [{ type: "text", text }], streamingState: "complete", tokenUsage: { toolReceipts: [] } });
      expect(h.chat.regenerate).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    });

    it("refuses a live bubble with a fenced block", () => {
      retry({ id: "live-7", role: "assistant", parts: [{ type: "text", text: FENCED }] });
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });

    it("CONTROL: text that merely mentions an action still regenerates", () => {
      retry({ id: "db-8", role: "assistant", parts: [{ type: "text", text: "The next action is to call Mike back." }], streamingState: "complete", tokenUsage: { toolReceipts: [] } });
      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    });
  });

  // Fast-path replies (brain dump, /save, a logged decision, a generated image)
  // write without a tool part or a receipt. Their bubble carries
  // metadata.receiptsUnavailable from the stream's start chunk, and their row
  // stores tokenUsage.receiptsUnavailable.
  it("refuses a live fast-path bubble (metadata.receiptsUnavailable), which has no tool part and no tokenUsage", () => {
    h.chat.messages = [user, { id: "dec_1", role: "assistant", parts: [{ type: "text", text: "Logged." }], metadata: { receiptsUnavailable: true } }];
    h.chat.status = "ready";
    render();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).not.toHaveBeenCalled();
  });

  it("a refused Retry leaves the pending partial re-resume alone", () => {
    vi.useFakeTimers();
    try {
      h.chat.messages = [user, reloaded(true)];
      render();
      act(() => transport().onResumePartial());
      act(() => void ctl.regenerate());
      act(() => vi.advanceTimersByTime(1_500));
      expect(h.chat.resumeStream).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a network kill after the server answered reattaches, never resends", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("Failed to fetch with this turn's trace set: resume once, regenerate never", () => {
    act(() => void ctl.sendText("next"));
    transport().lastTraceIdRef.current = "T2";
    h.chat.messages = [user, reply];
    h.chat.status = "error";
    h.chat.error = new Error("Failed to fetch");
    render();
    act(() => vi.advanceTimersByTime(10_000));
    expect(h.chat.resumeStream).toHaveBeenCalledTimes(1);
    expect(h.chat.regenerate).not.toHaveBeenCalled();
  });

  // The phrases other browsers use for the same drop (Chrome and Firefox XHR "network error",
  // Safari "The network connection was lost."). Not in the matcher, they fell through to the
  // auto-retry path and regenerated a turn the server was still running.
  it.each(["network error", "Network Error", "The network connection was lost."])(
    "%s with this turn's trace set: resume once, regenerate never",
    (message) => {
      act(() => void ctl.sendText("next"));
      transport().lastTraceIdRef.current = "T2";
      h.chat.messages = [user, reply];
      h.chat.status = "error";
      h.chat.error = new Error(message);
      render();
      act(() => vi.advanceTimersByTime(10_000));
      expect(h.chat.resumeStream).toHaveBeenCalledTimes(1);
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    },
  );

  it("CONTROL: an error message that is not a network drop is not reattached", () => {
    act(() => void ctl.sendText("next"));
    transport().lastTraceIdRef.current = "T2";
    h.chat.messages = [user, reply];
    h.chat.status = "error";
    h.chat.error = new Error("The AI provider returned an error");
    render();
    act(() => vi.advanceTimersByTime(10_000));
    expect(h.chat.resumeStream).not.toHaveBeenCalled();
  });

  // R3-15 (review finding 2): ai@6 goes error -> ready on a 204 resume, so the
  // error card vanished and the cut-off turn looked finished.
  function killThenEmptyResume() {
    act(() => void ctl.sendText("next"));
    transport().lastTraceIdRef.current = "T2";
    h.chat.messages = [user, reply];
    h.chat.status = "error";
    h.chat.error = new Error("Load failed");
    render();
    act(() => vi.advanceTimersByTime(10_000));
    expect(h.chat.resumeStream).toHaveBeenCalledTimes(1);
    vi.mocked(toast.error).mockClear();
    act(() => transport().onResumeEmpty?.());
    h.chat.status = "ready";
    h.chat.error = undefined;
    render();
  }

  it("a resume that finds nothing keeps the turn interrupted and offers Reconnect", () => {
    killThenEmptyResume();
    expect(ctl.error?.message, "the error card must survive the 204").toBe("Load failed");
    const call = vi.mocked(toast.error).mock.calls.at(-1);
    expect(call?.[1]).toMatchObject({ id: "chat-stall", duration: Infinity, action: { label: "Reconnect" } });
    act(() => (call![1] as { action: { onClick: () => void } }).action.onClick());
    expect(h.chat.resumeStream).toHaveBeenCalledTimes(2);
    expect(h.chat.regenerate).not.toHaveBeenCalled();
  });

  // The held card shows Retry, but the server owns that turn: a regenerate
  // would run it twice (a tool it had not reached yet would fire in both).
  it("Retry on a held interruption reattaches, never regenerates", () => {
    killThenEmptyResume();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(h.chat.resumeStream).toHaveBeenCalledTimes(2);
  });

  it("Retry inside the reattach window reattaches too", () => {
    act(() => void ctl.sendText("next"));
    transport().lastTraceIdRef.current = "T2";
    h.chat.messages = [user, reply];
    h.chat.status = "error";
    h.chat.error = new Error("Load failed");
    render();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(h.chat.resumeStream).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: once a reattach streams, Retry regenerates as usual", () => {
    act(() => void ctl.sendText("next"));
    transport().lastTraceIdRef.current = "T2";
    h.chat.messages = [user, reply];
    h.chat.status = "error";
    h.chat.error = new Error("Load failed");
    render();
    act(() => vi.advanceTimersByTime(10_000));
    h.chat.error = undefined;
    h.chat.status = "streaming";
    render();
    h.chat.status = "ready";
    render();
    act(() => void ctl.regenerate());
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
  });

  it("a new send clears the held interruption", () => {
    killThenEmptyResume();
    act(() => void ctl.sendText("again"));
    render();
    expect(ctl.error).toBeUndefined();
  });

  it("CONTROL: an empty mount-time resume (no error before it) raises nothing", () => {
    vi.mocked(toast.error).mockClear();
    h.chat.status = "ready";
    render();
    act(() => transport().onResumeEmpty?.());
    render();
    expect(ctl.error).toBeUndefined();
    expect(vi.mocked(toast.error).mock.calls.some((c) => (c[1] as { id?: string })?.id === "chat-stall")).toBe(false);
  });

  it("CONTROL: the previous turn's trace is not this turn's: the dropped POST is resent", () => {
    act(() => void ctl.sendText("next"));
    h.chat.messages = [user, reply];
    h.chat.status = "error";
    h.chat.error = new Error("Failed to fetch");
    render();
    act(() => vi.advanceTimersByTime(10_000));
    expect(h.chat.resumeStream).not.toHaveBeenCalled();
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
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

// ai@6 does not end the stream at an error part: a later tool-call plus
// finish(tool-calls) still runs the tool on the server. The client SDK rethrows
// on the error chunk, so this bubble holds only the text before it and the live
// gate (tool parts) sees nothing. Only the saved record of the turn can say, so
// Retry in the error state reads it first. The fixture stream is
// [start, text, error, tool-call createTask, finish(tool-calls), text]; the live
// side of it is pinned against the real SDK in
// tests/ai/chat/live-bubble-after-error-part.test.ts.
describe("Retry after a stream error asks the saved turn before replaying", () => {
  const savedWrite = {
    id: "stub",
    role: "assistant",
    content: "Working on it",
    streamingState: "errored",
    // traceId "T2" is the attempt that failed in inBandError(): a row only counts as safe when it names it
    tokenUsage: {
      traceId: "T2",
      toolReceipts: [{ toolName: "createTask", category: "personal_write", sideEffecting: true, verifiable: true, status: "partial", verificationState: "UNKNOWN_COMPLETION", entityType: null, entityId: null }],
    },
  };
  const savedSettledEmpty = { ...savedWrite, tokenUsage: { traceId: "T2", toolReceipts: [] } };
  const savedUnsettled = { ...savedWrite, tokenUsage: { traceId: "T2", receiptsUnavailable: true } };
  const IN_BAND = new Error("The AI provider dropped mid-response. Tap Retry to check and continue.");

  /** The turn was sent, the server answered it (a new trace), then the stream errored in-band. */
  function inBandError() {
    act(() => void ctl.sendText("add a task"));
    transport().lastTraceIdRef.current = "T2";
    h.chat.messages = [user, { id: "live-1", role: "assistant", parts: [{ type: "text", text: "Working on it" }] }];
    h.chat.status = "error";
    h.chat.error = IN_BAND;
    render();
    vi.mocked(toast.error).mockClear();
  }
  const retry = () => act(async () => void (await ctl.regenerate()));

  afterEach(() => {
    hookOptions = undefined;
  });

  it("withholds Retry when the saved turn lists the write that ran after the error part", async () => {
    const readSavedTurn = vi.fn(async () => [savedWrite]);
    hookOptions = { readSavedTurn };
    render();
    inBandError();

    await retry();

    expect(readSavedTurn).toHaveBeenCalledWith("c1", expect.any(AbortSignal));
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RAN);
  });

  it("withholds Retry while the saved row is not settled yet, and says to try again", async () => {
    hookOptions = { readSavedTurn: vi.fn(async () => [savedUnsettled]) };
    render();
    inBandError();

    await retry();

    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_UNCONFIRMED);
  });

  it("replays once the saved row says nothing ran (a cold failure, settled to [])", async () => {
    const readSavedTurn = vi.fn(async () => [savedSettledEmpty]);
    hookOptions = { readSavedTurn };
    render();
    inBandError();

    await retry();

    expect(readSavedTurn).toHaveBeenCalledTimes(1);
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("fails closed with no reader wired, and says no record can be checked (waiting would never help)", async () => {
    hookOptions = undefined;
    render();
    inBandError();

    await retry();

    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_NO_RECORD);
  });

  it("fails closed with a reader that rejects", async () => {
    hookOptions = { readSavedTurn: vi.fn(async () => { throw new Error("network"); }) };
    render();
    inBandError();

    await retry();

    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_UNCONFIRMED);
  });

  it("fails closed with no active conversation to ask about, and never asks", async () => {
    const unasked = vi.fn(async () => [savedSettledEmpty]);
    hookOptions = { readSavedTurn: unasked };
    render();
    inBandError();
    useChatUiStore.setState({ activeConversationId: null });
    render();

    await retry();

    expect(unasked).not.toHaveBeenCalled();
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_NO_RECORD);
  });

  it("a private turn leaves no saved row to read: held without asking, and told to send a new message", async () => {
    const readSavedTurn = vi.fn(async () => [savedSettledEmpty]);
    hookOptions = { readSavedTurn };
    useChatUiStore.setState({ privateMode: true });
    render();
    inBandError();

    await retry();

    expect(readSavedTurn).not.toHaveBeenCalled();
    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_NO_RECORD);
  });

  it("judges every saved row of the turn: a clean stub beside a finish row that lists a write is held", async () => {
    hookOptions = { readSavedTurn: vi.fn(async () => [savedSettledEmpty, { ...savedWrite, id: "finish" }]) };
    render();
    inBandError();

    await retry();

    expect(h.chat.regenerate).not.toHaveBeenCalled();
  });

  it("one check at a time: a second tap while the first is reading does not start a second replay, and says it is still checking", async () => {
    let finish!: (rows: unknown[]) => void;
    const readSavedTurn = vi.fn(() => new Promise<unknown[]>((resolve) => (finish = resolve)));
    hookOptions = { readSavedTurn };
    render();
    inBandError();

    const first = act(async () => void (await ctl.regenerate()));
    try {
      await act(async () => void (await ctl.regenerate()));
      expect(vi.mocked(toast.error), "a silent tap reads as a dead button").toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_STILL_CHECKING);
    } finally {
      // a failed assertion above must not leave the first act scope open for the tests that follow
      finish([savedSettledEmpty]);
      await first;
    }

    expect(readSavedTurn).toHaveBeenCalledTimes(1);
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error), "the first check went ahead and said nothing more").toHaveBeenCalledTimes(1);
  });

  // A regenerate resends the same user message (persistUserTurn dedupes it), so attempt 1's
  // clean row stays in the saved turn. It says nothing about attempt 2.
  it("THE SCENARIO: attempt 1 was clean and replayed; attempt 2 is mid-tool with no saved row of its own; a second Retry is held", async () => {
    const readSavedTurn = vi.fn(async () => [{ id: "u1", role: "user" }, savedSettledEmpty]);
    hookOptions = { readSavedTurn };
    render();
    inBandError();

    await retry();
    expect(h.chat.regenerate, "attempt 1's own row is clean and names its trace: replay").toHaveBeenCalledTimes(1);

    // attempt 2 was answered (a new trace), then its stream died in band; it has written no row yet
    transport().lastTraceIdRef.current = "T3";
    h.chat.status = "error";
    h.chat.error = new Error("The AI provider dropped mid-response. Tap Retry to check and continue.");
    render();
    vi.mocked(toast.error).mockClear();

    await retry();

    expect(readSavedTurn).toHaveBeenCalledTimes(2);
    expect(h.chat.regenerate, "a third attempt would repeat attempt 2's write").toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_UNCONFIRMED);
  });

  it("once attempt 2 has written its own clean row, Retry replays again", async () => {
    const attempt2 = { ...savedSettledEmpty, id: "stub-2", tokenUsage: { traceId: "T3", toolReceipts: [] } };
    const readSavedTurn = vi.fn(async () => [{ id: "u1", role: "user" }, savedSettledEmpty, attempt2]);
    hookOptions = { readSavedTurn };
    render();
    inBandError();
    await retry();
    transport().lastTraceIdRef.current = "T3";
    h.chat.status = "error";
    h.chat.error = new Error("The AI provider dropped mid-response. Tap Retry to check and continue.");
    render();

    await retry();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
  });

  // The guards ran before the await and were never looked at again.
  describe("what changed while the saved turn was being read", () => {
    /** Tap Retry (the read starts and waits); `answer` then lets the read come back with `rows`. */
    function pendingRead() {
      let finish!: (rows: unknown[]) => void;
      const readSavedTurn = vi.fn(() => new Promise<unknown[]>((resolve) => (finish = resolve)));
      hookOptions = { readSavedTurn };
      render();
      inBandError();
      const tap = ctl.regenerate();
      return {
        answer: (rows: unknown[]) =>
          act(async () => {
            finish(rows);
            await tap;
          }),
      };
    }

    it("the operator sent another message: the replay would regenerate THAT message, so nothing is replayed", async () => {
      const { answer } = pendingRead();
      h.chat.messages = [...(h.chat.messages as Msg[]), { id: "u2", role: "user", parts: [{ type: "text", text: "something else" }] }];
      render();
      await answer([savedSettledEmpty]);

      expect(h.chat.regenerate).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error), "the operator moved on: no toast about the old reply").not.toHaveBeenCalled();
    });

    it("the operator switched conversation: nothing is replayed", async () => {
      const { answer } = pendingRead();
      useChatUiStore.setState({ activeConversationId: "c2" });
      render();
      await answer([savedSettledEmpty]);

      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });

    it("a newer turn answered meanwhile (the trace moved on): nothing is replayed", async () => {
      const { answer } = pendingRead();
      transport().lastTraceIdRef.current = "T9";
      await answer([savedSettledEmpty]);

      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });

    it("the chat was unmounted: nothing is replayed", async () => {
      const { answer } = pendingRead();
      act(() => root.unmount());
      root = createRoot(container); // afterEach unmounts a root; give it an empty one
      await answer([savedSettledEmpty]);

      expect(h.chat.regenerate).not.toHaveBeenCalled();
    });

    it("CONTROL: the reply being renamed to its database id while reading is not a new message: the replay goes ahead", async () => {
      const { answer } = pendingRead();
      h.chat.messages = [user, { id: "db-1", role: "assistant", parts: [{ type: "text", text: "Working on it" }] }];
      render();
      await answer([savedSettledEmpty]);

      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    });

    it("CONTROL: nothing changed while reading, so the replay goes ahead", async () => {
      const { answer } = pendingRead();
      await answer([savedSettledEmpty]);

      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    });
  });

  describe("a read that does not come back, or comes back unreadable", () => {
    it("is given up after 12 s: Retry is held with the try-again copy, the request is cancelled, and the next tap works", async () => {
      // Only the timers the hook uses, so React's own scheduler (setImmediate, MessageChannel) stays
      // real under `await act(async ...)`. A review reported a hang when this test ran alone; three
      // filtered runs here passed either way, so this is a precaution, not a proven fix.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const reader = vi.fn((_id: string, _signal?: AbortSignal) => new Promise<unknown[]>(() => {}));
        hookOptions = { readSavedTurn: reader };
        render();
        inBandError();

        const first = ctl.regenerate();
        await act(async () => void (await vi.advanceTimersByTimeAsync(11_999)));
        expect(vi.mocked(toast.error), "still waiting at 11.999 s").not.toHaveBeenCalled();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
          await first;
        });

        expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_UNCONFIRMED);
        expect(h.chat.regenerate).not.toHaveBeenCalled();
        expect(reader.mock.calls[0]?.[1]?.aborted, "the request is cancelled, not left running").toBe(true);

        reader.mockImplementation(async () => [savedSettledEmpty]);
        await retry();
        expect(reader).toHaveBeenCalledTimes(2);
        expect(h.chat.regenerate, "the flag was released").toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("a saved row the gate cannot read (a null part) holds Retry with a toast instead of failing silently", async () => {
      hookOptions = { readSavedTurn: vi.fn(async () => [{ ...savedSettledEmpty, parts: [null] }]) };
      render();
      inBandError();

      await retry();

      expect(h.chat.regenerate).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_UNCONFIRMED);
    });
  });

  it("CONTROL: an error before the server answered (no new trace) replays at once, and the saved turn is not read", async () => {
    const readSavedTurn = vi.fn(async () => [savedWrite]);
    hookOptions = { readSavedTurn };
    render();
    act(() => void ctl.sendText("add a task"));
    // lastTraceIdRef is still the trace at send: the POST never reached the pipeline
    h.chat.messages = [user];
    h.chat.status = "error";
    h.chat.error = new Error('{"error":"Chat stream failed"}');
    render();

    await retry();

    expect(readSavedTurn).not.toHaveBeenCalled();
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: with no error the saved turn is never read and Retry replays a clean live bubble as before", async () => {
    const readSavedTurn = vi.fn(async () => [savedWrite]);
    hookOptions = { readSavedTurn };
    render();
    h.chat.messages = [user, reply];
    h.chat.status = "ready";
    render();

    await retry();

    expect(readSavedTurn).not.toHaveBeenCalled();
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
  });
});

const retryNow = () => act(async () => void (await ctl.regenerate()));
const IN_BAND_ERROR = () => new Error("The AI provider dropped mid-response. Tap Retry to check and continue.");
const cleanRow = (trace: string, id = `row-${trace}`) => ({
  id,
  role: "assistant",
  content: "Working on it",
  streamingState: "errored",
  tokenUsage: { traceId: trace, toolReceipts: [] },
});
const writeRow = (trace: string) => ({
  ...cleanRow(trace),
  tokenUsage: {
    traceId: trace,
    toolReceipts: [{ toolName: "createTask", category: "personal_write", sideEffecting: true, verifiable: true, status: "partial", verificationState: "UNKNOWN_COMPLETION", entityType: null, entityId: null }],
  },
});
const userRow = { id: "u1", role: "user" };
const userB: Msg = { id: "uB", role: "user", parts: [{ type: "text", text: "question in B" }] };
const replyB: Msg = { id: "aB", role: "assistant", parts: [{ type: "text", text: "answer in B" }] };

/** The turn was sent in conversation `conversationId`, the server answered it (trace `trace`), then the stream errored in band. */
function sendAndErrorInBand(conversationId: string | null, trace: string) {
  useChatUiStore.setState({ activeConversationId: conversationId });
  render();
  act(() => void ctl.sendText("add a task"));
  transport().lastTraceIdRef.current = trace;
  h.chat.messages = [user, { id: "live-1", role: "assistant", parts: [{ type: "text", text: "Working on it" }] }];
  h.chat.status = "error";
  h.chat.error = IN_BAND_ERROR();
  render();
}

// The error and the trace refs belong to the turn that produced them. Opening another
// conversation is a new situation: the old error must not hold Retry on a clean reply there.
describe("opening another conversation drops the old turn's error state", () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  /** The island's onSelect: reset the turn (when `reset`), point at B, load B's rows. */
  function openB(reset: boolean) {
    if (reset) act(() => ctl.resetTurn());
    useChatUiStore.setState({ activeConversationId: "cB" });
    h.chat.messages = [userB, replyB];
    render();
  }

  it("A errors in band (trace T2); after opening B, Regenerate on B's clean reply replays at once, with no toast and no read", async () => {
    const readSavedTurn = vi.fn(async () => [userRow, cleanRow("TB")]);
    hookOptions = { readSavedTurn };
    render();
    sendAndErrorInBand("cA", "T2");

    openB(true);
    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(readSavedTurn, "B's reply is not an errored turn: nothing to read").not.toHaveBeenCalled();
  });

  it("CONTROL (the hazard): with no reset the stale error still holds Regenerate on B", async () => {
    hookOptions = { readSavedTurn: vi.fn(async () => [userRow, cleanRow("TB")]) };
    render();
    sendAndErrorInBand("cA", "T2");
    vi.mocked(toast.error).mockClear();

    openB(false);
    await retryNow();

    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_UNCONFIRMED);
  });

  it("resetTurn clears the SDK's error and the trace the old turn left, so nothing of A follows the operator into B", () => {
    render();
    sendAndErrorInBand("cA", "T2");
    act(() => transport().onTraceId?.("T2"));
    expect(ctl.error).toBeDefined();
    expect(ctl.lastTraceId).toBe("T2");

    act(() => ctl.resetTurn());
    render();

    expect(h.chat.clearError).toHaveBeenCalledTimes(1);
    expect(ctl.error).toBeUndefined();
    expect(transport().lastTraceIdRef.current, "a Reconnect in B would name A's trace").toBeNull();
    expect(ctl.lastTraceId).toBeNull();
  });

  it("resetTurn also drops a held interruption (killedErrorRef): Retry in B regenerates, it does not reattach A's turn", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      act(() => void ctl.sendText("next"));
      transport().lastTraceIdRef.current = "T2";
      h.chat.messages = [user, reply];
      h.chat.status = "error";
      h.chat.error = new Error("Failed to fetch");
      render();
      act(() => vi.advanceTimersByTime(10_000));
      expect(h.chat.resumeStream).toHaveBeenCalledTimes(1);

      openB(true);
      act(() => void ctl.regenerate());

      expect(h.chat.resumeStream, "still one: the held interruption was A's").toHaveBeenCalledTimes(1);
      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // THE TRAP: a first message has no conversation id yet; the response header assigns it mid-turn.
  // That is the SAME turn, so its binding to its own trace must survive.
  it("a first message whose conversation id is assigned from the response header, then errors in band, is still judged against its own trace", async () => {
    const readSavedTurn = vi.fn(async () => [userRow, cleanRow("T2")]);
    hookOptions = { readSavedTurn };
    useChatUiStore.setState({ activeConversationId: null });
    render();
    act(() => void ctl.sendText("add a task"));
    transport().lastTraceIdRef.current = "T2";
    act(() => transport().onConversationId?.("c9"));
    h.chat.messages = [user, { id: "live-1", role: "assistant", parts: [{ type: "text", text: "Working on it" }] }];
    h.chat.status = "error";
    h.chat.error = IN_BAND_ERROR();
    render();

    await retryNow();

    expect(readSavedTurn).toHaveBeenCalledWith("c9", expect.any(AbortSignal));
    expect(h.chat.regenerate, "judged against T2, found, clean: replay").toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });
});

// replay() sets traceAtSend to the trace the replayed attempt had (T2). If the replay's POST dies
// before any response header, lastTraceId is still T2, so "the server answered with a new trace"
// is false and Retry used to run with no read. The server does not stop when the client
// disconnects, so that attempt can still run its tools, and a third POST would repeat them.
// An error message the auto retry ignores. The tests that are not about the auto retry use it, so no real 1.5 s timer is armed behind them.
const NOT_A_NETWORK_DROP = "The reply stopped before it finished.";

/**
 * Attempt 1 errors in band (T2, a clean row) and Retry replays; the replay's POST then fails with no
 * header. `rowsAfter` is what the server holds by the time Retry is tapped again.
 */
async function replayThenDeadPost(rowsAfter: unknown[], message = NOT_A_NETWORK_DROP) {
  let rows: unknown[] = [userRow, cleanRow("T2")];
  const readSavedTurn = vi.fn(async () => rows);
  hookOptions = { readSavedTurn };
  render();
  sendAndErrorInBand("c1", "T2");
  await retryNow();
  expect(h.chat.regenerate, "attempt 1's own clean row: the first replay goes ahead").toHaveBeenCalledTimes(1);
  rows = rowsAfter;
  // the replay's POST failed before any header: lastTraceId is still T2
  h.chat.status = "error";
  h.chat.error = new Error(message);
  render();
  vi.mocked(toast.error).mockClear();
  return {
    readSavedTurn,
    /** What the server holds from now on. */
    serve: (next: unknown[]) => {
      rows = next;
    },
  };
}

describe("a replay that dies before the server's response headers", () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  it("a manual Retry reads the saved turn and is held while no later attempt has a settled clean row", async () => {
    const { readSavedTurn } = await replayThenDeadPost([userRow, cleanRow("T2")]);

    await retryNow();

    expect(readSavedTurn).toHaveBeenCalledTimes(2);
    expect(h.chat.regenerate, "a second replay could repeat what attempt 2 ran").toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);
  });

  it("the auto retry applies the same hold: no regenerate, and the operator is told", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await replayThenDeadPost([userRow, cleanRow("T2")], "Load failed");

      await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));

      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Retry proceeds once a settled clean row names a LATER attempt (attempt 2 answered and did nothing)", async () => {
    await replayThenDeadPost([userRow, cleanRow("T2"), cleanRow("T3", "stub-2")]);

    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("a later attempt that wrote is held as 'may already have run an action'", async () => {
    await replayThenDeadPost([userRow, cleanRow("T2"), writeRow("T3")]);

    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RAN);
  });

  // A plain Regenerate reads nothing, so no saved row seeds the set: replay() itself acknowledges the
  // trace it re-ran (T1 here), or a later attempt's clean row would have nothing to be "new" against.
  it("a plain Regenerate seeds the set with the trace it re-ran: a later attempt's clean row then allows Retry", async () => {
    let rows: unknown[] = [userRow, cleanRow("T1")];
    const readSavedTurn = vi.fn(async () => rows);
    hookOptions = { readSavedTurn };
    render();
    h.chat.messages = [user, reply];
    h.chat.status = "ready";
    render();

    await retryNow();
    expect(readSavedTurn, "no error: nothing to read").not.toHaveBeenCalled();
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);

    // the replay's POST died before any header, but the server ran it and saved a clean row T3
    rows = [userRow, cleanRow("T1"), cleanRow("T3", "stub-3")];
    h.chat.status = "error";
    h.chat.error = new Error("Load failed");
    render();
    vi.mocked(toast.error).mockClear();
    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("opening another conversation drops the outstanding replay: Regenerate on B's clean reply is not held", async () => {
    await replayThenDeadPost([userRow, cleanRow("T2")]);

    act(() => ctl.resetTurn());
    useChatUiStore.setState({ activeConversationId: "cB" });
    h.chat.messages = [userB, replyB];
    render();
    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it.each([
    ["sendText", () => ctl.sendText("next")],
    ["append", () => ctl.append({ text: "next" })],
  ] as const)("a new message (%s) drops the outstanding replay: its own dropped send is auto-retryable as before", async (_name, send) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await replayThenDeadPost([userRow, cleanRow("T2")]);
      act(() => void send());
      h.chat.messages = [user, reply];
      h.chat.status = "error";
      h.chat.error = new Error("Load failed");
      render();

      await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));

      expect(h.chat.regenerate, "the manual replay, then the new send's auto retry").toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Each blind replay needs evidence the PREVIOUS replay has not already used. A clean row for attempt 2
// only proves the attempt before the one that may be running: once Retry has replayed on it, the same
// row (and every row then visible) cannot approve the next blind replay. Trace names here: the helper
// calls the first attempt T2, so T3 is the first replay, T4 the second, T5 the third.
describe("chained blind replays", () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  const deadPost = (message = NOT_A_NETWORK_DROP) => {
    h.chat.status = "error";
    h.chat.error = new Error(message);
    render();
    vi.mocked(toast.error).mockClear();
  };

  /** Attempt 1 (T2) replayed, POST#2 died, T3 settled clean, Retry#2 went ahead on it, POST#3 died too. */
  async function untilSecondBlindReplay(lastPostError?: string) {
    const server = await replayThenDeadPost([userRow, cleanRow("T2")]);
    server.serve([userRow, cleanRow("T2"), cleanRow("T3", "stub-3")]);
    await retryNow();
    expect(h.chat.regenerate, "Retry#2: the clean T3 is new evidence").toHaveBeenCalledTimes(2);
    deadPost(lastPostError); // POST#3 died before any header; it may be running unseen, with no row yet
    return server;
  }

  it("THE CHAIN: Retry#3 is held on the same rows; a settled clean T4 then allows Retry#4", async () => {
    const server = await untilSecondBlindReplay();

    await retryNow();

    expect(h.chat.regenerate, "T3 already approved a replay: it cannot approve the next one").toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);

    server.serve([userRow, cleanRow("T2"), cleanRow("T3", "stub-3"), cleanRow("T4", "stub-4")]);
    vi.mocked(toast.error).mockClear();
    await retryNow();

    expect(h.chat.regenerate, "a settled clean T4 is new evidence").toHaveBeenCalledTimes(3);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("the auto retry is held in the chain too, through the same choke point", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await untilSecondBlindReplay("Load failed");

      await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));

      expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a write in the newest row is still refused in the chain", async () => {
    const server = await untilSecondBlindReplay();
    server.serve([userRow, cleanRow("T2"), cleanRow("T3", "stub-3"), writeRow("T4")]);

    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RAN);
  });

  // Traces are minted fresh in production, so a stale entry could never match a later turn's row. The new
  // turn here deliberately reuses the name T3 for its own later attempt, only to make a stale set visible.
  it.each([
    ["sendText", () => ctl.sendText("next")],
    ["append", () => ctl.append({ text: "next" })],
    ["resetTurn (the operator opened another conversation)", () => ctl.resetTurn()],
  ] as const)("%s forgets what the old turn acknowledged", async (_name, startNewTurn) => {
    const server = await untilSecondBlindReplay(); // acknowledged: T2, T3
    const userRow2 = { id: "u2", role: "user" };
    act(() => void startNewTurn());
    // the new turn: answered with T9, errored in band, then replayed on its own clean row
    server.serve([userRow2, cleanRow("T9")]);
    transport().lastTraceIdRef.current = "T9";
    h.chat.messages = [userB, replyB];
    h.chat.status = "error";
    h.chat.error = IN_BAND_ERROR();
    render();
    const replays = () => vi.mocked(h.chat.regenerate as () => void).mock.calls.length;
    const before = replays();
    await retryNow();
    expect(replays() - before, "judged bound to T9: replays").toBe(1);
    deadPost();
    server.serve([userRow2, cleanRow("T9"), cleanRow("T3", "reused-name")]);

    await retryNow();

    expect(replays() - before, "T3 is new in this turn: the second replay is allowed").toBe(2);
  });
});

// "network error" and "The network connection was lost." were added so a drop AFTER the server
// answered reattaches. Before any header they must stay what they were: not auto-replayed.
describe("the newer network phrases do not widen the auto retry", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it.each(["network error", "Network Error", "The network connection was lost."])(
    "%s before any response header: no auto regenerate, no reattach, and the error card stays",
    (message) => {
      act(() => void ctl.sendText("next"));
      // lastTraceId is still the trace at send: the POST never got a header
      h.chat.messages = [user, reply];
      h.chat.status = "error";
      h.chat.error = new Error(message);
      render();

      act(() => vi.advanceTimersByTime(10_000));

      expect(h.chat.regenerate).not.toHaveBeenCalled();
      expect(h.chat.resumeStream).not.toHaveBeenCalled();
      expect(ctl.error?.message).toBe(message);
    },
  );

  it("CONTROL: the original phrases before any header still auto-regenerate once", () => {
    for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "fetch failed", "Load failed"]) {
      h.chat.regenerate = vi.fn();
      act(() => void ctl.sendText("next"));
      h.chat.messages = [user, reply];
      h.chat.status = "error";
      h.chat.error = new Error(message);
      render();
      act(() => vi.advanceTimersByTime(10_000));
      expect(h.chat.regenerate, message).toHaveBeenCalledTimes(1);
      h.chat.error = undefined;
      h.chat.status = "ready";
      render();
    }
  });

  it("a manual Retry on such an error behaves as before: it replays", async () => {
    act(() => void ctl.sendText("next"));
    h.chat.messages = [user, reply];
    h.chat.status = "error";
    h.chat.error = new Error("network error");
    render();

    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
  });
});

// The drawer has no streaming guard, and a stream keeps running across a conversation load. While a
// request is in flight it still owns the trace refs, the acknowledged set and the outstanding-replay
// record: wiping them made a later in-band error or network kill look like "the server never answered",
// and Retry and the auto retry replayed with no read.
describe("opening a conversation while a turn is still in flight", () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  /** A turn was sent in c1 (the previous trace was T0); the server answered it with header T1; it is still streaming. */
  function streamingInC1() {
    transport().lastTraceIdRef.current = "T0";
    useChatUiStore.setState({ activeConversationId: "c1" });
    render();
    act(() => void ctl.sendText("add a task"));
    transport().lastTraceIdRef.current = "T1";
    act(() => transport().onTraceId?.("T1"));
    h.chat.messages = [user, { id: "live-1", role: "assistant", parts: [{ type: "text", text: "Working on it" }] }];
    h.chat.status = "streaming";
    render();
  }
  const streamEndsInBand = () => {
    h.chat.status = "error";
    h.chat.error = IN_BAND_ERROR();
    render();
  };

  it.each([
    ["c1 again", "c1"],
    ["conversation B", "cB"],
  ])("opening %s mid-stream, then the stream errors in band: Retry reads the saved turn and is held, never a blind replay", async (_label, openId) => {
    const readSavedTurn = vi.fn(async () => [userRow]); // no row for T1 yet
    hookOptions = { readSavedTurn };
    render();
    streamingInC1();

    act(() => ctl.resetTurn());
    useChatUiStore.setState({ activeConversationId: openId });
    streamEndsInBand();
    await retryNow();

    expect(readSavedTurn).toHaveBeenCalledTimes(1);
    expect(h.chat.regenerate, "the in-flight turn's trace was wiped: this would be a blind replay").not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_UNCONFIRMED);
  });

  it("CONTROL: when the saved turn has a clean row for the in-flight turn's own trace (T1), Retry reads it and replays", async () => {
    const readSavedTurn = vi.fn(async () => [userRow, cleanRow("T1")]);
    hookOptions = { readSavedTurn };
    render();
    streamingInC1();

    act(() => ctl.resetTurn());
    streamEndsInBand();
    await retryNow();

    expect(readSavedTurn).toHaveBeenCalledTimes(1);
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
  });

  it("a network kill after the reset: the server owns the turn, so it reattaches and never regenerates", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      streamingInC1();
      act(() => ctl.resetTurn());
      useChatUiStore.setState({ activeConversationId: "cB" });
      h.chat.status = "error";
      h.chat.error = new Error("Failed to fetch");
      render();

      act(() => vi.advanceTimersByTime(10_000));

      expect(h.chat.resumeStream).toHaveBeenCalledTimes(1);
      expect(h.chat.regenerate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a replay still in flight keeps its outstanding record through the reset: if it then dies with no header, Retry is held", async () => {
    const readSavedTurn = vi.fn(async () => [userRow, cleanRow("T2")]);
    hookOptions = { readSavedTurn };
    render();
    sendAndErrorInBand("c1", "T2");
    await retryNow(); // attempt 1 replayed; the replay's POST is now in flight
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    h.chat.status = "streaming";
    h.chat.error = undefined;
    render();

    act(() => ctl.resetTurn());
    h.chat.status = "error";
    h.chat.error = new Error(NOT_A_NETWORK_DROP); // the POST died before any header: lastTraceId is still T2
    render();
    vi.mocked(toast.error).mockClear();
    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);
  });

  it("a replay still in flight keeps the acknowledged set through the reset: a later clean row (T4) then allows Retry", async () => {
    const { serve } = await replayThenDeadPost([userRow, cleanRow("T2")]);
    serve([userRow, cleanRow("T2"), cleanRow("T3", "stub-3")]);
    await retryNow(); // Retry#2 goes ahead on T3: acknowledged T2, T3
    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    h.chat.status = "streaming"; // POST#3 is in flight
    h.chat.error = undefined;
    render();

    act(() => ctl.resetTurn());
    h.chat.status = "error";
    h.chat.error = new Error(NOT_A_NETWORK_DROP); // POST#3 died before any header
    render();
    serve([userRow, cleanRow("T2"), cleanRow("T3", "stub-3"), cleanRow("T4", "stub-4")]);
    vi.mocked(toast.error).mockClear();
    await retryNow();

    expect(h.chat.regenerate, "with the set wiped, an empty set would refuse for good").toHaveBeenCalledTimes(3);
  });

  it("CONTROL: with nothing in flight the reset does clear the trace, and the old error is gone", () => {
    sendAndErrorInBand("c1", "T2");
    act(() => ctl.resetTurn());
    render();

    expect(transport().lastTraceIdRef.current).toBeNull();
    expect(ctl.error).toBeUndefined();
  });

  it.each([
    ["submitted", true],
    ["streaming", true],
    ["ready", false],
    ["error", false],
  ])("status %s counts as %s for 'a request is in flight'", (status, inFlight) => {
    streamingInC1();
    h.chat.status = status;
    render();

    act(() => ctl.resetTurn());

    expect(transport().lastTraceIdRef.current).toBe(inFlight ? "T1" : null);
  });
});

// A conversation opened from history, a cold page and a reply that came back with no X-Trace-Id all
// leave lastTraceId null, and the outer beforeEach seeds T1 for every test, which hid this. "A replay
// is outstanding" is an explicit record ({ from } with null allowed), not a trace comparison, so it
// holds when the trace in hand is null.
describe("a replay started from no trace at all", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    transport().lastTraceIdRef.current = null;
  });

  const hydrated = {
    id: "db-1",
    role: "assistant",
    parts: [{ type: "text", text: "a loaded reply" }],
    streamingState: "complete",
    tokenUsage: { traceId: "T0", toolReceipts: [] },
  };

  /** A conversation opened from history: [user, a hydrated reply that carries its trace T0]. */
  function openedFromHistory(rows: unknown[]) {
    let served = rows;
    const readSavedTurn = vi.fn(async () => served);
    hookOptions = { readSavedTurn };
    useChatUiStore.setState({ activeConversationId: "c1" });
    h.chat.messages = [user, hydrated];
    h.chat.status = "ready";
    h.chat.error = undefined;
    render();
    return {
      readSavedTurn,
      serve: (next: unknown[]) => {
        served = next;
      },
    };
  }
  const postDies = (message = NOT_A_NETWORK_DROP) => {
    h.chat.status = "error";
    h.chat.error = new Error(message);
    render();
    vi.mocked(toast.error).mockClear();
  };

  it("opened from history, Regenerate, the header is lost: Retry reads the saved turn and is held, not a blind replay", async () => {
    const { readSavedTurn } = openedFromHistory([userRow, cleanRow("T0")]);
    await retryNow(); // the operator's plain Regenerate: no error, nothing to read
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    postDies();

    await retryNow();

    expect(readSavedTurn).toHaveBeenCalledTimes(1);
    expect(h.chat.regenerate, "traceNow and replayedFrom are both null: the old equality gate was off").toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);
  });

  it("opening another conversation drops a null-start record: with null equal to null, a stale one would hold B", async () => {
    openedFromHistory([userRow, cleanRow("T0")]);
    await retryNow(); // Regenerate from null: the record is { from: null }
    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    h.chat.status = "ready";
    render();

    act(() => ctl.resetTurn()); // nothing in flight
    useChatUiStore.setState({ activeConversationId: "cB" });
    h.chat.messages = [userB, replyB];
    h.chat.status = "error";
    h.chat.error = new Error(NOT_A_NETWORK_DROP); // an error in B with no send of its own, e.g. a failed reattach
    render();
    vi.mocked(toast.error).mockClear();
    await retryNow();

    expect(h.chat.regenerate, "B's error is B's own: it is not held on A's replay").toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("the auto retry does not loop: over four dead POSTs there is one replay in all, the operator's own", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      openedFromHistory([userRow, cleanRow("T0")]);
      // the SDK's regenerate clears the error, which resets the auto-retry count: the cap does not bind
      h.chat.regenerate = vi.fn(async () => {
        h.chat.error = undefined;
        h.chat.status = "streaming";
      });
      await retryNow();

      for (let i = 0; i < 4; i++) {
        postDies("Load failed");
        await act(async () => void (await vi.advanceTimersByTimeAsync(4_000)));
        h.chat.error = undefined;
        h.chat.status = "ready";
        render();
      }

      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("after a reply that came back with no trace header (the transport nulls the trace), a second replay that dies is held too", async () => {
    transport().lastTraceIdRef.current = "T1";
    const { readSavedTurn } = openedFromHistory([userRow, cleanRow("T1")]);
    await retryNow(); // Regenerate #1 from T1
    transport().lastTraceIdRef.current = null; // #1 was answered with no X-Trace-Id
    h.chat.status = "ready";
    render();
    await retryNow(); // Regenerate #2 from null
    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    postDies();

    await retryNow();

    expect(readSavedTurn).toHaveBeenCalledTimes(1);
    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);
  });

  // The accepted consequence: with nothing acknowledged the judge refuses, so a replay that starts from
  // no trace and no hydrated row stays held even when a clean row appears.
  it("ACCEPTED: a cold page (no hydrated trace, nothing acknowledged) stays held even once a clean row appears", async () => {
    const { serve } = openedFromHistory([userRow]);
    h.chat.messages = [user, reply]; // a live reply: no tokenUsage, no trace
    render();
    await retryNow();
    postDies();
    serve([userRow, cleanRow("T7")]);

    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);
  });

  it("with the hydrated trace acknowledged, a settled clean row for a NEW trace (T7) then allows Retry", async () => {
    const { serve } = openedFromHistory([userRow, cleanRow("T0")]);
    await retryNow();
    postDies();
    serve([userRow, cleanRow("T0"), cleanRow("T7", "stub-7")]);

    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  // C: the rows the client never saw (history) cannot approve a replay whose attempt runs unseen.
  it("T0 from history cannot vouch for a replay: Regenerate #1 answered T1 and finished, #2 dies, the saved turn shows only T0", async () => {
    openedFromHistory([userRow, cleanRow("T0")]);
    await retryNow(); // Regenerate #1: the hydrated T0 is acknowledged here
    transport().lastTraceIdRef.current = "T1";
    act(() => transport().onTraceId?.("T1")); // answered with header T1
    h.chat.messages = [user, reply]; // finished: the live bubble carries no tokenUsage
    h.chat.status = "ready";
    render();
    await retryNow(); // Regenerate #2 from T1
    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    postDies();

    await retryNow();

    expect(h.chat.regenerate, "T0 was in the history the client never saw run: it proves nothing about #2").toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);
  });
});

// A POST answered without X-Trace-Id (429, 5xx, a gateway) makes the transport null lastTraceId
// (use-chat-transport.ts), so after a replay from a real trace T1 the trace in hand is null and the old
// gate's "current trace equals the replayed-from trace" read false: Retry and the auto retry replayed
// blind. The record is cleared by a header for a different trace, by a new send and by an idle reset;
// while it stands and an error is set, the replay is unanswered whatever the trace in hand is.
describe("a replay answered without a trace header", () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  /** Regenerate from T1 (the seeded trace) replays; its POST is answered by a trace-less error, so the transport nulls the trace. */
  async function replayThenTracelessError(message: string) {
    let rows: unknown[] = [userRow, cleanRow("T1")];
    const readSavedTurn = vi.fn(async () => rows);
    hookOptions = { readSavedTurn };
    useChatUiStore.setState({ activeConversationId: "c1" });
    h.chat.messages = [user, reply];
    h.chat.status = "ready";
    h.chat.error = undefined;
    render();
    await retryNow();
    expect(h.chat.regenerate, "the operator's Regenerate").toHaveBeenCalledTimes(1);
    transport().lastTraceIdRef.current = null;
    h.chat.status = "error";
    h.chat.error = new Error(message);
    render();
    vi.mocked(toast.error).mockClear();
    return {
      readSavedTurn,
      serve: (next: unknown[]) => {
        rows = next;
      },
    };
  }

  it("a manual Retry is held, with the resent-request copy, not replayed blind", async () => {
    const { readSavedTurn } = await replayThenTracelessError('{"error":"Chat stream failed"}');

    await retryNow();

    expect(readSavedTurn).toHaveBeenCalledTimes(1);
    expect(h.chat.regenerate, "null is not T1: the old equality read 'answered'").toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);
  });

  it("the auto retry is held the same way: no regenerate, and the operator is told", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await replayThenTracelessError("Load failed");

      await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));

      expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(RETRY_HELD_RESENT_UNKNOWN);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a settled clean row for a trace the client has not acted on (T5) then allows Retry", async () => {
    const { serve } = await replayThenTracelessError('{"error":"Chat stream failed"}');
    serve([userRow, cleanRow("T1"), cleanRow("T5", "stub-5")]);

    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("CONTROL: a replay answered with a NEW header (T2) that completes leaves nothing outstanding: the next Regenerate goes straight through", async () => {
    const readSavedTurn = vi.fn(async () => [userRow, cleanRow("T1")]);
    hookOptions = { readSavedTurn };
    h.chat.messages = [user, reply];
    h.chat.status = "ready";
    render();
    await retryNow();
    transport().lastTraceIdRef.current = "T2";
    act(() => transport().onTraceId?.("T2")); // the replay was answered
    render();

    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(2);
    expect(readSavedTurn, "no error: nothing to read").not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("a new message clears the record: its own dropped send is auto-retryable as before", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await replayThenTracelessError(NOT_A_NETWORK_DROP);
      act(() => void ctl.sendText("next"));
      h.chat.messages = [user, reply];
      h.chat.status = "error";
      h.chat.error = new Error("Load failed");
      render();

      await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));

      expect(h.chat.regenerate, "the operator's replay, then the new send's auto retry").toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// D1: the private flag describes the request that was sent. Once nothing is in flight, opening another
// conversation must not leave it behind to refuse a normal Regenerate there.
describe("a private send is forgotten when the operator opens another conversation", () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  function privateSendThenPrivateOff(status: "ready" | "streaming") {
    useChatUiStore.setState({ privateMode: true });
    render();
    act(() => void ctl.sendText("private question"));
    h.chat.messages = [user, reply];
    h.chat.status = status;
    render();
    useChatUiStore.setState({ privateMode: false });
    render();
  }

  it("nothing in flight: opening B and tapping Regenerate on a clean reply there is not refused as private", async () => {
    privateSendThenPrivateOff("ready");

    act(() => ctl.resetTurn());
    useChatUiStore.setState({ activeConversationId: "cB" });
    h.chat.messages = [userB, replyB];
    render();
    await retryNow();

    expect(h.chat.regenerate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("CONTROL: without the reset the private turn is still refused once Private Lab is off", async () => {
    privateSendThenPrivateOff("ready");

    await retryNow();

    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(/private/i);
  });

  it("a private request still in flight stays private through the reset: its later error is not replayed", async () => {
    privateSendThenPrivateOff("streaming");

    act(() => ctl.resetTurn());
    h.chat.status = "error";
    h.chat.error = new Error(NOT_A_NETWORK_DROP);
    render();
    await retryNow();

    expect(h.chat.regenerate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(/private/i);
  });
});

// D4(d): what resetTurn clears whether or not a request is in flight.
describe("resetTurn clears what is safe either way", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it.each(["ready", "streaming"])("status %s: a pending partial re-resume is cancelled", (status) => {
    h.chat.status = status;
    render();
    act(() => transport().onResumePartial());

    act(() => ctl.resetTurn());
    act(() => vi.advanceTimersByTime(5_000));

    expect(h.chat.resumeStream).not.toHaveBeenCalled();
  });

  it.each(["ready", "streaming"])("status %s: a Stop label is cleared", (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    h.chat.status = status;
    render();
    act(() => ctl.stopTurn());
    expect(ctl.stopped).not.toBeNull();

    act(() => ctl.resetTurn());

    expect(ctl.stopped).toBeNull();
  });
});
