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
  // 2026-07-22 · Authority-kernel controls (audit Waves 1+7). Defaults =
  // today's behavior; the composer selectors set these and the transport
  // body ships only non-defaults.
  privateMode: boolean;
  posture: "auto" | "execute" | "counsel" | "spar";
  depth: "auto" | "standard" | "deep";
  actionPermission: "read" | "draft" | "execute";
  /** 2026-08-12 · OPTIONAL TURBO (plans #20/#21): arm ONE next message to
   *  carry providerOverride:"anthropic" — under the cost firewall the
   *  per-request override is the only consent that opens metered lanes.
   *  Never sticky: use-chat-stream consumes and resets it on send.
   *  Keyless Anthropic degrades to the normal chain, so arming it is
   *  always safe; it becomes potent when a key is funded. */
  turbo: boolean;
  setTurbo: (on: boolean) => void;
  setPrivateMode: (on: boolean) => void;
  setPosture: (p: ChatUiState["posture"]) => void;
  setDepth: (d: ChatUiState["depth"]) => void;
  setActionPermission: (p: ChatUiState["actionPermission"]) => void;
  setDraft: (draft: string) => void;
  /** 2026-08-18 · edit-resend: the user message the composer's draft is
   *  editing. Sending while set truncates from this message forward
   *  (server cascade + client slice) and resends — the V1 contract
   *  ("saving will resend the message, retriggering a regeneration")
   *  that the chat-v2 migration dropped, leaving edit as a bare
   *  prefill. Null = normal append send. */
  editingMessageId: string | null;
  setEditingMessageId: (id: string | null) => void;
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
  privateMode: false,
  posture: "auto",
  depth: "auto",
  actionPermission: "draft",
  turbo: false,
  setTurbo: (turbo) => set({ turbo }),
  setPrivateMode: (privateMode) => set({ privateMode }),
  setPosture: (posture) => set({ posture }),
  setDepth: (depth) => set({ depth }),
  setActionPermission: (actionPermission) => set({ actionPermission }),
  // 2026-08-18 self-audit fix · emptying the draft DISARMS edit-resend.
  // A casual bubble tap arms editing (with the banner) — but if the
  // operator then clears the prefill to type something NEW, sending
  // must not cascade-delete the tapped message. Empty draft = new
  // intent. (The banner + cancel + Escape remain the explicit outs.)
  setDraft: (draft) =>
    set((s) => ({
      draft,
      editingMessageId: draft.trim() === "" ? null : s.editingMessageId,
    })),
  editingMessageId: null,
  setEditingMessageId: (editingMessageId) => set({ editingMessageId }),
  setConnection: (connection) => set({ connection }),
  // Switching conversations disarms any pending edit — the id belongs
  // to the previous thread and a cascade there would truncate the
  // WRONG conversation.
  setActiveConversationId: (activeConversationId) =>
    set({ activeConversationId, editingMessageId: null }),
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
