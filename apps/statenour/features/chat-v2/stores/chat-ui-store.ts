import { create } from "zustand";

export type PendingSend = {
  tempId: string;
  conversationId: string | null;
  text: string;
  createdAt: number;
};

export interface MemoryHit {
  id: string;
  content: string;
  category: string;
  similarity: number;
}

export interface ContradictionLog {
  id: string;
  claim: string;
  reality: string;
  severity: string;
}

export type ChatUiState = {
  draft: string;
  connection: "online" | "degraded" | "offline";
  activeConversationId: string | null;
  pending: PendingSend[];
  isVoiceDocked: boolean;
  memoryInspectorOpen: boolean;
  historyDrawerOpen: boolean;
  recalledHits: MemoryHit[];
  contradictions: ContradictionLog[];
  setDraft: (draft: string) => void;
  setConnection: (state: ChatUiState["connection"]) => void;
  setActiveConversationId: (id: string | null) => void;
  enqueuePending: (msg: PendingSend) => void;
  resolvePending: (tempId: string) => void;
  clearConversationDraft: () => void;
  toggleVoiceDock: () => void;
  setMemoryInspectorOpen: (open: boolean) => void;
  setHistoryDrawerOpen: (open: boolean) => void;
  setMemoryData: (hits: MemoryHit[], contradictions: ContradictionLog[]) => void;
};

export const useChatUiStore = create<ChatUiState>((set) => ({
  draft: "",
  connection: "online",
  activeConversationId: null,
  pending: [],
  isVoiceDocked: false,
  memoryInspectorOpen: false,
  historyDrawerOpen: false,
  recalledHits: [],
  contradictions: [],
  setDraft: (draft) => set({ draft }),
  setConnection: (connection) => set({ connection }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  enqueuePending: (msg) => set((s) => ({ pending: [...s.pending, msg] })),
  resolvePending: (tempId) =>
    set((s) => ({ pending: s.pending.filter((m) => m.tempId !== tempId) })),
  clearConversationDraft: () => set({ draft: "" }),
  toggleVoiceDock: () => set((s) => ({ isVoiceDocked: !s.isVoiceDocked })),
  setMemoryInspectorOpen: (open) => set({ memoryInspectorOpen: open }),
  setHistoryDrawerOpen: (open) => set({ historyDrawerOpen: open }),
  setMemoryData: (hits, contradictions) => set({ recalledHits: hits, contradictions }),
}));
