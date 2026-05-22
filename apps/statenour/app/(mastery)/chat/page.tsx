"use client";

import { useChat } from "@ai-sdk/react";
// DefaultChatTransport moved to hooks/chat/use-chat-transport.ts (B2).
import * as React from "react";
import { Suspense, useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import { useSearchParams, usePathname } from "next/navigation";
// v10.0.529.106 · Wave 83 · Button import moved into ComposerSendButton.
import { cn } from "@/lib/utils";
import {
  // v10.0.529.19 · Trash2 moved into ConversationDrawer
  // v10.0.529.106 · Wave 83 · Plus moved into ConversationDrawer ·
  // Mic / Square / FileAudio / Phone / ImageIcon moved into
  // ComposerToolbar · StopCircle moved into ComposerSendButton ·
  // Send / Copy / RefreshCw / Pin / PinOff moved into
  // MessageHoverActions + PinnedMessagesBar. Paperclip + X +
  // ArrowDown still used inline by file-part renderer + scroll
  // chip + a few mini-buttons.
  X,
  Paperclip,
  ArrowDown,
} from "lucide-react";
import { RealtimeVoiceOverlay } from "@/components/chat/realtime-voice-overlay";
// v10.0.413 · mode-persona chip · cycles default/battle/reflect/execute
// and auto-prepends the slash prefix on send. The system-prompt
// MODE_PERSONAS rule (v10.0.400) handles the voice switching server-side.
// v10.0.529.106 · Wave 83 · ModePersonaChip moved into ComposerToolbar ·
// page still owns the persona-mode state + applyMode prefix logic.
import { applyMode, type PersonaMode } from "@/components/chat/mode-persona-chip";
import { ReasoningTraceModal } from "@/components/chat/reasoning-trace-modal";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { useWakeWord } from "@/hooks/use-wake-word";
import { useConversations } from "@/hooks/use-conversations";
import { usePinnedMessages } from "@/hooks/use-pinned-messages";
import { useTextToSpeech } from "@/hooks/use-text-to-speech";
import { useImageAttachment } from "@/hooks/use-image-attachment";
import { useSlashCommands } from "@/hooks/use-slash-commands";
import { useMentionSuggestions } from "@/hooks/use-mention-suggestions";
import { useChatPrefetch } from "@/hooks/use-chat-prefetch";
import { useSuggestionWarm } from "@/hooks/use-suggestion-warm";
import { notifyDataChanged, type DataDomain } from "@/lib/events/data-change";
import { runDirectAction } from "@/lib/chat/direct-actions";
// v10.0.28 · dead import removed — looksLikeMarketingContent +
// alreadyHasGeneratedImage moved into useChatAutoFire hook in v8.18;
// the inline call sites were deleted but the import was left behind.
// v8.18 · decideAutoFire + AutoFirePlan moved into useChatAutoFire hook
import { AutoFirePlanToast } from "@/components/chat/auto-fire-plan-toast";
import { useNourState } from "@/lib/state/nour-state";
import { NickHeaderV2 } from "@/components/chat/nick-header-v2";
import { NickSuggestions } from "@/components/chat/nick-suggestions";
import { readPageContext, onPageContextChanged } from "@/components/chat/page-context-bridge";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { useSilentRetry } from "@/components/chat/use-silent-retry";
import { useVeniceHealth } from "@/components/chat/use-venice-health";
// v10.0.529.18 · useIdleSuggestion removed · the hook fired every
// session (debounce timer + /api/ai/autocomplete poll) but its render
// site was deleted in v10.0.141 ("idle-suggestion render REMOVED per
// user request"). The `idle` return value was assigned and never read.
// All wasted spend per session.
import { useAdaptivePlaceholder } from "@/components/chat/use-adaptive-placeholder";
import { usePromptSuggestions } from "@/components/chat/use-prompt-suggestions";
import { PromptSuggestionsBar } from "@/components/chat/prompt-suggestions-bar";
// v10.0.529.xx · WisdomPill import removed · mount cut from composer
// in favor of PromptSuggestionsBar (single above-composer suggestion
// surface). WisdomPill still consumed in components/brain-dump-modal.
// v10.0.529.20 · per-message footer (status badge + branch switcher +
// edit controls + info card + trace link) extracted into a memoized
// MessageFooter so finished messages bail out via shallow equality on
// every streamed token. The 4 sub-components above are imported INSIDE
// MessageFooter — page.tsx no longer references them directly.
import { MessageFooter } from "@/components/chat/message-footer";
import { ConversationPulse } from "@/components/chat/conversation-pulse";
// v10.0.529.19 · history-drawer JSX (~170 LOC inline) extracted into
// ConversationDrawer · /chat audit improvement #1.
import { ConversationDrawer } from "@/components/chat/conversation-drawer";
// v10.0.484 · ProactiveInsightCard import removed (mount deleted at
// line ~2562). Component file kept · no consumers in /chat anymore.
import { MessageActionSheet } from "@/components/chat/message-action-sheet";
// v10.0.529.106 · Wave 83 · useLongPress · ContextBlockBadges ·
// QualityPayload · MessageDiagnostics imports all moved into
// components/chat/message-bubble-shells.tsx (UserMessageBubble +
// AssistantMessageShell are the only consumers).
// SlashCommandPalette component kept in the tree for reference but
// not rendered — the existing use-slash-commands.ts hook now carries
// navigation + action commands in a unified SLASH_COMMANDS registry.
import { UndoSendToast } from "@/components/chat/undo-send-toast";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { setPersonaOverride as writePersonaOverride } from "@/lib/ai/intent-classifier";
import { useChatHaptics } from "@/hooks/chat/use-chat-haptics";
import { useStreamingErrorGuard } from "@/hooks/chat/use-streaming-error-guard";
import { useAmbientMode } from "@/hooks/chat/use-ambient-mode";
import { useChatStall } from "@/hooks/chat/use-chat-stall";
import { useChatOverrides } from "@/hooks/chat/use-chat-overrides";
import { useChatTransport } from "@/hooks/chat/use-chat-transport";
import { useChatKeyboard } from "@/hooks/chat/use-chat-keyboard";
import { useChatBranchSwap } from "@/hooks/chat/use-chat-branch-swap";
import { useChatDeepLink } from "@/hooks/chat/use-chat-deep-link";
import { useChatModalToggles } from "@/hooks/chat/use-chat-modal-toggles";
// v10.0.529.19 · useChatRename moved into ConversationDrawer
import { useChatDiagnose } from "@/hooks/chat/use-chat-diagnose";
import { useChatSpeedRibbon } from "@/hooks/chat/use-chat-speed-ribbon";
import { useChatEditing } from "@/hooks/chat/use-chat-editing";
import { useLazyRenderMessages } from "@/hooks/chat/use-lazy-render-messages";
import { useChatAutoFire } from "@/hooks/chat/use-chat-auto-fire";
import { useChatMessageActions } from "@/hooks/chat/use-chat-message-actions";
import { useAudioTranscribe } from "@/hooks/chat/use-audio-transcribe";
import { useNickMessageActions, postFeedback } from "@/hooks/chat/use-nick-message-actions";
// Legacy — kept for fallback but not rendered in the new skeleton.
// Surgical cut: the HotQuestionsBar + NickBelowInput + starter prompts
// row + Master/Builder/Friend tabs + MODE AUTO + AUTO pills + Launcher
// collapsible are all removed from the chat page render tree per the
// Apr 19 Tesla-tier redesign. Kept imports commented in case a future
// surface needs a specific piece.
import { NickStreaming } from "@/components/chat/nick-streaming";
import { NickMessage } from "@/components/chat/nick-message";
// v10.0.529.106 · Wave 83 · ToolResultCard dynamic import +
// isKnownToolName moved into components/chat/message-part-renderers.tsx
// where the only consumer (ToolPartRenderer) lives. dynamic() still
// needed below for BuilderSandbox + BrowserSandbox.
import dynamic from "next/dynamic";
import { ChatHistorySearch } from "@/components/chat/chat-history-search";
import { ConnectionStatus } from "@/components/chat/connection-status";
import { KeyboardCheatSheet } from "@/components/chat/keyboard-cheat-sheet";
import { SlashCommandDropdown } from "@/components/chat/slash-command-dropdown";
import { MentionDropdown } from "@/components/chat/mention-dropdown";
import { VoiceWaveformOverlay } from "@/components/chat/voice-waveform-overlay";
import { PinnedMessagesBar } from "@/components/chat/pinned-messages-bar";
import { MessageEditTextarea } from "@/components/chat/message-edit-textarea";
import { ErrorDiagnosticPanel } from "@/components/chat/error-diagnostic-panel";
import { AttachmentPreview } from "@/components/chat/attachment-preview";
import { StallBanner } from "@/components/chat/stall-banner";
import { ComposerToolbar } from "@/components/chat/composer-toolbar";
import { ComposerSendButton } from "@/components/chat/composer-send-button";
import { MessageHoverActions } from "@/components/chat/message-hover-actions";
import {
  FilePartRenderer,
  ReasoningPartRenderer,
  ToolPartRenderer,
} from "@/components/chat/message-part-renderers";
import {
  UserMessageBubble,
  AssistantMessageShell,
} from "@/components/chat/message-bubble-shells";
import {
  extractContextBlocks,
  extractQuality,
  extractModel,
  extractCitations,
} from "@/lib/chat/extract-message-metadata";
import { dedupeMessages } from "@/lib/chat/dedupe-messages";
// v10.0.529.106 · Wave 83 · SmartReplies + LaneCorrectionChip +
// ActionClaimWarning all moved into SmartRepliesCluster.
import { SmartRepliesCluster } from "@/components/chat/smart-replies-cluster";
import { useDraftAutosave } from "@/hooks/use-draft-autosave";
// Apr 19 · ChatControlBar retired (MODE AUTO + AUTO dropdowns gone).
// Types moved to lib/chat/types.ts so the retired component can be
// deleted entirely — the route still honors modeOverride /
// providerOverride / taskTypeOverride from the body.
// ChatOverrides was the explicit override-bag type for the retired
// ChatControlBar. The runtime hook (useChatOverrides) still owns the
// shape internally; only ChatModeOverride leaks out via cycleMode.
import type { ChatModeOverride } from "@/lib/chat/types";
import { DeeperContextBadge } from "@/components/chat/deeper-context-badge";
import { PromptInspector } from "@/components/chat/prompt-inspector";
import { ToolCallLogPanel } from "@/components/chat/tool-call-log-panel";
// v10.0.529.55 · GlitchCaptureButton import + component deleted ·
// audit Wave 9 flagged the always-visible floating chrome as cut ·
// the underlying glitch_capture workflow can be re-surfaced via
// the brain-dump modal or a future overflow-menu item if needed.
import { ProviderDegradationBanner } from "@/components/chat/provider-degradation-banner";
// Heavy interactive sandboxes (354 + 296 LOC). Code-split — they only
// enter the bundle when Nick actually opens a builder/browser flow.
// Saves another ~200KB on initial chat-page JS, which compounds with
// the ToolResultCard split above on mobile cold loads.
const BuilderSandbox = dynamic(
  () => import("@/components/chat/builder-sandbox").then((m) => m.BuilderSandbox),
  { ssr: false },
);
const BrowserSandbox = dynamic(
  () => import("@/components/chat/browser-sandbox").then((m) => m.BrowserSandbox),
  { ssr: false },
);
// HotQuestionsBar retired Apr 19 — openers now live in ChatEmptyState.
// v10.0.529.106 · Wave 83 · ErrorCard import removed · the panel
// moved into components/chat/error-diagnostic-panel.tsx.
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import { haptic } from "@/lib/ui/haptic";
import { extractMessageText } from "@/lib/chat/extract-message-text";
import { getMessageMeta } from "@/lib/chat/get-message-meta";
// v10.0.529.54 · AiPulse import removed · vanity 3D mesh cut.
// misc-pages slice (2026-05-22) · the page's last 2 authedFetch calls
// (fork + revert) migrated to trpc — fork → chat.fork (NEW), revert →
// chat.editMessage (REUSED, the Phase JJ edit procedure). The
// authedFetch import is now gone · /chat page is 100% on tRPC.
import { trpc } from "@/lib/trpc/client";
// v10.0.529.106 · Wave 83 · rootLogger import removed · all log
// surfaces moved into the action hooks (useChatMessageActions ·
// useNickMessageActions) where the only callers live.

// Wrench import removed — diagnostic button hidden from UI

// v10.0.529.18 · hoisted from inside Chat() function body. Previously
// re-declared on every render at module-init time (negligible runtime
// cost · meaningful noise to readers). Module scope is the right home
// for type aliases that don't close over state.
type Personality = "master" | "builder" | "friend";

// ─── Types ───────────────────────────────────────────────
// Apr 26 · Flow mode retired. Zero hits on /api/ai/debrief in 7d,
// fully superseded by:
//   - Global BrainDumpModal (Cmd+Shift+J) for quick capture
//   - Fast-path interceptors ("journal:" / "remember that" /
//     "brain dump:") in /api/ai/chat — capture in 200ms
//   - /brain page for review + analytics
// Removing the Mode type strips ~120 LOC of conditional branches.

// v10.0.529.106 · Wave 83 · dedupeMessages helper lifted into
// lib/chat/dedupe-messages.ts so the unit tests can import it
// directly and the page module shrinks.

// ─── Page ────────────────────────────────────────────────

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] animate-pulse" /></div>}>
      <Chat />
    </Suspense>
  );
}

function Chat() {
  const s = useNourState();
  const params = useSearchParams();
  // v10.0.529.86 · Wave 30 · live route awareness · feeds the system
  // prompt so Nick knows "the operator is currently on /tasks" and
  // can resolve "this task" without title-fuzzy guesses. Updates on
  // any nav · cheap · zero extra fetches.
  const currentPathname = usePathname();

  // ── Core chat state ──
  const [input, setInput] = useState("");
  // v10.0.413 · mode-persona state · cycles default/battle/reflect/execute
  // via the chip in the composer. Resets to default after every send so
  // operator opts in per-turn rather than getting stuck in battle voice.
  const [personaMode, setPersonaMode] = useState<PersonaMode>("default");
  const [error, setError] = useState<string | null>(null);
  // Apr 19 · Diagnose-with-Nick uses a dedicated /api/ai/diagnose-chat
  // endpoint that bypasses the streaming pipeline entirely — otherwise
  // tapping Diagnose when chat is down just fires another failing
  // stream. Report lands in this state + renders inline under the
  // ErrorCard so Nour sees health checks without relying on Nick.
  // v8.15 BATCH A · Diagnose-with-Nick state extracted to useChatDiagnose.
  // Hits /api/ai/diagnose-chat (bypasses streaming) and renders the report
  // inline under the ErrorCard.
  const {
    diagnosticReport,
    diagnosing,
    runDiagnostic,
    clearReport: clearDiagnosticReport,
  } = useChatDiagnose();
  // silentRetry wired near useChat() once regenerate is available.

  // v10.0.529.19 · useChatRename moved INSIDE ConversationDrawer · the
  // rename state was used exclusively inside the history-drawer JSX so
  // owner identity now matches consumer location. Parent still owns
  // `renameConvo` (the server round-trip) and threads it down as the
  // drawer's `onRename` callback prop.

  // v8.15 BATCH A · Message editing extracted to useChatEditing.
  //   editingMsgId        — USER message being edited (resend on save)
  //   editingAssistantId  — ASSISTANT message being edited (PATCH-only, no resend)
  //   editValue           — shared draft buffer
  // Per-edit draft autosave is owned by the hook so a refresh restores
  // the exact draft for the exact message.
  const {
    editingMsgId,
    setEditingMsgId,
    editingAssistantId,
    setEditingAssistantId,
    editValue,
    setEditValue,
    clearEditDraft,
  } = useChatEditing();

  // ── Personality mode ──
  // master = operator + strategist (default, terse, actionable)
  // builder = code + architecture (technical, longer allowed)
  // friend = casual (warm, no metrics unless asked)
  // v10.0.529.18 · Personality type hoisted to module scope (top of file).
  // Apr 27 · HYDRATION FIX — was initializing from localStorage in
  // the useState callback, which gives different values on server
  // (always "master") vs client (whatever's cached). React 19 +
  // Next 16 flag this as a hydration mismatch since the initial
  // client render diverges from the SSR HTML. Init deterministic
  // here, sync from localStorage in the effect below — the second
  // render after hydration is allowed to differ.
  const [personality, setPersonality] = useState<Personality>("master");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("nour:nick-personality");
      if (stored === "master" || stored === "builder" || stored === "friend") {
        setPersonality(stored);
      }
    } catch {
      // ignore — localStorage may be disabled (private mode, etc)
    }
  }, []);

  // v11.1 · X-Persona sync primitive — see the transport fetch wrapper
  // for the write site and the effect below for the read site. Ref so
  // the write doesn't cause re-renders.
  const lastPersonaHeaderRef = useRef<Personality | null>(null);

  // v10.0.28 — captures X-Trace-Id from the chat-route response header.
  // The route mints a traceId per turn (v10.0.10 AgentTrace) + now
  // surfaces it via header. Surfaced in the UI as a "view trace" deep-
  // link from the message info card → /system/agent-traces?search=<id>.
  const lastTraceIdRef = useRef<string | null>(null);
  const [lastTraceId, setLastTraceId] = useState<string | null>(null);

  // v11.1 B2 · overrides state + cycleMode extracted to
  // hooks/chat/use-chat-overrides.ts. Force mode/provider/taskType
  // on the next message; control bar + ⋯ menu drive it.
  const { overrides, setOverrides, cycleMode } = useChatOverrides();

  // ── Modal/panel toggles (v8.12 BATCH 69 → useChatModalToggles) ──
  // Five independent boolean overlays bundled into one hook so the
  // page surface stays tight. inspectorOpen/toolLogOpen drive the
  // sidebars; browserSandboxOpen auto-fires from the toolCompletedRef
  // effect when browser_do creates a session; showHelp + showHistorySearch
  // are keyboard-shortcut overlays (Cmd+/ and Cmd+F).
  const {
    inspectorOpen, setInspectorOpen,
    toolLogOpen, setToolLogOpen,
    browserSandboxOpen, setBrowserSandboxOpen,
    showHelp, setShowHelp,
    showHistorySearch, setShowHistorySearch,
  } = useChatModalToggles();

  // ── Speed ribbon (#3) — per-message timing map keyed by message id ──
  // v8.15 BATCH A · timingRef + showSpeedRibbon toggle extracted to
  // useChatSpeedRibbon. Caller still writes into timingRef.current from
  // the message-status effect below; localStorage hydration is owned by
  // the hook.
  const { timingRef, showSpeedRibbon, setShowSpeedRibbon } = useChatSpeedRibbon();

  // ── Optimistic prefetch: warm the lambda while user is typing.
  // Debounced 300ms, min 8 chars, min 2s between fires. Zero cost
  // to the UI — pure background warmup for first-token speed. ──
  useChatPrefetch(input);
  const sessionStartRef = useRef<number>(Date.now());
  // showHelp + showHistorySearch hoisted into useChatModalToggles above.

  // ── Refs ──
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // v11.1 Tier-1 fluidity · Stick-to-bottom auto-scroll with escape.
  // Replaces the old `useEffect(() => scrollRef.current.scrollTo(...),
  // [messages])` which fought Nour's scroll position on every token.
  // · scrollRef goes on the overflow-y-auto container
  // · contentRef goes on the direct child that grows
  // · isAtBottom toggles to false when user scrolls up → releases
  //   auto-scroll. The "↓ new reply" chip uses this signal.
  // · scrollToBottom() is the imperative jump back.
  // Spring is subtle (damping .85, stiffness .04) so during rapid
  // streams the viewport tracks smoothly instead of snapping per token.
  const stb = useStickToBottom({
    initial: "instant",
    damping: 0.85,
    stiffness: 0.04,
    mass: 1.15,
  });

  // Apr 27 · MOBILE-FLUIDITY — keyboard-aware scroll.
  // When the on-screen keyboard appears, the visual viewport shrinks
  // (window.visualViewport.height drops). Without intervention, the
  // last message can end up hidden under the keyboard. We listen on
  // the visualViewport `resize` event and re-scroll to bottom when
  // height actually changes.
  //
  // Bonus: when the user grows the textarea (multi-line drafts), the
  // input row eats more pixels — same scroll-to-bottom keeps the
  // latest message in view. Triggered via input.length change so we
  // don't fight the user's intentional scroll-up to re-read.
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    let lastHeight = vv.height;
    const onResize = () => {
      const dh = vv.height - lastHeight;
      // Keyboard opening → height drops by >100px. Scroll back to
      // bottom so the latest message stays visible above the keyboard.
      if (dh < -100) {
        // small delay so the layout settles before we measure
        setTimeout(() => stb.scrollToBottom(), 60);
      }
      lastHeight = vv.height;
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apr 27 · MOBILE-FLUIDITY — textarea-grow scroll.
  // When the user types a multi-line draft, the input grows up to
  // 160px tall. Without re-snapping, the bottom of the conversation
  // gets eaten by the growing input. Watch input length crossing
  // newline thresholds and nudge back to bottom — but ONLY when the
  // user is already at-bottom (otherwise we'd interrupt scroll-up
  // re-reading).
  useEffect(() => {
    if (!stb.isAtBottom) return;
    const newlines = (input.match(/\n/g) || []).length;
    if (newlines === 0) return;
    // Cheap rAF instead of setTimeout — runs after the textarea
    // re-measures its rows on the next paint.
    const id = requestAnimationFrame(() => stb.scrollToBottom());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // Apr 19 · Launcher state retired alongside NickBelowInput. The
  // localStorage key nour-chat-below-collapsed is no longer read or
  // written. A one-shot cleanup removes the stale key on mount so
  // persistent settings don't carry forward from the old UI.
  useEffect(() => {
    try {
      localStorage.removeItem("nour-chat-below-collapsed");
    } catch {}
  }, []);

  // ── Chat transport ──
  // Apr 26 · Flow-mode endpoint switch removed. /api/ai/chat now
  // handles brain-dump capture inline via the interceptor fast path.
  const apiPath = "/api/ai/chat";

  // ── useChat (messages stream owned by AI SDK) ──
  // We build the transport with a body that references activeId; useConversations
  // owns activeId, so we forward-declare setActiveId via the hook below.
  //
  // IMPORTANT: body is passed as a FUNCTION, not a direct object. AI
  // SDK v6's HttpChatTransport evaluates `this.body` on every send via
  // `resolve()`. If you pass the object directly, the transport
  // captures that object reference at construction time — any later
  // reassignment of transportBodyRef.current is silently ignored and
  // the server always sees the INITIAL body. Passing a getter function
  // resolves the current ref value on each send, which is what we want.
  const transportBodyRef = useRef<{
    conversationId?: string | null;
    modeOverride?: string;
    providerOverride?: string;
    taskTypeOverride?: string;
    personality?: string;
    // v10.0.529.86 · Wave 30 · context hints for pronoun resolution.
    //   contextRoute · the page the operator is on when they sent this
    //     message · resolves "this page" / "here" references
    //   lastTaskId · the most recently touched task in this client
    //     session · resolves "this task" / "snooze that"
    //   lastGoalId · same for goals · "log progress on this"
    //   lastSuggestionKind · when a NickSuggestions chip seeded the
    //     prompt · resolves "do that" / "yes" / "go ahead"
    //   lastSuggestionId · the specific suggestion that was tapped
    // All optional · system-prompt path treats nulls as "no hint."
    contextRoute?: string;
    lastTaskId?: string;
    lastGoalId?: string;
    lastSuggestionKind?: string;
    lastSuggestionId?: string;
    // v10.0.529.90 · Wave 34 · expanded operator context for pronoun
    // resolution across the surfaces wired in Waves 30-33. Whenever
    // the operator (a) taps a suggestion chip, (b) navigates to a
    // specific entity page like /journal#bd-xyz, (c) lands on a
    // pin/decision/reflection detail · we stash the id here. Nick
    // resolves "this decision" / "grade that" / "act on this
    // reflection" from these hints rather than guessing.
    lastJournalEntryId?: string;
    lastDecisionId?: string;
    lastPinId?: string;
    lastReflectionId?: string;
    lastMissionId?: string;
  }>({});

  // Deeper Context telemetry — populated by the transport fetch wrapper
  // when the server emits X-Deeper-Context-* response headers. Shows
  // the user exactly when cross-source semantic recall (brain_dump /
  // reflection / strategic_law / chat_message) contributed to the reply.
  const [deeperContext, setDeeperContext] = useState<{ count: number; types: string[] } | null>(null);

  // Apr 19 · Live context-blocks cache — populated by the transport
  // fetch wrapper from X-Context-Blocks header. Read by the assistant
  // message shell while streaming; later overwritten by persisted
  // tokenUsage.contextBlocks when the message is saved.
  // Declared here (above transport) so useMemo can close over the ref.
  const liveContextBlocksRef = useRef<import("@/components/chat/context-block-badges").ContextBlocks | null>(null);

  // Forward-declared ref for the conversation-id sync. Populated by a
  // useEffect after useConversations runs below (which owns activeId +
  // setActiveId). The transport can't close over setActiveId directly
  // because it's memoized on apiPath only for stability, and
  // setActiveId doesn't exist at the time the transport memo fires.
  //
  // Pre-2026-04-22 bug: this ref didn't exist. The transport never
  // read X-Conversation-Id, so every send posted conversationId=null
  // → server created a NEW conversation for every message → sidebar
  // filled with 2-msg fragments. Fix: capture the id once, echo it on
  // every subsequent send via transportBodyRef.current.conversationId.
  const onConversationIdRef = useRef<((id: string) => void) | null>(null);

  // B2 · transport extracted to hooks/chat/use-chat-transport.ts.
  // The hook memoizes on apiPath only — every other dep is a ref or
  // setter (which keep stable identity), so useChat never re-subscribes
  // mid-stream. Write path for persona is ref-only (loop-safe pattern
  // from commit 5aef1a6 / a5796d5).
  const transport = useChatTransport({
    apiPath,
    transportBodyRef,
    liveContextBlocksRef,
    lastPersonaHeaderRef,
    lastTraceIdRef,
    setDeeperContext,
    onConversationId: (id) => onConversationIdRef.current?.(id),
  });

  // Explicit chat id so this useChat instance has its own isolated
  // state and cannot accidentally share with any other useChat (e.g.
  // the HQ NickInput on /command). Avoids duplicate-key React warnings
  // that manifest when HMR or Strict Mode re-mount the component and
  // two Chat instances end up writing to each other's message arrays.
  const { messages, sendMessage, status, setMessages, stop, regenerate } = useChat({
    id: "mastery-chat",
    transport,
    onError: (err) => {
      setError(err.message || "Something went wrong.");
      // Apr 19 · Don't auto-clear the error after 4s — the silent
      // retry hook resets it naturally on success, and clearing it
      // prematurely would restart the retry loop.
    },
  });

  // v10.0.529.xx · `detectedMode` useMemo removed. The ModePill mount
  // it fed was deleted, leaving a regex classifier running on every
  // keystroke + messages.length change with zero render consumer.
  // The server-side detectChatMode() in /api/ai/chat still runs
  // authoritatively to pick the actual mode for each turn.

  // Draft auto-save — persists composer text to localStorage so a
  // refresh / accidental nav / session-expiry-bounce doesn't eat
  // in-progress messages. Restores on mount only if the current
  // input is empty (don't trample active editing).
  const { clearDraft, restore } = useDraftAutosave({
    key: "chat-composer",
    value: input,
  });
  useEffect(() => {
    const saved = restore();
    if (saved && input.length === 0) {
      setInput(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v10.0.529.7 · ?seed= query-param composer seed
  // Lets surfaces outside /chat (Ultron tiles, command palette, brief
  // links) deep-link the operator into the composer with a prompt
  // already loaded. The DecisionReplayCard uses this to send the
  // operator from "I see this is due" → "the prompt is in the
  // composer ready to send" in one tap. Param is cleared after seed
  // so a back-nav doesn't re-seed (router replace, no history entry).
  //
  // v10.0.529.8 · length cap added per post-session review · browser
  // URL limits truncate around 2KB; an oversized seed would arrive
  // half-mangled. Hard-cap at 2000 chars before setInput so the
  // textarea state stays sane and the model never sees a runaway seed.
  useEffect(() => {
    const seed = params?.get("seed");
    if (!seed || seed.length === 0) return;
    if (input.length > 0) return; // don't clobber an in-flight draft
    setInput(seed.slice(0, 2000));
    // Strip the param without adding a history entry.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("seed");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v8.15 BATCH A · per-edit draft autosave + restore moved into
  // useChatEditing. clearEditDraft from the hook is the same primitive
  // the rest of the page uses to discard a draft on save/cancel.

  // Derived state — hoisted so later hooks (stall detection, regen,
  // keyboard handlers) can reference them without a TDZ error.
  const isStreaming = status === "streaming" || status === "submitted";
  const isEmpty = messages.length === 0;

  // v8.16 B3 · Lazy-render gate for long conversations. Below 80
  // messages this is a no-op pass-through; above the threshold only
  // the most recent 50 mount until the user clicks "show older". While
  // streaming we force-show all so scroll spring physics + last-message
  // height growth stay calm.
  const { renderedMessages, hasHidden, hiddenCount, showOlder } =
    useLazyRenderMessages(messages, isStreaming);

  // v10.0.529.18 · memoize the two dedupeMessages calls so they
  // stop firing on every streaming token. Pre-fix the dedupe ran
  // inline at the .map call site (line ~1948) AND inside the smart-
  // replies IIFE (line ~2546) · both re-evaluated on every chunk.
  // Dedup is O(n) Map-based · cheap per call but multiplied across
  // ~50 streamed tokens per turn × 2 sites it added up. Now each
  // recomputes only when its source array changes.
  const dedupedRendered = useMemo(
    () => dedupeMessages(renderedMessages),
    [renderedMessages],
  );
  const dedupedAll = useMemo(
    () => dedupeMessages(messages),
    [messages],
  );

  // v11.1 B2 · stale-error clear extracted to
  // hooks/chat/use-streaming-error-guard.ts.
  useStreamingErrorGuard({ isStreaming, error, clearError: () => setError(null) });

  // v11.1 · X-Persona safe sync. Only fires when a turn COMPLETES
  // (isStreaming goes true → false). The fetch wrapper stashed the
  // header in a ref; here we diff and call setPersonality only if
  // the value actually changed. Zero risk of re-entry because:
  //   1. The dep is isStreaming (booleans don't re-trigger on same val)
  //   2. We only write on the TRUE→FALSE transition, not on every tick
  //   3. setPersonality is a stable React setter
  const prevIsStreamingForPersonaRef = useRef(false);
  useEffect(() => {
    const was = prevIsStreamingForPersonaRef.current;
    prevIsStreamingForPersonaRef.current = isStreaming;
    if (!was || isStreaming) return; // fire only on true → false
    const serverPersona = lastPersonaHeaderRef.current;
    if (!serverPersona || serverPersona === personality) return;
    setPersonality(serverPersona);
    try { localStorage.setItem("nour:nick-personality", serverPersona); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  // v11.1 B2 · haptic tick on stream completion. Implementation lives
  // in hooks/chat/use-chat-haptics.ts (decomposed from the inline
  // effect). Fires haptic.select() only on the true→false transition.
  useChatHaptics(isStreaming);

  // v10.0.28 — copy lastTraceIdRef to state on stream completion so
  // the UI can render a "view trace" link without polling. Same
  // pattern as the persona sync above (true→false edge, ref→state).
  const prevIsStreamingForTraceRef = useRef(false);
  useEffect(() => {
    const was = prevIsStreamingForTraceRef.current;
    prevIsStreamingForTraceRef.current = isStreaming;
    if (!was || isStreaming) return;
    const next = lastTraceIdRef.current;
    if (next && next !== lastTraceId) setLastTraceId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  // Smart-replies warm-up — pre-fetches suggestions for the current
  // last assistant/user pair so the chip row under it renders instant.
  // Computed here (hoisted) because the hook must run on every render
  // consistently. `assistantId=null` when there's no eligible pair.
  const { warmId, warmAssistantText, warmUserText } = useMemo(() => {
    if (messages.length === 0) return { warmId: null, warmAssistantText: "", warmUserText: "" };
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx < 0) return { warmId: null, warmAssistantText: "", warmUserText: "" };
    const asstMsg = messages[lastAssistantIdx];
    const aText = extractMessageText(asstMsg);
    let uText = "";
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "user") continue;
      uText = extractMessageText(m);
      break;
    }
    return {
      warmId: asstMsg.id || null,
      warmAssistantText: aText,
      warmUserText: uText,
    };
  }, [messages]);

  useSuggestionWarm({
    assistantId: warmId,
    assistantMessage: warmAssistantText,
    userMessage: warmUserText,
    streaming: isStreaming,
  });

  // Apr 19 · Silent retry — Apr 27: capped to 1 attempt (was 3).
  // Three retries × every error = up to 4 actual chat API calls per
  // user prompt, which spawned the duplicate-Venice-image storm
  // when image gen exceeded the 22s abort threshold. With only 1
  // silent retry attempt, transient blips still self-heal but a
  // genuinely slow-but-working operation can finish in peace.
  const silentRetry = useSilentRetry(
    error,
    () => {
      try {
        regenerate();
      } catch {
        // regenerate might throw if last message wasn't saved; ignore,
        // the exhausted state will surface the error card eventually.
      }
    },
    { maxAttempts: 1 },
  );
  // Apr 19 · Venice health — feeds the header dot. Amber when Venice
  // is unreachable / rate-limited, silent gold-idle when fine.
  const veniceHealthy = useVeniceHealth();

  // Apr 19 · Adaptive input placeholder — rotates based on live state
  // (contradictions / overdue / quiet) so the input itself carries
  // signal instead of a static "Message Nick…".
  const adaptivePlaceholder = useAdaptivePlaceholder();

  // v10.0.529.18 · idleDismissed + useIdleSuggestion both removed.
  // The render site was deleted in v10.0.141 per operator request ·
  // the hook stayed wired but its return value was never consumed.
  // Net: one fewer API call + one fewer debounce timer per session.

  // v7.4 · Apr 29 · Live "as you type" prompt suggestions. Pulls from
  // /api/ai/autocomplete (heuristic-first, ~5ms on a match). Renders
  // as a collapsible chip row above the textarea. Silent on empty
  // drafts, multi-line drafts, and after manual collapse.
  const promptSuggestions = usePromptSuggestions({ draft: input });

  // Apr 19 · Message action sheet (long-press bottom sheet). Replaces
  // the per-message hover button cluster (copy/pin/edit) with a
  // phone-first sheet. Open tracks which message is active.
  const [actionSheetMsg, setActionSheetMsg] = useState<null | {
    id: string;
    role: "user" | "assistant";
    text: string;
  }>(null);

  // Apr 19 · Undo-send window. When the user hits send, we queue the
  // actual API dispatch through a 2s setTimeout + show the toast. If
  // they tap undo, we clear the timer and the message never goes.
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const [undoPayload, setUndoPayload] = useState<string | null>(null);

  // Clear pending undo-send timer if the component unmounts (route
  // change mid-grace-period). Otherwise the closure would fire and
  // try to sendMessage against a dead useChat hook.
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
    };
  }, []);

  // Next.js router for slash commands
  const router = useRouter();

  // ── Offline queue: if Nour's phone loses signal mid-send, queue
  // the message to localStorage and auto-replay when connectivity
  // returns. Shows a colored status pill at the bottom of the chat. ──
  const offline = useOfflineQueue({
    sendMessage: async (text: string) => {
      // useChat's sendMessage is fire-and-forget; it schedules the
      // transport fetch internally. We resolve immediately so the
      // drain loop continues — if the real network request fails,
      // useChat's onError will fire but we won't re-queue (the user
      // can resend manually).
      sendMessage({ text });
    },
    onDrained: (count) => {
      if (count > 0) {
        setError(`${count} queued message${count > 1 ? "s" : ""} delivered.`);
        setTimeout(() => setError(null), 2500);
      }
    },
  });

  // v11.1 B2 · stall detection + handler lives in
  // hooks/chat/use-chat-stall.ts. Keeps the Apr-15 no-auto-retry
  // semantics (stops + surfaces error, doesn't double-send).
  const { stallStatus, triggerStallHandler } = useChatStall({
    messages: messages as { role: "user" | "assistant" | "system"; parts?: Array<{ type: string; text?: string }> }[],
    isStreaming,
    stop,
    setError,
  });

  // ── Regenerate with optional mode override ──
  // Called by ChatControlBar's "Regen" menu. If `forceMode` is passed
  // we set the override on the body ref BEFORE calling regenerate()
  // so the re-fire uses that mode, then clear it after.
  const handleRegenerate = useCallback(
    (forceMode?: ChatModeOverride) => {
      if (forceMode && forceMode !== "auto") {
        transportBodyRef.current.modeOverride = forceMode;
      }
      regenerate();
      if (forceMode && forceMode !== "auto") {
        setTimeout(() => {
          if (overrides.mode === "auto") {
            transportBodyRef.current.modeOverride = undefined;
          }
        }, 1000);
      }
    },
    [regenerate, overrides.mode]
  );

  const canRegenerate =
    !isStreaming && messages.length > 0 && messages[messages.length - 1]?.role === "assistant";

  // Find the last user message text — used by the Reword modal (#10)
  const lastUserText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "user") {
        return (
          m.parts
            ?.filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
            .map((p) => p.text)
            .join(" ") || ""
        );
      }
    }
    return "";
  }, [messages]);

  const handleRewordAndSend = useCallback(
    (text: string) => {
      haptic.success();
      // Route through sendOrQueue so an offline reword still captures
      // the edit instead of silently dropping it.
      sendOrQueue(text);
    },
    // sendOrQueue is a hoisted function declaration — stable reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Copy an assistant message's full text to the clipboard.
  const copyMessage = useCallback(async (msg: { parts?: Array<{ type: string; text?: string }> }) => {
    const text =
      msg.parts
        ?.filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
        .map((p) => p.text)
        .join("\n") || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }, []);

  // ── Conversations (list + CRUD) ──
  const {
    convos,
    activeId,
    setActiveId,
    showHistory,
    setShowHistory,
    loadConvo: loadConvoBase,
    deleteConvo: deleteConvoBase,
    newChat: newChatBase,
    renameConvo,
    pinnedIds: pinnedConvoIds,
    togglePin: toggleConvoPin,
    reloadConvos,
    // v10.0.187 · drawer pagination
    hasMoreConvos,
    loadMoreConvos,
    loadingMore,
    // v10.0.529.59 · audit Wave 8 follow-up · per-row flag toggle
    // (star/archive/mute) consumed by ConversationDrawer rows.
    patchConvoFlag,
  } = useConversations({
    setMessages,
    onError: (msg) => {
      setError(msg);
      setTimeout(() => setError(null), 4000);
    },
  });

  // v10.0.529.59 · audit Wave 8 follow-up · the active-convo flag
  // state (convoStarred/Archived/Muted) + 3 toggle wrappers were
  // removed in favor of per-row toggles in ConversationDrawer.
  // patchConvoFlag now lives in useConversations and operates on any
  // convo id; the drawer wires it per row. Source of truth is the
  // convo row itself (starredAt / mutedAt). deleteCurrentConversation
  // was folded into deleteConvo below — same confirm + toast UX, just
  // parameterized by id so the drawer per-row trash button can use it.

  // ── Conversation-id sync (fixes "every send is a new convo" bug) ──
  // Fill the forward-declared ref so the transport's fetch wrapper can
  // call into setActiveId whenever the server returns X-Conversation-Id.
  // Idempotent — only fires setActiveId when the id differs from what
  // we already have, so repeat sends to the same convo don't thrash.
  //
  // When we capture a NEW id (activeId was null), we also trigger a
  // sidebar refresh so the new conversation appears without needing a
  // full page reload.
  useEffect(() => {
    onConversationIdRef.current = (id: string) => {
      if (!id) return;
      if (activeId !== id) {
        const isBrandNew = activeId === null;
        setActiveId(id);
        if (isBrandNew) {
          // Small delay so the server finishes writing the first
          // assistant message before we refetch the list; without this
          // the row appears with message count=1 and auto-title.
          setTimeout(() => reloadConvos(), 800);
        }
      }
    };
    return () => {
      // Clear on unmount so a dangling transport can't call into a
      // stale setter reference after the component tears down.
      onConversationIdRef.current = null;
    };
  }, [activeId, setActiveId, reloadConvos]);

  // Fork-from-message handler (#4) — placed after useConversations so
  // activeId + loadConvoBase are in scope.
  const forkMutation = trpc.chat.fork.useMutation();
  const handleFork = useCallback(
    async (messageId: string) => {
      if (!activeId) return;
      haptic.medium();
      try {
        // tRPC surfaces a non-2xx as a thrown error · the catch below
        // handles the fork-failed path the legacy !res.ok branch did.
        const data = await forkMutation.mutateAsync({
          sourceConversationId: activeId,
          upToMessageId: messageId,
          titleSuffix: "fork",
        });
        haptic.success();
        await loadConvoBase(data.forkId);
        setError(`Forked → ${data.title}`);
        setTimeout(() => setError(null), 2500);
      } catch {
        haptic.error();
        setError("Fork failed");
        setTimeout(() => setError(null), 3000);
      }
    },
    [activeId, loadConvoBase, forkMutation]
  );
  // Keep transport body in sync with the active convo + overrides.
  // Each override is only included when it's NOT "auto" — that way the
  // server sees a clean absent-field when Nour hasn't forced anything.
  useEffect(() => {
    const base: Record<string, string | null | undefined> = {
      conversationId: activeId,
    };
    if (overrides.mode !== "auto") base.modeOverride = overrides.mode;
    if (overrides.provider !== "auto") base.providerOverride = overrides.provider;
    if (overrides.taskType !== "auto") base.taskTypeOverride = overrides.taskType;
    base.personality = personality;
    // v10.0.529.86 · Wave 30 · live route awareness preserved across
    // re-renders. Preserved across body-rebuilds via spread of the
    // previous suggestion + task/goal anchors · cleared by the next
    // send-cycle via the existing flow (suggestion meta gets stale
    // after first use · operator's NEXT manual message shouldn't
    // carry it forward).
    base.contextRoute = currentPathname ?? undefined;
    base.lastTaskId = transportBodyRef.current.lastTaskId;
    base.lastGoalId = transportBodyRef.current.lastGoalId;
    base.lastSuggestionKind = transportBodyRef.current.lastSuggestionKind;
    base.lastSuggestionId = transportBodyRef.current.lastSuggestionId;
    // v10.0.529.90 · Wave 34 · forward 5 new entity anchors so the
    // server-side gate.ts + route.ts can hand them to the system
    // prompt for pronoun resolution.
    base.lastJournalEntryId = transportBodyRef.current.lastJournalEntryId;
    base.lastDecisionId = transportBodyRef.current.lastDecisionId;
    base.lastPinId = transportBodyRef.current.lastPinId;
    base.lastReflectionId = transportBodyRef.current.lastReflectionId;
    base.lastMissionId = transportBodyRef.current.lastMissionId;
    transportBodyRef.current = base;
  }, [activeId, overrides, personality, currentPathname]);

  // v10.0.529.91 · Wave 35 · pull entity anchors from PageContextBridge.
  // The bridge (mounted in (mastery)/layout.tsx) writes to localStorage
  // + fires "nour:page-context-changed" whenever the operator navigates
  // to /decisions/<id> · /journal#bd-<id> · /pins#pin-<id> · /tasks#
  // task-row-<id>. Chat reads on mount AND subscribes so even mid-session
  // hash-changes (e.g. backlink jumps) hydrate the right anchor.
  //
  // Pre-Wave-35 these fields were ONLY set by suggestion-chip taps ·
  // operator viewing /decisions/abc could open chat and say "grade this"
  // and Nick had no anchor. Now the bridge backfills lastDecisionId
  // from the URL so the system-prompt hint lands automatically.
  useEffect(() => {
    const applyPageContext = (
      ctx: { lastTaskId?: string; lastGoalId?: string; lastJournalEntryId?: string; lastDecisionId?: string; lastPinId?: string; lastReflectionId?: string; lastMissionId?: string } | null,
    ) => {
      if (!ctx) return;
      const r = transportBodyRef.current;
      // Only OVERWRITE when the bridge actually has a value · don't
      // clobber an existing suggestion-tap anchor with undefined.
      if (ctx.lastTaskId) r.lastTaskId = ctx.lastTaskId;
      if (ctx.lastGoalId) r.lastGoalId = ctx.lastGoalId;
      if (ctx.lastJournalEntryId) r.lastJournalEntryId = ctx.lastJournalEntryId;
      if (ctx.lastDecisionId) r.lastDecisionId = ctx.lastDecisionId;
      if (ctx.lastPinId) r.lastPinId = ctx.lastPinId;
      if (ctx.lastReflectionId) r.lastReflectionId = ctx.lastReflectionId;
      if (ctx.lastMissionId) r.lastMissionId = ctx.lastMissionId;
    };
    // Initial read on chat mount · in case the operator was on
    // /decisions/abc · then navigated to /chat or /
    applyPageContext(readPageContext());
    // Subscribe to in-session updates (same tab · hashchange + route)
    return onPageContextChanged(applyPageContext);
  }, []);

  // ── Pinned messages ──
  const pins = usePinnedMessages();

  // ── Text-to-speech ──
  // UIMessage is structurally compatible with AssistantMessage
  // ({ id, role, parts? }) — the cast was unnecessary.
  const tts = useTextToSpeech({
    messages: messages as Array<{ id: string; role: string; parts?: Array<{ type: string; text?: string }> }>,
    isStreaming,
  });

  // ── Image attachment ──
  const img = useImageAttachment();

  // ── Speech-to-speech voice mode (v10.0.359 · OpenAI Realtime) ──
  // Full voice conversation with Nick · sub-500ms · barge-in supported.
  // Opens a fullscreen overlay; not modal-blocking, so you can return
  // to text chat by closing.
  const [voiceMode, setVoiceMode] = useState(false);

  // ── BDI reasoning trace (v10.0.360) · message ID for which to show
  // the cognitive chain modal. Null = closed.
  const [reasoningTraceMsg, setReasoningTraceMsg] = useState<string | null>(null);

  // ── Audio drop → transcript (v10.0.349 · VideoDB) ──
  // v10.0.529.106 · Wave 83 · file-upload + fetch + toast + relay
  // (~36 LOC) lifted into useAudioTranscribe. Page owns the textarea
  // append + focus side effect via the onTranscript callback.
  const audioInputRef = useRef<HTMLInputElement>(null);
  const { transcribing: audioTranscribing, handleAudioAttach } = useAudioTranscribe({
    onTranscript: (transcript) => {
      setInput((prev) => (prev ? prev + " " + transcript : transcript));
      inputRef.current?.focus();
    },
  });

  // ── Slash commands ──
  const slash = useSlashCommands();

  // ── @mention context injection ──
  const mentions = useMentionSuggestions();

  // ── Voice input + wake word ──
  const voice = useVoiceInput(
    (text: string) => { setInput((prev) => (prev ? prev + " " + text : text)); inputRef.current?.focus(); },
    (text: string) => { sendOrQueue(text); }
  );
  const wakeWord = useWakeWord(() => setTimeout(() => voice.startContinuous(), 300));

  // v11.1 D2 · Ambient / speaker mode. Composes wake-word + TTS with
  // audio-ducking (pause mic while Nick speaks so he doesn't re-trigger
  // himself). Persists toggle state in localStorage. When `ambient` is
  // true the phone can sit on the counter and carry a full conversation
  // hands-free.
  const ambient = useAmbientMode({ wakeWord, tts });

  // Morning auto-brief REMOVED — was auto-sending "Morning. What's
  // the plan?" on every fresh page load. Nour wants a clean slate
  // when he opens chat, not an auto-generated conversation.

  // v11.1 · Auto-scroll now handled by useStickToBottom (above) — no
  // manual scrollTo effect. The hook uses a ResizeObserver on the
  // content ref and auto-follows via its spring animation. When Nour
  // scrolls up, isAtBottom flips to false and auto-follow pauses
  // until he scrolls back down (or taps the "↓ new reply" chip).

  // ── Speed ribbon timing (#3) ─────────────────────────────
  // Watches assistant messages and populates timingRef:
  //   - sentAt: when the __pending__ sentinel was set by send()
  //   - firstTokenAt: first time the message appears in messages[]
  //   - endedAt: when isStreaming flips to false for this message
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || !last.id) return;

    const existing = timingRef.current.get(last.id);
    if (!existing) {
      // First time we see this assistant message — migrate the pending
      // sentinel from the send() call and mark firstTokenAt now.
      const pending = timingRef.current.get("__pending__");
      timingRef.current.set(last.id, {
        sentAt: pending?.sentAt || Date.now(),
        firstTokenAt: Date.now(),
      });
      timingRef.current.delete("__pending__");
      return;
    }

    // Mark endedAt when stream transitions from streaming → ready
    if (!isStreaming && !existing.endedAt) {
      timingRef.current.set(last.id, {
        ...existing,
        endedAt: Date.now(),
      });
    }
  }, [messages, isStreaming]);

  // ── Watch for tool-call completions and fire the cross-surface
  // data-change event so NourState, /tasks, and HQ refresh instantly.
  //
  // Each tool name maps to one or more data domains. We only fire on
  // the transition into 'output-available' so we don't spam the bus
  // on every streaming token.
  const toolCompletedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || !last.parts) return;

    // v10.0.75 · createLoop / closeLoop entries kept for chat-history
    // tool calls that pre-date the rename. Live tool catalog no longer
    // exposes those names (canonical: createTask / completeTask), but
    // older messages in ChatMessage rows still reference them — the map
    // lookup ensures cache invalidation still fires when those replays
    // resolve. Same backwards-compat pattern as tool-result-card.tsx.
    const TOOL_DOMAIN_MAP: Record<string, DataDomain[]> = {
      createTask: ["tasks"],
      updateTask: ["tasks"],
      completeTask: ["tasks"],
      deleteTask: ["tasks"],
      createLoop: ["tasks"],
      closeLoop: ["tasks"],
      addCommitment: ["commitments"],
      markCommitment: ["commitments"],
      setMit: ["mit"],
      clearMit: ["mit"],
      // Apr 19 · logScore retired alongside DailyScore.
      toggleHabit: ["habits"],
      // v10.0.529.86 · Wave 30 · the 5 Wave 29 tools that mutate
      // /tasks /goals surfaces. Without these the bus fires "any"
      // fallback · less efficient than targeted domain refresh.
      snoozeTask: ["tasks"],
      archiveGoal: ["goals"],
      logGoalProgress: ["goals"],
      pinMemory: ["brain"], // Wave 30 · "brain" domain added · targeted refresh
      // Wave 30 · expand the new tools to ALSO fire across related
      // domains so cross-surface refresh is exhaustive. snoozeTask
      // moves a task to WAITING (waiting-band reads "tasks" already
      // · noop) · archiveGoal also touches missions linkage ·
      // logGoalProgress affects mastery-radar via downstream
      // GoalEvent → no auto-fire there but the "goals" target
      // covers the immediate UI.
      // v10.0.529.87 · Wave 31 · /journal + /settings coverage.
      // Audit found 4 mutating tools fell through to "any" fanout ·
      // /journal subscribed but filtered by detail-string match so
      // tool-driven writes never refreshed the feed. Pre-fix Nick
      // could log a situation via chat and /journal would stay
      // stale until full page reload. syncDriveMemory now targets
      // "settings" so AiSettingsPanel's Cold Memory card refreshes.
      logSituation: ["journal"],
      journalDecision: ["journal"],
      reviewDecisionReplay: ["journal"],
      markCommitmentBroken: ["commitments"],
      syncDriveMemory: ["settings"],
      // v10.0.529.88 · Wave 32 · /life /plan /mastery /knowledge /pins
      // axis coverage. Audit found 8 write-tools fell through to "any"
      // fanout · 3 pages (mastery / pins / knowledge) had zero bus
      // subscription. Operator could update mastery via chat and the
      // radar stayed frozen up to 60s while polling caught up.
      setLifeGoal: ["goals"],
      updateMasteryScore: ["score"],
      createMissionPlan: ["missions"],
      setOKRs: ["missions"],
      setWeeklyTargets: ["missions"],
      syncKnowledge: ["knowledge"],
      // BrainMemory mutators that target /brain · pre-Wave-32 they
      // fell through to "any" so /brain refresh fired but couldn't
      // be filtered from churn signals. Targeted "brain" lets the
      // page narrow its refetch path.
      buildArchitectureMemory: ["brain"],
      learnCodingPreference: ["brain"],
    };

    for (const part of last.parts) {
      if (!part.type.startsWith("tool-")) continue;
      const tp = part as { type: string; state?: string; toolCallId?: string; output?: unknown };
      if (tp.state !== "output-available") continue;
      // Dedupe so we only fire once per completed tool call.
      const key = `${tp.toolCallId || ""}::${tp.type}`;
      if (toolCompletedRef.current.has(key)) continue;
      // v10.0.28 — bounded growth. A long session with image gen +
      // tool calls per turn could push this Set into thousands of
      // entries that live until tab unload. 500-cap → on overflow,
      // clear and start fresh; the only side effect is potential
      // duplicate "completed" notifications for keys we previously
      // saw in the same session, which is rare and idempotent.
      if (toolCompletedRef.current.size > 500) {
        toolCompletedRef.current.clear();
      }
      toolCompletedRef.current.add(key);

      // Derive tool name ("tool-createTask" -> "createTask").
      const toolName = tp.type.replace("tool-", "");
      const domains = TOOL_DOMAIN_MAP[toolName] ?? ["any"];
      for (const d of domains) {
        notifyDataChanged(d, { source: "chat-tool", detail: toolName });
      }

      // v10.0.529.86 · Wave 30 · E1 · cross-page kommando hand-off.
      // v10.0.529.90 · Wave 34 · smart-mode dispatch by tool family.
      //
      // Pre-Wave-34 every mutator forced NOW · creating a DAILY habit
      // from chat dumped the operator into NOW mode even though DAILY
      // tasks live in PLAN. Now we route by the work-type:
      //   · NOW   · day-of-work tools (create/complete/priority/snooze/
      //              update one-shot tasks) · the operator wants to
      //              see what's actionable right now
      //   · PLAN  · goal + life-mission tools (archiveGoal · logGoal
      //              Progress · setLifeGoal · createMissionPlan · setOKRs
      //              · setWeeklyTargets) · these affect the planning
      //              horizon · NOW mode would hide them behind status
      //              filters
      //   · (no   · journal / decision / pin / settings · these don't
      //     switch)  belong on /tasks at all · forcing a mode switch
      //              would yank the operator away from their context
      const NOW_TRIGGERING_TOOLS = new Set([
        "createTask",
        "completeTask",
        "setTaskPriority",
        "snoozeTask",
        "updateTask",
      ]);
      const PLAN_TRIGGERING_TOOLS = new Set([
        "archiveGoal",
        "logGoalProgress",
        "setLifeGoal",
        "createMissionPlan",
        "setOKRs",
        "setWeeklyTargets",
      ]);
      let targetMode: "NOW" | "PLAN" | null = null;
      if (NOW_TRIGGERING_TOOLS.has(toolName)) targetMode = "NOW";
      else if (PLAN_TRIGGERING_TOOLS.has(toolName)) targetMode = "PLAN";
      if (targetMode) {
        try {
          localStorage.setItem("nour:kommando:mode", targetMode);
        } catch {}
        window.dispatchEvent(
          new CustomEvent("nour:kommando:set-mode", { detail: targetMode }),
        );
      }

      // v11.1 G1 · when Nick creates a browser session via browser_do,
      // auto-open the BrowserSandbox side panel so Nour can watch.
      if (toolName === "browser_do") {
        const out = tp.output as { ok?: boolean; session?: { liveViewUrl?: string } } | null;
        if (out?.ok && out.session?.liveViewUrl) {
          setBrowserSandboxOpen(true);
        }
      }

      // ── clientAction mirror ──
      // Some tools return { clientAction: "setMit" | "clearMit", ...payload }
      // because the canonical state lives in browser localStorage (MIT is
      // client-owned). When we see one of these, mirror the write here so
      // the MitContract card and @mit mention update instantly.
      const output = tp.output as { clientAction?: string; text?: string } | null;
      if (output?.clientAction === "setMit" && typeof output.text === "string") {
        try {
          const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
          const payload: { date: string; text: string; linkedMissionId: string | null; setAt: number; completed: boolean; completedAt: number | null } = {
            date: todayKey,
            text: output.text.slice(0, 140),
            linkedMissionId: null,
            setAt: Date.now(),
            completed: false,
            completedAt: null,
          };
          window.localStorage.setItem("nour:mit-contract", JSON.stringify(payload));
          window.dispatchEvent(new CustomEvent("nour:mit-updated", { detail: payload }));
        } catch {}
      } else if (output?.clientAction === "clearMit") {
        try {
          window.localStorage.removeItem("nour:mit-contract");
          window.dispatchEvent(new CustomEvent("nour:mit-updated", { detail: null }));
        } catch {}
      }
    }
  }, [messages]);

  // Apr 26 · ?mode=flow / ?mode=unload deep-links retired alongside
  // flow mode itself. Old shortcuts now drop into the standard chat
  // surface; capture intents flow through the fast-path interceptors
  // (e.g. typing "brain dump:" hits 200ms instead of waiting for a
  // mode toggle). Deep-link consumers were the morning-routine HQ
  // tile + a couple of widget links, both already reworked to point
  // at /chat without query params.

  // ── URL-param consumers (?q= auto-send, ?cid= deep-link load) ──
  // v8.12 BATCH 68 — extracted to useChatDeepLink. Both effects are
  // one-shot per mount; dispatch flags live inside the hook.
  useChatDeepLink({
    params,
    messageCount: messages.length,
    activeConversationId: activeId,
    sendOrQueue,
    loadConversation: loadConvoBase,
  });

  // v10.0.529.92 · Wave 36 · NickSuggestions standalone deep-link.
  // When the chip strip is mounted on a non-chat surface (e.g. /brain)
  // and the operator taps a chip, it navigates to /chat?q=...&suggKind=
  // X&suggId=Y. The ?q= side is handled by useChatDeepLink above ·
  // here we mirror suggestion meta into transportBodyRef so the FIRST
  // send carries the right anchor (matches the same-tab onSeed flow).
  const [suggHydrated, setSuggHydrated] = useState(false);
  useEffect(() => {
    if (suggHydrated) return;
    const kind = params.get("suggKind");
    const id = params.get("suggId");
    if (!kind || !id) return;
    setSuggHydrated(true);
    const r = transportBodyRef.current;
    r.lastSuggestionKind = kind;
    r.lastSuggestionId = id;
    // Re-use the same prefix-strip mapping as the same-tab onSeed
    // handler · keep both code paths in lockstep.
    if (kind === "broken-promise" && id.startsWith("broken-promise-")) {
      r.lastTaskId = id.slice("broken-promise-".length);
    } else if (kind === "stalled-goal" && id.startsWith("stalled-goal-")) {
      r.lastGoalId = id.slice("stalled-goal-".length);
    } else if (kind === "stale-pin" && id.startsWith("stale-pin-")) {
      r.lastPinId = id.slice("stale-pin-".length);
    } else if (kind === "unresolved-reflection" && id.startsWith("unresolved-reflection-")) {
      r.lastReflectionId = id.slice("unresolved-reflection-".length);
    }
  }, [params, suggHydrated]);

  // ── Branch swap (in-place) ──
  // v8.12 BATCH 68 — extracted to useChatBranchSwap. Listens for the
  // `nick-swap-branch` window event from MessageBranchSwitcher and
  // replaces the active message with the chosen sibling without
  // disturbing scroll position or downstream effects.
  useChatBranchSwap(
    // v10.0.313 · useChatBranchSwap is now generic over the message
    // type · pass through directly, no cast needed
    messages,
    setMessages,
  );

  // ── MessageFooter callbacks (v10.0.529.20) ──
  // Stable useCallback refs for the memoized per-message footer.
  // These USED to be inline arrows inside the messages-list `.map`,
  // which gave each row a fresh closure per render and defeated the
  // point of memoizing the footer. Hoisting them here lets the footer's
  // React.memo bail out cleanly for all finished messages on every
  // streamed token.
  const handleFooterStartEdit = useCallback(
    (id: string) => setEditingAssistantId(id),
    [setEditingAssistantId],
  );
  const handleFooterCancelEdit = useCallback(
    () => setEditingAssistantId(null),
    [setEditingAssistantId],
  );
  const handleFooterMessageSaved = useCallback(
    (id: string, newContent: string, editedAt: string) => {
      setEditingAssistantId(null);
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          return {
            ...m,
            parts: [{ type: "text" as const, text: newContent }],
            editedAt,
          } as typeof m;
        }),
      );
    },
    [setEditingAssistantId, setMessages],
  );
  const editMessageMutation = trpc.chat.editMessage.useMutation();
  const handleFooterMessageReverted = useCallback(
    (id: string, priorContent: string) => {
      // Revert = trigger an edit with the old content. Reuses the
      // Phase JJ chat.editMessage procedure (PATCH /api/ai/chat/edit/
      // [id] equivalent). A thrown error is swallowed — same as the
      // legacy `.catch(() => undefined)`.
      editMessageMutation
        .mutateAsync({ messageId: id, content: priorContent })
        .then((j) => {
          if (!j || typeof j.content !== "string") return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id !== id
                ? m
                : ({ ...m, parts: [{ type: "text", text: j.content }], editedAt: j.editedAt } as typeof m),
            ),
          );
        })
        .catch(() => undefined);
    },
    [setMessages, editMessageMutation],
  );
  const handleFooterSwapBranch = useCallback(
    (activeMessageId: string, siblingId: string) => {
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("nick-swap-branch", {
          detail: { activeMessageId, siblingId },
        }),
      );
    },
    [],
  );

  // ── Focus input when messages/history changes ──
  useEffect(() => {
    if (!showHistory) inputRef.current?.focus();
  }, [messages, showHistory]);

  // ── Global keyboard shortcuts — extracted to useChatKeyboard (B2).
  // Shortcut matrix identical, 125-line handler moved out of this file.
  useChatKeyboard({
    inputRef,
    isStreaming,
    stop,
    messages,
    setShowHistorySearch,
    setShowHelp,
    setInspectorOpen,
    setToolLogOpen,
    setOverrides,
    tts,
    haptic,
    router,
    showHelp,
    showHistory,
    showHistorySearch,
    error,
    setError,
    setShowHistory,
  });

  // ── Auto-resize textarea ──
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, []);
  useEffect(() => { autoResize(); }, [input, autoResize]);

  // ── Auto-fire image gen on marketing-content replies ─────────────
  //
  // Apr 28 · When Nick produces a complete marketing post (caption +
  // hashtags + sign-off + CTA), the user expects the image to come
  // automatically — not have to tap a button. This watches `messages`
  // for new assistant turns, and when one lands that:
  //   · is marketing content (≥3 signals via shared detector)
  //   · doesn't already have a generated image markdown
  //   · isn't itself a response to a "now generate the picture" ask
  //     (defense vs. infinite loop)
  //   · we haven't auto-fired for this message ID yet
  // …it fires `sendOrQueue("now generate the picture")` once. The
  // existing typo-tolerant interceptor catches it → context-aware synth
  // pulls the prior caption → brand-tier injection → Venice renders.
  // Same path as the auto-suggest button, just one tap saved.
  // ── Auto-fire plan toast (v8.18 → useChatAutoFire) ───────────────
  // The hook owns autoFiredRef, the pending plan state, the 6-gate
  // decision useEffect, and both Go/Cancel handlers. Page just wires
  // the toast and forwards `sendOrQueue` so proceed actually fires.
  const {
    pendingAutoFire,
    handleAutoFireProceed,
    handleAutoFireCancel,
  } = useChatAutoFire({
    messages,
    isStreaming,
    sendOrQueue: (text: string) => sendOrQueue(text),
  });

  // ── Wrapped convo handlers that also reset local state ──
  const loadConvo = useCallback(async (id: string) => {
    await loadConvoBase(id);
  }, [loadConvoBase]);

  const newChat = useCallback(() => {
    newChatBase();
    setError(null);
    // v10.0.529.18 · setIdleDismissed reset removed (the state + hook
    // it referenced were dead since v10.0.141). undo-send cleanup stays.
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoVisible(false);
    setUndoPayload(null);
    // Reset live context-blocks cache too — the next turn in the
    // fresh session shouldn't inherit badges from the previous one.
    liveContextBlocksRef.current = null;
    // Reset session-storage gate for proactive insight card so the
    // next chat session can show a fresh observation.
    try {
      sessionStorage.removeItem("nour:chat-proactive-shown");
    } catch { /* swallow */ }
  }, [newChatBase]);

  // v10.0.529.59 · audit Wave 8 follow-up · confirm before delete.
  // Previously the drawer's per-row trash fired immediately with no
  // confirm; only the header's "Delete conversation" had the guard.
  // Now both flows share one confirm-protected path. e.preventDefault
  // / stopPropagation still happen via deleteConvoBase.
  const deleteConvo = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    await deleteConvoBase(id, e);
    toast.success("Conversation deleted");
  }, [deleteConvoBase]);

  async function send() {
    const raw = input.trim();
    if (!raw && !img.attached) return;

    // Direct-action intercept — /add /done /mit /score /commit bypass
    // Nick and hit the API directly. Only runs when there's no attached
    // image (images always go through Nick for vision analysis).
    if (!img.attached && raw.startsWith("/")) {
      const result = await runDirectAction(raw);
      if (result.handled) {
        setInput("");
        mentions.close();
        slash.close();
        if (inputRef.current) inputRef.current.style.height = "auto";
        return;
      }
    }

    // ── Optimistic cross-surface refresh for NL interceptors ──
    // The chat route intercepts "remember that X", "log this decision: X",
    // etc BEFORE hitting the model. Those interceptors write to BrainDump
    // or masteryDecision synchronously. We fire the data-change event
    // here (before awaiting the server) so the /journal page refreshes
    // as soon as the interceptor's stream response arrives.
    //
    // Keep these patterns in sync with the server-side regexes in
    // app/api/ai/chat/route.ts — DECISION_PREFIX_REGEX + BRAIN_DUMP_PREFIX_REGEX.
    if (!img.attached && raw.length > 3) {
      const nlDecision =
        /^(log\s+(this|a|my)?\s*decision\s*:?\s*|decision\s*:\s*|my\s+decision\s*(is|:)\s*|i['']?ve?\s+decided\s+to\s+|i\s+decided\s+to\s+|decided\s+to\s+)/i;
      const nlBrainDump =
        /^(remember\s+(this\s*:?\s*|that\s+|:\s*)|note\s*(this\s*:?\s*|that\s+|:\s*)|capture\s+(this\s*:?\s*|:\s*)|journal\s+(this\s*:?\s*|:\s*)|brain\s*dump\s*:\s*)/i;
      if (nlDecision.test(raw)) {
        // Delay slightly so the server write has time to land before
        // the journal page refetches. 600ms is enough for a single
        // prisma insert + stream open.
        setTimeout(
          () => notifyDataChanged("any", { source: "chat-nl", detail: "nl-decision" }),
          600
        );
      } else if (nlBrainDump.test(raw)) {
        // Brain dump ingestJournal takes longer (AI extraction). Wait
        // 2.5s before firing the refresh so the extraction has time to
        // commit before the journal page pulls fresh data.
        setTimeout(
          () => notifyDataChanged("any", { source: "chat-nl", detail: "nl-brain-dump" }),
          2500
        );
      }
    }

    // Expand @mention tokens into live context before the AI sees it.
    // Unknown tokens are left untouched. Async path resolves @yesterday,
    // @week, @cold server-side via /api/chat/resolve-mention (#7).
    const expanded = await mentions.expandMentionsAsync(raw);
    // v10.0.413 · apply persona mode prefix when chip is non-default ·
    // skips if operator already typed /battle, /reflect, or /execute manually
    const text = applyMode(expanded, personaMode);
    // Reset chip to default after using it · per-turn opt-in.
    if (personaMode !== "default") setPersonaMode("default");
    setInput("");
    clearDraft(); // successful send — drop the autosaved draft
    mentions.close();
    setError(null);
    haptic.tap();

    // Record send time for the speed ribbon (#3). We can't know the
    // assistant's message id yet, so we stash under a sentinel key
    // keyed by "pending" and migrate it in the messages effect below.
    timingRef.current.set("__pending__", { sentAt: Date.now() });

    // Apr 19 · Undo-send window. Instead of dispatching immediately,
    // schedule a 2s timer + show the undo toast. If the user taps
    // undo, clear the timer and restore input. Image sends skip the
    // undo window (attach + send is already two taps; adding a
    // third feels wrong).
    if (img.attached) {
      const filename = img.attached.file.name;
      const result = await img.readAsBase64();
      if (result) {
        // AI SDK v6 UIMessage shape — FileUIPart with `mediaType` +
        // data-URL. The v4/v5 `{ type: "image", image, mimeType }`
        // shape is silently dropped by convertToModelMessages in v6,
        // which was breaking every image send (#SHIP 2026-04-24).
        // AI SDK v6 UIMessage parts shape — text + file. `any[]` was
        // here because the SDK's discriminated union was being narrowed
        // wrong before push; the precise type is union'd via
        // SendMessageParts so we can drop the any.
        type SendMessagePart =
          | { type: "text"; text: string }
          | {
              type: "file";
              mediaType: string;
              url: string;
              filename: string;
            };
        const parts: SendMessagePart[] = [];
        if (text) parts.push({ type: "text", text });
        parts.push({
          type: "file",
          mediaType: result.mimeType,
          url: `data:${result.mimeType};base64,${result.base64}`,
          filename,
        });
        sendMessage({ parts });
        // v10.0.186 · feedback for image sends. Pre-fix the operator
        // got NO confirmation that an image-bearing send actually
        // dispatched (text sends had the undo-send toast for that).
        // Audit flagged "send wrong image → no recovery path." A
        // brief sonner toast acknowledges receipt without blocking
        // the next interaction.
        toast.success(`Sent ${filename}`, { duration: 1800 });
      } else {
        // v10.0.186 · pre-fix the FileReader-failed path silently
        // dropped the attachment with no operator feedback. Now
        // surface it so the operator knows to retry.
        toast.error(`Couldn't read ${filename}. Try again?`, { duration: 3000 });
      }
      img.clear();
      if (inputRef.current) inputRef.current.style.height = "auto";
      return;
    }

    // Text-only path — enable undo-send
    setUndoPayload(text);
    setUndoVisible(true);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      sendOrQueue(text);
      setUndoVisible(false);
      setUndoPayload(null);
      undoTimerRef.current = null;
    }, 2000);
    if (inputRef.current) inputRef.current.style.height = "auto";
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // v11.1 · input is no longer disabled during stream — but Enter
      // still shouldn't fire send while Nick is mid-reply (would stack
      // the queue). Let Nour TYPE the next turn; only SEND when the
      // current stream is done.
      if (isStreaming) return;
      send();
      return;
    }
    // ↑ arrow on empty input → recall the last user message (shell-style).
    // Only triggers when the textarea is empty so it doesn't hijack
    // normal cursor navigation inside a multi-line draft.
    if (e.key === "ArrowUp" && !input.trim()) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const text =
        lastUser?.parts
          ?.filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
          .map((p) => p.text)
          .join(" ") || "";
      if (text) {
        e.preventDefault();
        setInput(text);
        // Move cursor to end after React updates the value.
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = text.length;
            inputRef.current.selectionEnd = text.length;
          }
        });
      }
    }
  }

  function sendSuggestion(text: string) {
    sendOrQueue(text);
  }

  /**
   * Central send wrapper — checks offline status before calling
   * useChat's sendMessage. If navigator.onLine === false, the
   * message goes into the offline queue and will be replayed when
   * connectivity returns. All direct sendMessage call sites inside
   * this page should go through this helper.
   */
  function sendOrQueue(text: string) {
    if (!offline.isOnline) {
      offline.enqueue(text);
      return;
    }
    sendMessage({ text });
  }

  // v10.0.529.106 · Wave 83 · MessageActionSheet's 7 callback bodies
  // (~170 LOC of inline async fetch + haptic + log handling) lifted
  // into useChatMessageActions. Page just wires the action-sheet mount.
  const messageActions = useChatMessageActions({
    actionSheetMsg,
    pins,
    messages,
    setMessages,
    setEditingMsgId,
    setEditValue,
    setError,
    setReasoningTraceMsg,
  });

  // v10.0.529.106 · Wave 83 · NickMessage callback bag (onCopy /
  // onCreateTask / onSaveToBrain / onPinToMemory · ~80 LOC of inline
  // async fetch in the messages.map) lifted into useNickMessageActions.
  // postFeedback (per-message body) stays a free function call below.
  const nickMessageActions = useNickMessageActions({ setError });

  return (
    <div
      className={cn(
        // May 02 · ticker-overlap fix · was `fixed inset-0` which made
        // the chat container start at viewport y=0, putting its first
        // 21px under the GlobalTopTicker (sticky top-0 z-55) and its
        // last 21px under the BottomPulseTicker (fixed bottom-0 z-60).
        // The top/bottom offsets reserve the ticker zones AND the iPhone
        // safe-area insets (status bar + home indicator) via env() so
        // the chat content never slides under either chrome on mobile.
        // The 21px is each ticker's h-5 + 1px border.
        "fixed inset-x-0 z-10",
        "flex flex-col bg-[var(--bg-void)]",
        "state-aura",
        `state-aura-${s.currentState}`,
        // Apr 27 · MOBILE — block pull-to-refresh at the page root
        // so even if the inner scroll container yields, the gesture
        // doesn't reach the document scroller.
        "overscroll-none",
      )}
      style={{
        // May 02 · top/bottom reserve ticker height + iPhone safe-area
        // insets so the chat sits BETWEEN the GlobalTopTicker and the
        // BottomPulseTicker without sliding under either chrome on
        // notched devices. Pre-fix: had an inner paddingTop:env(...)
        // to push past the notch; now that the container itself starts
        // below the safe-area zone, that inner padding is redundant.
        //
        // v10.0.529.95 · Wave 39 · H3 · bottom was 21px (sm:h-5 desktop
        // ticker). On mobile the ticker is min-h-[32px] · 11px short ·
        // composer's send button overlapped the ticker. Switched to a
        // CSS env hop · 32px mobile · 21px sm: and up via media query
        // inline · not possible · so we just use the larger value
        // (32px) · costs desktop 11px of vertical space · acceptable
        // trade for mobile usability.
        top: "calc(21px + env(safe-area-inset-top, 0px))",
        bottom: "calc(32px + env(safe-area-inset-bottom, 0px))",
        overscrollBehavior: "none",
      }}
    >
      {/* ─── Pinned Messages ──────────────────────────────
          v10.0.529.106 · Wave 83 · self-contained presentation
          strip moved into PinnedMessagesBar. */}
      <PinnedMessagesBar pinned={pins.pinned} onUnpin={pins.unpin} />

      {/* ─── Nick Header v2 — Apr 19 Tesla-minimum ─── */}
      {/* NICK · live-dot · overflow menu. Revenue + drift numbers
          retired from this header — they belong on the HQ ticker.
          Persona / mode / TTS / wake word / inspect prompt all
          hidden inside the ⋯ menu. */}
      <NickHeaderV2
        isStreaming={isStreaming}
        hasError={!!error}
        ttsEnabled={tts.enabled}
        onToggleTTS={tts.toggle}
        wakeWordActive={wakeWord.active}
        onToggleWakeWord={() => (wakeWord.active ? wakeWord.stop() : wakeWord.start())}
        ambientActive={ambient.ambient}
        onToggleAmbient={ambient.toggle}
        showSpeedRibbon={showSpeedRibbon}
        onToggleSpeedRibbon={() => setShowSpeedRibbon(!showSpeedRibbon)}
        providerOverride={overrides.provider}
        onCycleProvider={() =>
          setOverrides((o) => {
            const chain = ["auto", "ollama", "venice", "openai", "anthropic"] as const;
            const idx = chain.indexOf(o.provider as typeof chain[number]);
            return { ...o, provider: chain[(idx + 1) % chain.length] };
          })
        }
        onNewChat={newChat}
        onToggleHistory={() => setShowHistory(!showHistory)}
        historyOpen={showHistory}
        messageCount={messages.length}
        sessionStartTime={sessionStartRef.current}
        onInspectPrompt={() => setInspectorOpen(true)}
        conversationId={activeId}
        personality={personality}
        onPersonalityChange={(p) => {
          // Manual override persists 30min via localStorage. Clients
          // are read by lib/ai/intent-classifier.ts on next turn —
          // server infers persona from the turn text when no override
          // is in flight.
          setPersonality(p);
          writePersonaOverride(p);
          try { localStorage.setItem("nour:nick-personality", p); } catch {}
        }}
        veniceHealthy={veniceHealthy}
      />

      {/* ─── Context Rail removed 2026-05-09 — operator: crowding screen ─── */}

      {/* ─── Deeper Context badge — shows when the last reply pulled
           cross-source semantic matches. Hidden by default, appears
           inline under the context rail so Nour can see real-time
           visibility into what the multi-source vector index is doing. */}
      {!isEmpty && deeperContext && deeperContext.count > 0 && (
        <div className="px-3 pt-1.5 shrink-0">
          <DeeperContextBadge
            count={deeperContext.count}
            types={deeperContext.types}
          />
        </div>
      )}

      {/* v7.6 · C13 · Apr 29 · Conversation pulse strip — alive
          telemetry from the active conversation. Sparkline + cost
          counter + provider badge. Silent when there's no telemetry
          (legacy convs without Batch A data). */}
      {!isEmpty && (
        // v10.0.529.54 · cut AiPulse Spline mesh · audit flagged as
        // pure vanity (data props default-on · not wired to real
        // provider/latency · burns a WebGL context on every chat open).
        // ConversationPulse keeps the cost/latency sparkline · the
        // actual operator-leverage signal.
        <div className="px-3 pt-1.5 shrink-0">
          <ConversationPulse
            messages={messages.map((m) => {
              const meta = getMessageMeta(m);
              return {
                role: m.role,
                latencyMs: typeof meta.latencyMs === "number" ? meta.latencyMs : null,
                costCents: typeof meta.costCents === "number" ? meta.costCents : null,
                provider: typeof meta.provider === "string" ? meta.provider : null,
                routerReason: typeof meta.routerReason === "string" ? meta.routerReason : null,
                promptTokens: typeof meta.promptTokens === "number" ? meta.promptTokens : null,
                completionTokens: typeof meta.completionTokens === "number" ? meta.completionTokens : null,
              };
            })}
          />
        </div>
      )}

      {/* ─── History Drawer ────────────────────────────────
          Apr 27 · MOBILE-FLUIDITY — was an inline dropdown that
          shoved messages out of view on small screens. Now renders
          as a slide-down sheet with backdrop on mobile (full-width
          modal feel), keeps the inline dropdown look on desktop via
          sm: breakpoints. The backdrop catches outside-taps so the
          sheet closes the same way Nour expects from native apps.

          v10.0.529.19 · ~170 LOC inline JSX (renderConvo helper +
          date-group walk + rename input + pagination footer) lifted
          into <ConversationDrawer/>. Parent still owns the convo
          data + cross-surface state; drawer owns its inline rename
          input via useChatRename. Visual contract identical. */}
      {showHistory && (
        <ConversationDrawer
          convos={convos}
          activeId={activeId}
          pinnedConvoIds={pinnedConvoIds}
          hasMoreConvos={hasMoreConvos}
          loadingMore={loadingMore}
          onLoadMore={loadMoreConvos}
          onSelectConvo={loadConvo}
          onDeleteConvo={deleteConvo}
          onRename={renameConvo}
          onTogglePin={toggleConvoPin}
          onNewChat={() => { newChat(); setShowHistory(false); }}
          onToggleStar={(id) => patchConvoFlag(id, "starred", !convos.find((c) => c.id === id)?.starredAt)}
          onToggleArchive={(id) => patchConvoFlag(id, "archived", true)}
          onToggleMute={(id) => patchConvoFlag(id, "muted", !convos.find((c) => c.id === id)?.mutedAt)}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* ─── Messages ─────────────────────────────────────
          v11.1 Tier-1 · useStickToBottom wraps the overflow-y-auto
          container + inner content-ref div. Scroll auto-follows the
          stream; releases on user scroll-up; "↓ new reply" chip jumps
          back. `relative` on the outer lets the chip anchor to its
          bottom-right corner without touching the main layout. */}
      {/* Apr 27 · MOBILE — overscroll-none + touch-action disable
          mobile pull-to-refresh. Nour was triggering page reloads
          while swiping up to re-read messages. `overscroll-contain`
          stops the rubber-band from chaining to body; the inline
          touch-action style narrows it further so the gesture is
          treated as a vertical scroll, not a navigation hint. */}
      <div
        ref={stb.scrollRef}
        /* v10.0.526 · a11y A5 + A8 fix · WAI-ARIA log pattern for
           chat-style additive scrollers. Screen readers get a
           landmark to jump to + streaming reply contents announce
           via aria-live="polite" + aria-relevant="additions text". */
        role="log"
        aria-label="Conversation with Nick"
        aria-live="polite"
        aria-relevant="additions text"
        // v10.0.529.96 · Wave 40 · conditional flex-1.
        // When empty: scroll-area sizes to ChatEmptyState content (small
        // orb + greeting) so the composer rises into the upper-middle
        // band right below the greeting. When messages exist: flex-1
        // restores full-height scrolling with composer pinned at bottom.
        // Operator wanted ChatGPT-style empty-state composer placement.
        className={cn(
          "overflow-y-auto relative overscroll-contain",
          isEmpty ? "shrink-0" : "flex-1",
        )}
        style={{ touchAction: "pan-y", overscrollBehaviorY: "contain" }}
      >
        <div ref={stb.contentRef}>
        {isEmpty ? (
          /* Apr 19 · Chat empty state v2 — Nick leads with 3 SPECIFIC
              observations pulled from live state (contradictions,
              overdue commits, ghost prediction, weak axis, skill
              candidates, momentum). No generic "ask me anything".
              No mode/persona labels. Tap an opener → ask fills input.
              See components/chat/chat-empty-state.tsx */
          <ChatEmptyState
            onPick={(ask) => {
              setInput(ask);
              inputRef.current?.focus();
            }}
          />
        ) : (
          // Apr 27 · MOBILE-FLUIDITY — outer padding tuned for thumb
          // reach. Generous bottom space so the last message clears
          // the sticky input row + safe-area without being hugged.
          // mx-auto + max-w-3xl centers the column on desktop so
          // messages don't stretch impotent across a wide viewport.
          <div className="mx-auto w-full max-w-3xl px-3 sm:px-4 pt-3 pb-6 sm:pb-3 space-y-3">
            {/* Dedupe messages by id before rendering. AI SDK v6 can
                occasionally push the same message twice during stream
                reconnects or HMR — React then throws duplicate-key
                warnings and the UI goes spotty. We defensively dedupe
                here so React never sees the collision regardless of
                what's in the underlying store. */}

            {/* v8.16 B3 · Lazy-render banner. Only renders when the
                conversation crosses the 80-message threshold AND we're
                hiding older history. Click reveals the rest for the
                session. */}
            {hasHidden && (
              <button
                type="button"
                onClick={showOlder}
                className="mx-auto block w-full max-w-md rounded-full border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-[var(--gold)]/80 hover:border-[var(--gold)]/50 hover:bg-[var(--gold)]/[0.08] hover:text-[var(--gold)] transition-colors"
                title="Reveal older messages — kept hidden by default to keep the page snappy"
              >
                ↑ show {hiddenCount} older message{hiddenCount === 1 ? "" : "s"}
              </button>
            )}

            {dedupedRendered.map((msg, idx, arr) => {
              // v10.0.529.20 · compute `isLastMessage` against the
              // raw useChat `messages` array (semantics IDENTICAL to
              // the pre-extraction IIFE that used the same check)
              // so the MessageFooter receives a stable boolean rather
              // than re-running the lookup behind the memo boundary.
              const isLastMessage = messages[messages.length - 1]?.id === msg.id;
              const isLatestAssistant = msg.role === "assistant" && idx === arr.length - 1;
              const isLatestAssistantStreaming = isLatestAssistant && isStreaming;
              // Show timestamp on first message, role changes, and every 5th message
              const prevMsg = idx > 0 ? arr[idx - 1] : null;
              const showTimestamp = idx === 0 || msg.role !== prevMsg?.role || idx % 5 === 0;
              // Relative time label
              // UIMessage doesn't have createdAt — use the timing ref
              // or fall back to null (timestamp only shows for timed messages)
              const msgTiming = msg.id ? timingRef.current.get(msg.id) : undefined;
              const msgTime = msgTiming?.sentAt ? new Date(msgTiming.sentAt) : null;
              const timeLabel = msgTime
                ? (() => {
                    const diff = Date.now() - msgTime.getTime();
                    if (diff < 60_000) return "now";
                    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
                    if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h`;
                    return msgTime.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  })()
                : null;
              return (
                <div key={msg.id} className={cn(
                  "flex group",
                  msg.role === "user" ? "justify-end" : "justify-start",
                  // Extra spacing between conversation turns for visual breathing
                  prevMsg && prevMsg.role !== msg.role && "mt-3"
                )}
                  style={{ animation: "fadeSlideUp 0.2s ease-out" }}>
                  {/* Apr 27 · MOBILE-FLUIDITY — bumped to 90% width on
                      mobile so messages aren't squeezed into a narrow
                      column, and bumped text size to 14.5px so it's
                      thumb-readable without zoom. Desktop keeps the
                      tighter 13.5px. */}
                  <div className={cn(
                    "max-w-[92%] sm:max-w-[88%] text-[14.5px] sm:text-[13.5px] leading-[1.55] sm:leading-[1.6] relative",
                    msg.role === "user"
                      ? "rounded-2xl rounded-br-md px-3.5 py-2.5 sm:py-2 bg-[var(--gold-ghost)] border border-[var(--gold)]/10 text-[var(--text-primary)]"
                      : "pl-1 border-l-2 border-[var(--gold)]/10 text-[var(--text-secondary)]",
                    isLatestAssistantStreaming && "nick-bubble-latest"
                  )}>
                    {/* Timestamp — shown on role changes and periodically */}
                    {showTimestamp && timeLabel && (
                      <div className={cn(
                        "text-[10px] font-mono uppercase tracking-wider mb-0.5",
                        msg.role === "user" ? "text-[var(--gold)]/40 text-right" : "text-[var(--text-tertiary)]/50"
                      )}>
                        {msg.role === "assistant" && <span className="text-[var(--gold)]/30 mr-1">Nick</span>}
                        {timeLabel}
                      </div>
                    )}

                    {/* Hover actions strip · v10.0.529.106 · Wave 83 ·
                        ~55 LOC of icon buttons lifted into
                        MessageHoverActions. */}
                    {msg.role === "assistant" && !isLatestAssistantStreaming && (
                      <MessageHoverActions
                        isPinned={pins.isPinned(msg.id)}
                        canRegenerate={idx === messages.length - 1}
                        onCopy={() => copyMessage(msg)}
                        onSendToSocial={() => {
                          const text = extractMessageText(msg);
                          if (!text) return;
                          const url = `/social?caption=${encodeURIComponent(text.slice(0, 2200))}`;
                          window.open(url, "_blank", "noopener");
                        }}
                        onRegenerate={() => regenerate()}
                        onTogglePin={() => {
                          const text = msg.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(" ") || "";
                          pins.toggle(msg.id, text);
                        }}
                      />
                    )}
                    {msg.parts?.map((part, i) => {
                      if (part.type === "text" && part.text.trim()) {
                        // Apr 19 · Extract contextBlocks from the
                        // message's tokenUsage blob (persisted) or the
                        // live stream header (cached in a ref).
                        const blocks = extractContextBlocks(msg, liveContextBlocksRef.current);
                        return msg.role === "assistant" ? (
                          <AssistantMessageShell
                            key={i}
                            text={part.text}
                            messageId={msg.id}
                            contextBlocks={blocks}
                            quality={extractQuality(msg)}
                            citations={extractCitations(msg)}
                            onRegen={() => regenerate()}
                            onLongPress={() =>
                              setActionSheetMsg({
                                id: msg.id,
                                role: "assistant",
                                text: part.text,
                              })
                            }
                          >
                          <NickMessage
                            text={part.text}
                            onQuickAction={(t) => { setInput(""); sendOrQueue(t); }}
                            streaming={isLatestAssistantStreaming}
                            showTiming={showSpeedRibbon}
                            timing={msg.id ? timingRef.current.get(msg.id) : undefined}
                            model={extractModel(msg)}
                            messageId={msg.id}
                            conversationId={activeId ?? undefined}
                            onFork={msg.id && activeId ? () => handleFork(msg.id!) : undefined}
                            onCopy={nickMessageActions.onCopy}
                            onCreateTask={nickMessageActions.onCreateTask}
                            onSaveToBrain={nickMessageActions.onSaveToBrain}
                            onPinToMemory={nickMessageActions.onPinToMemory}
                            onFeedback={(positive) =>
                              postFeedback({
                                messageId: msg.id,
                                positive,
                                snippet: part.text,
                                conversationId: activeId,
                              })
                            }
                          />
                          </AssistantMessageShell>
                        ) : editingMsgId === msg.id ? (
                          // v10.0.529.106 · Wave 83 · ~62 LOC of inline
                          // textarea + Resend/Cancel JSX lifted into
                          // MessageEditTextarea · the truncate-then-
                          // resend orchestration stays on the parent
                          // because it needs the messages array. Same
                          // queueMicrotask semantics as before.
                          <MessageEditTextarea
                            key={i}
                            value={editValue}
                            onChange={setEditValue}
                            onResend={() => {
                              if (!editValue.trim()) return;
                              const idx2 = messages.findIndex((m) => m.id === msg.id);
                              if (idx2 >= 0) {
                                setMessages(messages.slice(0, idx2));
                                queueMicrotask(() => sendOrQueue(editValue.trim()));
                              }
                              clearEditDraft();
                              setEditingMsgId(null);
                            }}
                            onCancel={() => {
                              clearEditDraft();
                              setEditingMsgId(null);
                            }}
                          />
                        ) : (
                          <UserMessageBubble
                            key={i}
                            text={part.text}
                            onClick={() => {
                              if (msg.role === "user") {
                                setEditingMsgId(msg.id);
                                setEditValue(part.text || "");
                              }
                            }}
                            onLongPress={() =>
                              setActionSheetMsg({
                                id: msg.id,
                                role: msg.role as "user" | "assistant",
                                text: part.text,
                              })
                            }
                          />
                        );
                      }
                      // File parts — images attached by the user, or
                      // files the assistant returned (rare). Renders a
                      // thumbnail that opens full-size in a new tab.
                      // Shape: { type: "file", mediaType, url, filename? }
                      // v10.0.529.106 · Wave 83 · ~110 LOC of file/
                      // reasoning/tool part renderers lifted into
                      // components/chat/message-part-renderers.tsx.
                      // Each branch is now an independent named
                      // function · easier to unit-test · ToolResultCard
                      // dynamic-import preserved.
                      if (part.type === "file") {
                        return <FilePartRenderer key={i} part={part as Parameters<typeof FilePartRenderer>[0]["part"]} role={msg.role} />;
                      }
                      if (part.type === "reasoning") {
                        return <ReasoningPartRenderer key={i} part={part as Parameters<typeof ReasoningPartRenderer>[0]["part"]} />;
                      }
                      if (part.type.startsWith("tool-")) {
                        return <ToolPartRenderer key={i} part={part as Parameters<typeof ToolPartRenderer>[0]["part"]} />;
                      }
                      return null;
                    })}

                    {/* v7.6 · C6 · Apr 29 · Streaming-state badge +
                        per-message info card (C7). Both surface Batch A
                        columns. Status badge silent when complete; info
                        card always present on assistant turns (icon-
                        only, expands on tap).
                        v10.0.529.20 · extracted from a ~140-line inline
                        IIFE into MessageFooter so finished messages bail
                        out via React.memo shallow equality on every
                        streamed token. All callbacks below are stable
                        useCallback refs hoisted to the parent. */}
                    <MessageFooter
                      msg={msg}
                      editing={editingAssistantId === msg.id}
                      isLastMessage={isLastMessage}
                      lastTraceId={lastTraceId}
                      onStartEdit={handleFooterStartEdit}
                      onCancelEdit={handleFooterCancelEdit}
                      onMessageSaved={handleFooterMessageSaved}
                      onMessageReverted={handleFooterMessageReverted}
                      onSwapBranch={handleFooterSwapBranch}
                    />
                  </div>
                </div>
              );
            })}

            {/* Smart replies — 3 tap-to-send follow-up chips under the
                latest assistant message. Fires /api/ai/chat/suggestions
                keyed by message id; server caches 60s. Hidden while
                streaming so they don't flicker mid-token.
                v10.0.529.106 · Wave 83 · ~53 LOC of IIFE + walker
                lifted into SmartRepliesCluster. */}
            <SmartRepliesCluster
              messages={dedupedAll}
              isStreaming={isStreaming}
              activeConversationId={activeId}
              inputIsEmpty={!input.trim()}
              onPick={(s) => {
                haptic.tap();
                setInput("");
                sendOrQueue(s);
              }}
            />

            {/* Streaming indicator — "Nick is thinking..." with tool awareness */}
            {isStreaming && (
              <NickStreaming
                lastMessage={messages[messages.length - 1] as { role: string; parts?: Array<{ type: string; state?: string }> } | undefined}
                stallStatus={stallStatus}
              />
            )}

            {/* v6 · Apr 28 — Auto-fire plan toast.
                Replaces the silent "now generate the picture" injection.
                Shows plan card + Go/Edit/Cancel + 2.5s countdown. */}
            {pendingAutoFire && !isStreaming && (
              <div className="my-2">
                <AutoFirePlanToast
                  plan={pendingAutoFire.plan}
                  onProceed={handleAutoFireProceed}
                  onCancel={handleAutoFireCancel}
                />
              </div>
            )}

            {/* v10.0.484 · ProactiveInsightCard mount removed per
                operator. The card auto-injected a "Nick noticed"
                nudge between turns and operator wanted it gone from
                /chat (intrusive after every reply). Component file
                preserved at components/chat/proactive-insight-card.tsx
                in case it gets re-mounted on a different surface
                (Ultron HQ · /brain · etc) later — nothing renders it
                today. */}
          </div>
        )}

        {/* v10.0.529.106 · Wave 83 · ~55 LOC of conditional retry +
            error + diagnostic JSX lifted into ErrorDiagnosticPanel.
            Two visual states (retrying pill · exhausted error card +
            diagnostic report) bundled into one branchless mount. */}
        <ErrorDiagnosticPanel
          error={error}
          retrying={silentRetry.retrying}
          retryAttempt={silentRetry.attemptCount}
          retryMax={silentRetry.maxAttempts ?? 1}
          exhausted={silentRetry.exhausted}
          diagnosing={diagnosing}
          diagnosticReport={diagnosticReport}
          onRetry={() => {
            setError(null);
            clearDiagnosticReport();
            regenerate();
          }}
          onDiagnose={runDiagnostic}
          onDismiss={() => {
            setError(null);
            clearDiagnosticReport();
          }}
          onCloseReport={clearDiagnosticReport}
        />
        </div>
        {/* v11.1 Tier-1 · "↓ new reply" chip. Appears when Nour is
            scrolled up (isAtBottom=false) AND a stream is live. Tap
            to jump back to the bottom. Zero-cost when at bottom — the
            whole chip unmounts. Fade-in via stagger-in class. */}
        {!stb.isAtBottom && isStreaming && (
          <button
            type="button"
            onClick={() => { haptic.tap(); void stb.scrollToBottom(); }}
            className={cn(
              "absolute right-4 bottom-4 z-10 flex items-center gap-1.5",
              "rounded-full px-3 py-1.5 text-[11px] font-medium",
              "bg-[var(--gold)] text-black shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
              "animate-fade-in-scale",
            )}
            aria-label="Jump to latest"
          >
            <ArrowDown size={12} />
            <span>new reply</span>
          </button>
        )}
      </div>

      {/* Processing bar */}
      {isStreaming && <div className="processing-bar" />}

      {/* ─── Input Area ────────────────────────────────────
          Apr 27 · COMPOSER — outer band centers everything in a max
          width on desktop so the row doesn't stretch impotent across
          a 1500px viewport. Mobile stays full-width. The inner input
          row (further down) gets a real composer chrome so the
          buttons read as one unit, not scattered icons. */}
      <div
        className="shrink-0 border-t border-[var(--border-default)] bg-[var(--bg-void)]"
      >
      <div className="mx-auto w-full max-w-3xl">

        {/* Apr 19 · Unified slash command palette — handles prompts,
            navigation, and client-side actions in one menu.
            - prompt ending in ": " → fill input (Nour finishes typing)
            - prompt (other) → fire as message
            - navigate → router-push, zero stream
            - action → client-side handler (new-chat / history /
              pin-last / clear-chat / diagnose) */}
        {/* v10.0.529.106 · Wave 83 · ~85 LOC dropdown row + onClick
            switch lifted into SlashCommandDropdown · the navigate /
            action / prompt-fill / prompt-fire branches are now
            callback props so the dropdown stays pure presentation. */}
        {slash.show && (
          <SlashCommandDropdown
            filtered={slash.filtered}
            onNavigate={(path) => {
              router.push(path);
              setInput("");
              slash.close();
            }}
            onAction={(action) => {
              setInput("");
              slash.close();
              switch (action) {
                case "new-chat":
                  newChat();
                  break;
                case "history":
                  setShowHistory((v) => !v);
                  break;
                case "pin-last": {
                  const last = [...messages].reverse().find((m) => m.role === "assistant");
                  if (last) {
                    // Pull the first text part — same logic as
                    // extractText on the server. Keep narrow
                    // type to avoid any-leak into the lint pass.
                    const textPart = last.parts?.find(
                      (p): p is { type: "text"; text: string } =>
                        !!p && (p as { type?: string }).type === "text",
                    );
                    const text = textPart?.text ?? "";
                    if (text) pins.pin(last.id, text);
                  }
                  break;
                }
                case "clear-chat":
                  newChat();
                  break;
                case "diagnose":
                  // v8.15 BATCH A · runDiagnostic owns fetch + state.
                  // Setting error to "Manual diagnostic run" forces the
                  // ErrorCard panel open so Nour sees the report.
                  void runDiagnostic();
                  setError("Manual diagnostic run");
                  break;
              }
            }}
            onPromptFill={(prompt) => {
              setInput(prompt);
              slash.close();
              inputRef.current?.focus();
            }}
            onPromptFire={(prompt) => {
              setInput("");
              sendSuggestion(prompt);
              inputRef.current?.focus();
            }}
            onClose={() => slash.close()}
          />
        )}

        {/* @mention context injection dropdown
            v10.0.529.106 · Wave 83 · ~45 LOC of presentation JSX
            lifted into MentionDropdown · the caret-aware token rewrite
            stays on the parent because it needs textarea ref access. */}
        {mentions.show && !slash.show && (
          <MentionDropdown
            filtered={mentions.filtered}
            onPick={(m) => {
              // Replace the partial @token the user typed with the full label.
              // This only rewrites the token itself — expansion to live data
              // happens later inside send() via mentions.expandMentions().
              const val = input;
              const upToCaret = val.slice(0, inputRef.current?.selectionStart ?? val.length);
              const afterCaret = val.slice(inputRef.current?.selectionStart ?? val.length);
              const replaced = upToCaret.replace(/@\w*$/, `${m.label} `);
              const next = replaced + afterCaret;
              setInput(next);
              mentions.close();
              requestAnimationFrame(() => {
                if (inputRef.current) {
                  const pos = replaced.length;
                  inputRef.current.selectionStart = pos;
                  inputRef.current.selectionEnd = pos;
                  inputRef.current.focus();
                }
              });
            }}
          />
        )}

        {/* Attached file/image preview — shows thumbnail for images,
            a paperclip chip for anything else (PDFs, text, docs).
            v10.0.529.106 · Wave 83 · lifted into AttachmentPreview. */}
        {img.attached && (
          <AttachmentPreview
            file={img.attached.file}
            preview={img.attached.preview}
            onClear={img.clear}
          />
        )}

        {/* Apr 19 · HotQuestionsBar retired — Nick-leads openers now
            live inside ChatEmptyState instead of as a pill row above
            the input. See components/chat/chat-empty-state.tsx. */}

        {/* v11.1 B4-lite · Tighter stall banner. Fires at 6s instead
            of 15s so Nour sees "reconnecting" feedback fast. Auto-
            aborts + retries with OpenAI at 22s (down from 30s).
            v10.0.529.106 · Wave 83 · lifted into StallBanner. */}
        {stallStatus === "warn" && isStreaming && (
          <StallBanner onRetry={triggerStallHandler} />
        )}

        {/* Apr 19 · Persona tabs retired. Nick now infers persona
            per-turn from tone + intent via lib/ai/intent-classifier.ts
            (quiet background classifier). Manual override still
            available in the ⋯ overflow menu for edge cases. */}
        {/* Apr 19 · Starter prompt pills retired. Nick-leads openers
            now live inside ChatEmptyState instead (3 specific pulls
            from live state · see components/chat/chat-empty-state.tsx). */}

        {/* Apr 19 · Unified slash palette moved into the existing
            slash.show dropdown above (hooks/use-slash-commands.ts
            SLASH_COMMANDS now includes navigation + action entries). */}

        {/* v10.0.529.xx · WisdomPill mount removed from /chat composer.
            Audit Wave 8 flagged 2 above-composer suggestion surfaces
            (WisdomPill at write-time + PromptSuggestionsBar live
            prompts). PromptSuggestionsBar wins: tap-to-pick is more
            iPhone-native than the WisdomPill's prefix-insert-as-margin-
            note pattern, and the autocomplete endpoint feeding it is
            heuristic-matched per keystroke (zero-quality-bar surface).
            WisdomPill stays mounted in components/brain-dump-modal.tsx
            where its "considering: …" prefix pattern was originally
            shipped. */}

        {/* v7.4 · Apr 29 · Live prompt suggestions. Renders only when
            the user is actively typing (≥2 chars, single line) and the
            autocomplete endpoint matched a heuristic. Tap a chip to
            replace the draft; X collapses the bar for this draft.
            Replaces the retired empty-state opener cards as the
            "what could I ask?" surface. */}
        <PromptSuggestionsBar
          suggestions={promptSuggestions.suggestions}
          loading={promptSuggestions.loading}
          onPick={(s) => {
            setInput(s);
            inputRef.current?.focus();
            // Move cursor to end so user can keep typing after the
            // accepted suggestion without manually clicking.
            requestAnimationFrame(() => {
              const el = inputRef.current;
              if (el) el.setSelectionRange(s.length, s.length);
            });
          }}
          onCollapse={promptSuggestions.collapse}
        />

        {/* v10.0.141 · idle-suggestion render REMOVED per user request.
            Was a "you've been idle 3s, here's a chat opener" card that
            kept resurfacing the same chronic insights ("risk appetite
            at 34/100"). Nour: "Remove the chat card I previously
            requested to be removed." The useIdleSuggestion hook is
            kept for now in case the empty-state pattern wants to
            reuse it later, but the chat-input render is dead. */}

        {/* v10.0.529.85 · Wave 29 · Nick's proactive suggestion strip.
            Reads /api/nick/suggest · aggregates weakest mastery axis ·
            stuck DOING · overdue · stalled goals · pattern clusters ·
            orphan-task nudges · contradictions into 3-5 ranked chips.
            Tap a chip → seeds the chat input with a pre-built prompt
            so the operator just hits send. Self-hides on clean morning. */}
        <NickSuggestions
          onSeed={(prompt, meta) => {
            setInput(prompt);
            // v10.0.529.86 · Wave 30 · stash the suggestion meta on
            // the transport body so the next send carries "operator
            // tapped suggestion X" context. Resolves "do that" /
            // "yes" / "go ahead" pronouns against the seeded
            // suggestion's kind + id. Cleared by the next non-seed
            // send (composer's natural onChange leaves these set ·
            // we'll clear after first send via a tiny effect below).
            if (meta) {
              transportBodyRef.current.lastSuggestionKind = meta.kind;
              transportBodyRef.current.lastSuggestionId = meta.id;

              // v10.0.529.90 · Wave 34 · CLOSE THE LOOP.
              // The suggestion IDs encode the underlying entity:
              //   broken-promise-<taskId> → set lastTaskId
              //   stalled-goal-<goalId>   → set lastGoalId
              //   stale-pin-<pinId>       → set lastPinId
              //   unresolved-reflection-<reflectionId> → set lastReflectionId
              // Pre-Wave-34 the system prompt got `lastSuggestionId="broken
              // -promise-abc123"` and Nick had to PARSE that string to find
              // the underlying taskId. Now we extract it client-side and
              // populate the proper `lastTaskId` field directly · "do it"
              // / "ok" / "send it" resolves to that exact entity without
              // ambiguity.
              if (meta.kind === "broken-promise") {
                const taskId = meta.id.replace(/^broken-promise-/, "");
                if (taskId && taskId !== meta.id) {
                  transportBodyRef.current.lastTaskId = taskId;
                }
              } else if (meta.kind === "stalled-goal") {
                const goalId = meta.id.replace(/^stalled-goal-/, "");
                if (goalId && goalId !== meta.id) {
                  transportBodyRef.current.lastGoalId = goalId;
                }
              } else if (meta.kind === "stale-pin") {
                const pinId = meta.id.replace(/^stale-pin-/, "");
                if (pinId && pinId !== meta.id) {
                  transportBodyRef.current.lastPinId = pinId;
                }
              } else if (meta.kind === "unresolved-reflection") {
                const reflectionId = meta.id.replace(/^unresolved-reflection-/, "");
                if (reflectionId && reflectionId !== meta.id) {
                  transportBodyRef.current.lastReflectionId = reflectionId;
                }
              }
              // weak-axis / pattern / orphan-nudge / contradictions /
              // overdue / stuck-task → no single entity to anchor to ·
              // lastSuggestionKind + Id are sufficient on their own.
            }
            // Best-effort focus the textarea so the operator can edit
            // before hitting send · matches the wisdom-pill pattern.
            setTimeout(() => inputRef.current?.focus(), 30);
          }}
        />

        {/* Input row — Apr 27 · COMPOSER chrome.
            Wraps the whole composer (mic / attach / textarea / mode /
            send) in a single rounded container with elevated bg, so
            the buttons read as one unit. Removes the loose-floating
            feel and gives the composer real "weight" on the page.
            Mobile keeps generous padding + safe-area inset; desktop
            tightens up for density. */}
        <div
          className="p-2 sm:p-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
        <div className="flex items-end gap-1.5 sm:gap-1 px-2 py-1.5 sm:py-1 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]/40 focus-within:border-[var(--gold)]/40 transition-colors">
          {/* v10.0.529.106 · Wave 83 · ~130 LOC of mic / paperclip /
              persona-chip / audio / phone / camera button JSX +
              hidden file inputs lifted into ComposerToolbar. Voice
              and image hooks stay on the parent · the toolbar
              receives intent callbacks. */}
          <ComposerToolbar
            voice={voice}
            isStreaming={isStreaming}
            audioTranscribing={audioTranscribing}
            personaMode={personaMode}
            onPersonaModeChange={setPersonaMode}
            longPressTimerRef={longPressTimerRef}
            onMicClick={() => {
              if (voice.continuous) { voice.stopContinuous(); return; }
              if (voice.isRecording) { voice.stopRecording(); return; }
              voice.startRecording();
            }}
            onContinuousStart={voice.startContinuous}
            onContinuousStop={voice.stopContinuous}
            fileInputRef={img.fileInputRef}
            cameraInputRef={img.cameraInputRef}
            audioInputRef={audioInputRef}
            onFileChange={img.handleFileChange}
            onAudioChange={handleAudioAttach}
            onOpenGallery={img.openGallery}
            onOpenCamera={img.openCamera}
            onOpenAudio={() => audioInputRef.current?.click()}
            onOpenVoiceMode={() => setVoiceMode(true)}
          />

          {/* Textarea (with voice waveform overlay during recording) */}
          <div className="flex-1 relative">
            {/* Apr 27 · MOBILE-FLUIDITY — voice waveform.
                When the mic is active, hide the textarea visually and
                show 5 bars that bounce to the live audioLevel. Gives
                Nour real "I see you hearing me" feedback. The textarea
                stays mounted so transcribed text streams in cleanly
                when recording stops. */}
            {(voice.isRecording || voice.continuous) && (
              <VoiceWaveformOverlay
                audioLevel={voice.audioLevel}
                mode={voice.continuous ? "continuous" : "recording"}
              />
            )}
            <textarea
              ref={inputRef}
              /* v10.0.526 · a11y A4 fix · the rotating adaptive
                 placeholder is not a stable accessible name. Screen
                 readers need a deterministic label. */
              aria-label="Message Nick"
              value={input}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);
                slash.onInputChange(val);
                mentions.onInputChange(val, e.target.selectionStart ?? val.length);
              }}
              onPaste={(e) => {
                // v10.0.515 · #2 Multimodal · paste-image support.
                // If clipboard has an image, attach it and stop the
                // text-paste path (otherwise the textarea swallows
                // a blank "image" string). Returns true on hit.
                const attached = img.attachFromPaste(e);
                if (attached) {
                  e.preventDefault();
                  toast.success("Image attached from clipboard", { duration: 1500 });
                }
              }}
              onKeyDown={handleKey}
              placeholder={adaptivePlaceholder}
              rows={1}
              /* Apr 27 · MOBILE-FLUIDITY:
                 · text-[16px] on mobile prevents iOS Safari from
                   auto-zooming on focus (the #1 cause of layout
                   jank on /chat). sm:text-[13.5px] keeps the
                   compact desktop look.
                 · min-h bumped to 44px on mobile so the textarea
                   reads as a real input not a strip.
                 · placeholder shows the tap-to-fix idle suggestion;
                   shrinks slightly on mobile so it fits one line. */
              className={cn(
                // Apr 27 · COMPOSER — textarea now sits inside the
                // shared composer chrome, so drop its own border + bg.
                // Transparent so the parent's elevated bg shows through;
                // the focus ring is on the parent's focus-within.
                //
                // v7.4 · Apr 29 · Mobile max-h cut 160 → 96px so the
                // composer can't eat the bottom half of the viewport
                // when a long placeholder or draft wraps. Desktop
                // unchanged.
                // v10.0.528 · a11y A2 fix · min-h was 40 / 32 (mobile /
                // desktop). Bumped mobile to 44 to match the 44pt Apple
                // HIG target the composer buttons now hit · bumped
                // desktop to 36 so the textarea visually anchors to the
                // taller Send chip (sm:h-9 = 36).
                "w-full text-[16px] sm:text-[13.5px] leading-[1.5] resize-none px-2 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[36px] max-h-[96px] sm:max-h-[160px]",
                "bg-transparent border-0 text-[var(--text-primary)]",
                "placeholder:text-[var(--text-tertiary)] outline-none",
              )}
              /* v11.1 Tier-1 · input stays live during stream. Nour can
                 type the NEXT turn while Nick finishes the current one.
                 Send fires only when Enter is pressed AND !isStreaming
                 (handleKey already gates on this). */
            />
          </div>

          {/* Mode pill — Apr 27 · COMPOSER-WEIGHT — fully hidden in
              the composer row (was already hidden on mobile, now
              hidden on desktop too). The STANDARD chip was tertiary
              info eating prime composer real estate. Mode detection
              runs server-side regardless; manual override lives in
              the ⋯ menu in the header when Nour wants it. */}

          {/* v11.1 Tier-1 · Send / Stop — kinetic button that morphs
              between send arrow and stop square.
              v10.0.529.106 · Wave 83 · ~50 LOC of inline button JSX
              lifted into ComposerSendButton. */}
          <ComposerSendButton
            isStreaming={isStreaming}
            empty={!input.trim()}
            onSend={send}
            onStop={stop}
          />
        </div>
        </div>

        {/* v10.0.529.xx · Center stop-bar removed. Audit Wave 8 flagged
            redundant stop affordances · send-button kinetically morphs
            into stop during streaming (above) which is the canonical
            surface · the secondary `stop` button here duplicated that ·
            its sibling `regen` button was UNREACHABLE because the JSX
            gate combined `isStreaming` with `canRegenerate` (which
            requires `!isStreaming`). Per-message regenerate already
            ships inside the user-message hover/long-press footer
            (line ~1985). */}
      </div>
      </div>

      {/* Apr 19 · NickBelowInput retired. History + prompts + noticed
          pulls moved into the overflow menu (⋯) in NickHeaderV2 + the
          Nick-leads empty state. Conversation resume + convo switcher
          live inside the history drawer triggered from the header. */}

      {/* v10.0.359 · Realtime voice overlay · speech-to-speech Nick.
          Mounted lazily by `voiceMode` state · null-renders when closed
          so no audio context / WebRTC instances live in the background.
          v10.0.529.96 · Wave 40 · operator anchors forwarded so spoken
          pronouns ("snooze that" / "grade this decision") resolve the
          same way as text. */}
      <RealtimeVoiceOverlay
        open={voiceMode}
        onClose={() => setVoiceMode(false)}
        operatorContext={{
          contextRoute: transportBodyRef.current.contextRoute,
          lastTaskId: transportBodyRef.current.lastTaskId,
          lastGoalId: transportBodyRef.current.lastGoalId,
          lastJournalEntryId: transportBodyRef.current.lastJournalEntryId,
          lastDecisionId: transportBodyRef.current.lastDecisionId,
          lastPinId: transportBodyRef.current.lastPinId,
          lastReflectionId: transportBodyRef.current.lastReflectionId,
          lastMissionId: transportBodyRef.current.lastMissionId,
        }}
      />

      {/* Apr 19 · Undo-send toast — 2s grace period after sending.
          Text-only sends schedule the dispatch through a timer so
          tapping undo within 2s cancels the send entirely. */}
      <UndoSendToast
        visible={undoVisible}
        onUndo={() => {
          if (undoTimerRef.current) {
            clearTimeout(undoTimerRef.current);
            undoTimerRef.current = null;
          }
          // Restore input so Nour can edit + resend
          if (undoPayload) setInput(undoPayload);
          setUndoVisible(false);
          setUndoPayload(null);
          timingRef.current.delete("__pending__");
          inputRef.current?.focus();
        }}
      />

      {/* Apr 19 · Message action sheet — long-press on any message
          opens this phone-first bottom drawer with copy/pin/edit/
          delete/save-as-belief actions. Replaces the old hover
          button cluster on each message.
          v10.0.529.106 · Wave 83 · the 7 callback bodies (~170 LOC of
          inline async fetch + haptic + log handling) lifted into
          useChatMessageActions. */}
      <MessageActionSheet
        open={!!actionSheetMsg}
        onClose={() => setActionSheetMsg(null)}
        role={actionSheetMsg?.role ?? "user"}
        text={actionSheetMsg?.text ?? ""}
        isPinned={actionSheetMsg ? pins.isPinned(actionSheetMsg.id) : false}
        onCopy={messageActions.onCopy}
        onPin={messageActions.onPin}
        onEdit={messageActions.onEdit}
        onDelete={messageActions.onDelete}
        onSaveAsBelief={messageActions.onSaveAsBelief}
        onSaveAsDecision={messageActions.onSaveAsDecision}
        onShowReasoning={messageActions.onShowReasoning}
      />

      {/* v10.0.360 · BDI reasoning trace modal · "show reasoning"
          on any assistant message opens the cognitive chain (belief /
          desire / intention / observation grouping). */}
      <ReasoningTraceModal
        open={reasoningTraceMsg !== null}
        messageId={reasoningTraceMsg}
        onClose={() => setReasoningTraceMsg(null)}
      />

      {/* ─── System Prompt Inspector (Cmd+I) ─── */}
      <PromptInspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} />

      {/* ─── Tool Call Log Panel (Cmd+Shift+L) ─── */}
      <ToolCallLogPanel
        open={toolLogOpen}
        onClose={() => setToolLogOpen(false)}
        messages={messages}
      />

      {/* ─── v10.0.338 · Glitch capture button · cross-cutting prevention
          tool E from docs/glitch-taxonomy.md. Floating top-right under
          the chat header so the operator can flag a glitch without
          leaving /chat. Each tap captures the recent transcript +
          category + note → brainMemory category=glitch_capture. Feeds
          weekly digest + becomes a regression test seed. */}
      {/* v10.0.529.55 · GlitchCaptureButton floating top-right · CUT.
          Audit (Wave 8) flagged HIGH confidence · always-visible chrome
          over the primary chat surface on every session including mobile ·
          the weekly-digest capture flow is operator-side admin work that
          belongs in the ⋯ overflow menu (already exists on NickHeaderV2).
          Operator can wire it there in a future commit if they miss it. */}

      {/* ─── v10.0.343 · Provider degradation banner · Cat 8
          (operational silence) prevention. Polls /api/ai/venice-status
          every 60s and renders ONLY when overallTone is amber/red ·
          surfaces silent provider downgrades that would otherwise just
          slow the chat without telling the operator. Click to expand
          per-provider detail. */}
      <div className="fixed top-2 left-3 right-12 z-20 max-w-md mx-auto pointer-events-none">
        <div className="pointer-events-auto">
          <ProviderDegradationBanner />
        </div>
      </div>

      {/* ─── Floating Tool Log trigger button — bottom right ─── */}
      {/* Wrench diagnostic button REMOVED from visible UI — Nour:
          "that little wrench for diagnostic on chat needs rid of."
          Tool log is still accessible via keyboard shortcut ⌘⇧L.
          The toolLogOpen state + panel still work, just no floating
          button to trigger it. */}

      {/* ─── Chat history search (Cmd+F) ─── */}
      <ChatHistorySearch
        open={showHistorySearch}
        onClose={() => setShowHistorySearch(false)}
        onJumpTo={(convId) => {
          loadConvo(convId);
        }}
      />

      {/* ─── Builder sandbox panel (desktop only) ─── */}
      <BuilderSandbox
        open={personality === "builder"}
        onClose={() => {
          setPersonality("master");
          try { localStorage.setItem("nour:nick-personality", "master"); } catch {}
        }}
      />

      {/* v11.1 G1 · Browser sandbox (desktop only) — live-view iframe
          of the active Browserbase session. Auto-opens when Nick
          creates a session via browser_do tool. */}
      <BrowserSandbox
        open={browserSandboxOpen}
        onClose={() => setBrowserSandboxOpen(false)}
      />

      {/* ─── Offline queue status (bottom pill) ─── */}
      <ConnectionStatus
        status={offline.status}
        queue={offline.queue}
        onRetry={offline.retryNow}
        onClear={offline.clearQueue}
      />

      {/* ─── Keyboard cheat sheet (Cmd+/) ───
          v10.0.529.106 · Wave 83 · ~64 LOC of inline modal JSX +
          static shortcut array lifted into KeyboardCheatSheet so the
          page render tree drops a self-contained overlay. */}
      <KeyboardCheatSheet open={showHelp} onClose={() => setShowHelp(false)} />

      {/* v10.0.529.xx · Inline <style> keyframes block (fadeSlideUp,
          slideUpSoft, fadeIn, .no-scrollbar) hoisted to app/globals.css
          under the "chat-page mount animations" heading. The inline
          block was ~19 LOC of duplicated CSS · fadeSlideUp already
          existed in globals at line 1388. */}
    </div>
  );
}

// v10.0.529.106 · Wave 83 · the four extract* helpers + the
// UserMessageBubble + AssistantMessageShell memo'd components were
// lifted out of this file. extract* helpers now live in
// lib/chat/extract-message-metadata.ts · the bubble shells live in
// components/chat/message-bubble-shells.tsx. Both are imported at
// the top of this file.
