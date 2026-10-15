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
  regenerate: (options?: { messageId?: string } & any) => Promise<void>;
  /**
   * The operator opened another conversation or a new chat: drop the old turn's error, held
   * interruption, trace refs and outstanding replay, so they cannot hold Retry on a clean reply there.
   */
  resetTurn: () => void;
  setMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void;
  liveContextBlocks: ContextBlocks | null;
  lastTraceId: string | null;
};
