"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Brain, History, Mic, MicOff } from "lucide-react";
import { isNearBottom } from "../lib/scroll-position";
import { useChatUiStore } from "../stores/chat-ui-store";
import { useChatStream } from "../hooks/use-chat-stream";
import { resolveIslandHeight } from "../lib/island-height";
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
import { useChatDeepLinkPrefill } from "../hooks/use-chat-deep-link-prefill";

function useScrollToBottom<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // 2026-08-18 · drives the jump-to-latest button. Same predicate as
  // the auto-follow below (isNearBottom) so the button can never show
  // while auto-follow is active, and vice versa.
  const [isAtBottom, setIsAtBottom] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rafId: number | null = null;

    const measure = () => {
      const near = isNearBottom(
        container.scrollHeight,
        container.scrollTop,
        container.clientHeight,
      );
      setIsAtBottom(near);
      return near;
    };

    // Operator scrolling — the button's show/hide signal.
    const onScroll = () => void measure();
    container.addEventListener("scroll", onScroll, { passive: true });
    measure();

    // Content growth — auto-follow when near the bottom, and re-measure
    // either way (streaming can push the bottom away without a single
    // scroll event firing).
    const observer = new MutationObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (measure()) {
          endRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      });
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  return { containerRef, endRef, isAtBottom, scrollToBottom };
}

export function ChatIsland() {
  const isVoiceDocked = useChatUiStore((state) => state.isVoiceDocked);
  const toggleVoiceDock = useChatUiStore((state) => state.toggleVoiceDock);
  const memoryInspectorOpen = useChatUiStore((state) => state.memoryInspectorOpen);
  const setMemoryInspectorOpen = useChatUiStore((state) => state.setMemoryInspectorOpen);
  const historyDrawerOpen = useChatUiStore((state) => state.historyDrawerOpen);
  const posture = useChatUiStore((state) => state.posture);
  const depth = useChatUiStore((state) => state.depth);
  const privateMode = useChatUiStore((state) => state.privateMode);
  const setHistoryDrawerOpen = useChatUiStore((state) => state.setHistoryDrawerOpen);
  const setActiveConversationId = useChatUiStore((state) => state.setActiveConversationId);
  const recalledHits = useChatUiStore((state) => state.recalledHits);
  const contradictions = useChatUiStore((state) => state.contradictions);
  const setMemoryData = useChatUiStore((state) => state.setMemoryData);
  const [memoryFetchedAt, setMemoryFetchedAt] = useState<Date | null>(null);

  const chat = useChatStream();
  // BDN-004 · restore ?q=/?seed=/?prompt= prefill + ?cid= conversation
  // deep-links (orphaned in the chat-v2 migration; 13 callers were
  // landing on an empty composer). Prefill only — never auto-send.
  useChatDeepLinkPrefill();
  const conversations = useConversations({
    setMessages: chat.setMessages,
    onError: (message) => console.error("useConversations error:", message),
  });
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

  const closeDrawer = useCallback(() => setHistoryDrawerOpen(false), [setHistoryDrawerOpen]);
  useEffect(() => {
    if (!historyDrawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDrawer, historyDrawerOpen]);

  useEffect(() => {
    const onCockpitEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ type: string; payload: any }>).detail;
      if (detail?.type === "memory.recalled") {
        setMemoryData(detail.payload?.hits || [], detail.payload?.contradictions || []);
        setMemoryFetchedAt(new Date());
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
        const response = await fetch(
          `/api/brain/recall?q=${encodeURIComponent(lastUserText.slice(0, 1000))}&limit=8`,
          { credentials: "include", signal: controller.signal },
        );
        if (!response.ok) return;
        const report = (await response.json()) as {
          hits?: Array<{ id?: string; memoryId?: string; content?: string; category?: string; similarity?: number; knnDistance?: number }>;
        };
        const hits = (report.hits ?? []).map((hit, index) => ({
          id: hit.id ?? hit.memoryId ?? `hit-${index}`,
          content: hit.content ?? "",
          category: hit.category ?? "memory",
          similarity: typeof hit.similarity === "number"
            ? hit.similarity
            : typeof hit.knnDistance === "number"
              ? Math.max(0, Math.min(1, 1 - hit.knnDistance))
              : 0,
        }));
        setMemoryData(hits, contradictions);
        setMemoryFetchedAt(new Date());
      } catch {
        // Abort and network failures preserve the last known memory view.
      }
    })();
    return () => controller.abort();
  }, [contradictions, lastUserText, memoryInspectorOpen, setMemoryData]);

  return (
    <div ref={islandRef} className="relative flex h-full w-full flex-col overflow-hidden bg-void text-fg">
      <header className="z-10 flex items-center justify-between gap-3 border-b border-edge bg-void/90 px-3 py-2.5 backdrop-blur-xl sm:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold tracking-wide text-fg">NICK</h1>
            <ChatCapabilityIndicator />
          </div>
          {/* UI-1 authority strip: the header answers "what mode, what
              access" at a glance — the static tagline told the operator
              nothing about current authority. Reads the same store the
              composer writes; gold = non-default. */}
          <p className="mt-0.5 text-[10px] text-fg-tertiary">
            <span className={posture !== "auto" ? "text-gold" : undefined}>{posture === "auto" ? "auto posture" : posture}</span>
            {" · "}
            <span className={depth !== "auto" ? "text-gold" : undefined}>{depth === "auto" ? "auto depth" : depth}</span>
            {/* No separator here: the PRIVATE span below carries its own. This
                line used to read `depth` + " · " + <permission label>, and
                removing the permission picker (#1589) left the delimiter behind
                — the live header rendered "auto posture · auto depth ·" with
                nothing after it, and "auto depth ·  · PRIVATE" when private
                mode was on. Mine; caught on the deployed page, not in review. */}
            {privateMode && <span className="text-gold"> · PRIVATE</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMemoryInspectorOpen(!memoryInspectorOpen)} aria-label="Context and memory" aria-pressed={memoryInspectorOpen} className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-wider ${memoryInspectorOpen ? "border-gold/35 bg-gold/10 text-gold" : "border-edge text-fg-secondary hover:text-fg"}`}>
            <Brain size={13} /><span className="hidden sm:inline">Context</span>
          </button>
          <button onClick={() => setHistoryDrawerOpen(!historyDrawerOpen)} aria-label="Conversation history" aria-pressed={historyDrawerOpen} className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-wider ${historyDrawerOpen ? "border-gold/35 bg-gold/10 text-gold" : "border-edge text-fg-secondary hover:text-fg"}`}>
            <History size={13} /><span className="hidden sm:inline">History</span>
          </button>
          <button onClick={toggleVoiceDock} aria-label={isVoiceDocked ? "Close voice" : "Open voice"} aria-pressed={isVoiceDocked} className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-wider ${isVoiceDocked ? "border-red-500/35 bg-red-500/10 text-red-300" : "border-edge text-fg-secondary hover:text-fg"}`}>
            {isVoiceDocked ? <MicOff size={13} /> : <Mic size={13} />}<span className="hidden sm:inline">Voice</span>
          </button>
        </div>
      </header>

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
            error={chat.error}
            liveContextBlocksRef={chat.liveContextBlocksRef}
            lastTraceIdRef={chat.lastTraceIdRef}
            onRetry={() => void chat.regenerate()}
            onCommand={(prompt) => chat.sendText(prompt)}
          />
          <div ref={endRef} />
        </div>
        {/* Jump to latest — shows only once the operator has scrolled
            away from the bottom (same isNearBottom predicate as the
            auto-follow, so the two can never disagree). 48px circle =
            the iOS-PWA touch-target floor. */}
        {!isAtBottom && (
          <button
            onClick={scrollToBottom}
            aria-label="Scroll to latest message"
            className="absolute bottom-3 right-3 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-void/90 text-fg-secondary shadow-lg backdrop-blur-xl transition-colors hover:text-fg active:scale-95"
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

      <div className="relative z-10 border-t border-edge bg-void/90 px-3 pb-3 pt-3 backdrop-blur-xl sm:px-4">
        <ChatComposer chat={chat} />
      </div>

      {/* BDN-315 · desktop focus panel. Overlays like the memory
          inspector rather than re-laying-out the chat column — the plan
          explicitly warns against forcing a permanent multi-column
          dashboard. Renders null unless the operator opts in. */}
      <ChatMediaFocusPanel />

      <MemoryInspectorSidebar open={memoryInspectorOpen} onClose={() => setMemoryInspectorOpen(false)} hits={recalledHits} contradictions={contradictions} fetchedAt={memoryFetchedAt} reply={replyQuality} />

      {historyDrawerOpen && (
        <div className="absolute inset-y-0 left-0 z-50 w-full border-r border-edge bg-void sm:w-80" style={{ paddingLeft: "env(safe-area-inset-left, 0px)" }}>
          <OperatorConversationDrawer
            convos={conversations.convos}
            activeId={conversations.activeId}
            pinnedIds={conversations.pinnedIds}
            hasMore={conversations.hasMoreConvos}
            loadingMore={conversations.loadingMore}
            onLoadMore={conversations.loadMoreConvos}
            onSelect={(id) => {
              setActiveConversationId(id);
              void conversations.loadConvo(id);
              setHistoryDrawerOpen(false);
            }}
            onDelete={(id, event) => {
              const wasActive = conversations.activeId === id;
              void conversations.deleteConvo(id, event).then((ok) => {
                if (ok && wasActive) setActiveConversationId(null);
              });
            }}
            onRename={conversations.renameConvo}
            onTogglePin={conversations.togglePin}
            onArchive={(id) => conversations.patchConvoFlag(id, "archived", true)}
            onNew={() => {
              setActiveConversationId(null);
              conversations.newChat();
              setHistoryDrawerOpen(false);
            }}
            onShowActions={() => {
              setHistoryDrawerOpen(false);
              chat.sendText("/receipts");
            }}
            onClose={() => setHistoryDrawerOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
