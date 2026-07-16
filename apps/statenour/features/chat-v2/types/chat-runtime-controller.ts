import type { UIMessage } from "ai";

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
  liveContextBlocksRef: React.RefObject<any>;
  lastTraceIdRef: React.RefObject<string | null>;
};
