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
