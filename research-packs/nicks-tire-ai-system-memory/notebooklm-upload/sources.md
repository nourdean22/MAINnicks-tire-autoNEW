# Gathered Source Documents

## SOURCE: Repo Code: page.tsx
* **Path**: C:\Users\nourd\NOURCITY\apps\statenour\app\(mastery)\brain\page.tsx
* **Type**: repo_file

---

"use client";

/**
 * /brain — the unified self-model surface (Wave 2 consolidation).
 *
 * Five former pages merged into one tabbed surface (redirects, not
 * deletes — see next.config.ts):
 *   • Graph  ← the Obsidian/Ultron-style fullscreen live brain graph. Default tab.
 *   • Memory ← the former /brain hub dashboard (every self-model
 *     subsystem: maturity, skills, identity, beliefs, contradictions,
 *     predictions, nudges, telemetry).
 *   • Board  ← the former /brain/board (multi-advisor consultation).
 *   • Wisdom ← the former /brain/wisdom (the wisdom-layer dashboard).
 *   • Reason ← the former /reason (the live tier-classified reasoning
 *     engine · "Charizard" surface).
 *
 * Each former page's own query params survive alongside ?tab= because
 * PageTabs reads only its own param and merges (never replaces) the
 * query string on tab-switch:
 *   • Memory · ?resolve=<key>            (contradiction deep-link)
 *   • Wisdom · ?evolution=1 · ?focus=<k> (review surface · card focus)
 *   • Reason · ?q=<text> · ?h=1          (question · sessionStorage handoff)
 *
 * Lives under (mastery) layout so it inherits NourStateProvider +
 * AmbientAura + PageTracker + KeyboardShortcuts like the rest of the
 * mastery surfaces.
 */


export default function BrainPage() {
  return (
    <>
      <StandardPage
        eyebrow="Mastery"
        title="Brain"
        description="Everything the system knows about you · the self-model, advisors, wisdom, and live reasoning."
        width="3xl"
        rhythm="loose"
      >
        <PageTabs
          defaultKey="graph"
          tabs={[
            { key: "graph", label: "Graph", render: () => <HomeBrainGraph variant="full" /> },
            { key: "memory", label: "Memory", render: () => <MemoryTab /> },
            { key: "board", label: "Board", render: () => <BoardTab /> },
            { key: "wisdom", label: "Wisdom", render: () => <WisdomTab /> },
            { key: "reason", label: "Reason", render: () => <ReasonTab /> },
            { key: "health", label: "Health", render: () => <BrainHealthView /> },
            { key: "continuity", label: "Continuity", render: () => <BrainContinuityView /> },
          ]}
        />
      </StandardPage>

      {/* Phase 5 FULL propagation (2026-05-26) · NickSidePane on /brain.
       *  Mounted at the page-level (outside the tabs) so the FAB renders
       *  on every tab. Presets bias toward what's known / what's forming /
       *  what to consolidate. */}
      <NickSidePane
        page="brain"
        coachSurface="brain"
        presets={[
          "What's the strongest signal in this brain snapshot?",
          "Which memory cluster is growing fastest?",
          "What should I consolidate or prune today?",
          "Which identity drift is the most actionable?",
        ]}
      />
    </>
  );
}

==================================================

## SOURCE: Repo Code: page.tsx
* **Path**: C:\Users\nourd\NOURCITY\apps\statenour\app\(mastery)\chat\page.tsx
* **Type**: repo_file

---

"use client";

// DefaultChatTransport moved to hooks/chat/use-chat-transport.ts (B2).
// v10.0.529.106 · Wave 83 · Button import moved into ComposerSendButton.
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
// v10.0.413 · mode-persona chip · cycles default/battle/reflect/execute
// and auto-prepends the slash prefix on send. The system-prompt
// MODE_PERSONAS rule (v10.0.400) handles the voice switching server-side.
// v10.0.529.106 · Wave 83 · ModePersonaChip moved into ComposerToolbar ·
// page still owns the persona-mode state + applyMode prefix logic.
// v10.0.28 · dead import removed — looksLikeMarketingContent +
// alreadyHasGeneratedImage moved into useChatAutoFire hook in v8.18;
// the inline call sites were deleted but the import was left behind.
// v8.18 · decideAutoFire + AutoFirePlan moved into useChatAutoFire hook
// v11 · AutoFirePlanToast import moved into chat-message-list.tsx.
// v11 · ChatEmptyState import moved into chat-message-list.tsx (the
// empty-state branch + message list now render inside ChatMessageList).
// v10.0.529.18 · useIdleSuggestion removed · the hook fired every
// session (debounce timer + /api/ai/autocomplete poll) but its render
// site was deleted in v10.0.141 ("idle-suggestion render REMOVED per
// user request"). The `idle` return value was assigned and never read.
// All wasted spend per session.
// v10.0.529.xx · WisdomPill import removed · mount cut from composer
// in favor of PromptSuggestionsBar (single above-composer suggestion
// surface). WisdomPill still consumed in components/brain-dump-modal.
// v10.0.529.20 · per-message footer (status badge + branch switcher +
// edit controls + info card + trace link) extracted into a memoized
// MessageFooter so finished messages bail out via shallow equality on
// every streamed token. The 4 sub-components above are imported INSIDE
// MessageFooter — page.tsx no longer references them directly.
// v11 · MessageFooter import moved into chat-message-list.tsx (the
// per-message footer renders inside the extracted message list).
// v10.0.529.19 · history-drawer JSX (~170 LOC inline) extracted into
// ConversationDrawer · /chat audit improvement #1.
// v10.0.484 · ProactiveInsightCard import removed (mount deleted at
// line ~2562). Component file kept · no consumers in /chat anymore.
// v10.0.529.106 · Wave 83 · useLongPress · ContextBlockBadges ·
// QualityPayload · MessageDiagnostics imports all moved into
// components/chat/message-bubble-shells.tsx (UserMessageBubble +
// AssistantMessageShell are the only consumers).
// SlashCommandPalette component kept in the tree for reference but
// not rendered — the existing use-slash-commands.ts hook now carries
// navigation + action commands in a unified SLASH_COMMANDS registry.
// v10.0.529.19 · useChatRename moved into ConversationDrawer
// Legacy — kept for fallback but not rendered in the new skeleton.
// Surgical cut: the HotQuestionsBar + NickBelowInput + starter prompts
// row + Master/Builder/Friend tabs + MODE AUTO + AUTO pills + Launcher
// collapsible are all removed from the chat page render tree per the
// Apr 19 Tesla-tier redesign. Kept imports commented in case a future
// surface needs a specific piece.
// v11 · NickStreaming + NickMessage imports moved into
// chat-message-list.tsx (both render inside the extracted message list).
// v10.0.529.106 · Wave 83 · ToolResultCard dynamic import +
// isKnownToolName moved into components/chat/message-part-renderers.tsx
// where the only consumer (ToolPartRenderer) lives. dynamic() still
// needed below for BuilderSandbox + BrowserSandbox.
// v11 · MessageEditTextarea import moved into chat-message-list.tsx.
// v11 · MessageHoverActions · FilePartRenderer/ReasoningPartRenderer/
// ToolPartRenderer · UserMessageBubble/AssistantMessageShell ·
// extractContextBlocks/Quality/Model/Citations imports all moved into
// components/chat/chat-message-list.tsx — the message-list render block
// that consumed them now lives there. page.tsx no longer references them.
// v11 · SmartRepliesCluster import moved into chat-message-list.tsx
// (the smart-replies cluster renders inside the extracted message list).
// Apr 19 · ChatControlBar retired (MODE AUTO + AUTO dropdowns gone).
// Types moved to lib/chat/types.ts so the retired component can be
// deleted entirely — the route still honors modeOverride /
// providerOverride / taskTypeOverride from the body.
// ChatOverrides was the explicit override-bag type for the retired
// ChatControlBar. The runtime hook (useChatOverrides) still owns the
// shape internally; only ChatModeOverride leaks out via cycleMode.
// v10.0.529.55 · GlitchCaptureButton import + component deleted ·
// audit Wave 9 flagged the always-visible floating chrome as cut ·
// the underlying glitch_capture workflow can be re-surfaced via
// the brain-dump modal or a future overflow-menu item if needed.
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
// v10.0.529.54 · AiPulse import removed · vanity 3D mesh cut.
// misc-pages slice (2026-05-22) · the page's last 2 authedFetch calls
// (fork + revert) migrated to trpc — fork → chat.fork (NEW), revert →
// chat.editMessage (REUSED, the Phase JJ edit procedure). The
// authedFetch import is now gone · /chat page is 100% on tRPC.
// v10.0.529.106 · Wave 83 · rootLogger import removed · all log
// surfaces moved into the action hooks (useChatMessageActions ·
// useNickMessageActions) where the only callers live.

// Wrench import removed — diagnostic button hidden from UI

// v10.0.529.18 · hoisted from inside Chat() function body. Previously
// re-declared on every render at module-init time (negligible runtime
// cost · meaningful noise to readers). Module scope is the right home
// for type aliases that don't close over state.
type Personality = "master" | "builder" | "friend";

// 2026-05-24 · Wave X Phase 1 · perf hoist (P1 finding from
// defensive audit). These three lookup constants were defined INSIDE
// the tool-completion useEffect at the bottom of the Chat() body ·
// the effect re-fires on every streamed token (~40 per assistant
// turn) and reconstructed them all from scratch each time. 80+ Set
// + Map allocations per assistant turn dropped to zero by moving
// them to module scope where they're built once at module init.
// Pure data · no state closure · safe to hoist.
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
  toggleHabit: ["habits"],
  snoozeTask: ["tasks"],
  archiveGoal: ["goals"],
  logGoalProgress: ["goals"],
  pinMemory: ["brain"],
  logSituation: ["journal"],
  journalDecision: ["journal"],
  reviewDecisionReplay: ["journal"],
  markCommitmentBroken: ["commitments"],
  syncDriveMemory: ["settings"],
  setLifeGoal: ["goals"],
  updateMasteryScore: ["score"],
  createMissionPlan: ["missions"],
  setOKRs: ["missions"],
  setWeeklyTargets: ["missions"],
  syncKnowledge: ["knowledge"],
  buildArchitectureMemory: ["brain"],
  learnCodingPreference: ["brain"],
};

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
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="w-1.5 h-1.5 rounded-full bg-(--gold) animate-pulse" /></div>}>
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

  // Telemetry Bar (ConversationPulse) state persisted in localStorage
  const [showConversationPulse, setShowConversationPulseState] = useState(false);
  useEffect(() => {
    try {
      setShowConversationPulseState(localStorage.getItem("nour:chat:show-pulse") === "1");
    } catch {}
  }, []);
  const setShowConversationPulse = useCallback((next: boolean) => {
    setShowConversationPulseState(next);
    try {
      localStorage.setItem("nour:chat:show-pulse", next ? "1" : "0");
    } catch {}
  }, []);

  // ── Optimistic prefetch: warm the lambda while user is typing.
  // Debounced 300ms, min 8 chars, min 2s between fires. Zero cost
  // to the UI — pure background warmup for first-token speed. ──
  useChatPrefetch(input);
  const sessionStartRef = useRef<number>(Date.now());

  // ── Cockpit Engine State ──
  const [recalledHits, setRecalledHits] = useState<any[]>([]);
  const [contradictions, setContradictions] = useState<any[]>([]);
  const [cockpitEvents, setCockpitEvents] = useState<any[]>([]);
  const [activeApproval, setActiveApproval] = useState<{
    approvalId: string;
    toolName: string;
    params: Record<string, any>;
    reason: string;
  } | null>(null);
  const [memoryInspectorOpen, setMemoryInspectorOpen] = useState(false);
  const [showLiveTimeline, setShowLiveTimeline] = useState(false);



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
  // Wave AC.c · 2026-05-28 · sessionStorage seed from HomeComposer.
  // The /home route owns a simple <HomeComposer /> that stashes the
  // draft in sessionStorage[chat:seed] before router.push("/chat") —
  // avoids URL-length limits and survives deep links. Read once on
  // mount, consume + clear so re-mounts don't re-seed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (input.length > 0) return;
    try {
      const stashed = sessionStorage.getItem("chat:seed");
      if (stashed && stashed.length > 0) {
        setInput(stashed.slice(0, 2000));
        sessionStorage.removeItem("chat:seed");
      }
    } catch {
      // Best-effort · sessionStorage blocked = no seed, operator types.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const approveMutation = trpc.system.approveApprovalRequest.useMutation();
  const rejectMutation = trpc.system.rejectApprovalRequest.useMutation();

  // Reset cockpit state when streaming starts (new turn)
  useEffect(() => {
    if (isStreaming) {
      setCockpitEvents([]);
      setRecalledHits([]);
      setContradictions([]);
      setActiveApproval(null);
      // Auto-expand timeline during live streaming (as per option 2 recommendation)
      setShowLiveTimeline(true);
      return;
    } else {
      // Transition timeline to summary/collapse on completion (after a small delay to let visual settle)
      const t = setTimeout(() => {
        setShowLiveTimeline(false);
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [isStreaming]);

  // Listen for Server-Sent Events from the chat transport
  useEffect(() => {
    const handleCockpitEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ type: string; payload: any }>;
      const { type, payload } = customEvent.detail;

      if (type === "intent.classified") {
        setCockpitEvents((prev) => [
          ...prev,
          {
            id: `intent-${Date.now()}`,
            type: "intent" as const,
            status: "success" as const,
            label: "Intent Classified",
            detail: `Intent: ${payload.intent}\nMode: ${payload.mode}\nModel: ${payload.model}\nProvider: ${payload.provider}\nTargets: ${payload.targets.join(", ")}`,
            timestamp: Date.now(),
          },
        ]);
      } else if (type === "memory.recalled") {
        setRecalledHits(payload.hits || []);
        setContradictions(payload.contradictions || []);
        setCockpitEvents((prev) => [
          ...prev,
          {
            id: `memory-${Date.now()}`,
            type: "memory" as const,
            status: "success" as const,
            label: `Memory Recalled (${payload.hits?.length ?? 0} hits)`,
            detail: `Recalled ${payload.hits?.length ?? 0} beliefs.\nDetected ${payload.contradictions?.length ?? 0} contradictions.`,
            timestamp: Date.now(),
          },
        ]);
      } else if (type === "tool.plan_created") {
        setCockpitEvents((prev) => [
          ...prev,
          {
            id: `plan-${Date.now()}`,
            type: "tool_plan" as const,
            status: "success" as const,
            label: "Tool Execution Plan Created",
            detail: payload.actions
              .map(
                (act: any) =>
                  `- ${act.type} (risk: ${act.riskClass})`
              )
              .join("\n"),
            timestamp: Date.now(),
          },
        ]);
      } else if (type === "tool.execution_started") {
        setCockpitEvents((prev) => [
          ...prev,
          {
            id: payload.actionId,
            type: "tool_exec" as const,
            status: "running" as const,
            label: `Executing Tool: ${payload.toolName}`,
            timestamp: Date.now(),
          },
        ]);
      } else if (type === "tool.execution_succeeded") {
        setCockpitEvents((prev) =>
          prev.map((evt) =>
            evt.id === payload.actionId
              ? {
                  ...evt,
                  status: "success" as const,
                  detail: `Result:\n${JSON.stringify(payload.result, null, 2)}`,
                }
              : evt
          )
        );
      } else if (type === "tool.execution_failed") {
        setCockpitEvents((prev) =>
          prev.map((evt) =>
            evt.id === payload.actionId
              ? {
                  ...evt,
                  status: "error" as const,
                  detail: `Error: ${payload.error}`,
                }
              : evt
          )
        );
      } else if (type === "approval.required") {
        setActiveApproval({
          approvalId: payload.approvalId,
          toolName: payload.toolName,
          params: payload.params,
          reason: payload.reason,
        });
        setCockpitEvents((prev) => [
          ...prev,
          {
            id: payload.approvalId,
            type: "tool_exec" as const,
            status: "gated" as const,
            label: `Approval Required: ${payload.toolName}`,
            detail: `Reason: ${payload.reason}`,
            timestamp: Date.now(),
          },
        ]);
      }
    };

    window.addEventListener("cockpit-event", handleCockpitEvent);
    return () => window.removeEventListener("cockpit-event", handleCockpitEvent);
  }, []);

  const handleApprove = async (id: string, editedPayload?: any) => {
    try {
      await approveMutation.mutateAsync({ id, editedPayload });
      setActiveApproval(null);
      toast.success("Action approved and queued for execution");
    } catch (err: any) {
      toast.error(err.message || "Failed to approve action");
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectMutation.mutateAsync({ id });
      setActiveApproval(null);
      toast.success("Action rejected");
    } catch (err: any) {
      toast.error(err.message || "Failed to reject action");
    }
  };

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
    { maxAttempts: 1, isStreaming },
  );
  // Apr 19 · Provider-fleet health — feeds the header dot. Amber when
  // the fleet is degraded / a lane is unreachable, silent gold-idle
  // when fine.
  const providerHealthy = useProviderHealth();

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
      toast.success("copied to clipboard");
    } catch {
      // 2026-05-24 · Wave X · pre-fix this catch was bare · Safari
      // rejects navigator.clipboard outside user-gesture context
      // (the most-common failure mode on iOS PWA) · operator hit
      // Copy and got NO feedback. Now: toast tells them to fall
      // back to long-press (which uses the native iOS selection
      // UI which always works).
      toast.error("couldn't copy · try long-press to select", { duration: 4000 });
    }
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
      } catch (err) {
        // 2026-05-24 · Wave X · pre-fix the catch discarded `err`
        // entirely · operator saw "Fork failed" with no clue whether
        // it was "conversation no longer exists" vs "network" vs
        // "auth refresh needed." Now: forward up to 80 chars of the
        // error message so the failure is actionable.
        haptic.error();
        const detail =
          err instanceof Error && err.message
            ? ` · ${err.message.slice(0, 80)}`
            : "";
        setError(`Fork failed${detail}`);
        setTimeout(() => setError(null), 3500);
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

    // 2026-05-24 · Wave X · TOOL_DOMAIN_MAP hoisted to module scope
    // (see top of file). Was rebuilt on every streamed token here ·
    // ~40 allocations per assistant turn. Same backwards-compat
    // pattern as tool-result-card.tsx for legacy createLoop/closeLoop
    // names that pre-date the rename.
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
      // 2026-05-24 · Wave X · NOW_TRIGGERING_TOOLS + PLAN_TRIGGERING_TOOLS
      // hoisted to module scope. Were rebuilt every token here (~40 per
      // turn × 2 Sets = 80 needless allocations per assistant turn).
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

  // 2026-05-24 · Wave X.b · removed dead `loadConvo` wrapper that
  // just awaited loadConvoBase with no value-add (P2 from audit).
  // Only one consumer (ChatHistorySearch.onJumpTo) · now calls
  // loadConvoBase directly. Pure noise deletion · matches kaizen
  // YAGNI principle.

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
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  // P9 · editable confirm before creating a task from an AI message (prevents
  // one-tap junk tasks from a naive title split). Reuses the existing prompt
  // primitive; the dialog node is mounted next to confirmDialog below.
  const { prompt, dialog: promptDialog } = usePromptDialog();
  const deleteConvo = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: "Delete conversation?",
      body: "This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await deleteConvoBase(id, e);
    toast.success("Conversation deleted");
  }, [deleteConvoBase, confirm]);

  async function send() {
    const raw = input.trim();
    if (!raw && !img.attached) return;

    // Command confirmation interceptor
    if (!img.attached && raw.startsWith("/")) {
      const cmdMatch = raw.match(/^\/(triage-prune|db-vacuum|run-cron)\b/i);
      if (cmdMatch) {
        const cmdName = cmdMatch[1].toLowerCase();
        let title = "";
        let body = "";
        let confirmLabel = "";
        let tone: "danger" | "default" = "default";

        if (cmdName === "triage-prune") {
          title = "Run Triage Prune?";
          body = "This will archive all tasks untouched for >14 days. This action cannot be undone.";
          confirmLabel = "Prune";
          tone = "danger";
        } else if (cmdName === "db-vacuum") {
          title = "Run Database Vacuum?";
          body = "This will run VACUUM on the database to reclaim space and rebuild indexes. It may take a few seconds.";
          confirmLabel = "Vacuum";
          tone = "default";
        } else if (cmdName === "run-cron") {
          const jobName = raw.slice(9).trim();
          title = "Run Cron Job?";
          body = jobName 
            ? `Are you sure you want to manually execute the cron job "${jobName}"?`
            : "Are you sure you want to manually execute the specified cron job?";
          confirmLabel = "Run Job";
          tone = "default";
        }

        const ok = await confirm({
          title,
          body,
          confirmLabel,
          tone,
        });
        if (!ok) return;
      }
    }

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
      // 2026-05-24 · Wave X.b · P0 silent-failure fix · pre-fix this
      // branch called sendMessage({ parts }) directly without
      // checking offline.isOnline · operator attached photo on weak
      // cell · the message silently vanished while toast.success
      // lied that it sent. Now: explicit offline guard with a clear
      // error toast (attachments don't survive the queue · operator
      // has to retry online).
      if (!offline.isOnline) {
        toast.error(
          `Offline · image sends require connection. Drop the attachment to send text only.`,
          { duration: 5000 },
        );
        return;
      }
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
      // 2026-05-24 · Wave X.b · clarity-gate fix · pre-fix this branch
      // ALWAYS called preventDefault() before checking isStreaming · so
      // hitting Enter mid-stream consumed the keystroke and did nothing
      // (no send · no newline · silent dead key). Now: while streaming
      // we fall through · the textarea inserts a natural newline (same
      // as shift+Enter) so the operator can draft the next turn while
      // Nick replies. The original "don't stack the queue" intent is
      // preserved · we just stop silently swallowing the keystroke.
      if (isStreaming) return;
      e.preventDefault();
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
  const nickMessageActions = useNickMessageActions({
    setError,
    confirmTitle: (proposed) =>
      prompt({
        title: "Create this task?",
        body: "Edit the title if needed, then confirm. Nothing is created until you do.",
        defaultValue: proposed,
        confirmLabel: "Create task",
      }),
  });

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
        "flex flex-col bg-(--bg-void)",
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
        top: "env(safe-area-inset-top, 0px)",
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
        showConversationPulse={showConversationPulse}
        onToggleConversationPulse={() => setShowConversationPulse(!showConversationPulse)}
        mode={overrides.mode}
        onModeChange={(m) => setOverrides((o) => ({ ...o, mode: m }))}
        providerOverride={overrides.provider}
        onProviderChange={(p) => setOverrides((o) => ({ ...o, provider: p }))}
        onCycleProvider={() =>
          setOverrides((o) => {
            const chain = ["auto", "ollama", "gemini", "openai", "anthropic"] as const;
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
        providerHealthy={providerHealthy}
        memoryInspectorOpen={memoryInspectorOpen}
        onToggleMemoryInspector={() => setMemoryInspectorOpen(!memoryInspectorOpen)}
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
      {!isEmpty && showConversationPulse && (
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
          onSelectConvo={(id) => void loadConvoBase(id)}
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
        {/* v11 · message-list render extracted into ChatMessageList.
            The isEmpty empty-state branch + the de-duplicated message
            map (rows · part renderers · MessageFooter) + SmartReplies-
            Cluster + NickStreaming + AutoFirePlanToast all moved out
            VERBATIM; every Chat-scope value is threaded as a prop. The
            scroll container / contentRef + the ErrorDiagnosticPanel +
            the "new reply" chip stay here. */}
        <ChatMessageList
          isEmpty={isEmpty}
          setInput={setInput}
          inputRef={inputRef}
          hasHidden={hasHidden}
          hiddenCount={hiddenCount}
          showOlder={showOlder}
          dedupedRendered={dedupedRendered}
          dedupedAll={dedupedAll}
          messages={messages}
          isStreaming={isStreaming}
          showSpeedRibbon={showSpeedRibbon}
          timingRef={timingRef}
          liveContextBlocksRef={liveContextBlocksRef}
          activeId={activeId}
          editingMsgId={editingMsgId}
          editValue={editValue}
          setEditValue={setEditValue}
          setEditingMsgId={setEditingMsgId}
          clearEditDraft={clearEditDraft}
          pins={pins}
          copyMessage={copyMessage}
          regenerate={regenerate}
          sendOrQueue={sendOrQueue}
          setMessages={setMessages}
          handleFork={handleFork}
          setActionSheetMsg={setActionSheetMsg}
          editingAssistantId={editingAssistantId}
          lastTraceId={lastTraceId}
          handleFooterStartEdit={handleFooterStartEdit}
          handleFooterCancelEdit={handleFooterCancelEdit}
          handleFooterMessageSaved={handleFooterMessageSaved}
          handleFooterMessageReverted={handleFooterMessageReverted}
          handleFooterSwapBranch={handleFooterSwapBranch}
          input={input}
          stallStatus={stallStatus}
          pendingAutoFire={pendingAutoFire}
          handleAutoFireProceed={handleAutoFireProceed}
          handleAutoFireCancel={handleAutoFireCancel}
        />

        {/* Cockpit Upgrade: Tool Execution Timeline & Gated Approval Card */}
        {showLiveTimeline && cockpitEvents.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-3 sm:px-4 py-2">
            <ToolExecutionTimeline events={cockpitEvents} />
          </div>
        )}

        {activeApproval && (
          <div className="mx-auto w-full max-w-3xl px-3 sm:px-4 py-2">
            <ApprovalCard
              approvalId={activeApproval.approvalId}
              toolName={activeApproval.toolName}
              params={activeApproval.params}
              reason={activeApproval.reason}
              onApprove={handleApprove}
              onReject={handleReject}
            />
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
              "bg-(--gold) text-black shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
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
        className="shrink-0 border-t border-(--border-default) bg-(--bg-void)"
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
            // 2026-05-24 · Wave X.b · onSeed parsing extracted to
            // `lib/chat/suggestion-seed.ts` (extractEntityFromSuggestion).
            // Pre-extract this was 55 LOC of repeated `meta.id.replace`
            // calls inline · now it's one pure function call · testable
            // in isolation · easier to extend with new suggestion kinds.
            if (meta) {
              Object.assign(
                transportBodyRef.current,
                extractEntityFromSuggestion(meta),
              );
            }
            // Best-effort focus the textarea so the operator can edit
            // before hitting send · matches the wisdom-pill pattern.
            setTimeout(() => inputRef.current?.focus(), 30);
          }}
        />

        {/* 2026-05-25 · Wave X.h · the composer chrome (wrapper +
            ComposerToolbar + textarea + VoiceWaveformOverlay +
            ComposerSendButton · ~130 LOC) lifted into the
            ChatComposer client component. All state, refs, and
            hooks stay in the page · the component is pure JSX
            with props passed through. The visual + behavior
            contract is byte-for-byte preserved (verified
            against the prior inline JSX). */}
        <ChatComposer
          input={input}
          setInput={setInput}
          inputRef={inputRef}
          adaptivePlaceholder={adaptivePlaceholder}
          isStreaming={isStreaming}
          handleKey={handleKey}
          send={send}
          stop={stop}
          voice={voice}
          onOpenVoiceMode={() => setVoiceMode(true)}
          audioTranscribing={audioTranscribing}
          audioInputRef={audioInputRef}
          onAudioChange={handleAudioAttach}
          img={img}
          personaMode={personaMode}
          onPersonaModeChange={setPersonaMode}
          longPressTimerRef={longPressTimerRef}
          slash={slash}
          mentions={mentions}
          memoryInspectorOpen={memoryInspectorOpen}
          onToggleMemoryInspector={() => setMemoryInspectorOpen(!memoryInspectorOpen)}
        />

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
        onCreateTask={() => { if (actionSheetMsg) nickMessageActions.onCreateTask(actionSheetMsg.text); }}
        onSaveToBrain={() => { if (actionSheetMsg) nickMessageActions.onSaveToBrain(actionSheetMsg.text); }}
        onPinToPrompt={() => { if (actionSheetMsg) nickMessageActions.onPinToMemory(actionSheetMsg.text); }}
        onFeedback={(positive) => { if (actionSheetMsg) postFeedback({ messageId: actionSheetMsg.id, positive, snippet: actionSheetMsg.text, conversationId: activeId }); }}
        onFork={actionSheetMsg ? () => handleFork(actionSheetMsg.id) : undefined}
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

      {/* ─── Memory Inspector Sidebar ─── */}
      <MemoryInspectorSidebar
        open={memoryInspectorOpen}
        onClose={() => setMemoryInspectorOpen(false)}
        hits={recalledHits}
        contradictions={contradictions}
      />

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
          (operational silence) prevention. Polls /api/system/provider-health
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
      {confirmDialog}
      {promptDialog}
      <ChatHistorySearch
        open={showHistorySearch}
        onClose={() => setShowHistorySearch(false)}
        onJumpTo={(convId) => {
          void loadConvoBase(convId);
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

==================================================

## SOURCE: Repo Code: page.tsx
* **Path**: C:\Users\nourd\NOURCITY\apps\statenour\app\(mastery)\decisions\[id]\page.tsx
* **Type**: repo_file

---

"use client";

/**
 * /decisions/[id] · v10.0.221 · single-decision detail.
 *
 * Showcase of the DecisionSpread primitive. Layout, top to bottom:
 *
 *   ┌─ header · title + domain + stakes + status chip
 *   ├─ timeline · age · review countdown · review status
 *   ├─ TrendCounter row · 4 cards (age, review-due, sibling-grades-avg, anti-patterns)
 *   ├─ MAIN SPREAD · prediction ↔ outcome with grade in the connector
 *   │  · LEFT  · context · options considered · chosen · reasoning
 *   │  · RIGHT · actual outcome · grade · post-mortem
 *   ├─ Anti-pattern hints · DecisionSpread cards (3) for matching
 *   │  domain lessons — the operator gets to consult them inline
 *   ├─ Sibling decisions · last 5 same-domain (each is a small spread)
 *   └─ Edit panel · grade form · review date · action buttons
 *
 * The page is the test for whether DecisionSpread scales beyond list
 * surfaces. Multiple spreads on one page, each with different score
 * types (grade letter, revisit count, similarity).
 */

// misc-pages slice (2026-05-22) · the detail read + grade-save moved
// off authedFetch onto trpc.operator.decisionDetail / gradeDecision.
  ComparisonMatrix,
  type MatrixCell,
  type MatrixCriterion,
  type MatrixOption,
} from "@/components/ui/comparison-matrix";

interface Decision {
  id: number;
  date: string;
  title: string;
  domain: string | null;
  stakes: string | null;
  context: string | null;
  optionsConsidered: string | null;
  chosen: string | null;
  reasoning: string | null;
  predictedOutcome: string | null;
  emotionalState: string | null;
  reviewDate: string | null;
  actualOutcome: string | null;
  grade: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Sibling {
  id: number;
  date: string;
  title: string;
  grade: string | null;
  actualOutcome: string | null;
  reviewDate: string | null;
}

interface AntiPattern {
  key: string;
  content: string;
  seenCount: number | null;
  metadata: Record<string, unknown> | null;
}

interface DetailPayload {
  decision: Decision;
  lineage: { siblings: Sibling[]; antiPatterns: AntiPattern[] };
  timeline: {
    ageDays: number;
    reviewDueDays: number | null;
    isReviewed: boolean;
    isOverdue: boolean;
  };
}

const GRADE_NUMERIC: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
function gradeToNumeric(grade: string | null): number {
  if (!grade) return 0;
  const g = grade.trim().toUpperCase().charAt(0);
  return GRADE_NUMERIC[g] ?? 0;
}

function gradeTone(grade: string | null): "emerald" | "gold" | "amber" | "rose" | "tertiary" {
  if (!grade) return "tertiary";
  const n = gradeToNumeric(grade);
  if (n >= 3.5) return "emerald";
  if (n >= 2.5) return "gold";
  if (n >= 1.5) return "amber";
  return "rose";
}

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const numericId = Number(id);
  const idValid = Number.isInteger(numericId) && numericId > 0;

  // ── Edit form state ─────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editOutcome, setEditOutcome] = useState("");
  const [editGrade, setEditGrade] = useState<string>("");
  const [editReviewDate, setEditReviewDate] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Reactive detail read · `cache: "no-store"` carries over as a
  // staleTime-0 query keyed on the id. `enabled` gates the call until
  // the route param resolves to a valid positive int.
  const detailQuery = trpc.operator.decisionDetail.useQuery(
    { id: numericId },
    { enabled: idValid },
  );
  const data = (detailQuery.data ?? null) as DetailPayload | null;
  const loading = detailQuery.isLoading;
  const error = detailQuery.error ? detailQuery.error.message : null;
  const fetchedAt = detailQuery.dataUpdatedAt
    ? new Date(detailQuery.dataUpdatedAt).toISOString()
    : null;

  // Seed the edit form whenever fresh decision data lands (the legacy
  // load() seeded these inside its .then()).
  useEffect(() => {
    if (!data) return;
    setEditOutcome(data.decision.actualOutcome ?? "");
    setEditGrade(data.decision.grade ?? "");
    setEditReviewDate(data.decision.reviewDate ?? "");
  }, [data]);

  // v10.0.529.89 · Wave 33 · split-pane refresh · when Nick grades or
  // reviews this decision via chat (reviewDecisionReplay tool fires
  // "journal" domain), the open detail page refreshes instantly.
  // Pre-Wave-33 the operator could see Nick's grade in the chat
  // transcript while this page still showed the old grade · jarring.
  useEffect(() => {
    return onDataChanged(["journal"], () => void detailQuery.refetch());
  }, [detailQuery]);

  const gradeDecision = trpc.operator.gradeDecision.useMutation();

  async function save() {
    if (!idValid) return;
    setSaving(true);
    try {
      await gradeDecision.mutateAsync({
        id: numericId,
        actualOutcome: editOutcome || undefined,
        grade: editGrade || undefined,
        reviewDate: editReviewDate || undefined,
      });
      toast.success("decision updated");
      setEditing(false);
      await detailQuery.refetch();
      // v10.0.529.90 · Wave 34 · symmetric notify. Wave 33 wired this
      // page to LISTEN for "journal" events from chat-driven grading ·
      // now it also EMITS so /journal list + any split-pane view
      // refresh when the operator grades from the detail page.
      notifyDataChanged("journal", { source: "decisions-page", detail: "decision-grade", id });
    } catch (e) {
      toast.error(`save failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-5xl px-3 py-6">
        <p className="text-[11px] text-[var(--text-tertiary)]">loading decision…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-5xl px-3 py-6">
        <Panel className="border-rose-500/30 bg-rose-500/[0.04]">
          <div className="flex items-start gap-3 p-3">
            <AlertCircle size={14} className="text-rose-300/80 mt-0.5" />
            <div>
              <p className="text-[12px] font-bold text-rose-300">load failed</p>
              <p className="text-[10px] text-rose-300/70 mt-0.5 font-mono">{error}</p>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  if (!data) return null;

  const { decision: d, lineage, timeline } = data;
  const tone = gradeTone(d.grade);

  // Avg sibling grade — surface the domain trend so the operator
  // sees "this domain has been at C+ on average; this F is an outlier."
  const siblingGrades = lineage.siblings
    .map((s) => (s.grade ? gradeToNumeric(s.grade) : null))
    .filter((n): n is number => n !== null);
  const siblingAvgGrade =
    siblingGrades.length > 0
      ? siblingGrades.reduce((a, b) => a + b, 0) / siblingGrades.length
      : null;

  // ─── ComparisonMatrix data · current + siblings × 4 criteria ──────
  // The "options" are the current decision and its same-domain siblings ·
  // the "criteria" are the dimensions an operator wants to scan across
  // a domain (grade · how-fresh · review-status · has-outcome). The
  // current decision is pinned to row 1 with a "(this)" label so the
  // operator can locate it inside the sort.
  const matrixOptions: MatrixOption[] = [
    {
      id: `current-${d.id}`,
      label: `${d.title.slice(0, 48)} · (this)`,
      _grade: d.grade,
      _ageDays: timeline.ageDays,
      _reviewDueDays: timeline.reviewDueDays,
      _hasOutcome: !!d.actualOutcome,
    },
    ...lineage.siblings.map((s) => {
      const ageDays = Math.max(
        0,
        Math.round((Date.now() - new Date(s.date).getTime()) / 86_400_000),
      );
      const reviewDueDays = s.reviewDate
        ? Math.round(
            (new Date(s.reviewDate).getTime() - Date.now()) / 86_400_000,
          )
        : null;
      return {
        id: `sib-${s.id}`,
        label: s.title.slice(0, 48),
        href: `/decisions/${s.id}`,
        _grade: s.grade,
        _ageDays: ageDays,
        _reviewDueDays: reviewDueDays,
        _hasOutcome: !!s.actualOutcome,
      };
    }),
  ];

  const matrixCriteria: MatrixCriterion[] = [
    { id: "grade", label: "grade", higherIsBetter: true },
    { id: "age", label: "age (days)", higherIsBetter: false },
    { id: "review", label: "review (days)", higherIsBetter: true },
    { id: "outcome", label: "outcome", higherIsBetter: true },
  ];

  const matrixCells = (
    opt: MatrixOption,
    crit: MatrixCriterion,
  ): MatrixCell => {
    const grade = opt._grade as string | null;
    const ageDays = opt._ageDays as number;
    const reviewDueDays = opt._reviewDueDays as number | null;
    const hasOutcome = opt._hasOutcome as boolean;

    switch (crit.id) {
      case "grade":
        return grade
          ? { value: grade, score: gradeToNumeric(grade), display: grade }
          : { value: null };
      case "age":
        return { value: ageDays, score: ageDays };
      case "review":
        return reviewDueDays === null
          ? { value: null, display: "no date" }
          : { value: reviewDueDays, score: reviewDueDays };
      case "outcome":
        return {
          value: hasOutcome ? "yes" : "no",
          score: hasOutcome ? 1 : 0,
          display: hasOutcome ? "yes" : "no",
        };
      default:
        return { value: null };
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push("/system/decision-drift")}
          className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
        >
          <ChevronLeft size={11} /> decision-drift
        </button>
      </div>

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <span>decision · {d.date}</span>
            {d.domain && (
              <span className="font-mono tracking-[0.18em] opacity-80">
                {d.domain.slice(0, 4).toUpperCase()}
              </span>
            )}
            {d.stakes && (
              <span className="rounded border border-[var(--gold)]/30 bg-[var(--gold)]/[0.05] px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-[var(--gold)]/90 normal-case">
                {d.stakes} stakes
              </span>
            )}
          </span>
        }
        title={d.title}
        description={
          timeline.isReviewed
            ? `reviewed · grade ${d.grade ?? "—"} · logged ${timeline.ageDays}d ago`
            : timeline.isOverdue
              ? `overdue review · ${Math.abs(timeline.reviewDueDays!)}d past due`
              : timeline.reviewDueDays !== null
                ? `review in ${timeline.reviewDueDays}d`
                : `unreviewed · logged ${timeline.ageDays}d ago`
        }
        actions={
          <div className="flex items-center gap-2">
            <FreshnessChip
              lastFetchedAt={fetchedAt}
              source="api/decisions/[id]"
              onReload={() => void detailQuery.refetch()}
            />
            <button
              onClick={() => setEditing((v) => !v)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-[11px] font-medium transition",
                editing
                  ? "border-zinc-600 bg-zinc-800 text-zinc-200"
                  : "border-[var(--gold)]/40 bg-[var(--gold)]/[0.08] text-[var(--gold)] hover:bg-[var(--gold)]/15",
              )}
            >
              {editing ? "× cancel" : timeline.isReviewed ? "edit" : "grade decision"}
            </button>
          </div>
        }
      />

      {/* ── Timeline TrendCounter row ───────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TrendCounter
          value={timeline.ageDays}
          label="age · days since logged"
          goodWhen="neutral"
          tone="tertiary"
        />
        <TrendCounter
          value={timeline.reviewDueDays ?? 0}
          label={
            timeline.reviewDueDays === null
              ? "no review date set"
              : timeline.isOverdue
                ? "days OVERDUE"
                : "days to review"
          }
          goodWhen="high"
          tone={
            timeline.reviewDueDays === null ? "tertiary"
            : timeline.isOverdue ? "rose"
            : timeline.reviewDueDays < 7 ? "amber"
            : "emerald"
          }
          format={(n) => timeline.reviewDueDays === null ? "—" : `${Math.abs(n)}`}
        />
        <TrendCounter
          value={siblingAvgGrade ?? 0}
          label={
            siblingAvgGrade === null
              ? "no domain history"
              : `${d.domain ?? "domain"} avg · ${siblingGrades.length} graded`
          }
          goodWhen="high"
          tone={
            siblingAvgGrade === null ? "tertiary"
            : siblingAvgGrade >= 3 ? "emerald"
            : siblingAvgGrade >= 2 ? "gold"
            : "rose"
          }
          format={(n) => siblingAvgGrade === null ? "—" : `${n.toFixed(1)}/4`}
        />
        <TrendCounter
          value={lineage.antiPatterns.length}
          label="domain anti-patterns"
          goodWhen="neutral"
          tone={lineage.antiPatterns.length > 0 ? "amber" : "tertiary"}
        />
      </div>

      {/* ── MAIN SPREAD · the page's centerpiece ───────────────── */}
      <DecisionSpread
        leftLabel={
          <span className="inline-flex items-center gap-2">
            <span>predicted</span>
            {d.emotionalState && (
              <span className="rounded bg-[var(--gold)]/[0.06] px-1.5 py-px text-[9px] tracking-wider text-[var(--gold)]/80 normal-case">
                {d.emotionalState}
              </span>
            )}
          </span>
        }
        leftTitle={d.chosen ?? "no choice recorded"}
        leftBody={d.predictedOutcome ?? d.context ?? "no prediction"}
        leftMeta={
          d.optionsConsidered
            ? `options · ${d.optionsConsidered.slice(0, 80)}`
            : d.reasoning
              ? `reasoning · ${d.reasoning.slice(0, 80)}`
              : undefined
        }
        score={gradeToNumeric(d.grade)}
        scoreFormat={() => d.grade ?? "—"}
        scoreLabel={timeline.isReviewed ? "graded" : "ungraded"}
        rightLabel="actual"
        rightTitle={
          d.actualOutcome
            ? d.actualOutcome.slice(0, 80)
            : timeline.isOverdue
              ? "OVERDUE — outcome not yet recorded"
              : "outcome not yet recorded"
        }
        rightBody={
          d.actualOutcome && d.actualOutcome.length > 80 ? (
            <p className="text-[12px] leading-relaxed">
              {d.actualOutcome.slice(80, 600)}
              {d.actualOutcome.length > 600 && "…"}
            </p>
          ) : !timeline.isReviewed ? (
            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)] italic">
              {timeline.reviewDueDays !== null && timeline.reviewDueDays >= 0
                ? `Review opens in ${timeline.reviewDueDays}d. The page will let you grade then — or click "grade decision" above to log the outcome now.`
                : "Click 'grade decision' above to record the actual outcome."}
            </p>
          ) : null
        }
      />

      {/* ── Edit form · folds out below the spread ───────────────── */}
      {editing && (
        <Panel className="border-[var(--gold)]/30 bg-[var(--gold)]/[0.03]">
          <div className="space-y-3 p-3">
            <h3 className="text-sm font-semibold text-[var(--gold)]">
              {timeline.isReviewed ? "Edit grade" : "Grade decision"}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  actual outcome
                </label>
                <textarea
                  value={editOutcome}
                  onChange={(e) => setEditOutcome(e.target.value)}
                  rows={4}
                  placeholder="what actually happened — blunt, specific, with numbers when possible"
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-base)]/60 px-3 py-2 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--gold)]/60 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  grade
                </label>
                <select
                  value={editGrade}
                  onChange={(e) => setEditGrade(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-base)]/60 px-3 py-2 text-[12px] text-[var(--text-primary)] focus:border-[var(--gold)]/60 focus:outline-none"
                >
                  <option value="">— pick —</option>
                  <option value="A">A · prediction held + outcome was great</option>
                  <option value="B">B · prediction mostly right</option>
                  <option value="C">C · partial · some wrong</option>
                  <option value="D">D · prediction wrong, recoverable</option>
                  <option value="F">F · totally missed it</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  next review date
                </label>
                <input
                  type="date"
                  value={editReviewDate}
                  onChange={(e) => setEditReviewDate(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-base)]/60 px-3 py-2 text-[12px] text-[var(--text-primary)] focus:border-[var(--gold)]/60 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-md border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-700/60"
              >
                cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={saving || !editGrade || !editOutcome}
                className="rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/[0.12] px-3 py-1.5 text-[11px] text-[var(--gold)] hover:bg-[var(--gold)]/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? "saving…" : "save grade"}
              </button>
            </div>
          </div>
        </Panel>
      )}

      {/* ── Anti-pattern hints · DecisionSpread for matching domain ── */}
      {lineage.antiPatterns.length > 0 && (
        <section className="space-y-2">
          <header className="flex items-baseline justify-between">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              anti-patterns in {d.domain}
            </p>
            <Link
              href="/system/quality?view=lessons"
              className="text-[10px] font-mono tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)]"
            >
              full library →
            </Link>
          </header>
          <div className="space-y-2">
            {lineage.antiPatterns.map((ap) => {
              const meta = (ap.metadata ?? {}) as Record<string, unknown>;
              const attempt = (meta.attempt as string | undefined) ?? ap.content.slice(0, 80);
              const outcome = (meta.outcome as string | undefined) ?? "";
              const lesson = (meta.lesson as string | undefined) ?? ap.content;
              return (
                <DecisionSpread
                  key={ap.key}
                  leftLabel={
                    <span className="inline-flex items-center gap-2">
                      <BookOpen size={10} className="opacity-70" />
                      <span>past attempt</span>
                    </span>
                  }
                  leftTitle={attempt}
                  leftBody={lesson}
                  leftMeta={`#${ap.key}`}
                  score={ap.seenCount ?? 0}
                  scoreFormat={(n) => `${n}×`}
                  scoreLabel="revisited"
                  rightLabel="outcome learned"
                  rightTitle={outcome || "see lesson"}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Wave 2 cleanup (2026-06-03): the standalone sibling LIST that used to
          render here was removed -- it duplicated the domain-scan matrix below.
          The matrix now renders each sibling's label as a Link (MatrixOption
          href), so it is BOTH the comparison view AND the navigation. */}

      {/* ── ComparisonMatrix · domain scan view ────────────────────
       *   Shipped 2026-05-23 · task #8 from operator backlog. Renders
       *   current decision + siblings as a dense grid keyed by 4 criteria
       *   so the operator can scan a domain in one glance instead of
       *   reading individual sibling cards. Per-column color-coding
       *   surfaces outliers (the F in a string of A's, the 200-day-old
       *   unreviewed decision in a domain with 30-day cadence). Only
       *   rendered when there's at least one sibling — with just the
       *   current decision the matrix is 1 × N, which is just a label
       *   row and contributes no signal.
       */}
      {lineage.siblings.length > 0 && (
        <section className="space-y-2">
          <header>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              domain scan · {d.domain ?? "all"}
            </p>
          </header>
          <ComparisonMatrix
            options={matrixOptions}
            criteria={matrixCriteria}
            cells={matrixCells}
            caption="current decision + siblings · click a sibling to open it · click a header to sort"
            defaultSortCriterion="grade"
          />
        </section>
      )}

      {/* ── Reasoning + context · expanded fields below the fold ── */}
      <Panel>
        <div className="grid gap-4 p-3 md:grid-cols-2">
          {d.context && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] mb-1.5">
                context
              </p>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                {d.context}
              </p>
            </div>
          )}
          {d.reasoning && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] mb-1.5">
                reasoning
              </p>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                {d.reasoning}
              </p>
            </div>
          )}
          {d.optionsConsidered && (
            <div className="md:col-span-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] mb-1.5">
                options considered
              </p>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                {d.optionsConsidered}
              </p>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

==================================================

## SOURCE: Repo Code: page.tsx
* **Path**: C:\Users\nourd\NOURCITY\apps\statenour\app\(mastery)\journal\page.tsx
* **Type**: repo_file

---

"use client";

// Phase D follow-up audit (2026-05-18 PM) · second attempt at the
// useSearchParams() prerender fix. First attempt used
// `export const dynamic = "force-dynamic"` · that does NOT take
// effect on "use client" pages (route segment config is only
// honored by Server Components per Next.js 16). Real fix: wrap
// JournalPageInner in <Suspense> from the exported outer JournalPage.
// Same pattern shipped on /tasks at the same time.

/**
 * JOURNAL — Unified thought-capture feed.
 *
 * Merges BrainDump (chat + Telegram + manual), Reflection (cron
 * engine), SituationLog (War Room), and DecisionReplay (reviewed
 * decisions) into a single chronological stream.
 *
 * Filters: source (all / dump / reflection / situation / decision)
 * and thought-type (raw / thinking / reasoning / insight / decision
 * / reflection / planning / venting).
 *
 * Each entry expands inline to show the full body, extracted
 * summary, linked topics, and — for brain dumps — the action items
 * + insights + commitments extracted during ingest.
 */


// v10.0.30 — structured logger for journal-page client errors.
const log = rootLogger.withSurface("journal/page");
// Wave AP · 2026-05-28 · Sam-led /journal trio · brief + prompt + strip
  TYPE_META,
  type FeedEntry,
  type SourceKey,
  type TypeKey,
} from "@/components/journal/types";

// Phase TT (2026-05-19 AM) · authedFetch replaced by trpc · 2 reads
// (feed · metacognition) now flow through typed procedures.
// ─── Types ─────────────────────────────────────────────
// v10.0.284 · FeedEntry · SourceKey · TypeKey · TYPE_META · SOURCE_ICON
// + JournalEntryRow extracted to components/journal/{types,entry-row}.
// FeedResponse stays here · API-response shape, only the page reads it.

interface FeedResponse {
  data: {
    entries: FeedEntry[];
    counts: {
      total: number;
      bySource: Record<string, number>;
      byType: Record<string, number>;
    };
  };
}

// v10.0.529.24 · subset of the JournalEntry server-type used by the
// metacognition card. Mirrors the fields rendered below · not the
// full server interface · keeps the page from depending on
// lib/brain/learning-journal.ts at compile time.
interface MetacognitionEntry {
  date: string;
  selfAssessment: string;
  learningRate: { daily: number; weekly: number; monthly: number; trend: "accelerating" | "steady" | "decelerating" };
  predictionCalibration: { calibrationScore: number; overconfident: number; underconfident: number; wellCalibrated: number };
  weakSpots: { domain: string; daysSinceLastLearning: number; memoryCount: number }[];
  stagnationAlert: string | null;
}

// ─── Page ──────────────────────────────────────────────

// Outer · Suspense boundary required because JournalPageInner calls
// useSearchParams() (Phase D cross-link #1 · ?search= seeding).
// Per Next.js 16, useSearchParams in a client component MUST be
// wrapped in <Suspense> for static prerender to succeed.
export default function JournalPage() {
  return (
    <>
      <Suspense fallback={null}>
        <JournalPageInner />
      </Suspense>
      {/* Phase 5 FULL propagation (2026-05-26) · NickSidePane on
       *  /journal. Mounted at the page-level (outside Suspense) so the
       *  FAB renders even before the heavy journal feed hydrates ·
       *  operator can capture a thought instantly. Presets bias toward
       *  patterns / threads / blind spots. */}
      <NickSidePane
        page="journal"
        coachSurface="journal"
        presets={[
          "What pattern keeps surfacing in this week's entries?",
          "Which blind spot am I dancing around?",
          "Which thread is the real story behind today?",
          "What would I tell a younger me about this entry?",
        ]}
      />
    </>
  );
}

function JournalPageInner() {
  // Phase D follow-up audit (2026-05-18) · cross-link #1 ·
  // initialize search from ?search= URL param so deep-links from
  // ThreadRail "view in feed →" land on a pre-filtered view.
  // The state mirror keeps subsequent typing reactive · the URL
  // param is the seed, not the source of truth.
  const searchParams = useSearchParams();
  const initialSearch = searchParams?.get("search") ?? "";

  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [counts, setCounts] = useState<FeedResponse["data"]["counts"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<SourceKey>("all");
  const [type, setType] = useState<TypeKey>("all");
  const [search, setSearch] = useState(initialSearch);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"feed" | "insights" | "reflect">("feed");
  const initialDeepLinkHandledRef = useRef(false);

  // Dynamic heuristics to set the default active tab on load/mount
  useEffect(() => {
    if (initialDeepLinkHandledRef.current) return;
    const hash = window.location.hash || "";
    const hasSearchParam = searchParams?.get("search");
    let t: ReturnType<typeof setTimeout> | undefined;
    if ((hash.startsWith("#bd-") || hasSearchParam) && activeTab !== "feed") {
      t = setTimeout(() => {
        setActiveTab("feed");
      }, 0);
    }
    initialDeepLinkHandledRef.current = true;
    return () => {
      if (t) clearTimeout(t);
    };
  }, [searchParams, activeTab]);

  // Handle the focus-composer custom event dispatched by TodaysPrompt
  useEffect(() => {
    if (typeof window === "undefined") return () => {};
    const handleFocusComposer = () => {
      setActiveTab("reflect");
      requestAnimationFrame(() => {
        const el = document.getElementById("journal-reflect-composer");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          const firstField = el.querySelector<HTMLTextAreaElement>("textarea");
          firstField?.focus();
        }
      });
    };
    window.addEventListener("nour:journal-focus-composer", handleFocusComposer);
    return () => {
      window.removeEventListener("nour:journal-focus-composer", handleFocusComposer);
    };
  }, []);
  // v10.0.436 · sort key · localStorage-persisted · 6 modes
  type JournalSort = "newest" | "oldest" | "alpha-asc" | "alpha-desc" | "longest" | "shortest";
  const [sortKey, setSortKey] = useState<JournalSort>("newest");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const saved = window.localStorage.getItem("journal:sortKey");
    const valid: JournalSort[] = ["newest", "oldest", "alpha-asc", "alpha-desc", "longest", "shortest"];
    if (saved && valid.includes(saved as JournalSort)) {
      setSortKey(saved as JournalSort);
    }
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    window.localStorage.setItem("journal:sortKey", sortKey);
  }, [sortKey, isMounted]);
  // v10.0.30 — error state. Pre-v10.0.30 the load() catch silently
  // reset entries to [], so a 401 / 429 / 500 looked identical to a
  // legitimately empty filter. Now: distinct error banner + preserved
  // HTTP status code so the operator knows what happened.
  const [error, setError] = useState<string | null>(null);
  // v10.0.30 — abort signal so rapid filter changes / data-change
  // events don't pile up overlapping requests with stale resolutions.
  const inflightRef = useRef<AbortController | null>(null);
  // v10.0.30 — gate the stagger-in animation to the first load only.
  // Pre-v10.0.30 every filter change re-fired the animation cascade
  // (delay = i * 40ms), so entry 99 waited ~4s to appear after a
  // filter switch — perceived as freezing. Only animate on initial
  // mount; subsequent loads jump straight to position.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // v10.0.529.24 · metacognition · loads the latest learning-journal
  // entry the evening cron produces. Surfaces Nick's nightly
  // self-assessment of his brain (learningRate · calibration · weak
  // spots) right at the top of /journal so the operator can see it
  // without re-running the 16-query Promise.all the cron does. Null
  // when no cron run has landed yet or legacy rows have no metadata.
  const [meta, setMeta] = useState<MetacognitionEntry | null>(null);

  // Phase D · ADR-0013 · pattern-radar refresh signal · bumped when
  // operator confirms a convergence candidate so the ThreadRail
  // re-pulls and shows the new thread above the feed.
  const [threadRefresh, setThreadRefresh] = useState(0);

  // Phase TT · tRPC migration · imperative-fetch-via-utils inside the
  // existing load() function so the page's AbortController/inflightRef
  // scheduling stays intact. Same JJ/MM/PP pattern · pure data-source
  // swap · no UX behavior change.
  const utils = trpc.useUtils();

  const load = useCallback(async () => {
    // Abort any in-flight load so the latest filter wins on resolve.
    if (inflightRef.current) inflightRef.current.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    setLoading(true);
    try {
      const view = await utils.journal.feed.fetch({
        source: source !== "all" ? source : undefined,
        type: type !== "all" ? type : null,
        limit: 100,
        days: 60,
      });
      if (ctrl.signal.aborted) return;
      setEntries(view.entries as typeof entries);
      setCounts(view.counts as typeof counts);
      setError(null);
    } catch (err) {
      // Aborted requests are expected — don't surface as user-facing errors.
      if ((err as { name?: string })?.name === "AbortError") return;
      // v10 B.1 FIND-05 · also reset counts on error so the filter
      // badge ("3 decisions") doesn't drift from the empty feed
      // ("No thoughts captured") — contradictory state confused the
      // operator after a failed filter switch.
      setEntries([]);
      setCounts(null);
      // v10.0.529.21 · sanitize the error before surfacing to the UI.
      // Pre-fix raw Prisma/Neon error strings could leak table names
      // and column hints in the operator-facing banner. log.error
      // keeps the raw message for the /system/errors dashboard.
      const rawMsg = err instanceof Error ? err.message : String(err);
      log.error("journal_load_failed", { error: rawMsg });
      setError(sanitizeError(err));
    } finally {
      setLoading(false);
    }
  }, [source, type, utils]);

  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // v10.0.529.24 · fetch metacognition once on mount. Fire-and-forget ·
  // failures degrade silently to "card hidden" rather than breaking the
  // feed below · this is supplemental context, not load-critical data.
  // Phase TT · migrated to utils.journal.metacognition.fetch() · same
  // mount-only fire-and-forget shape.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entry = await utils.journal.metacognition.fetch();
        if (!cancelled) setMeta(entry as MetacognitionEntry | null);
      } catch (err) {
        if (!cancelled) log.warn("metacognition_fetch_failed", { error: sanitizeError(err) });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v10.0.30 — flip the stagger gate AFTER the first render that
  // has entries. Setting it inside load() runs before the render is
  // committed, so the first stagger would be skipped. This effect
  // runs post-commit, so the initial mount staggers and every
  // subsequent load (filter switch / data-change) jumps straight.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    if (entries.length > 0 && !hasLoadedOnce) {
      // Defer to the next tick so the current animation can run
      // before we flip the gate for future loads.
      t = setTimeout(() => {
        setHasLoadedOnce(true);
      }, 100);
    }
    return () => {
      if (t) clearTimeout(t);
    };
  }, [entries, hasLoadedOnce]);

  // Cross-surface refresh — when a brain dump or decision gets
  // captured anywhere (chat NL interceptor, global capture, telegram,
  // OR chat AI tool: logSituation / journalDecision / review etc.),
  // the page auto-reloads.
  //
  // v10.0.529.87 · Wave 31 · subscribe to BOTH the targeted "journal"
  // domain AND "any" with the legacy detail-string guard. Pre-Wave-31
  // the page only matched 3 detail strings — tool-driven writes from
  // chat fell through unnoticed. Targeted domain closes the gap while
  // legacy NL interceptor paths still match on detail string.
  useEffect(() => {
    return onDataChanged(["any", "journal"], (e) => {
      // Targeted "journal" domain → always reload (tool calls land here).
      if (e.domain === "journal") {
        load();
        return;
      }
      // "any" domain → legacy NL interceptor + global capture paths
      // that pre-date the targeted domain. Filter by detail string so
      // unrelated "any" fires (e.g. score/habit writes) don't churn.
      if (
        e.detail === "journal-capture" ||
        e.detail === "nl-brain-dump" ||
        e.detail === "nl-decision"
      ) {
        load();
      }
    });
  }, [load]);

  // Deep-link: /journal#bd-<id> scrolls + highlights the target entry.
  // Used by the /tasks UI backlinks ("from journal" badge on a task).
  // Has to fire after entries load since the DOM node doesn't exist yet
  // on the first render when the feed is still fetching.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    if (entries.length > 0) {
      const hash = window.location.hash || "";
      if (hash.startsWith("#bd-")) {
        const id = hash.slice(4);
        const el = document.getElementById(`bd-${id}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-[var(--gold)]/60");
          // v10.0.30 — cleanup: cancel the timer on unmount or entries change
          // so we don't fire setTimeout against a node React already
          // reconciled away. Pre-v10.0.30 this could mutate a detached
          // element after navigation.
          t = setTimeout(() => {
            el.classList.remove("ring-2", "ring-[var(--gold)]/60");
          }, 2500);
        }
      }
    }
    return () => {
      if (t) clearTimeout(t);
    };
  }, [entries]);

  // Apply the client-side text filter before grouping. The filter
  // checks title + body + summary + linkedTopics so "cameron" finds
  // the Global Cleveland thread and "tire" finds every tire-related
  // capture. Case-insensitive substring match.
  const q = search.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!q) return entries;
    return entries.filter((e) => {
      const haystack = `${e.title} ${e.body} ${e.summary || ""} ${(e.linkedTopics || []).join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, q]);

  // v10.0.436 · sort dispatch · default = newest (date desc).
  // 6 modes mirror the wisdom + skills pattern.
  const sortedEntries = useMemo(() => {
    const out = [...filteredEntries];
    switch (sortKey) {
      case "oldest":
        out.sort((a, b) => a.date.localeCompare(b.date));
        break;
      case "alpha-asc":
        out.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "alpha-desc":
        out.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case "longest":
        out.sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0));
        break;
      case "shortest":
        out.sort((a, b) => (a.body?.length ?? 0) - (b.body?.length ?? 0));
        break;
      case "newest":
      default:
        out.sort((a, b) => b.date.localeCompare(a.date));
        break;
    }
    return out;
  }, [filteredEntries, sortKey]);

  // Group filtered entries by date for the day headers.
  //
  // 2026-05-24 · Wave R · pre-fix this grouped over the already-sorted
  // list which meant `alpha-asc` / `alpha-desc` / `longest` /
  // `shortest` modes broke the day-grouping invariant · two non-
  // adjacent entries sharing a date created TWO day-group headers
  // for the same date. Day headers are always date-ordered now ·
  // entries within each day inherit whatever the sortKey dictated.
  // For date-monotonic modes (newest/oldest, which is the default)
  // this is identical to the pre-fix behavior.
  const byDate = useMemo(() => {
    const groups = new Map<string, FeedEntry[]>();
    for (const e of sortedEntries) {
      const key = e.date;
      const list = groups.get(key) || [];
      list.push(e);
      groups.set(key, list);
    }
    // Day-header sort · newest-first if the user is on a "newest"-ish
    // mode, otherwise oldest-first so the day axis matches the
    // entries axis. The entry-level sort (sortedEntries) handles the
    // within-day order.
    const dateAsc = sortKey === "oldest";
    return Array.from(groups.entries()).sort((a, b) =>
      dateAsc ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]),
    );
  }, [sortedEntries, sortKey]);

  // H.3.1 · suppress DeepModeNudge across the entire journal surface.
  // Journal entries ARE deep thinking — every brain-dump, decision-
  // replay, reflection would trigger the classifier and surface the
  // chip on every keystroke. data-no-deep-nudge on the root wrapper
  // makes the global watcher skip any focused input inside it.
  return (
    <div className="min-h-screen text-zinc-100 space-y-5" data-no-deep-nudge>
      <SectionHeader
        icon={<NotebookPen size={16} className="text-(--gold)" />}
        label="Journal"
        subtitle="thinking · reasoning · insights · decisions · reflections"
        accent="gold"
        live
      />

      {/* Mastery Layer Stage D · 2026-05-26 · mission-mode breadcrumb.
       *  Self-hides when ?missionId is absent. */}
      <MissionBreadcrumb />

      {/* Mastery Layer Stage A · Coach Channel surface · 2026-05-26.
       *  Surfaces system-noticed events tagged for journal (pattern
       *  observations, thread suggestions, learning velocity nudges).
       *  Self-hides when zero events. */}
      <CoachEventBanner surface="journal" />

      {/* Tab Selector Switcher */}
      <div className="glass-card relative overflow-hidden bg-linear-to-br from-zinc-950 via-zinc-900 to-zinc-950/80 border border-white/10 border-b-white/5 rounded-xl p-3 shadow-xl flex items-center justify-between pb-2.5">
        {/* Background ambient glow matching active tab */}
        <div 
          className={cn(
            "absolute top-0 right-0 w-32 h-32 rounded-full blur-2xl pointer-events-none transition-all duration-500",
            activeTab === "feed" && "bg-(--gold)/5",
            activeTab === "insights" && "bg-emerald-500/5",
            activeTab === "reflect" && "bg-violet-500/5"
          )}
        />
        <div className="flex items-center gap-1.5 md:gap-3 z-10">
          {[
            { id: "feed" as const, label: "Feed", Icon: NotebookPen, activeColor: "text-(--gold)", activeBorder: "bg-(--gold)", hoverColor: "hover:text-(--gold)/80" },
            { id: "insights" as const, label: "Insights", Icon: Sparkles, activeColor: "text-emerald-400", activeBorder: "bg-emerald-400", hoverColor: "hover:text-emerald-400/80" },
            { id: "reflect" as const, label: "Reflect", Icon: Brain, activeColor: "text-violet-400", activeBorder: "bg-violet-400", hoverColor: "hover:text-violet-400/80" }
          ].map((tab) => {
            const Icon = tab.Icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex items-center gap-1.5 py-1 px-2.5 rounded-md text-[11px] font-mono uppercase tracking-wider transition-all pointer-coarse:min-h-[44px]",
                  isActive 
                    ? cn(
                        "text-white font-medium border",
                        tab.id === "feed" && "bg-(--gold)/5 border-(--gold)/20 shadow-[0_0_8px_rgba(212,163,89,0.1)]",
                        tab.id === "insights" && "bg-emerald-500/5 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.1)]",
                        tab.id === "reflect" && "bg-violet-500/5 border-violet-500/20 shadow-[0_0_8px_rgba(139,92,246,0.1)]"
                      )
                    : cn("text-white/45 hover:text-white/80 hover:bg-white/2 border-transparent", tab.hoverColor)
                )}
              >
                <Icon size={12} className={cn(isActive && tab.activeColor)} />
                <span>{tab.label}</span>
                {isActive && (
                  <span className={cn("absolute bottom-[-11px] left-0 right-0 h-[2px] rounded-full", tab.activeBorder)} />
                )}
              </button>
            );
          })}
        </div>
        <span className="hidden sm:inline text-[9px] font-mono text-white/30 tracking-wider z-10">
          JOURNAL COCKPIT
        </span>
      </div>

      {/* Tab Contents */}
      {activeTab === "feed" && (
        <div className="space-y-5 animate-fade-in">
          {/* ── Search box — filters the loaded feed on the client so it
              composes with the server-side Source and Type filters. Stays
              focused on title + body + summary + linkedTopics so it feels
              like a real search, not just a title match.
              v10.0.436 · added sort dropdown alongside · 6 modes ── */}
          <div className="flex gap-2 flex-wrap sm:flex-nowrap">
            <div className="relative flex-1 min-w-0">
              <Search
                size={12}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-tertiary)"
              />
              <input
                type="text"
                placeholder="Search journal — titles, body, summary, tags..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-8 py-2 min-h-[44px] sm:min-h-0 rounded-lg bg-(--bg-elevated) border border-(--border-default) text-[12px] text-(--text-primary) placeholder:text-(--text-tertiary) outline-none focus:border-(--gold)/40 transition-colors"
              />
              {search.length > 0 && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-(--text-tertiary) hover:text-(--text-primary) hover:bg-(--bg-raised)"
                  aria-label="Clear search"
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>
            <SortDropdown<JournalSort>
              value={sortKey}
              onChange={setSortKey}
              defaultValue="newest"
              ariaLabel="Sort journal entries"
              options={[
                { value: "newest", label: "newest first" },
                { value: "oldest", label: "oldest first" },
                { value: "alpha-asc", label: "title · A→Z" },
                { value: "alpha-desc", label: "title · Z→A" },
                { value: "longest", label: "body · longest" },
                { value: "shortest", label: "body · shortest" },
              ]}
            />
          </div>
          <ActiveFiltersStrip
            filters={[
              ...(search.trim() ? [{ label: `search · "${search.trim().slice(0, 20)}"`, onRemove: () => setSearch("") }] : []),
              ...(source !== "all" ? [{ label: `source · ${source}`, onRemove: () => setSource("all") }] : []),
              ...(type !== "all" ? [{ label: `type · ${type}`, onRemove: () => setType("all") }] : []),
              ...(sortKey !== "newest" ? [{ label: `sort · ${sortKey}`, onRemove: () => setSortKey("newest") }] : []),
            ]}
            onClearAll={() => { setSearch(""); setSource("all"); setType("all"); setSortKey("newest"); }}
          />

          {/* ── Source filter row ── */}
          <FilterChipRow<SourceKey>
            label="Source"
            keys={["all", "dump", "reflection", "situation", "decision", "retro"] as const}
            active={source}
            onChange={setSource}
            counts={
              counts
                ? {
                    all: counts.total,
                    dump: counts.bySource.dump ?? 0,
                    reflection: counts.bySource.reflection ?? 0,
                    situation: counts.bySource.situation ?? 0,
                    decision: counts.bySource.decision ?? 0,
                    retro: counts.bySource.retro ?? 0,
                  }
                : undefined
            }
            chipSize="md"
            ariaLabelSuffix="filter"
            emptyLabel="entries"
          />

          {/* ── Type filter row (only relevant for brain dumps) ── */}
          <FilterChipRow<TypeKey>
            label="Type"
            keys={["all", "raw", "thinking", "reasoning", "insight", "decision", "reflection", "planning", "venting"] as const}
            active={type}
            onChange={setType}
            counts={
              counts
                ? {
                    all: counts.total,
                    raw: counts.byType.raw ?? 0,
                    thinking: counts.byType.thinking ?? 0,
                    reasoning: counts.byType.reasoning ?? 0,
                    insight: counts.byType.insight ?? 0,
                    decision: counts.byType.decision ?? 0,
                    reflection: counts.byType.reflection ?? 0,
                    planning: counts.byType.planning ?? 0,
                    venting: counts.byType.venting ?? 0,
                  }
                : undefined
            }
            getMeta={(key) => (key === "all" ? null : TYPE_META[key as Exclude<TypeKey, "all">])}
            chipSize="sm"
            ariaLabelSuffix="type filter"
            emptyLabel="entries"
            hideZeroCount
          />

          {/* v10.0.30 — error banner. */}
          {error && (
            <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[12px] text-rose-200 flex items-center justify-between gap-3">
              <span className="font-mono text-[11px]">{error}</span>
              <button
                onClick={() => {
                  setError(null);
                  load();
                }}
                className="rounded border border-rose-500/40 px-2 py-1 text-[10px] hover:bg-rose-500/10"
              >
                retry
              </button>
            </div>
          )}

          {/* ── Feed ── */}
          {loading && entries.length === 0 ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <ShimmerSkeleton key={i} className="h-20 rounded-xl border border-zinc-800/40" />
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-(--gold)/20 bg-linear-to-b from-(--gold)/5 to-zinc-900/40">
              <NotebookPen size={24} className="text-(--gold)/60 mx-auto mb-3" />
              {q ? (
                <>
                  <p className="text-[13px] font-semibold text-(--text-secondary)">
                    No matches for &ldquo;{search}&rdquo;.
                  </p>
                  <p className="text-[11px] text-(--text-tertiary) mt-2 max-w-[380px] mx-auto">
                    {entries.length} entries loaded. Try different keywords, or{" "}
                    <button
                      onClick={() => setSearch("")}
                      className="text-(--gold) hover:underline"
                    >
                      clear search
                    </button>
                    .
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[13px] font-semibold text-(--text-secondary)">
                    No thoughts captured yet in this filter.
                  </p>
                  <p className="text-[11px] text-(--text-tertiary) mt-2 max-w-[380px] mx-auto">
                    Use <kbd className="font-mono text-[10px] px-1 rounded bg-zinc-800/80 border border-zinc-700/50">⌘⇧J</kbd> to capture anywhere, open{" "}
                    <span className="text-(--gold)">/chat?mode=flow</span> for a guided dump, or send a Telegram message.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {byDate.map(([date, dayEntries]) => (
                <div key={date}>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar size={11} className="text-(--text-tertiary)" />
                    <span className="text-[10px] font-display font-bold uppercase tracking-[0.22em] text-(--text-tertiary)">
                      {formatDay(date)}
                    </span>
                    <div className="h-px flex-1 bg-zinc-800/50" />
                    <span className="text-[9px] font-mono text-(--text-tertiary)">
                      {dayEntries.length} {dayEntries.length === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {dayEntries.map((entry, i) => (
                      <JournalEntryRow
                        key={entry.id}
                        entry={entry}
                        isExpanded={expandedId === entry.id}
                        onToggle={() =>
                          setExpandedId((curr) => (curr === entry.id ? null : entry.id))
                        }
                        delay={hasLoadedOnce ? 0 : i * 40}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "insights" && (
        <div className="space-y-5 animate-fade-in">
          <NicksJournalBrief />
          <TodaysPrompt />
          <JournalThreadsStrip />
          <ProofOfBecomingStrip />
          <JournalInsightsPreview />
          <ThreadRadar onThreadCreated={() => setThreadRefresh((n) => n + 1)} />
          <ThreadRail refreshSignal={threadRefresh} />
          <ThreadSuggestions
            refreshSignal={threadRefresh}
            onActioned={() => setThreadRefresh((n) => n + 1)}
          />
          <BrainSignalsChip />
        </div>
      )}

      {activeTab === "reflect" && (
        <div className="space-y-5 animate-fade-in">
          <MasteryContextDrawer
            surface="journal"
            label="Reflection signals"
            hint="learning velocity · weekly memoir"
          >
            <div className="space-y-4">
              <LearningVelocityTicker />
              <WeeklyMemoirBlock />
            </div>
          </MasteryContextDrawer>

          {meta && (
            <div className="rounded-xl border border-(--gold)/20 bg-linear-to-br from-(--gold)/4 to-transparent p-4 space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-(--gold)/80">
                    Metacognition
                  </span>
                  <span className="text-[10px] text-(--text-tertiary)">
                    · {meta.date}
                  </span>
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium tabular-nums",
                    meta.learningRate.trend === "accelerating" && "text-emerald-400",
                    meta.learningRate.trend === "steady" && "text-(--text-secondary)",
                    meta.learningRate.trend === "decelerating" && "text-amber-400",
                  )}
                >
                  {meta.learningRate.trend}
                </span>
              </div>

              {meta.selfAssessment && (
                <p className="text-[12.5px] leading-relaxed text-(--text-primary) italic">
                  &ldquo;{meta.selfAssessment}&rdquo;
                </p>
              )}

              <div className="flex items-center gap-3 pt-1 text-[11px] font-mono text-(--text-secondary)">
                <span className="text-[9px] uppercase tracking-[0.18em] text-(--text-tertiary)">
                  calibration
                </span>
                <span className="text-[15px] font-semibold tabular-nums text-(--text-primary)">
                  {Math.round(meta.predictionCalibration.calibrationScore * 100)}%
                </span>
              </div>

              {meta.weakSpots.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-(--text-tertiary) mr-1">
                    Weak spots
                  </span>
                  {meta.weakSpots.slice(0, 2).map((spot) => (
                    <Badge
                      key={spot.domain}
                      variant="outline"
                      className="text-[10px] border-amber-400/30 text-amber-300 bg-amber-400/4"
                    >
                      {spot.domain} · {spot.daysSinceLastLearning >= 999 ? "never" : `${spot.daysSinceLastLearning}d stale`}
                    </Badge>
                  ))}
                  {meta.weakSpots.length > 2 && (
                    <span
                      className="text-[10px] font-mono text-amber-400/60"
                      title={meta.weakSpots
                        .slice(2)
                        .map((s) => `${s.domain} (${s.daysSinceLastLearning >= 999 ? "never" : `${s.daysSinceLastLearning}d`})`)
                        .join(" · ")}
                    >
                      +{meta.weakSpots.length - 2} more
                    </span>
                  )}
                </div>
              )}

              {meta.stagnationAlert && (
                <div className="text-[11.5px] leading-relaxed text-red-300 border-l-2 border-red-400/40 pl-3 mt-2">
                  {meta.stagnationAlert}
                </div>
              )}
            </div>
          )}

          <div id="journal-reflect-composer">
            <ReflectComposer />
          </div>
        </div>
      )}
    </div>
  );
}

function formatDay(dateStr: string): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const y = yesterday.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (dateStr === today) return "Today";
  if (dateStr === y) return "Yesterday";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// ─── FilterChipRow ────────────────────────────────────────────────
// v10.0.530 kaizen · the source-row and type-row of /journal had
// near-identical structure: flex-wrap of aria-pressed toggle buttons
// with an inline AnimatedCounter. Wave-8 audit flagged the
// duplication. Extracted as a local generic primitive (file-local
// per uncle-bob single-responsibility — only 2 callers, both here,
// no need to expose at module boundary).
type ChipMeta = {
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  bg?: string;
  border?: string;
  color?: string;
} | null;

interface FilterChipRowProps<K extends string> {
  label: string;
  keys: readonly K[];
  active: K;
  onChange: (key: K) => void;
  counts?: Record<K, number>;
  /** Per-key visual metadata · returns null for "all" / unmapped keys. */
  getMeta?: (key: K) => ChipMeta;
  chipSize?: "sm" | "md";
  /** Suffix in the aria-label · e.g. "filter" → "dump filter, 3 entries". */
  ariaLabelSuffix?: string;
  /** Unit noun for the aria-label count · default "entries". */
  emptyLabel?: string;
  /** When true, hide the count badge if count === 0 (type-row behaviour). */
  hideZeroCount?: boolean;
}

function FilterChipRow<K extends string>({
  label,
  keys,
  active,
  onChange,
  counts,
  getMeta,
  chipSize = "md",
  ariaLabelSuffix = "filter",
  emptyLabel = "entries",
  hideZeroCount = false,
}: FilterChipRowProps<K>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-(--text-tertiary) mr-1">
        {label}
      </span>
      {keys.map((key) => {
        const isActive = active === key;
        const meta = getMeta?.(key) ?? null;
        const Icon = meta?.icon;
        const count = counts ? counts[key] ?? 0 : null;
        const showCount = count !== null && (!hideZeroCount || count > 0);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            // v10.0.529.21 a11y · aria-pressed lets screen readers
            // announce the active filter state on this toggle-style
            // chip. Visual gold border alone is insufficient signal.
            aria-pressed={isActive}
            aria-label={count !== null ? `${key} ${ariaLabelSuffix}, ${count} ${emptyLabel}` : String(key)}
            className={cn(
              "flex items-center gap-1 rounded-md font-bold uppercase tracking-wider border transition-all",
              chipSize === "md" ? "px-2.5 py-1 text-[10px]" : "px-2 py-1 text-[9px]",
              // 2026-05-24 · Wave R · iOS HIG 44pt tap target via
              // pointer-coarse media query · the chip's visual height
              // stays the same on desktop (mouse) but expands to 44px
              // on touch devices. Pre-fix the chips were ~20-24px tall ·
              // operator on iPhone had to thumb a 4-line-tall area to
              // reliably hit one. Tailwind v4 arbitrary variant syntax.
              "pointer-coarse:min-h-[44px]",
              isActive
                ? meta
                  ? `${meta.bg} ${meta.border} ${meta.color}`
                  : "bg-(--gold)/15 border-(--gold)/40 text-(--gold)"
                : meta
                ? "bg-transparent border-transparent text-zinc-600 hover:text-zinc-400"
                : "bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300"
            )}
          >
            {Icon && <Icon size={9} aria-hidden />}
            {key}
            {showCount && (
              // 2026-05-24 · Wave R · pre-fix every chip count animated
              // via <AnimatedCounter> · with 14 chips visible the whole
              // row ticked from 0 simultaneously on every page load /
              // re-fetch · classic "gpt-built" gratuitous motion. Plain
              // span is the editorial-minimalist choice · matches the
              // chip-count rendering on /settings + /tasks.
              <span className="text-[8px] font-mono opacity-70 tabular-nums" aria-hidden>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Wave S · feature-mining wire-ups · 2026-05-24
// ═══════════════════════════════════════════════════════════════════════
//
// Two inline components consuming the new journal-router procedures.
// Both are silent-by-default per kaizen · only render when there's
// signal worth surfacing. Extracted from the page body so the main
// component stays scannable.

/**
 * Wave S #7 · Learning-velocity ticker.
 *
 * Single line above the feed · gives the operator at-a-glance whether
 * the week is generative or just busy. Reads measureLearningVelocity
 * via tRPC · returns null on fetch failure or zero-signal week.
 */
function LearningVelocityTicker() {
  const { data } = trpc.journal.learningVelocity.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  if (!data) return null;
  // Silent when truly nothing happened this week · "0 entries · 0 new"
  // would just be noise. Threshold is intentionally low (any of the
  // three counters non-zero qualifies).
  const hasSignal =
    data.memoriesThisWeek > 0 ||
    data.newConnections > 0 ||
    data.contradictionsResolved > 0 ||
    data.wisdomPromotions > 0;
  if (!hasSignal) return null;
  const deltaSign = data.memoriesDelta > 0 ? "+" : "";
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono text-(--text-tertiary) py-1">
      <span className="font-bold uppercase tracking-[0.18em] text-(--text-secondary)">
        velocity
      </span>
      <span className="tabular-nums">
        {data.memoriesThisWeek} entries this week
        {data.memoriesDelta !== 0 && (
          <span
            className={cn(
              "ml-1",
              data.memoriesDelta > 0 ? "text-emerald-400/80" : "text-rose-400/70",
            )}
          >
            ({deltaSign}{data.memoriesDelta} vs last)
          </span>
        )}
      </span>
      {data.newConnections > 0 && (
        <span className="tabular-nums">· {data.newConnections} new connections</span>
      )}
      {data.contradictionsResolved > 0 && (
        <span className="tabular-nums">· {data.contradictionsResolved} contradictions resolved</span>
      )}
      {data.wisdomPromotions > 0 && (
        <span className="tabular-nums">· {data.wisdomPromotions} wisdom</span>
      )}
      <span className="ml-auto text-(--text-tertiary)/60">
        brain {data.healthScore}/100
      </span>
    </div>
  );
}

/**
 * Wave S #3 + #6 · Brain signals chip.
 *
 * Slim row showing the operator's emotional trajectory + drift
 * composite. Covers two feature-mining candidates with one read.
 * Silent when both signals are dormant.
 */
function BrainSignalsChip() {
  const { data } = trpc.journal.brainSignals.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  if (!data) return null;
  const { emotionalArc: arc, drift } = data;
  if (!arc && !drift) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-(--border-default) bg-(--bg-void)/40 px-3 py-2 text-[10px]">
      <span className="font-bold uppercase tracking-[0.22em] text-(--text-tertiary)">
        right now
      </span>
      {arc && (
        <>
          <span className="font-mono">
            <span className="text-(--text-tertiary)">trajectory ·</span>{" "}
            <span
              className={cn(
                "font-medium",
                arc.trajectory === "rising" && "text-emerald-300",
                arc.trajectory === "falling" && "text-rose-300",
                arc.trajectory === "volatile" && "text-amber-300",
                arc.trajectory === "stable" && "text-(--text-secondary)",
              )}
            >
              {arc.trajectory}
            </span>
          </span>
          {arc.dominantState && (
            <span className="font-mono text-(--text-secondary)">
              · {arc.dominantState.toLowerCase()}
            </span>
          )}
          {arc.stressDays > 0 && (
            <span className="font-mono text-amber-400/70">
              · {arc.stressDays} stress day{arc.stressDays === 1 ? "" : "s"}/7
            </span>
          )}
        </>
      )}
      {drift && (
        <>
          <span className="font-mono">
            <span className="text-(--text-tertiary)">drift ·</span>{" "}
            <span
              className={cn(
                "font-medium tabular-nums",
                drift.overallScore < 3 && "text-emerald-300",
                drift.overallScore >= 3 && drift.overallScore < 6 && "text-amber-300",
                drift.overallScore >= 6 && "text-rose-300",
              )}
            >
              {drift.overallScore.toFixed(1)}/10
            </span>
          </span>
          {drift.topConcern && (
            <span
              className="font-mono text-(--text-secondary) truncate max-w-[200px]"
              title={drift.topConcern}
            >
              · {drift.topConcern}
            </span>
          )}
        </>
      )}
      {arc?.intervention && (
        <span
          className="ml-auto truncate max-w-[280px] text-(--gold)/70 italic"
          title={arc.intervention}
        >
          → {arc.intervention.slice(0, 60)}
        </span>
      )}
    </div>
  );
}

/**
 * Journal-advancement item D (2026-06-10) · Proof of Becoming strip.
 *
 * The operator's evidence file, one line: how many entries the brain
 * decoded this week (vs last), how many landed on a goal, and which
 * life domains they prove. Every number is derived from real rows
 * (enrichedAt / linkStatus / extracted domains) — blank beats
 * fabricated, so a zero week renders nothing.
 */
function ProofOfBecomingStrip() {
  const { data } = trpc.journal.proofStack.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  if (!data || data.weekTotal === 0) return null;
  const delta = data.weekTotal - data.prevWeekTotal;
  const filed = data.becomingDomains.filter((d) => d.count > 0).length;
  return (
    <section
      className="rounded-lg border border-(--gold)/20 bg-(--gold)/3 px-3 py-2.5 space-y-2.5"
      aria-label="This week's proof stack — your evidence file"
    >
      {/* Trend header — kept from the original strip: total this week vs
          last, plus goal-linked count. Every number is from real rows. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        <span className="font-bold uppercase tracking-[0.22em] text-(--gold)/80">
          becoming
        </span>
        <span className="font-mono tabular-nums text-(--text-primary)">
          {data.weekTotal} proof{data.weekTotal === 1 ? "" : "s"} this week
          {delta !== 0 && (
            <span className={cn("ml-1", delta > 0 ? "text-emerald-400/80" : "text-rose-400/70")}>
              ({delta > 0 ? "+" : ""}
              {delta} vs last)
            </span>
          )}
        </span>
        {data.grounded > 0 && (
          <span className="font-mono tabular-nums text-emerald-300/80">
            · {data.grounded} goal-linked
          </span>
        )}
        <span className="ml-auto font-mono tabular-nums text-(--text-tertiary)">
          {filed}/{data.becomingDomains.length} domains
        </span>
      </div>

      {/* 10-domain identity grid — the operator's evidence file. Filed
          domains read as exhibits (gold count); empty domains stay visible
          and honest ("no proof logged"), never hidden. */}
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
        {data.becomingDomains.map((d) => {
          const hasProof = d.count > 0;
          return (
            <li
              key={d.key}
              className={cn(
                "flex flex-col gap-0.5 rounded-md border px-2.5 py-2 pointer-coarse:min-h-[44px]",
                hasProof
                  ? "border-(--gold)/35 bg-(--gold)/6"
                  : "border-(--border-default) bg-(--bg-raised)/60",
              )}
              title={
                hasProof
                  ? `${d.count} entr${d.count === 1 ? "y" : "ies"} of ${d.label.toLowerCase()} proof this week`
                  : `No ${d.label.toLowerCase()} proof logged this week`
              }
            >
              <span
                className={cn(
                  "text-[8.5px] font-bold uppercase tracking-[0.16em] leading-tight",
                  hasProof ? "text-(--gold)/85" : "text-(--text-tertiary)",
                )}
              >
                {d.label}
              </span>
              {hasProof ? (
                <span className="font-display text-[17px] font-bold tabular-nums leading-none text-(--text-primary)">
                  {d.count}
                  <span className="ml-1 text-[8.5px] font-mono font-normal uppercase tracking-wider text-(--text-tertiary)">
                    {d.count === 1 ? "entry" : "entries"}
                  </span>
                </span>
              ) : (
                <span className="text-[9px] font-mono italic leading-tight text-(--text-tertiary)/70">
                  no proof logged
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Wave S #5 · Weekly memoir block.
 *
 * Top 3 distilled wisdom / belief items from the last 7 days. The
 * nightly wisdom-distiller already produces these · this surface just
 * makes them visible without going to /brain. Silent when fewer than
 * 2 items (a 1-item "memoir" is just a row, not a memoir).
 */
function WeeklyMemoirBlock() {
  const { data } = trpc.journal.weeklyMemoirItems.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30 * 60 * 1000,
  });
  if (!data || data.length < 2) return null;
  return (
    <div className="rounded-xl border border-(--gold)/15 bg-(--gold)/2 p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-(--gold)/70">
          this week
        </span>
        <span className="text-[10px] text-(--text-tertiary)">
          · distilled from your last 7 days
        </span>
      </div>
      <ul className="space-y-1">
        {data.map((item) => (
          <li
            key={item.id}
            className="text-[11.5px] leading-relaxed text-(--text-primary)"
          >
            <span className="text-(--gold)/40 mr-1.5">·</span>
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

==================================================

## SOURCE: Repo Code: page.tsx
* **Path**: C:\Users\nourd\NOURCITY\apps\statenour\app\(mastery)\knowledge\page.tsx
* **Type**: repo_file

---

"use client";


// v10.0.31 — structured logger for knowledge-page errors.
const log = rootLogger.withSurface("knowledge/page");
// v10.0.443 · FilterChipBar replaces bare-Badge category row · brings
// 44px iOS HIG tap targets + aria-checked radiogroup. The `cn` import
// was dropped at the same time (its last consumer was the old chip).
// v10.0.485 · `cn` re-added for KnowledgeRefreshPanel (migrated from /pins).

// Phase ZZ (2026-05-19 AM) · authedFetch reads migrated to trpc · 3
// sites (list · open · search).
// Phase straggler-pages (2026-05-22) · the last call-site — the
// /api/admin/knowledge-refresh POST in KnowledgeRefreshPanel — is
// migrated onto `operator.knowledgeRefresh`. Zero use-authed-fetch
// imports remain. Legacy REST route stays mounted.
interface KFile {
  name: string;
  category: string;
  path: string;
  size: number;
  modified: string;
}

interface SearchResult {
  name: string;
  category: string;
  path: string;
  match_count: number;
  matches: string[];
}

interface RefreshSubsystem {
  id: string;
  ok: boolean;
  status: number;
  durationMs: number;
  summary: string;
}

export default function KnowledgePage() {
  const [files, setFiles] = useState<KFile[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [filterCat, setFilterCat] = useState("all");
  // v10.0.440 · sort key · 5 modes
  type KnowledgeSort = "name" | "newest" | "oldest" | "largest" | "smallest";
  const [sortKey, setSortKey] = useState<KnowledgeSort>(() => {
    if (typeof window === "undefined") return "name";
    const saved = window.localStorage.getItem("knowledge:sortKey");
    const valid: KnowledgeSort[] = ["name", "newest", "oldest", "largest", "smallest"];
    return saved && valid.includes(saved as KnowledgeSort) ? (saved as KnowledgeSort) : "name";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("knowledge:sortKey", sortKey);
  }, [sortKey]);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  // v10 B.1 FIND-04 · res.ok guard before .json(). Without this, an
  // API 500 would call .json() on a potentially non-JSON error body
  // (Vercel's "Internal Server Error" is plain text), throw silently
  // into .catch, and leave the page stuck in `loading=false` with
  // zero files — indistinguishable from "knowledge base is empty."
  // v10.0.31 — wrapped in useCallback so the setInterval below
  // captures a stable reference (prior plain function form was a
  // latent correctness risk: each render created a fresh closure).
  // Phase ZZ · tRPC migration · same useCallback shape preserves the
  // setInterval + event-bus refresh hooks below.
  const utils = trpc.useUtils();
  const loadFiles = useCallback(() => {
    utils.operator.knowledgeFiles
      .fetch()
      .then((d) => {
        setFiles((d.files ?? []) as typeof files);
        setCategories(d.categories ?? []);
        setFetchedAt(new Date().toISOString());
      })
      .catch((err) => {
        log.warn("loadFiles_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [utils]);

  useEffect(() => {
    loadFiles();
    const i = setInterval(loadFiles, 60000);
    return () => clearInterval(i);
  }, [loadFiles]);

  // v10.0.529.88 · Wave 32 · instant refresh when chat tool
  // syncKnowledge fires (TOOL_DOMAIN_MAP targets "knowledge"). Pre-
  // Wave-32 operator triggered a sync via chat and waited up to 60s
  // for the poll · stale Drive corpus visible the whole time.
  useEffect(() => {
    return onDataChanged(["knowledge"], () => loadFiles());
  }, [loadFiles]);

  // v10.0.31 — abort signal so user clicks (open file → search →
  // open another file) don't pile up overlapping fetches that
  // resolve out of order, leaving stale results visible alongside
  // a newly-opened file.
  const inflightRef = useRef<AbortController | null>(null);

  async function openFile(path: string) {
    if (inflightRef.current) inflightRef.current.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      const data = await utils.operator.knowledgeFile.fetch({ path });
      if (ctrl.signal.aborted) return;
      setContent(data.content ?? "");
      setSelectedFile(path);
      setResults([]);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      log.warn("openFile_failed", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function search() {
    if (!query.trim()) return;
    if (inflightRef.current) inflightRef.current.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      const data = await utils.operator.knowledgeSearch.fetch({ q: query });
      if (ctrl.signal.aborted) return;
      setResults((data.results ?? []) as typeof results);
      setSelectedFile(null);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      log.warn("search_failed", {
        query: query.slice(0, 60),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const filtered = (filterCat === "all" ? files : files.filter((f) => f.category === filterCat));
  const sortedFiltered = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "newest":
        return new Date(b.modified).getTime() - new Date(a.modified).getTime();
      case "oldest":
        return new Date(a.modified).getTime() - new Date(b.modified).getTime();
      case "largest":
        return (b.size ?? 0) - (a.size ?? 0);
      case "smallest":
        return (a.size ?? 0) - (b.size ?? 0);
      case "name":
      default:
        return a.name.localeCompare(b.name);
    }
  });

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map((i) => <div key={i} className="skeleton h-16 w-full" />)}</div>;
  }

  // File viewer
  if (selectedFile) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedFile(null)}>
            <ArrowLeft size={16} />
          </Button>
          <span className="text-sm text-[var(--nour-text-secondary)] truncate">{selectedFile}</span>
        </div>
        <Card className="p-4 bg-[var(--nour-surface)] border-[var(--nour-border)]">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--nour-text)]">{content}</pre>
        </Card>
      </div>
    );
  }

  return (
    <StandardPage
      eyebrow="Mastery"
      title="Knowledge"
      rhythm="loose"
      actions={
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={fetchedAt}
            source="fs · /knowledge"
            onReload={loadFiles}
          />
          <Badge variant="outline" className="font-mono"><AnimatedCounter value={files.length} /> files</Badge>
        </div>
      }
    >
      <PageNick page="knowledge" />

      {/* Knowledge corpus refresh · migrated from /pins in v10.0.485
          (audit Wave 9 · zero shared state with pins · belongs here) */}
      <KnowledgeRefreshPanel />

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nour-text-secondary)]" />
          <Input
            placeholder="Search knowledge base..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            className="pl-9 bg-[var(--nour-surface)] border-[var(--nour-border)]"
          />
        </div>
        <Button onClick={search} className="bg-[var(--nour-gold)] text-[var(--text-primary)] hover:bg-[var(--nour-gold)]/90">
          Search
        </Button>
      </div>

      {/* v10.0.443 · category filters · migrated from bare Badge to
          FilterChipBar · brings 44px iOS HIG mobile tap targets +
          aria-checked radiogroup semantics + uppercase font-mono
          parity with the rest of the OS · ux-audit + mobile-design
          skills applied. */}
      <div className="flex gap-2 items-start flex-wrap">
        <FilterChipBar
          value={filterCat}
          onChange={setFilterCat}
          options={[
            { value: "all", label: "all" },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
          ariaLabel="Filter knowledge categories"
        />
        {/* v10.0.440 · sort dropdown · 5 modes */}
        <div className="ml-auto">
          <SortDropdown<KnowledgeSort>
            value={sortKey}
            onChange={setSortKey}
            defaultValue="name"
            ariaLabel="Sort knowledge files"
            options={[
              { value: "name", label: "name · A→Z" },
              { value: "newest", label: "modified · newest" },
              { value: "oldest", label: "modified · oldest" },
              { value: "largest", label: "size · largest" },
              { value: "smallest", label: "size · smallest" },
            ]}
          />
        </div>
      </div>

      {/* Search Results */}
      {results.length > 0 && (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--nour-text-secondary)] mb-3">
            Results (<AnimatedCounter value={results.length} />)
          </h2>
          <div className="space-y-2 stagger-in">
            {results.map((r) => (
              <Card
                /* v10.0.31 — was key={i} (array index) which breaks
                   reconciliation on result reorder/partial update.
                   path is unique per result. */
                key={r.path}
                className="p-3 bg-[var(--nour-surface)] border-[var(--nour-border)] cursor-pointer hover:border-[var(--nour-gold)] transition-colors glow-on-hover"
                onClick={() => openFile(r.path)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileText size={12} className="text-[var(--nour-text-secondary)]" />
                  <span className="text-sm font-medium">{r.name}</span>
                  <Badge variant="outline" className="text-[10px] h-4">{r.category}</Badge>
                  <span className="text-[10px] text-[var(--nour-text-secondary)] ml-auto"><AnimatedCounter value={r.match_count} /> matches</span>
                </div>
                {r.matches[0] && (
                  <p className="text-xs text-[var(--nour-text-secondary)] line-clamp-2 font-mono">{r.matches[0]}</p>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* File Grid */}
      {results.length === 0 && (
        <section>
          {sortedFiltered.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={filterCat === "all" ? "No knowledge files yet" : `No files in "${filterCat}"`}
              why={filterCat === "all" ? "The corpus is empty or hasn't synced yet." : "No files match this category filter."}
              unlock={filterCat === "all" ? "Run a corpus refresh above, or sync your sources." : "Clear the filter to see all files."}
            />
          ) : (
          <div className="grid grid-cols-1 gap-2 stagger-in">
            {sortedFiltered.map((f) => (
              <Card
                key={f.path}
                className="p-3 bg-[var(--nour-surface)] border-[var(--nour-border)] cursor-pointer hover:border-[var(--nour-text-secondary)] transition-colors glow-on-hover"
                onClick={() => openFile(f.path)}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen size={12} className="text-[var(--nour-text-secondary)] shrink-0" />
                  <span className="text-sm truncate flex-1">{f.name}</span>
                  <Badge variant="outline" className="text-[10px] h-4 shrink-0">{f.category}</Badge>
                  <span className="text-[10px] text-[var(--nour-text-secondary)] font-mono shrink-0">{(f.size / 1024).toFixed(1)}K</span>
                </div>
              </Card>
            ))}
          </div>
          )}
        </section>
      )}
    </StandardPage>
  );
}

function KnowledgeRefreshPanel() {
  const [results, setResults] = useState<RefreshSubsystem[] | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Phase straggler-pages · the knowledge-corpus refresh is a tRPC
  // mutation now · `isPending` replaces the page-local `refreshing`
  // flag. The procedure rejects (BAD_REQUEST / INTERNAL_SERVER_ERROR)
  // on the no-targets / env-missing cases · the catch surfaces the
  // sanitized message, same as the old `res.ok` guard.
  const refreshMutation = trpc.operator.knowledgeRefresh.useMutation();
  const refreshing = refreshMutation.isPending;

  const runRefresh = async () => {
    setRefreshError(null);
    try {
      const json = await refreshMutation.mutateAsync();
      setResults(json.results);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Panel>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-white flex items-center gap-1">
          <Sparkles className="h-4 w-4" /> Knowledge corpus refresh
        </h2>
        <button
          onClick={runRefresh}
          disabled={refreshing}
          className={cn(
            "rounded-md border px-3 py-1.5 text-xs font-medium transition",
            refreshing
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15",
          )}
        >
          {refreshing ? "refreshing…" : "refresh now"}
        </button>
      </div>
      <p className="text-[10px] text-zinc-500 mb-2">
        Pulls fresh data from all sources (Industry RSS, ALG, Insights, Gmail, Calendar, Drive, Knowledge sync, Embeddings) and hot-flushes the prompt cache. ~60s total.
      </p>
      {refreshError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-300 mb-2">
          {refreshError}
        </div>
      )}
      {results && (
        <div className="space-y-1">
          {results.map((r) => (
            <div
              key={r.id}
              className={cn(
                "flex items-center justify-between rounded-md border px-2 py-1 text-xs",
                r.ok
                  ? "border-emerald-500/20 bg-emerald-500/[0.03] text-emerald-200"
                  : "border-rose-500/30 bg-rose-500/[0.05] text-rose-200",
              )}
            >
              <span className="font-mono">{r.id}</span>
              <span className="text-[10px] opacity-75 truncate max-w-[55%]">{r.summary}</span>
              <span className="text-[10px] tabular-nums opacity-50">{r.durationMs}ms</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

==================================================

## SOURCE: Repo Code: layout.tsx
* **Path**: C:\Users\nourd\NOURCITY\apps\statenour\app\(mastery)\layout.tsx
* **Type**: repo_file

---

// Phase H.2 (2026-05-18 PM) · DeepModeNudge · global watcher that
// surfaces a tiny gold chip when the focused input matches the
// reasoning classifier at tier ≥ deep · one-tap to /reason pre-filled.
// Non-invasive · listens to document focus/input events · self-hides
// when nothing matches. Lives in layout so it monitors every mastery
// surface (chat textarea, task quick-add, journal, etc).
// Phase J (2026-05-18 PM) · TRPCProvider · wraps every mastery surface
// so any component can call trpc.X.useQuery / useMutation with end-
// to-end type safety. Legacy useAuthedFetch calls keep working ·
// gradual migration · no big-bang cutover.
// Phase N.4 (2026-05-18 PM) · MegaConfirmHost · accessible focus-trap
// Dialog for mega-tier cost confirms · replaces window.confirm.
// Mounted once at layout root · components call megaConfirm() and
// get a Promise<boolean>.

// ── Render mode (audit-2026-06-21 CSP follow-up) ──────────────────────────
// MUST be force-dynamic. middleware.ts stamps a per-request CSP nonce onto
// every framework <script> via the request headers — but that only happens on
// a live render. A statically prerendered (mastery) page ships with NO nonce,
// so the runtime `'strict-dynamic'` CSP header blocks ALL of its scripts →
// blank/skeleton page in every browser (Chrome, Safari, desktop, phone).
// Dynamic rendering = a live nonce that matches the header. Mirrors
// app/auth/sign-in/page.tsx, which already does this and works.
export const dynamic = "force-dynamic";

export default function MasteryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TRPCProvider>
    <NourStateProvider>
      {/* A11y · WCAG 2.4.1 Bypass Blocks · first focusable element in the
          shell. Keyboard / screen-reader users jump past the ambient HUD,
          tickers, and bottom nav straight to <main id="main-content">.
          Visually hidden until focused (sr-only → not-sr-only on focus). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-[var(--bg-elevated)] focus:px-4 focus:py-2 focus:text-[var(--text-primary)] focus:outline focus:outline-2 focus:outline-[var(--glass-border)]"
      >
        Skip to main content
      </a>
      <NeuralBackground />
      <PageTracker />
      {/* v10.0.529.91 · Wave 35 · invisible · watches usePathname +
          URL hash to extract the entity ID the operator is viewing ·
          writes localStorage + fires nour:page-context-changed event ·
          chat reads on mount + on event so "grade this decision" /
          "act on this reflection" resolve without needing a chip tap. */}
      <PageContextBridge />
      <SwipeNavigation />
      <KeyboardShortcuts />
      {/* v7.4 · Apr 29 · NotificationCenter (bell) RETIRED. Per Nour:
          "the whole free-floating bell thing is annoying — let's just
          have two persistent tickers feed me everything." Priority
          alerts now flow through the GlobalTopTicker; ambient brain
          signals flow through the BottomPulseTicker. /system/health
          remains the canonical surface for true incident triage. */}
      {/* Session-expiry pre-warning — polls /api/auth/session and
          surfaces a fixed banner 10min before expiry so mid-capture
          401s + bounce-to-sign-in don't eat work in progress. Silent
          outside the warn window. */}
      <SessionExpiryBanner />
      {/* AmbientAura (#17) — reads currentState and applies state-aura +
          state-aura-<state> classes on a wrapper around EVERY mastery
          page. Previously only /chat and /command had the ambient
          background glow. Now /settings, /tasks, /journal, /system/*,
          /brain, etc all react to the state change the same way. */}
      {/* Apr 19 · Dropped `min-h-screen` from <main>. AmbientAura's
          wrapper already enforces min-h-screen for the ambient glow, so
          a second one here just created phantom bottom whitespace on
          short pages (e.g. HQ/Ultron when content is < 100vh). */}
      <AmbientAura>
        {/* May 02 · pb fix · BottomPulseTicker is fixed bottom-0 (h-5 +
            border = 21px). Pre-fix, md:pb-0 left desktop content sliding
            under the ticker. md:pb-8 (32px) clears the ticker with a
            touch of breathing room; mobile keeps pb-20 (80px) to clear
            the orb stack too. */}
        <main id="main-content" className="pb-24">
          <div className="feed py-4 md:py-6 page-enter">
            {/* v11.1 · ErrorBoundary wraps the page content (not the
                chrome). A broken panel still lets the orb, nav, and
                notifications work. The boundary auto-reports to
                /api/errors → visible in /system/errors. */}
            <ErrorBoundary name="mastery.page">
              {children}
            </ErrorBoundary>
          </div>
        </main>
      </AmbientAura>
      {/* 2026-06-18 · IA reorg Phase 4 · the FloatingHome orb is RETIRED as
          primary nav. BottomTabBar (4 daily tabs Home/Missions/Journal/Stats
          + a "More" slot) is the fixed primary surface; MoreSheet is the
          verb-grouped launcher behind "More" with the ⌘K Search tap-trigger.
          The ambient BottomPulseTicker now rides inside BottomTabBar so the
          whole bottom chrome is one stacked, safe-area-aware unit. */}
      <BottomTabBar />
      <MoreSheet />
      {/* Phase H.2 · global deep-mode hint · sees focused input, runs
          quick client classifier, chip appears bottom-right when
          verdict ≥ deep. One-tap to /reason. */}
      <DeepModeNudge />
      {/* N.4 · global host for the focus-trap confirm Dialog · listens
          for megaConfirm() calls + renders the modal. */}
      <MegaConfirmHost />
      {/* Global brain-dump capture — Cmd/Ctrl+Shift+J from anywhere. */}
      <BrainDumpModal />
    </NourStateProvider>
    </TRPCProvider>
  );
}

==================================================

## SOURCE: Repo Code: page.tsx
* **Path**: C:\Users\nourd\NOURCITY\apps\statenour\app\(mastery)\market\page.tsx
* **Type**: repo_file

---

"use client";

/**
 * /market · Wave 2 surface merge · former /seo + /radar.
 *
 * Two former pages, both nickstire-bridge projections, collapsed into one
 * tabbed surface via the canonical PageTabs primitive:
 *   · Search · GSC search performance (clicks/impressions/queries/pages)
 *   · Radar  · brand + competitive signal (master_report projection)
 *
 * Each former page body moved verbatim into components/market/*-tab.tsx
 * (StandardPage wrapper → fragment, description relocated inline). Old
 * routes 301 → /market?tab=search · /market?tab=radar (next.config.ts).
 */


export default function MarketPage() {
  return (
    <StandardPage
      eyebrow="NOUR OS"
      title="market intel"
      description="Search performance + competitive/brand radar."
    >
      <PageTabs
        defaultKey="search"
        tabs={[
          { key: "search", label: "Search", render: () => <SearchTab /> },
          { key: "radar", label: "Radar", render: () => <RadarTab /> },
        ]}
      />
    </StandardPage>
  );
}

==================================================

## SOURCE: Repo Code: page.tsx
* **Path**: C:\Users\nourd\NOURCITY\apps\statenour\app\(mastery)\missions\page.tsx
* **Type**: repo_file

---

"use client";

/**
 * /missions · Wave AA · 2026-05-28 · the new top-level execution surface.
 *
 * Replaces the 1457-LOC /tasks page with a mission-led IA · missions are
 * the rows, tasks unfold inside each card. Operator's request (Wave AA
 * brainstorm): "change the task page to missions and make the missions
 * lead and the to do list feeds into the missions."
 *
 * What this page IS:
 *   · MissionsQuickAdd at top · single capture input
 *   · MissionFeed · grouped mission cards with inline tasks
 *   · CoachEventBanner · Nick-noticed events (kaizen-B kept)
 *   · NickSidePane FAB · Nick chat one tap away (kaizen-B kept)
 *   · OmniCaptureModal · ⌘K omni-capture (kaizen-B kept)
 *
 * What this page IS NOT (deleted from old /tasks):
 *   · KommandoShell pill nav (TODAY · GOALS · TRENDS · CAPTURE)
 *   · "first move wins the day" smart headline
 *   · `@dania · daily: ... · ... by fri · @health · /30m` ghost hint
 *   · TaskFilters band · SortDropdown · ActiveFiltersStrip
 *   · MoveFrame 3-card HUD (mission cards surface next move inside)
 *   · MissionScoreboard widget (the page IS the scoreboard)
 *   · IntelPanel drawer with 6 children (Phase 4 will telemetry-prune)
 *
 * Phase 1A scope: layout + redirect + data wire-up. Phase 1B adds the
 * AI auto-classify of new tasks → missions. Phase 2 layers Nick's pick
 * + morning brief + auto-decompose. Phase 3 adds retro capture +
 * complete-mission cascade. Phase 4 ships telemetry instrumentation
 * for the data-driven prune.
 */


type KindFilter = "all" | "ONCE" | "DAILY" | "PROMISE";

const log = rootLogger.withSurface("missions/page");

export default function MissionsPage() {
  return (
    <Suspense fallback={<MissionsPageSkeleton />}>
      <MissionsPageInner />
    </Suspense>
  );
}

function MissionsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskIdParam = searchParams.get("taskId");

  const utils = trpc.useUtils();
  const tasksQuery = trpc.task.list.useQuery(
    {},
    { refetchOnWindowFocus: false },
  );
  const missionsQuery = trpc.task.missions.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const healthQuery = trpc.system.healthSummary.useQuery(undefined, {
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });
  const statsQuery = trpc.operator.characterSheet.useQuery(undefined, {
    staleTime: 60_000,
  });

  // wave-AA-audit · derived arrays wrapped in useMemo so the useCallback
  // dependencies below stay stable across renders. Pre-fix, the bare
  // `(data ?? []) as T[]` recreated a new array reference every render,
  // which made every handler recompile on every parent state change —
  // breaking the React.memo at child render sites + producing the
  // "could make dependencies change on every render" warnings.
  const tasks = useMemo<Task[]>(
    () => (tasksQuery.data ?? []) as Task[],
    [tasksQuery.data],
  );
  const missions = useMemo<Project[]>(
    () => (missionsQuery.data ?? []) as Project[],
    [missionsQuery.data],
  );

  const taskDetailQuery = trpc.task.byId.useQuery(
    { id: taskIdParam ?? "" },
    { enabled: !!taskIdParam && !tasksQuery.isLoading && !tasks.some((t) => t.id === taskIdParam) }
  );

  const createTask = trpc.task.create.useMutation();
  const updateTask = trpc.task.update.useMutation();
  // WEEKLY completion routes through the unified checkTask service (it
  // lazy-loads recurringDays + computes the next scheduled weekday, which
  // the client doesn't carry). See handleCompleteTask.
  const checkTaskMut = trpc.task.check.useMutation();
  const deleteTaskMut = trpc.task.delete.useMutation();
  const createMission = trpc.task.createMission.useMutation();
  // Wave AJ · 2026-05-28 · ↑/↓ reorder mutations · server resolves the
  // swap math + ranks · client just calls (id, direction) + refetches.
  const reorderMissionMut = trpc.task.reorderMission.useMutation();
  const reorderTaskMut = trpc.task.reorderTask.useMutation();
  const decomposeTask = trpc.task.decompose.useMutation();

  // Telemetry · Phase 4 · mark surface-mount + capture mutation events
  // so the 2-week prune analysis has signal. Silent no-op when telemetry
  // is disabled (offline / dev).
  const telemetry = useMissionSurfaceTelemetry("missions");

  // Phase 3 · retro modal state · opens when operator completes a
  // mission. Persists the just-completed mission id + title so the modal
  // can render its prompt + dispatch the retro capture.
  const [retroState, setRetroState] = useState<{
    missionId: string;
    title: string;
  } | null>(null);

  // Dopamine loop · level-up modal state · triggered when a task
  // completion pushes the operator's overall XP past a level boundary.
  const [levelUpState, setLevelUpState] = useState<LevelUpPayload | null>(null);

  // Dopamine loop · floating XP particles state
  const [xpParticle, setXpParticle] = useState<{ xp: number; key: number }>({ xp: 0, key: 0 });

  // wave-AB.c · CRUD drawer state · mission edit (and create) + task edit.
  const [missionEditOpen, setMissionEditOpen] = useState(false);
  const [missionEditId, setMissionEditId] = useState<string | null>(null);
  const [missionEditInitial, setMissionEditInitial] = useState<
    React.ComponentProps<typeof MissionEditDrawer>["initial"]
  >(undefined);
  const [taskEditOpen, setTaskEditOpen] = useState(false);
  const [taskEditTarget, setTaskEditTarget] = useState<Task | null>(null);

  // Execution Mode state & selectors
  const [executionModeActive, setExecutionModeActive] = useState(false);

  // ── Search & Filter State ──
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [addingDomain, setAddingDomain] = useState(false);
  const [newDomainInput, setNewDomainInput] = useState("");
  const [filterEditMode, setFilterEditMode] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);

  // Custom domains hook
  const { customDomains, setCustomDomains } = useCustomDomains();

  // Queue Next focused task ID state
  const [queuedTaskId, setQueuedTaskId] = useState<string | null>(null);

  const clearTaskIdParam = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("taskId");
    const newUrl = params.toString() ? `/missions?${params.toString()}` : "/missions";
    router.replace(newUrl, { scroll: false });
  }, [router]);

  // Handle deep-linked task from query params
  useEffect(() => {
    if (taskIdParam) {
      if (tasks.length > 0) {
        const localTask = tasks.find((t) => t.id === taskIdParam);
        if (localTask) {
          setTaskEditTarget(localTask);
          setTaskEditOpen(true);
          clearTaskIdParam();
          return;
        }
      }

      if (taskDetailQuery.data) {
        setTaskEditTarget(taskDetailQuery.data as Task);
        setTaskEditOpen(true);
        clearTaskIdParam();
      } else if (taskDetailQuery.isSuccess && !taskDetailQuery.data) {
        toast.error("Linked task not found.");
        clearTaskIdParam();
      } else if (taskDetailQuery.isError) {
        toast.error("Failed to load linked task.");
        clearTaskIdParam();
      }
    }
  }, [taskIdParam, tasks, taskDetailQuery.data, taskDetailQuery.isSuccess, taskDetailQuery.isError, clearTaskIdParam]);

  // Memoized selector for the focused task in Execution Mode
  const focusedTask = useMemo(() => {
    // 1. First choice: a task that is currently in "DOING" status
    const doingTask = tasks.find((t) => t.status === "DOING");
    if (doingTask) return doingTask;

    // 1.5 Second choice: a task queued by the operator (Queue next)
    if (queuedTaskId) {
      const queuedTask = tasks.find(
        (t) =>
          t.id === queuedTaskId &&
          t.status !== "DONE" &&
          t.status !== "WAITING" &&
          t.status !== "ARCHIVED"
      );
      if (queuedTask) return queuedTask;
    }

    // We only care about open (non-DONE, non-WAITING, non-ARCHIVED) tasks for focus recommendations
    const openTasks = tasks.filter((t) => t.status !== "DONE" && t.status !== "WAITING" && t.status !== "ARCHIVED");
    if (openTasks.length === 0) {
      // Fallback to any tasks that are not DONE or ARCHIVED if nothing else
      const anyNotDone = tasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED");
      if (anyNotDone.length > 0) return anyNotDone[0];
      return null;
    }

    // Sort candidate open tasks using the new multi-factor priority: Overdue > Due Date > autoPriority > oldest
    const now = Date.now();
    const sortedOpen = [...openTasks].sort((a, b) => {
      const isOverdueA = a.dueDate ? new Date(a.dueDate).getTime() < now : false;
      const isOverdueB = b.dueDate ? new Date(b.dueDate).getTime() < now : false;

      if (isOverdueA !== isOverdueB) {
        return isOverdueA ? -1 : 1;
      }
      if (isOverdueA && isOverdueB) {
        const timeA = new Date(a.dueDate!).getTime();
        const timeB = new Date(b.dueDate!).getTime();
        if (timeA !== timeB) return timeA - timeB;
      }

      const hasDueA = !!a.dueDate;
      const hasDueB = !!b.dueDate;
      if (hasDueA !== hasDueB) {
        return hasDueA ? -1 : 1;
      }
      if (hasDueA && hasDueB) {
        const timeA = new Date(a.dueDate!).getTime();
        const timeB = new Date(b.dueDate!).getTime();
        if (timeA !== timeB) return timeA - timeB;
      }

      const priA = a.autoPriority ?? Infinity;
      const priB = b.autoPriority ?? Infinity;
      if (priA !== priB) {
        return priA - priB;
      }

      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });

    return sortedOpen[0] || null;
  }, [tasks, queuedTaskId]);

  const focusedTaskMission = useMemo(() => {
    if (!focusedTask || !focusedTask.missionId) return null;
    return missions.find((m) => m.id === focusedTask.missionId) || null;
  }, [focusedTask, missions]);

  // ── Filtered Tasks & Missions ──
  const filteredTasks = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return tasks.filter((t) => {
      const mission = missions.find((m) => m.id === t.missionId);
      const missionTitle = mission?.title.toLowerCase() || t.mission?.title.toLowerCase() || "";
      const domain = mission?.domain?.toLowerCase() || t.mission?.domain?.toLowerCase() || "other";

      if (query) {
        const matchesTitle = t.title.toLowerCase().includes(query);
        const matchesMission = missionTitle.includes(query);
        if (!matchesTitle && !matchesMission) return false;
      }

      if (kindFilter !== "all" && t.loopKind !== kindFilter) return false;

      if (domainFilter) {
        if (domain !== domainFilter.toLowerCase()) return false;
      }

      return true;
    });
  }, [tasks, missions, searchQuery, kindFilter, domainFilter]);

  const filteredMissions = useMemo(() => {
    const hasActiveFilter = !!(searchQuery.trim() || domainFilter || kindFilter !== "all");
    if (!hasActiveFilter) return missions;

    return missions.filter((m) => {
      if (m.status !== "ACTIVE" || !isUserProject(m)) return false;

      if (domainFilter && m.domain?.toLowerCase() !== domainFilter.toLowerCase()) {
        return false;
      }

      const query = searchQuery.toLowerCase().trim();
      const missionTasks = tasks.filter((t) => t.missionId === m.id);

      const missionMatchesSearch = !query || m.title.toLowerCase().includes(query);

      const hasMatchingTask = missionTasks.some((t) => {
        if (query && !t.title.toLowerCase().includes(query)) return false;
        if (kindFilter !== "all" && t.loopKind !== kindFilter) return false;
        return true;
      });

      return missionMatchesSearch || hasMatchingTask;
    });
  }, [missions, tasks, searchQuery, domainFilter, kindFilter]);

  // ── Filter helper counts ──
  const activeTasks = useMemo(() => tasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED"), [tasks]);
  const onceCount = useMemo(() => activeTasks.filter((t) => !t.loopKind || t.loopKind === "ONCE").length, [activeTasks]);
  const dailyCount = useMemo(() => activeTasks.filter((t) => t.loopKind === "DAILY").length, [activeTasks]);
  const promiseCount = useMemo(() => activeTasks.filter((t) => t.loopKind === "PROMISE").length, [activeTasks]);
  const activeCount = activeTasks.length;

  const activeDomains = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of activeTasks) {
      const mission = missions.find((m) => m.id === t.missionId);
      const d = mission?.domain?.toLowerCase() || t.mission?.domain?.toLowerCase() || "other";
      counts[d] = (counts[d] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [activeTasks, missions]);

  // ── Hidden High-Risk Detection ──
  const visibleTaskIds = useMemo(() => {
    const set = new Set<string>();
    if (executionModeActive) {
      if (focusedTask) {
        set.add(focusedTask.id);
      }
    } else {
      for (const t of filteredTasks) {
        set.add(t.id);
      }
    }
    return set;
  }, [executionModeActive, focusedTask, filteredTasks]);

  const filtersActive = !!(searchQuery.trim() || domainFilter || kindFilter !== "all");
  const filterKey = `${searchQuery}-${domainFilter}-${kindFilter}-${executionModeActive}`;

  const hiddenRiskSummary = useMemo(() => {
    return computeHiddenRiskSummary({
      allTasks: tasks,
      visibleTaskIds,
      filtersActive,
      executionModeActive,
      now: new Date(),
      searchQuery,
      kindFilter,
      domainFilter,
      missions,
    });
  }, [tasks, visibleTaskIds, filtersActive, executionModeActive, searchQuery, kindFilter, domainFilter, missions]);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setDomainFilter(null);
    setKindFilter("all");
  }, []);

  const handleQueueNext = useCallback((taskId: string) => {
    setQueuedTaskId(taskId);
    const task = tasks.find(t => t.id === taskId);
    toast.success(`Queued “${task?.title || "task"}” next in Execution Mode.`);
  }, [tasks]);

  // ── Mutation wrappers · invalidate task + mission queries on success ──
  const refetchAll = useCallback(async () => {
    await Promise.all([
      utils.task.list.invalidate(),
      utils.task.missions.invalidate(),
      utils.operator.characterSheet.invalidate(),
    ]);
  }, [utils]);

  const handleAddTask = useCallback(
    async ({ title, missionId }: { title: string; missionId: string }) => {
      if (isAddingTask) return;
      setIsAddingTask(true);
      try {
        telemetry.event("addTask", { missionId, source: "card" });
        await createTask.mutateAsync({
          title,
          missionId: missionId === "inbox" ? null : missionId,
          status: "READY",
          originSource: "missions-page:card-add",
        });
        await refetchAll();
      } catch (err) {
        log.error("addTask_failed", { err });
        toast.error("Could not add task. Try again.");
      } finally {
        setIsAddingTask(false);
      }
    },
    [createTask, refetchAll, telemetry, isAddingTask],
  );

  const handleCompleteTask = useCallback(
    async (id: string) => {
      const task = tasks.find((t) => t.id === id);
      const wasOpen = task && task.status !== "DONE";
      // Wave AL · 2026-05-28 · recurring tasks · DAILY loopKind tasks
      // never reach DONE forever · they're a habit, not a one-shot.
      // On complete:
      //   · streakCount++
      //   · lastCompletedAt = now
      //   · status = WAITING + snoozedUntil = tomorrow 00:00 local
      // The existing task-resurface cron auto-flips WAITING→READY
      // when snoozedUntil ≤ now · the task reappears tomorrow.
      const loopKind = (task as unknown as { loopKind?: string } | undefined)
        ?.loopKind;
      const isDaily = loopKind === "DAILY";
      const isWeekly = loopKind === "WEEKLY";
      const isRecurring = isDaily || isWeekly;
      let xpAdded = 0;
      try {
        telemetry.event("completeTask", { taskId: id, isDaily });
        if (isDaily) {
          const tomorrow = new Date();
          tomorrow.setHours(0, 0, 0, 0);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const currentStreak =
            (task as unknown as { streakCount?: number } | undefined)
              ?.streakCount ?? 0;
          const res = await updateTask.mutateAsync({
            id,
            fields: {
              status: "WAITING",
              snoozedUntil: tomorrow.toISOString(),
              lastCompletedAt: new Date().toISOString(),
              streakCount: currentStreak + 1,
            },
          });
          // Wire 4 · DAILY now credits per-day stat XP server-side; surface the
          // real reward, falling back to the client-known streak if absent.
          const dailyReward = (res as unknown as { reward?: TaskReward }).reward ?? {
            xpCredited: null,
            goalLifted: false,
            streak: currentStreak + 1,
          };
          const dailyMsg = formatReward(dailyReward);
          if (dailyMsg) {
            toast.success(dailyMsg, {
              duration: 4500,
              action: { label: "Stats", onClick: () => router.push("/stats") },
            });
          }
          if (dailyReward.levelUp) setLevelUpState(dailyReward.levelUp);
          if (dailyReward.xpCredited) xpAdded = dailyReward.xpCredited;
        } else if (isWeekly) {
          // 2026-06-09 · WEEKLY completes through the unified task.check service
          // (it computes nextWeekdayOccurrence(recurringDays) + parks the task
          // WAITING until its next weekday — the client can't, recurringDays is
          // lazy-loaded server-side). CheckTaskResult carries the typed reward.
          const res = await checkTaskMut.mutateAsync({ id, action: "complete" });
          const msg = formatReward(res.reward);
          if (msg) {
            toast.success(msg, {
              duration: 4500,
              action: { label: "Stats", onClick: () => router.push("/stats") },
            });
          }
          if (res.reward?.levelUp) setLevelUpState(res.reward.levelUp);
          if (res.reward?.xpCredited) xpAdded = res.reward.xpCredited;
        } else {
          // ONCE/PROMISE → status DONE via updateTask (unchanged semantics). The
          // service attaches `reward` at runtime on the DONE transition (same
          // cast pattern as autoLearn), so read it via a cast.
          const res = await updateTask.mutateAsync({ id, fields: { status: "DONE" } });
          const reward = (res as unknown as { reward?: TaskReward }).reward;
          const msg = formatReward(reward);
          if (msg) {
            toast.success(msg, {
              duration: 4500,
              action: { label: "Stats", onClick: () => router.push("/stats") },
            });
          }
          if (reward?.levelUp) setLevelUpState(reward.levelUp);
          if (reward?.xpCredited) xpAdded = reward.xpCredited;
        }
        if (xpAdded > 0) {
          setXpParticle({ xp: xpAdded, key: Date.now() });
        }
        await refetchAll();

        // Phase 3 · cascade · if this was the last open task in an
        // active mission, prompt the operator to mark the mission
        // complete + capture a retro. Wave AL · DAILY tasks come back
        // tomorrow · they don't actually "close" the mission · skip
        // the cascade so the retro prompt doesn't fire incorrectly.
        if (wasOpen && task?.missionId && !isRecurring) {
          const mission = missions.find((m) => m.id === task.missionId);
          if (mission && mission.status === "ACTIVE") {
            const remaining = tasks.filter(
              (t) =>
                t.id !== id &&
                t.missionId === task.missionId &&
                t.status !== "DONE",
            );
            if (remaining.length === 0) {
              setRetroState({ missionId: mission.id, title: mission.title });
            }
          }
        }
      } catch (err) {
        log.error("completeTask_failed", { err });
        toast.error("Could not complete task.");
      }
    },
    [tasks, missions, updateTask, checkTaskMut, refetchAll, telemetry],
  );

  const handleStartTask = useCallback(
    async (id: string) => {
      try {
        telemetry.event("startTask", { taskId: id });
        await updateTask.mutateAsync({
          id,
          fields: { status: "DOING" },
        });
        await refetchAll();
      } catch (err) {
        log.error("startTask_failed", { err });
        toast.error("Could not start task.");
      }
    },
    [updateTask, refetchAll, telemetry],
  );

  const handleDeleteTask = useCallback(
    async (id: string) => {
      try {
        telemetry.event("deleteTask", { taskId: id });
        await deleteTaskMut.mutateAsync({ id });
        await refetchAll();
      } catch (err) {
        log.error("deleteTask_failed", { err });
        toast.error("Could not delete task.");
      }
    },
    [deleteTaskMut, refetchAll, telemetry],
  );

  const handleUpdateTaskFields = useCallback(
    async (id: string, fields: any) => {
      try {
        await updateTask.mutateAsync({ id, fields });
        await refetchAll();
      } catch (err) {
        log.error("updateTaskFields_failed", { err });
        toast.error("Could not update task.");
      }
    },
    [updateTask, refetchAll],
  );

  const handleEditTask = useCallback(
    (task: Task) => {
      setTaskEditTarget(task);
      setTaskEditOpen(true);
      telemetry.event("editTaskOpen", { taskId: task.id });
    },
    [telemetry],
  );

  const handleSnoozeTask = useCallback(
    async (taskId: string, snoozedUntilIso: string) => {
      try {
        const clearing = !snoozedUntilIso;
        telemetry.event("snoozeTask", {
          taskId,
          clearing,
          snoozedUntil: snoozedUntilIso || null,
        });
        await updateTask.mutateAsync({
          id: taskId,
          fields: {
            snoozedUntil: snoozedUntilIso || null,
            status: clearing ? "READY" : "WAITING",
          },
        });
        await refetchAll();
        toast.success(clearing ? "Snooze cleared." : "Task snoozed.");
      } catch (err) {
        log.error("snoozeTask_failed", { err });
        toast.error("Could not update snooze.");
      }
    },
    [updateTask, refetchAll, telemetry],
  );

  const handleDecomposeTask = useCallback(
    async (id: string) => {
      const task = tasks.find((t) => t.id === id);
      const promise = decomposeTask.mutateAsync({ taskId: id });
      
      toast.promise(promise, {
        loading: `Decomposing “${task?.title || "task"}” into subtasks...`,
        success: (res) => {
          void refetchAll();
          return `Successfully created ${res.subtasksCount} subtasks!`;
        },
        error: (err) => `Failed to decompose task: ${err instanceof Error ? err.message : String(err)}`,
      });
    },
    [decomposeTask, tasks, refetchAll],
  );

  const handleCompleteMission = useCallback(
    (missionId: string) => {
      const mission = missions.find((m) => m.id === missionId);
      if (!mission) return;
      telemetry.event("completeMission", { missionId });
      setRetroState({ missionId, title: mission.title });
    },
    [missions, telemetry],
  );

  const handleArchiveMission = useCallback(
    async (missionId: string) => {
      try {
        telemetry.event("archiveMission", { missionId });
        // Use the create mutation surface · the same `record<string,unknown>`
        // shape supports status changes through the legacy POST path.
        // wave-AA-audit · "Archive" semantics map to MissionStatus.KILLED
        // (operator decided not to pursue), not PAUSED (might resume).
        // MissionStatus enum only has ACTIVE/PAUSED/COMPLETE/KILLED ·
        // we reserve COMPLETE for "shipped" (the retro flow sets it).
        await fetch(`/api/missions/${missionId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "KILLED" }),
        });
        await refetchAll();
        toast.success("Mission archived");
      } catch (err) {
        log.error("archiveMission_failed", { err });
        toast.error("Could not archive mission.");
      }
    },
    [refetchAll, telemetry],
  );

  // ── Quick-add submit · wave-AA-audit follow-up · background classifier.
  // Pre-fix · the classifier ran SYNCHRONOUSLY before the create, adding
  // ~500ms of perceived latency to every quick-add. Operator's response
  // was just to wait through it · sloppy UX.
  //
  // Post-fix · two-phase pattern:
  //   1. Create immediately as unattached · refetch · operator sees the
  //      task land in the "Unattached" section in <100ms.
  //   2. Fire the classifier in the background (no await on the outer
  //      handler · the operator can type the next thing). On success,
  //      update the task's missionId via the tRPC update mutation +
  //      refetch · the task animates from Unattached into its mission
  //      card on the next render.
  //
  // The optimistic path is correct even when the classifier returns null
  // (low-signal task, model failure): the task simply stays in Unattached
  // and the operator drags it manually. Telemetry records both paths so
  // the Phase 4 prune analysis can verify classifier hit-rate over time.
  const [submitting, setSubmitting] = useState(false);
  const handleQuickAdd = useCallback(
    async (text: string) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        const isMissionRequest =
          /^(create|new|start)\s+mission\s*:?\s*/i.test(text);
        if (isMissionRequest) {
          const title = text.replace(
            /^(create|new|start)\s+mission\s*:?\s*/i,
            "",
          ).trim();
          if (!title) {
            toast.error("Give the mission a name.");
            return;
          }
          telemetry.event("createMission", { source: "quickAdd" });
          await createMission.mutateAsync({ title, status: "ACTIVE" });
          await refetchAll();
          toast.success(`Mission “${title}” created.`);
          return;
        }

        // Create the task; the server classifies it (mission + goal + stats)
        // via enrichTaskLinkage right after the write.
        telemetry.event("addTask", {
          source: "quickAdd",
          missionId: null,
          classifierConfidence: null,
        });
        const created = (await createTask.mutateAsync({
          title: text,
          missionId: null,
          status: "READY",
          originSource: "missions-page:quickAdd",
        })) as { id: string } | null;
        await refetchAll();

        if (!created?.id) {
          // No id back · the task may still have been created · stop
          // here so we don't try to update a phantom row.
          return;
        }

        // 2026-06-01 · server-side enrichTaskLinkage (fire-and-forget on
        // create) now classifies the task to mission + goal + statHints —
        // strictly more than the old client-side mission-only classify, and
        // it runs on every creation path. We just refetch shortly so the
        // attached mission surfaces in the list. (Removed the redundant
        // client classify + its /api/ai/classify-task-mission route.)
        setTimeout(() => {
          void refetchAll();
        }, 2500);
      } finally {
        setSubmitting(false);
      }
    },
    [createTask, createMission, refetchAll, telemetry, submitting],
  );

  // ── Loading ──
  if (tasksQuery.isLoading || missionsQuery.isLoading) {
    return <MissionsPageSkeleton />;
  }

  if (executionModeActive) {
    return (
      <div className="space-y-4 max-w-3xl pb-[env(safe-area-inset-bottom,0px)]">
        {/* ⌘K omni-capture · kaizen-B kept */}
        <OmniCaptureModal onCapture={(text) => void handleQuickAdd(text)} />

        {/* Nick chat FAB · kaizen-B kept */}
        <NickSidePane
          page="missions"
          coachSurface="tasks"
          presets={[
            "Which mission should I push today?",
            "Which mission is stalling?",
            "What's the next move across all my missions?",
            "Summarize my week so far.",
          ]}
        />

        {/* Hidden risk warning banner */}
        <HiddenRiskWarning
          summary={hiddenRiskSummary}
          executionModeActive={executionModeActive}
          filterKey={filterKey}
          onClearFilters={handleClearFilters}
          onExitFocusMode={() => setExecutionModeActive(false)}
          onQueueNext={handleQueueNext}
        />

        {focusedTask ? (
          <ExecutionPanel
            task={focusedTask}
            mission={focusedTaskMission}
            onComplete={handleCompleteTask}
            onStart={handleStartTask}
            onDelete={handleDeleteTask}
            onEdit={handleEditTask}
            onUpdateTask={handleUpdateTaskFields}
            onExit={() => setExecutionModeActive(false)}
          />
        ) : (
          <div className="space-y-4 max-w-xl mx-auto py-12 text-center">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 border border-zinc-800 text-zinc-400 text-xl font-bold">
              ✓
            </span>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                All Tasks Completed
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                You have no open tasks left to execute. Great work!
              </p>
            </div>
            <button
              onClick={() => setExecutionModeActive(false)}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Exit Focus Mode
            </button>
          </div>
        )}

        {/* task edit sheet · pass live mission list so the
         *  operator can reassign tasks between missions inline. */}
        <TaskEditSheet
          key={taskEditTarget?.id ?? "none"}
          open={taskEditOpen}
          onClose={() => setTaskEditOpen(false)}
          task={taskEditTarget}
          missions={missions}
          onSaved={() => {
            setTaskEditOpen(false);
            void refetchAll();
          }}
        />
      </div>
    );
  }

  const stats = statsQuery.data ?? [];
  const totalLevel = stats.reduce((s: number, x: any) => s + (x.level || 0), 0);
  const totalXp = Math.round(stats.reduce((s: number, x: any) => s + (x.xp || 0), 0));

  const dailyTasks = tasks.filter(
    (t) => t.loopKind === "DAILY" && t.status !== "DONE" && t.status !== "ARCHIVED"
  );
  const maxStreak = dailyTasks.length > 0
    ? Math.max(...dailyTasks.map((t) => (t as any).streakCount ?? 0))
    : 0;

  return (
    <div className="space-y-4 max-w-3xl pb-[env(safe-area-inset-bottom,0px)]">
      <PageHeader
        eyebrow="Mastery Loop"
        title="Missions & Tasks"
        description="Deploy your focus, complete active campaigns, and level up your character sheet."
        actions={
          statsQuery.isLoading ? (
            <div className="h-8 w-32 rounded bg-zinc-900/50 animate-pulse border border-zinc-800" />
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--gold)]/20 bg-[var(--gold)]/[0.03] backdrop-blur-md px-3 py-1.5 text-xs font-mono text-[var(--gold)]/90 shadow-[0_0_15px_rgba(212,175,55,0.05)] transition-all hover:border-[var(--gold)]/40 hover:bg-[var(--gold)]/[0.06] hover:shadow-[0_0_20px_rgba(212,175,55,0.1)]">
              <div className="flex items-center gap-1.5 pr-2 border-r border-[var(--gold)]/10">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Lvl</span>
                <span className="font-bold tabular-nums text-white">{totalLevel}</span>
              </div>
              <div className="flex items-center gap-1.5 px-0.5 pr-2 border-r border-[var(--gold)]/10">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">XP</span>
                <span className="font-bold tabular-nums text-white">{totalXp.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-amber-500 animate-pulse">🔥</span>
                <span className="font-bold tabular-nums text-white">{maxStreak}d</span>
              </div>
            </div>
          )
        }
      />

      {/* ⌘K omni-capture · kaizen-B kept */}
      <OmniCaptureModal onCapture={(text) => void handleQuickAdd(text)} />

      {/* Nick chat FAB · kaizen-B kept */}
      <NickSidePane
        page="missions"
        coachSurface="tasks"
        presets={[
          "Which mission should I push today?",
          "Which mission is stalling?",
          "What's the next move across all my missions?",
          "Summarize my week so far.",
        ]}
      />

      {/* Coach Channel · kaizen-B kept · self-hides when zero events */}
      <CoachEventBanner surface="tasks" />

      {/* Nick's morning brief · Phase 2 · cross-mission pace summary */}
      <NicksMorningBrief tasks={tasks} missions={missions} />

      {/* Wave AO · 2026-05-28 · Sam-parity with /goals · the ONE
       *  mission that needs operator attention right now (DOING tasks
       *  first · then deadline urgency · then open-count). Self-hides
       *  when nothing qualifies. */}
      <TopMissionToday missions={missions} tasks={tasks} />

      {/* Wave AO · 2026-05-28 · 1-glance triage chip per active mission ·
       *  in_flight (amber) · healthy (green) · behind (gold) · stalled
       *  (rose) · idle (zinc) · done (faint gold). Tap a chip → tooltip
       *  shows full title + state. Self-hides on empty. */}
      <MissionsHealthStrip missions={missions} tasks={tasks} />

      {/* Wire 2 · read-only rescue suggestions + GENERAL-anchor open-counts.
       *  Self-hides when nothing needs attention. Never moves a task. */}
      <MissionsRescueStrip
        tasks={tasks}
        onCompleteTask={handleCompleteTask}
        onStartTask={handleStartTask}
        onDeleteTask={handleDeleteTask}
        onEditTask={handleEditTask}
        onSnoozeTask={handleSnoozeTask}
        onDecomposeTask={handleDecomposeTask}
      />

      {/* Hidden risk warning banner */}
      <HiddenRiskWarning
        summary={hiddenRiskSummary}
        executionModeActive={executionModeActive}
        filterKey={filterKey}
        onClearFilters={handleClearFilters}
        onExitFocusMode={() => setExecutionModeActive(false)}
        onQueueNext={handleQueueNext}
      />

      {/* Single quick-add input at top */}
      <MissionsQuickAdd onSubmit={handleQuickAdd} busy={submitting} />

      {/* wave-AB.c · explicit "+ new mission" button so the operator
       *  doesn't have to type the "create mission X" magic phrase. */}
      <div className="flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => {
            setMissionEditId(null);
            setMissionEditInitial(undefined);
            setMissionEditOpen(true);
            telemetry.event("createMissionOpen", { source: "button" });
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]/90 hover:bg-[var(--gold)]/[0.08]"
        >
          + new mission
        </button>
        <button
          type="button"
          onClick={() => {
            setExecutionModeActive(true);
            telemetry.event("executionModeOpen", { source: "button" });
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-amber-400 hover:bg-amber-500/10"
        >
          ⚡ Execution Mode
        </button>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] transition-colors",
            showFilters
              ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
              : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
          )}
        >
          {showFilters ? "✕ Close Filters" : "⚙️ Filters"}
        </button>
        <span className="text-[10px] font-mono text-[var(--text-tertiary)]/70">
          or type{" "}
          <code className="px-1 rounded bg-[var(--bg-raised)]/10 text-[var(--text-tertiary)]">
            create mission &lt;name&gt;
          </code>{" "}
          above
        </span>
      </div>

      {showFilters && (
        <TaskFilters
          showFilters={showFilters}
          kindFilter={kindFilter}
          setKindFilter={setKindFilter}
          domainFilter={domainFilter}
          setDomainFilter={setDomainFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onceCount={onceCount}
          dailyCount={dailyCount}
          promiseCount={promiseCount}
          activeCount={activeCount}
          activeDomains={activeDomains}
          customDomains={customDomains}
          setCustomDomains={setCustomDomains}
          addingDomain={addingDomain}
          setAddingDomain={setAddingDomain}
          newDomainInput={newDomainInput}
          setNewDomainInput={setNewDomainInput}
          filterEditMode={filterEditMode}
          setFilterEditMode={setFilterEditMode}
        />
      )}

      {/* Active filters summary chip bar */}
      {filtersActive && (
        <div className="flex items-center justify-between gap-2 px-1 flex-wrap">
          <ActiveFiltersStrip
            filters={[
              ...(searchQuery.trim() ? [{ label: `search · "${searchQuery.trim().slice(0, 20)}"`, onRemove: () => setSearchQuery("") }] : []),
              ...(kindFilter !== "all" ? [{ label: `kind · ${kindFilter}`, onRemove: () => setKindFilter("all") }] : []),
              ...(domainFilter ? [{ label: `domain · ${domainFilter}`, onRemove: () => setDomainFilter(null) }] : []),
            ]}
            onClearAll={handleClearFilters}
          />
        </div>
      )}

      {/* Mission cards + unattached section */}
      <MissionFeed
        missions={filteredMissions}
        tasks={filteredTasks}
        onAddTask={handleAddTask}
        onCompleteTask={handleCompleteTask}
        onStartTask={handleStartTask}
        onDeleteTask={handleDeleteTask}
        onCompleteMission={handleCompleteMission}
        onArchiveMission={handleArchiveMission}
        onDecomposeTask={handleDecomposeTask}
        autonomicHealth={healthQuery.data?.autonomic}
        onEditMission={(missionId) => {
          const m = missions.find((mm) => mm.id === missionId);
          if (!m) return;
          setMissionEditId(missionId);
          setMissionEditInitial({
            title: m.title,
            status: m.status,
            domain: m.domain ?? null,
            description: m.description ?? null,
            deadline: m.deadline ?? null,
          });
          setMissionEditOpen(true);
          telemetry.event("editMissionOpen", { missionId });
        }}
        onEditTask={handleEditTask}
        onMoveMission={async (missionId, direction) => {
          try {
            telemetry.event("reorderMission", { missionId, direction });
            const res = await reorderMissionMut.mutateAsync({
              missionId,
              direction,
            });
            if (res.ok) await refetchAll();
          } catch (err) {
            log.error("reorderMission_failed", { err });
            toast.error("Could not reorder mission.");
          }
        }}
        onMoveTask={async (taskId, direction) => {
          try {
            telemetry.event("reorderTask", { taskId, direction });
            const res = await reorderTaskMut.mutateAsync({
              taskId,
              direction,
            });
            if (res.ok) await refetchAll();
          } catch (err) {
            log.error("reorderTask_failed", { err });
            toast.error("Could not reorder task.");
          }
        }}
        // Wave AV · 2026-05-28 · DAILY task snooze · pill in the row's
        // meta strip opens a popover with 2 presets. We translate the
        // tap into the existing task.update mutation + the WAITING flip
        // the task-resurface cron expects. Empty string = clear snooze.
        onSnoozeTask={handleSnoozeTask}
      />

      {/* Phase 3 retro modal · opens when a mission is completed (either
       *  via explicit "complete mission" tap OR via cascade when the last
       *  open task is ticked done). */}
      {retroState && (
        <MissionRetroModal
          missionId={retroState.missionId}
          missionTitle={retroState.title}
          onClose={() => setRetroState(null)}
          onSaved={async () => {
            await refetchAll();
            setRetroState(null);
            toast.success("Mission retro saved.");
          }}
        />
      )}

      {/* wave-AB.c · mission edit/create drawer · key forces remount on
       *  target switch so useState initializers re-seed cleanly. */}
      <MissionEditDrawer
        key={missionEditId ?? "new"}
        open={missionEditOpen}
        onClose={() => setMissionEditOpen(false)}
        missionId={missionEditId}
        initial={missionEditInitial}
        onSaved={() => {
          setMissionEditOpen(false);
          void refetchAll();
        }}
      />

      {/* wave-AB.c · task edit sheet · pass live mission list so the
       *  operator can reassign tasks between missions inline. */}
      <TaskEditSheet
        key={taskEditTarget?.id ?? "none"}
        open={taskEditOpen}
        onClose={() => setTaskEditOpen(false)}
        task={taskEditTarget}
        missions={missions}
        onSaved={() => {
          setTaskEditOpen(false);
          void refetchAll();
        }}
      />

      {/* Dopamine loop · level-up celebration modal */}
      {levelUpState && (
        <LevelUpModal
          newLevel={levelUpState.newLevel}
          tierName={levelUpState.tierName}
          tierEmoji={levelUpState.tierEmoji}
          onClose={() => setLevelUpState(null)}
        />
      )}

      {/* Dopamine loop · floating XP particle animation overlay */}
      {xpParticle.xp > 0 && (
        <div className="fixed inset-0 pointer-events-none z-[9999]" aria-hidden="true">
          <XpParticle xp={xpParticle.xp} triggerKey={xpParticle.key} />
        </div>
      )}
    </div>
  );
}

function MissionsPageSkeleton() {
  return (
    <div className="space-y-3 max-w-3xl">
      <ShimmerSkeleton className="h-12 rounded-lg" />
      <ShimmerSkeleton className="h-24 rounded-lg" />
      <ShimmerSkeleton className="h-24 rounded-lg" />
      <ShimmerSkeleton className="h-24 rounded-lg" />
    </div>
  );
}

==================================================

## SOURCE: Repo Code: page.tsx
* **Path**: C:\Users\nourd\NOURCITY\apps\statenour\app\(mastery)\money\page.tsx
* **Type**: repo_file

---

"use client";

/**
 * /money — personal wealth hub. 2026-06-19 · IA reorg Phase 5. Consolidates
 * the former standalone /finance (bank ledger) + /wealth (investment
 * portfolio) into one tabbed surface, mirroring the proven /business PageTabs
 * pattern. Personal money only — Nick's-Tire business revenue stays under
 * /business. /finance + /wealth now 307-redirect here (?tab=finance|wealth).
 */


export default function MoneyPage() {
  return (
    <StandardPage
      eyebrow="NOUR OS"
      title="money"
      width="2xl"
      rhythm="comfortable"
      description="Personal wealth — bank ledger (Finance) + investment portfolio (Wealth). Business revenue lives under Business."
    >
      <PageTabs
        defaultKey="finance"
        tabs={[
          { key: "finance", label: "Finance", render: () => <FinanceTab /> },
          { key: "wealth", label: "Wealth", render: () => <WealthTab /> },
        ]}
      />
    </StandardPage>
  );
}

==================================================

## SOURCE: Repo Code: page.tsx
* **Path**: C:\Users\nourd\NOURCITY\apps\statenour\app\(mastery)\page.tsx
* **Type**: repo_file

---

/**
 * The home route · 2026-06-22 · Redesigned Nour Command Center layout.
 *
 * Wide responsive grid:
 *   - Left Main: existing home card bento stack
 *   - Right Side: HomeBrainGraph (sticky on desktop, compact preview on mobile)
 *   - Floating Bottom: HomeNickDock command bar
 */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 pb-32 space-y-4">
      <HomeIdentityHeader />
      <CoachEventBanner surface="home" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_520px]">
        {/* Main Left Bento Stack */}
        <main className="space-y-4 min-w-0">
          <NicksHomeBrief />
          <HomeCommandStack />
          <HomeActionHub />
          <HomeJournalHub />
          <ObsidianEngineCard />
          <HomeStatePulse />
        </main>

        {/* Right Sticky Graph Column / Mobile Preview */}
        <aside className="lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)] min-w-0">
          <HomeBrainGraph variant="home" />
        </aside>
      </div>

      {/* Floating Bottom Dock */}
      <HomeNickDock />
    </div>
  );
}

==================================================

