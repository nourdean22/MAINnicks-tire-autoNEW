import type { UIMessage } from "ai";
import type { ContextBlocks } from "@/components/chat/context-block-badges";

export type ChatRuntimeController = {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  isStreaming: boolean;
  sendText: (text: string) => void;
  append: (message: any, chatRequestOptions?: any) => Promise<void>;
  stop: () => void;
  regenerate: (options?: { messageId?: string } & any) => Promise<void>;
  setMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void;
  liveContextBlocks: ContextBlocks | null;
  lastTraceId: string | null;
};
