import type { UIMessage } from "ai";
import type { ContextBlocks } from "@/components/chat/context-block-badges";
import type { StoppedTurn } from "../lib/turn-lifecycle";

export type ChatRuntimeController = {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  isStreaming: boolean;
  sendText: (text: string) => void;
  append: (message: any, chatRequestOptions?: any) => Promise<void>;
  /** Bare client abort (stall recovery, new chat). Tells the server nothing. */
  stop: () => void;
  /** Operator Stop (04-F6): DELETE to the server first, then the abort. */
  stopTurn: () => void;
  /** The turn the operator stopped, until the next send (09-F29). */
  stopped: StoppedTurn | null;
  /** The words of the current Retry hold (a RETRY_* constant from lib/saved-turn.ts), or null (W3b). */
  hold: string | null;
  regenerate: (options?: { messageId?: string } & any) => Promise<void>;
  /**
   * The operator opened another conversation or a new chat: drop the old turn's error, held
   * interruption, trace refs and outstanding replay, so they cannot hold Retry on a clean reply there.
   */
  resetTurn: () => void;
  setMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void;
  liveContextBlocks: ContextBlocks | null;
  lastTraceId: string | null;
  /** The source page's route attached to the next turn (W3b chip), or null when nothing is attached or it was detached. */
  pageContext: { route: string } | null;
  /** Leave the page-context anchors out of the next send; writes nothing on the server. */
  detachPageContext: () => void;
};
