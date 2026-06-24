import { UIMessage, ChatRequestOptions } from "ai";

export type ChatRuntimeController = {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  isStreaming: boolean;
  sendText: (text: string) => void;
  stop: () => void;
  regenerate: (options?: { messageId?: string } & ChatRequestOptions) => Promise<void>;
  setMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void;
  liveContextBlocksRef: React.RefObject<any>;
};
