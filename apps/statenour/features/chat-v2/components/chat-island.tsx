"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Brain, History, Mic, MicOff, MoreHorizontal, Volume2, VolumeX } from "lucide-react";
import { isNearBottom, nextFollow } from "../lib/scroll-position";
import { scrollBehavior } from "@/lib/ui/scroll-behavior";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useChatUiStore } from "../stores/chat-ui-store";
import { useChatStream } from "../hooks/use-chat-stream";
import { resolveIslandHeight } from "../lib/island-height";
import { fetchInspectorRecall } from "../lib/inspector-recall";
import { ChatComposer } from "./chat-composer";
import { ChatMediaDock } from "./chat-media-dock";
import { ChatMediaFocusPanel } from "./chat-media-focus-panel";
import { ChatMessageList } from "./chat-message-list";
import { ChatCapabilityIndicator } from "./chat-capability-indicator";
import { OperatorConversationDrawer } from "./operator-conversation-drawer";
import { RealtimeVoiceOverlay } from "@/components/chat/realtime-voice-overlay";
import { MemoryInspectorSidebar } from "@/components/chat/memory-inspector-sidebar";
import { extractQuality } from "@/lib/chat/extract-message-metadata";
import { useConversations } from "@/hooks/use-conversations";
import type { SavedRow } from "../lib/saved-turn";
import { useChatDeepLinkPrefill } from "../hooks/use-chat-deep-link-prefill";
import { useTts } from "../hooks/use-tts";
import { toast } from "sonner";

function useScrollToBottom<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // 2026-08-18 · drives the jump-to-latest button. Same predicate as
  // the auto-follow below (isNearBottom) so the button can never show
  // while auto-follow is active, and vice versa.
  const [isAtBottom, setIsAtBottom] = useState(true);
  // 09-F13: auto-follow is state, not a per-frame distance check: one frame
  // that grew past the threshold used to drop it for the rest of the stream.
  // Content growth keeps it; only the operator's own scroll input changes it.
  const followRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rafId: number | null = null;
    let inputRafId: number | null = null;

    const distance = () => container.scrollHeight - container.scrollTop - container.clientHeight;
    const measure = () => {
      const near = isNearBottom(
        container.scrollHeight,
        container.scrollTop,
        container.clientHeight,
      );
      // While following, the view is headed for the bottom: no jump button.
      setIsAtBottom(near || followRef.current);
      return near;
    };

    // Reaching the bottom by any route re-arms follow. Follow only scrolls
    // down, so an upward move is the operator's: a momentum flick, a scrollbar
    // drag, keys or VoiceOver send scroll events with no wheel or touchmove.
    let lastTop = container.scrollTop;
    const onScroll = () => {
      const top = container.scrollTop;
      if (top < lastTop - 2) followRef.current = nextFollow(followRef.current, { kind: "user-scroll", distanceFromBottom: distance() });
      lastTop = top;
      if (measure()) followRef.current = true;
    };
    // Read a frame later, once the input has moved the scroll position.
    const onUserInput = () => {
      if (inputRafId !== null) cancelAnimationFrame(inputRafId);
      inputRafId = requestAnimationFrame(() => {
        inputRafId = null;
        followRef.current = nextFollow(followRef.current, { kind: "user-scroll", distanceFromBottom: distance() });
        measure();
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "PageUp" || event.key === "ArrowUp" || event.key === "Home") onUserInput();
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onUserInput, { passive: true });
    container.addEventListener("touchmove", onUserInput, { passive: true });
    container.addEventListener("keydown", onKey);
    measure();

    // Content growth: follow if following, and re-measure either way
    // (streaming can push the bottom away without a scroll event firing).
    const observer = new MutationObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        followRef.current = nextFollow(followRef.current, { kind: "content-grew", distanceFromBottom: distance() });
        if (followRef.current) container.scrollTo({ top: container.scrollHeight, behavior: scrollBehavior() });
        else measure();
      });
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (inputRafId !== null) cancelAnimationFrame(inputRafId);
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onUserInput);
      container.removeEventListener("touchmove", onUserInput);
      container.removeEventListener("keydown", onKey);
      observer.disconnect();
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    followRef.current = nextFollow(followRef.current, { kind: "jump", distanceFromBottom: 0 });
    // scrollIntoView also scrolls every overflow:hidden ancestor (the message
    // wrapper and the island root). Each jump shifted the wrapper by up to the
    // scroller's overflow, leaving a dark band between the last message and
    // the composer that grew with the conversation. Scroll the container only.
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: scrollBehavior() });
  }, []);

  return { containerRef, endRef, isAtBottom, scrollToBottom };
}

export function ChatIsland() {
  const isVoiceDocked = useChatUiStore((state) => state.isVoiceDocked);
  const toggleVoiceDock = useChatUiStore((state) => state.toggleVoiceDock);
  const memoryInspectorOpen = useChatUiStore((state) => state.memoryInspectorOpen);
  const setMemoryInspectorOpen = useChatUiStore((state) => state.setMemoryInspectorOpen);
  const historyDrawerOpen = useChatUiStore((state) => state.historyDrawerOpen);
  const privateMode = useChatUiStore((state) => state.privateMode);
  const activeConversationId = useChatUiStore((state) => state.activeConversationId);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const setHistoryDrawerOpen = useChatUiStore((state) => state.setHistoryDrawerOpen);
  const setActiveConversationId = useChatUiStore((state) => state.setActiveConversationId);
  const recalledHits = useChatUiStore((state) => state.recalledHits);
  const contradictions = useChatUiStore((state) => state.contradictions);
  const setMemoryData = useChatUiStore((state) => state.setMemoryData);
  const [memoryFetchedAt, setMemoryFetchedAt] = useState<Date | null>(null);
  // W3b: below md the header shows History and More; auto-read, context and voice live in this sheet.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  // Retry after a stream error reads the conversation as saved before it replays a
  // turn. useConversations owns the tRPC client but is created after this hook, so
  // the reader reaches the chat through a ref.
  const readSavedTurnRef = useRef<((id: string, signal?: AbortSignal) => Promise<readonly SavedRow[] | null>) | undefined>(undefined);
  const chat = useChatStream({ readSavedTurn: (id, signal) => readSavedTurnRef.current?.(id, signal) ?? Promise.resolve(null) });
  // 2026-08-27 · read-aloud narration. The hook owns the persisted
  // preference + streaming follower; the island only hands it to the
  // composer (toggle chip) and the message list (per-message replay).
  const tts = useTts({ messages: chat.messages, isStreaming: chat.isStreaming });
  // BDN-004 · restore ?q=/?seed=/?prompt= prefill + ?cid= conversation
  // deep-links (orphaned in the chat-v2 migration; 13 callers were
  // landing on an empty composer). Prefill only — never auto-send.
  useChatDeepLinkPrefill();
  // W3b: a failed delete, rename, archive or Load older is said once, on the same sonner
  // channel the Retry holds use; it used to reach the console only.
  const conversations = useConversations({
    setMessages: chat.setMessages,
    onError: (message) => toast.error(message),
  });
  useEffect(() => {
    readSavedTurnRef.current = conversations.readSavedTurn;
  }, [conversations.readSavedTurn]);
  // Every path here that empties or switches the conversation (pick one, New, delete the active one)
  // goes through this: the old turn's error, trace refs and outstanding replay are reset BEFORE the
  // active conversation moves, so none of it stays attached to the next chat. resetTurn leaves a turn
  // that is still in flight alone. The composer's /new calls chat.resetTurn() itself, in the same order.
  const moveToConversation = (id: string | null) => {
    chat.resetTurn();
    setActiveConversationId(id);
  };
  // Opening a conversation from History: the turn is reset first, the rows are read, and the
  // store moves only once THIS read landed (loadConvo answers false for a failed or superseded
  // read). The store used to move before the read, so a failed open left the next send posting
  // into a conversation the operator never saw. The active conversation stays where it was and
  // the list shows a Retry line (W3b, empty-vs-error).
  const openConversation = (id: string) => {
    chat.resetTurn();
    void conversations.loadConvo(id).then((ok) => {
      if (ok) setActiveConversationId(id);
    });
  };
  const { containerRef, endRef, isAtBottom, scrollToBottom } = useScrollToBottom<HTMLDivElement>();
  const islandRef = useRef<HTMLDivElement>(null);

  /**
   * Keep the island clear of the iOS soft keyboard.
   *
   * This used to assign `viewport.height` outright, which ignored the
   * bottom-chrome reservation the shell owns as padding-bottom. An inline
   * height beats `h-full`, so the island rendered exactly --bottom-chrome-h
   * too tall on every load — keyboard or not — and the composer sat that far
   * under the tab bar. See resolveIslandHeight for the measurements.
   *
   * Now the pin only engages when the visual viewport is genuinely shorter
   * than the shell's content box; otherwise the inline height is REMOVED so
   * `h-full` stays authoritative and keeps tracking the measured token.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const viewport = window.visualViewport;

    const syncHeight = () => {
      const island = islandRef.current;
      const shell = island?.parentElement;
      if (!island || !shell) return;

      const shellStyle = getComputedStyle(shell);
      const next = resolveIslandHeight({
        viewportHeight: viewport.height,
        parentHeight: shell.getBoundingClientRect().height,
        parentPaddingTop: parseFloat(shellStyle.paddingTop) || 0,
        parentPaddingBottom: parseFloat(shellStyle.paddingBottom) || 0,
        viewportScale: viewport.scale,
      });

      if (next === null) island.style.removeProperty("height");
      else island.style.height = `${next}px`;
    };

    viewport.addEventListener("resize", syncHeight);
    viewport.addEventListener("scroll", syncHeight);
    syncHeight();

    // The reservation itself is measured — BottomTabBar publishes
    // --bottom-chrome-h from a ResizeObserver, so the shell's padding-bottom
    // can change after mount (the ticker wrapping to a second line is the
    // case that started all of this). visualViewport does not fire for that,
    // so watch the shell's own box too.
    const shell = islandRef.current?.parentElement;
    const ro =
      typeof ResizeObserver === "undefined" || !shell
        ? null
        : new ResizeObserver(syncHeight);
    if (ro && shell) ro.observe(shell);

    return () => {
      viewport.removeEventListener("resize", syncHeight);
      viewport.removeEventListener("scroll", syncHeight);
      ro?.disconnect();
    };
  }, []);

  const [recallProvenance, setRecallProvenance] = useState<
    "OK" | "ZERO" | "ERROR" | "UNMEASURED" | undefined
  >(undefined);
  const [recallProvenanceReason, setRecallProvenanceReason] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    const onCockpitEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ type: string; payload: any }>).detail;
      if (detail?.type === "memory.recalled") {
        setMemoryData(detail.payload?.hits || [], detail.payload?.contradictions || []);
        setMemoryFetchedAt(new Date());
        // 2026-09-10 · carry WHY the hit list is the length it is, so an
        // empty list can render as "read failed" rather than as "Nick
        // believes nothing about you".
        setRecallProvenance(detail.payload?.provenance);
        setRecallProvenanceReason(detail.payload?.provenanceReason);
      }
    };
    window.addEventListener("cockpit-event", onCockpitEvent);
    return () => window.removeEventListener("cockpit-event", onCockpitEvent);
  }, [setMemoryData]);

  const lastUserText = useMemo(() => {
    const lastUser = [...chat.messages].reverse().find((message) => message.role === "user");
    return (lastUser?.parts ?? [])
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim();
  }, [chat.messages]);

  // WP-11 (2026-07-29): the latest assistant turn's persisted quality
  // verdicts (gate · critic · factCheck · truth · receipt) for the
  // Context & Evidence panel. Live-streaming turns have no blob until
  // the server finalize writes it — the panel labels that honestly.
  const replyQuality = useMemo(() => {
    const lastAssistant = [...chat.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    return lastAssistant ? extractQuality(lastAssistant as never) : undefined;
  }, [chat.messages]);

  useEffect(() => {
    if (!memoryInspectorOpen || !lastUserText) return;
    const controller = new AbortController();
    void (async () => {
      try {
        // 2026-10-01 · read-only and unwrapped (lib/inspector-recall.ts): the
        // inline fetch read apiHandler's envelope, so this showed zero
        // memories and blanked the provenance on every open, and it bumped
        // lastSeen on what it showed. A failed read now lands in the catch.
        const report = await fetchInspectorRecall(lastUserText, controller.signal);
        setMemoryData(report.hits, contradictions);
        setMemoryFetchedAt(new Date());
        setRecallProvenance(report.provenance);
        setRecallProvenanceReason(report.provenanceReason);
      } catch (err) {
        // An ABORT is ordinary (the panel closed, or the query changed):
        // keep the last known view untouched. A real failure is not
        // ordinary -- say the read failed rather than leaving a stale
        // list looking freshly confirmed.
        if ((err as { name?: string })?.name !== "AbortError") {
          setRecallProvenance("ERROR");
          setRecallProvenanceReason("could not refresh memory for this turn -- showing the last known view");
        }
      }
    })();
    return () => controller.abort();
  }, [contradictions, lastUserText, memoryInspectorOpen, setMemoryData]);

  return (
    <div ref={islandRef} className="relative flex h-full w-full flex-col overflow-hidden bg-void text-fg">
      {/* W3b: one line. Nick, the capability dot and its word, Private when it is on; History and
          More on the right below md (auto-read, context and voice sit in the More sheet there),
          all of them at md and up. The five controls keep the 44px box the mobile-a11y pin counts;
          the three that leave the phone line are hidden by max-md:hidden, never made smaller. */}
      <header className="z-10 flex items-center justify-between gap-3 border-b border-edge-subtle bg-canvas px-3 py-1 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Nick</h1>
          <ChatCapabilityIndicator />
          {/* 09-F22: the posture/depth strip read selectors the composer lost
              on 2026-08-28, so it always said the same thing. Private is the
              one mode left to show. */}
          {privateMode && <p className="font-mono text-[11px] text-accent">Private</p>}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {/* 09-F23: one global preference, so one control (it was a button
              on every reply). No speech engine, no control. */}
          {tts.supported && (
            <button
              type="button"
              aria-label={tts.enabled ? "Auto-read replies is on (tap to turn off)" : "Auto-read replies is off (tap to turn on)"}
              aria-pressed={tts.enabled}
              onClick={tts.toggle}
              className={`flex h-11 w-11 items-center justify-center rounded-control max-md:hidden transition-colors duration-[var(--motion-state)] ${tts.enabled ? "bg-surface-interactive text-fg" : "text-fg-tertiary hover:bg-surface hover:text-fg"}`}
            >
              {tts.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          )}
          <button onClick={() => setMemoryInspectorOpen(!memoryInspectorOpen)} aria-label="Context and memory" aria-pressed={memoryInspectorOpen} className={`flex h-11 w-11 items-center justify-center rounded-control max-md:hidden transition-colors duration-[var(--motion-state)] ${memoryInspectorOpen ? "bg-surface-interactive text-fg" : "text-fg-tertiary hover:bg-surface hover:text-fg"}`}>
            <Brain size={16} /><span className="sr-only">Context</span>
          </button>
          <button ref={historyButtonRef} onClick={() => setHistoryDrawerOpen(!historyDrawerOpen)} aria-label="Conversation history" aria-pressed={historyDrawerOpen} className={`flex h-11 w-11 items-center justify-center rounded-control transition-colors duration-[var(--motion-state)] ${historyDrawerOpen ? "bg-surface-interactive text-fg" : "text-fg-tertiary hover:bg-surface hover:text-fg"}`}>
            <History size={16} /><span className="sr-only">History</span>
          </button>
          <button onClick={toggleVoiceDock} aria-label={isVoiceDocked ? "Close voice" : "Open voice"} aria-pressed={isVoiceDocked} className={`flex h-11 w-11 items-center justify-center rounded-control max-md:hidden transition-colors duration-[var(--motion-state)] ${isVoiceDocked ? "bg-rose-500/15 text-rose-300" : "text-fg-tertiary hover:bg-surface hover:text-fg"}`}>
            {isVoiceDocked ? <MicOff size={16} /> : <Mic size={16} />}<span className="sr-only">Voice</span>
          </button>
          <button ref={moreButtonRef} type="button" onClick={() => setMoreOpen(true)} aria-label="More chat controls" aria-expanded={moreOpen} aria-haspopup="dialog" className="flex h-11 w-11 items-center justify-center rounded-control md:hidden text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:bg-surface hover:text-fg">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </header>

      {/* The More sheet (below md): the same three controls as rows, in the DOM (window.* menus do
          not exist in the installed iOS PWA). Each row acts and closes the sheet; focus returns to More. */}
      <Dialog open={moreOpen} onOpenChange={(open) => { if (!open) setMoreOpen(false); }}>
        <DialogContent
          unstyled
          showCloseButton={false}
          finalFocus={moreButtonRef}
          overlayClassName="z-[58] bg-canvas/60"
          className="fixed inset-x-0 bottom-0 z-[59] rounded-t-float border-t border-edge-default bg-overlay p-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] shadow-l1 outline-none"
        >
          <DialogTitle className="px-3 py-2 text-[13px] font-medium text-fg-secondary">More chat controls</DialogTitle>
          {tts.supported && (
            <button type="button" aria-pressed={tts.enabled} onClick={() => { tts.toggle(); setMoreOpen(false); }} className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-[15px] text-fg hover:bg-surface">
              {tts.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              Auto-read replies
              <span className="ml-auto text-[13px] text-fg-tertiary">{tts.enabled ? "On" : "Off"}</span>
            </button>
          )}
          <button type="button" aria-pressed={memoryInspectorOpen} onClick={() => { setMemoryInspectorOpen(!memoryInspectorOpen); setMoreOpen(false); }} className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-[15px] text-fg hover:bg-surface">
            <Brain size={16} />
            Context and memory
          </button>
          <button type="button" aria-pressed={isVoiceDocked} onClick={() => { toggleVoiceDock(); setMoreOpen(false); }} className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-[15px] text-fg hover:bg-surface">
            {isVoiceDocked ? <MicOff size={16} /> : <Mic size={16} />}
            Voice
            <span className="ml-auto text-[13px] text-fg-tertiary">{isVoiceDocked ? "Open" : "Closed"}</span>
          </button>
        </DialogContent>
      </Dialog>

      {/* `relative` anchors the jump-to-latest button only — plain
          relative creates no containing block for `position: fixed`
          descendants (the voice overlay's `fixed inset-0` still anchors
          to the viewport; only transform/filter would re-anchor it —
          the state-aura 2545px lesson). */}
      <div className="relative flex flex-1 overflow-hidden">
        <div ref={containerRef} className="flex-1 overflow-y-auto">
          <ChatMessageList
            messages={chat.messages}
            isLoading={chat.isStreaming}
            isLoadingConvo={conversations.isLoadingConvo}
            loadFailedId={conversations.loadFailedId}
            onRetryLoad={(id) => openConversation(id)}
            error={chat.error}
            hold={chat.hold}
            liveContextBlocks={chat.liveContextBlocks}
            lastTraceId={chat.lastTraceId}
            onRetry={() => void chat.regenerate()}
            onCommand={(prompt) => chat.sendText(prompt)}
            tts={tts}
            stopped={chat.stopped}
            conversationId={privateMode ? null : activeConversationId}
          />
          <div ref={endRef} />
        </div>
        {/* Jump to latest — shows only once the operator has scrolled
            away from the bottom (same isNearBottom predicate as the
            auto-follow, so the two can never disagree). 48px circle =
            the iOS-PWA touch-target floor.
            2026-09-02 · moved from bottom-RIGHT to bottom-centre. Anchored
            right, the 48px circle sat on top of the right-aligned user
            bubbles (justify-end, 16px container padding) and, worse, on the
            Copy / Edit / More row of the most recent user message -- which
            is also justify-end. The list's pb-12 protects the list's own
            bottom, not a viewport-anchored button. Centre-bottom collides
            with nothing and is the conventional position anyway. */}
        {!isAtBottom && (
          <button
            onClick={scrollToBottom}
            aria-label="Scroll to latest message"
            className="ui-material absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-edge-default text-fg-secondary shadow-l1 transition-colors hover:text-fg active:scale-95"
          >
            <ArrowDown size={18} />
          </button>
        )}
        {isVoiceDocked && <RealtimeVoiceOverlay open={isVoiceDocked} onClose={toggleVoiceDock} />}
      </div>

      {/* pb-3, not pb-safe. The route shell now reserves the MEASURED
          --bottom-chrome-h; .pb-safe adds a hardcoded 96px on top of it,
          which measured as 111px of dead gap between the input and the tab
          bar. One reservation, and it is the self-measuring one. */}
      {/* BDN-311 · media dock sits ABOVE the composer and renders null
          when nothing is playing, so the layout is unchanged in the
          common case. Placed outside the composer container on purpose:
          it must not inherit the composer's bottom-safe-area padding,
          which would add dead space under the player. */}
      <ChatMediaDock />

      <div className="relative z-10 bg-canvas px-3 pb-3 pt-2 sm:px-4">
        <ChatComposer chat={chat} />
      </div>

      {/* BDN-315 · desktop focus panel. Overlays like the memory
          inspector rather than re-laying-out the chat column — the plan
          explicitly warns against forcing a permanent multi-column
          dashboard. Renders null unless the operator opts in. */}
      <ChatMediaFocusPanel />

      <MemoryInspectorSidebar open={memoryInspectorOpen} onClose={() => setMemoryInspectorOpen(false)} hits={recalledHits} contradictions={contradictions} fetchedAt={memoryFetchedAt} reply={replyQuality} recallProvenance={recallProvenance} recallProvenanceReason={recallProvenanceReason} />

      {/* 09-F4: a modal dialog (pattern: nick-side-pane.tsx): focus moves in
          and is trapped, Escape and a scrim tap close it, and focus returns
          to the History button. */}
      <Dialog
        open={historyDrawerOpen}
        onOpenChange={(open) => {
          if (!open) setHistoryDrawerOpen(false);
        }}
      >
        <DialogContent
          unstyled
          showCloseButton={false}
          aria-label="Conversation history"
          finalFocus={historyButtonRef}
          overlayClassName="z-[58] bg-canvas/60"
          className="fixed inset-y-0 left-0 z-[59] w-full border-r border-edge-default bg-overlay pb-[env(safe-area-inset-bottom,0px)] shadow-l1 outline-none sm:w-80"
          style={{ paddingLeft: "env(safe-area-inset-left, 0px)" }}
        >
          <OperatorConversationDrawer
            convos={conversations.convos}
            activeId={conversations.activeId}
            pinnedIds={conversations.pinnedIds}
            hasMore={conversations.hasMoreConvos}
            loadingMore={conversations.loadingMore}
            listState={conversations.listState}
            onRetryList={conversations.reloadConvos}
            onLoadMore={conversations.loadMoreConvos}
            onSelect={(id) => {
              openConversation(id);
              setHistoryDrawerOpen(false);
            }}
            onDelete={(id, event) => {
              const wasActive = conversations.activeId === id;
              void conversations.deleteConvo(id, event).then((ok) => {
                if (ok && wasActive) moveToConversation(null);
              });
            }}
            onRename={conversations.renameConvo}
            onTogglePin={conversations.togglePin}
            onArchive={(id) => conversations.patchConvoFlag(id, "archived", true)}
            onNew={() => {
              moveToConversation(null);
              conversations.newChat();
              setHistoryDrawerOpen(false);
            }}
            onShowActions={() => {
              setHistoryDrawerOpen(false);
              chat.sendText("/receipts");
            }}
            onClose={() => setHistoryDrawerOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
