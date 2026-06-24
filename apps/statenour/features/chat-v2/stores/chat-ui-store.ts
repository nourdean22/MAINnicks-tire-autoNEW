import { create } from "zustand";

export type PendingSend = {
  tempId: string;
  conversationId: string | null;
  text: string;
  createdAt: number;
};

export type ChatUiState = {
  draft: string;
  connection: "online" | "degraded" | "offline";
  activeConversationId: string | null;
  pending: PendingSend[];
  isVoiceDocked: boolean;
  setDraft: (draft: string) => void;
  setConnection: (state: ChatUiState["connection"]) => void;
  setActiveConversationId: (id: string | null) => void;
  enqueuePending: (msg: PendingSend) => void;
  resolvePending: (tempId: string) => void;
  clearConversationDraft: () => void;
  toggleVoiceDock: () => void;
};

export const useChatUiStore = create<ChatUiState>((set) => ({
  draft: "",
  connection: "online",
  activeConversationId: null,
  pending: [],
  isVoiceDocked: false,
  setDraft: (draft) => set({ draft }),
  setConnection: (connection) => set({ connection }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  enqueuePending: (msg) => set((s) => ({ pending: [...s.pending, msg] })),
  resolvePending: (tempId) =>
    set((s) => ({ pending: s.pending.filter((m) => m.tempId !== tempId) })),
  clearConversationDraft: () => set({ draft: "" }),
  toggleVoiceDock: () => set((s) => ({ isVoiceDocked: !s.isVoiceDocked })),
}));
