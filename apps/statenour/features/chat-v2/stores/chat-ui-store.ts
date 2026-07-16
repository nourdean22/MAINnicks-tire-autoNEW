import { create } from "zustand";

export type PendingSend = {
  tempId: string;
  conversationId: string | null;
  text: string;
  createdAt: number;
  status: "resolving-context" | "sending";
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
  diagnosticReport: string | null;
  isVoiceDocked: boolean;
  memoryInspectorOpen: boolean;
  historyDrawerOpen: boolean;
  recalledHits: MemoryHit[];
  contradictions: ContradictionLog[];
  setDraft: (draft: string) => void;
  setConnection: (state: ChatUiState["connection"]) => void;
  setActiveConversationId: (id: string | null) => void;
  enqueuePending: (msg: PendingSend) => void;
  updatePending: (tempId: string, patch: Partial<Pick<PendingSend, "text" | "status">>) => void;
  resolvePending: (tempId: string) => void;
  clearConversationDraft: () => void;
  setDiagnosticReport: (report: string | null) => void;
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
  diagnosticReport: null,
  isVoiceDocked: false,
  memoryInspectorOpen: false,
  historyDrawerOpen: false,
  recalledHits: [],
  contradictions: [],
  setDraft: (draft) => set({ draft }),
  setConnection: (connection) => set({ connection }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  enqueuePending: (msg) => set((s) => ({ pending: [...s.pending, msg] })),
  updatePending: (tempId, patch) =>
    set((s) => ({
      pending: s.pending.map((m) => (m.tempId === tempId ? { ...m, ...patch } : m)),
    })),
  resolvePending: (tempId) =>
    set((s) => ({ pending: s.pending.filter((m) => m.tempId !== tempId) })),
  clearConversationDraft: () => set({ draft: "" }),
  setDiagnosticReport: (diagnosticReport) => set({ diagnosticReport }),
  toggleVoiceDock: () => set((s) => ({ isVoiceDocked: !s.isVoiceDocked })),
  setMemoryInspectorOpen: (open) => set({ memoryInspectorOpen: open }),
  setHistoryDrawerOpen: (open) => set({ historyDrawerOpen: open }),
  setMemoryData: (hits, contradictions) => set({ recalledHits: hits, contradictions }),
}));
