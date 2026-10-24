"use client";

/**
 * Command Palette — ⌘K universal launcher.
 *
 * Press ⌘K (Mac) / Ctrl+K (PC) from anywhere to open. Type to search
 * across:
 *   - Navigate (core pages + depth pages)
 *   - System (one row per /system hub tile, built from components/system/hub-cards.ts)
 *   - Quick Actions (talk to Nick, generate image, ...)
 *   - System probes (live counts from /api/brain/status, /api/health,
 *     /api/system/diagnostics — results surfaced via toast, not alert)
 *   - Power (purge stale, trigger health digest, reconnect Google,
 *     open deployment — one-keystroke-away ops surface)
 *
 * Enrichments (Apr 24):
 *   - Recency boost: last 8 commands run are remembered in
 *     localStorage and surface under "Recently Used" at the top.
 *   - Toast results replace alert() — non-modal, readable mid-flow.
 *   - New entries: /system/diagnostics hub, /system/cron-diagnostics,
 *     /system/stale, /brain, + trigger-health-digest / reconnect-oauth
 *     actions that were previously buried in admin URLs.
 *   - Async actions show inline "Running..." label (existing) AND
 *     emit toast.success / toast.error on finish so the outcome is
 *     visible even after the palette closes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpcVanilla } from "@/lib/trpc/vanilla-client";
import { Command as CommandPrimitive } from "cmdk";
import {
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
// 2026-10-02 · UI v2 · the Resolver's row grammar (notch-on-selected, no gold
// glow) and its hint/kbd class literals live in one place.
import {
  PALETTE_HINT,
  PALETTE_KBD,
  PaletteRow,
} from "@/components/command-palette/palette-row";
// 2026-05-27 · Power Atlas Phase 1 Task 1.10 · cmdk log-anywhere.
// Parses `<name> <+|-><number> [<note>]` and surfaces fuzzy-matched
// PersonProfile candidates as a dedicated CommandGroup. Hidden when
// the parser returns null (i.e. the query is normal cmdk text).
import RelationshipLogAction from "@/components/command-palette/relationship-log-action";
// 2026-06-18 · IA reorg Phase 3 · ⌘K navigation now derives from the single
// NAV source of truth so the bar / MORE sheet / palette can never drift.
import { NAV } from "@/components/layout/nav-items";
// UI v3 W5a · the System group derives from the hub tiles (a hook-free module: this palette mounts
// in the root layout, outside TRPCProvider).
import { hubPaletteRows } from "@/components/system/hub-cards";
import {
  BrainIcon,
  HeartPulseIcon,
  ZapIcon,
  RefreshCwIcon,
  WrenchIcon,
  ImageIcon,
  SearchIcon,
  EyeIcon,
  PlayIcon,
  KeyIcon,
  RocketIcon,
  HistoryIcon,
  BookmarkIcon,
} from "lucide-react";
import { apiFetch } from "@/lib/utils/api-fetch";
// 2026-09-15 · UI workbench · the palette becomes the Intent Resolver: when an
// object is focused (a list row) or open (`?inspect=`), ⌘K leads with the
// actions FOR THAT OBJECT (the Raycast action-panel idea, not its look); the
// workset rides as its own group; a memory hit opens the universal inspector;
// Reality Mode is toggled from here. Spec: docs/design/ui-workbench-2026-09-15.md.
import { useInspectorStore } from "@/lib/state/inspector-store";
import { useWorksetStore } from "@/lib/state/workset-store";
import { ENTITY_KIND_LABEL, formatEntityRef, type EntityRef } from "@/lib/ui/entity-ref";
import { askNickPrompt, homeRouteFor } from "@/lib/ui/entity-actions";
import { useInspector } from "@/hooks/use-inspector";
import { inspectHref, readInspect } from "@/lib/ui/inspect-url";
import { entityLabelFromDom } from "@/hooks/use-selection-keyboard";

interface CommandAction {
  id: string;
  label: string;
  group: string;
  icon: React.ReactNode;
  action: () => void | Promise<void>;
  shortcut?: string;
  keywords?: string[];
}

const RECENT_KEY = "command-palette:recents";
const RECENT_CAP = 8;

// 2026-06-18 · IA reorg Phase 1 · external open-trigger. Mirrors the
// CAPTURE_OPEN_EVENT pattern (brain-dump-modal): any surface can open the
// palette by dispatching this event. Critical on the iOS PWA where there is
// no keyboard for ⌘K — the FloatingHome "Search" button fires it by tap.
export const COMMAND_PALETTE_OPEN_EVENT = "ultron:open-command-palette";

function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(id: string) {
  if (typeof window === "undefined") return;
  try {
    const prev = loadRecents().filter((x) => x !== id);
    const next = [id, ...prev].slice(0, RECENT_CAP);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage full / disabled — silently skip */
  }
}

/**
 * Where a semantic search hit opens. 2026-10-10 · audit 02-F12: a chat hit
 * used `/chat#<messageId>`, which nothing reads, so it opened whatever thread
 * was current. It now opens its own conversation through `?cid=` (read by
 * use-chat-deep-link-prefill). A chat hit that arrives without its
 * conversation id cannot be opened, so it asks Nick, like unknown sources.
 */
export function semanticHitHref(
  hit: { id: string; sourceType: string; conversationId?: string | null },
  query: string,
): string {
  if (hit.sourceType === "brain_memory") {
    // 2026-09-15 · a memory hit opens the universal memory inspector on the
    // Brain memory tab (was: the wisdom tab's KEY-based ?focus= fed a ROW id,
    // a deep link that could never resolve).
    return inspectHref("/brain", "tab=memory", { kind: "memory", id: hit.id });
  }
  if (hit.sourceType === "chat_message" && hit.conversationId) {
    return `/chat?cid=${encodeURIComponent(hit.conversationId)}`;
  }
  // Future sources (knowledge_file, task, pin) wire here.
  return `/chat?prompt=${encodeURIComponent(query)}`;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  // 2026-05-24 · Wave W Phase 2 · universal hybrid spotlight ·
  // operator types in ⌘K · in addition to filtering navigation
  // actions (cmdk default), we ALSO call the /api/brain/search-hybrid
  // RRF endpoint (FTS + KNN cosine fusion across brain_memory +
  // chat_message). Pre-Wave-W this endpoint was wired to nothing the
  // operator used daily · ~22 days of paid-for embeddings sitting
  // idle. Now: ⌘K reaches into your second-brain from anywhere.
  const [query, setQuery] = useState("");
  const [semanticHits, setSemanticHits] = useState<
    Array<{ id: string; sourceType: string; content: string; conversationId?: string | null }>
  >([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const router = useRouter();
  // Inspect actions go through the inspector contract (no scroll-to-top,
  // replace-when-open) instead of a bare router.push (review 2026-09-15).
  const { openInspector } = useInspector();
  // 2026-09-15 · Intent Resolver inputs. `urlFocus` is read when the palette
  // OPENS from window.location, not useSearchParams: this component mounts in
  // the ROOT layout, where a search-params hook would force a Suspense bailout
  // on static routes such as sign-in.
  const focused = useInspectorStore((s) => s.focused);
  const realityMode = useInspectorStore((s) => s.realityMode);
  const setRealityMode = useInspectorStore((s) => s.setRealityMode);
  const hydrateInspector = useInspectorStore((s) => s.hydrate);
  const worksetEntries = useWorksetStore((s) => s.entries);
  const worksetAdd = useWorksetStore((s) => s.add);
  const hydrateWorkset = useWorksetStore((s) => s.hydrate);
  const [urlFocus, setUrlFocus] = useState<EntityRef | null>(null);
  // The URL focus is captured in the OPEN handlers (below), not in an effect —
  // a synchronous setState in an effect is a cascading render. The store
  // hydrations are external-system syncs and idempotent.
  useEffect(() => {
    if (!open) return;
    hydrateInspector();
    hydrateWorkset();
  }, [open, hydrateInspector, hydrateWorkset]);
  const captureUrlFocus = useCallback(() => {
    setUrlFocus(readInspect(window.location.search));
  }, []);
  // scattered-components REST→tRPC slice (2026-05-22 · prerender fix) ·
  // the eight CommandPalette system probes migrated off `authedFetch`
  // onto tRPC. CommandPalette mounts in the ROOT layout
  // (app/layout.tsx), OUTSIDE the <TRPCProvider> that wraps only the
  // (mastery) layout — so the React hook clients (`trpc.useUtils()` /
  // `useMutation()`) throw "Unable to find tRPC Context" at prerender.
  // The probes are imperative (fired from `probe()` closures, never on
  // render), so they call the vanilla client `trpcVanilla` directly —
  // no provider needed, exactly like the root-layout ClientErrorTelemetry.
  // Each procedure delegates to the same service the legacy REST route
  // also calls; most already exist from earlier slices, only
  // `operator.businessDashboard` + `system.aiSpend` are new this slice.

  // 2026-06-18 · IA reorg Phase 1 · tap-to-open. On the iOS PWA there is no
  // ⌘K — the FloatingHome "Search" button (and the future bottom-bar search)
  // dispatch COMMAND_PALETTE_OPEN_EVENT to open the palette by tap.
  useEffect(() => {
    const onOpen = () => {
      captureUrlFocus();
      setRecents(loadRecents());
      setOpen(true);
    };
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen);
  }, [captureUrlFocus]);

  const closePalette = useCallback(() => {
    setOpen(false);
    setSemanticHits([]);
    setSemanticLoading(false);
  }, []);

  const navigate = useCallback(
    (path: string) => {
      closePalette();
      router.push(path);
    },
    [closePalette, router],
  );

  const openExternal = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    closePalette();
  }, [closePalette]);

  const runAction = useCallback(async (id: string, fn: () => void | Promise<void>) => {
    setLoading(id);
    try {
      await fn();
      saveRecent(id);
    } finally {
      setLoading(null);
      closePalette();
    }
  }, [closePalette]);

  // Wrap any async probe so failures surface cleanly as toast.error
  // rather than silently hanging at "Running...".
  const probe = useCallback(
    (label: string, fn: () => Promise<string>) => async () => {
      try {
        const result = await fn();
        toast.success(label, { description: result });
      } catch (err) {
        toast.error(`${label} failed`, {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  // 2026-06-18 · IA reorg Phase 3 · the Navigate group DERIVES from the single
  // NAV source (nav-items.ts) — the bar, MORE sheet, and ⌘K all read it, so they
  // can't drift. A command can't exist here for a destination not in NAV, which
  // structurally deleted the old hand-listed Navigate/Pages groups + the ~10
  // "label-theater" System-Ops entries that all routed to /system or
  // /system/calibration under fake distinct names.
  const navCommands: CommandAction[] = useMemo(
    () =>
      NAV.map((entry) => ({
        id: `nav:${entry.href}`,
        label: entry.label,
        group: "Navigate",
        icon: <entry.icon className="size-4" />,
        action: entry.external
          ? () => openExternal(entry.href)
          : () => navigate(entry.href),
      })),
    [navigate, openExternal],
  );

  // Hub sub-surfaces come from the SAME registry as More/navigation. Before
  // this, only Brain Board was hand-added below, so a new Content/Brain tab
  // could be live and deep-linkable but invisible to the intent resolver.
  const navTabCommands: CommandAction[] = useMemo(
    () =>
      NAV.flatMap((entry) =>
        (entry.tabs ?? []).map((tab) => ({
          id: `nav-tab:${entry.href}:${tab.key}`,
          label: `${entry.label} · ${tab.label}`,
          group: "Navigate",
          icon: <entry.icon className="size-4" />,
          action: () => navigate(`${entry.href}?tab=${encodeURIComponent(tab.key)}`),
          keywords: [entry.label, tab.label, tab.key],
        })),
      ),
    [navigate],
  );

  // The System rows come from the hub list; tiles a Navigate row already reaches are skipped.
  const hubRows = useMemo(
    () =>
      hubPaletteRows(
        new Set(
          NAV.flatMap((entry) => [
            entry.href,
            ...(entry.tabs ?? []).map((tab) => `${entry.href}?tab=${encodeURIComponent(tab.key)}`),
          ]),
        ),
      ),
    [],
  );

  const actions: CommandAction[] = useMemo(
    () => [
      ...navCommands,
      ...navTabCommands,
      // High-value anchors that are deeper than a tab.
      { id: "nav-brain-anti-patterns", label: "Brain · Anti-patterns", group: "Navigate", icon: <BrainIcon className="size-4" />, action: () => navigate("/brain?tab=memory#anti-patterns"), keywords: ["anti-pattern", "lesson", "failure", "revisit"] },
      { id: "nav-brain-recall-preview", label: "Brain · Recall Preview", group: "Navigate", icon: <BrainIcon className="size-4" />, action: () => navigate("/brain?tab=memory#recall-preview"), keywords: ["recall", "memory", "prompt", "context", "retrieval"] },
      { id: "nav-brain-time-travel", label: "Brain · Time Travel", group: "Navigate", icon: <HistoryIcon className="size-4" />, action: () => navigate("/brain?tab=health#time-travel"), keywords: ["time travel", "history", "day", "snapshot", "memory"] },

      // ═══ SYSTEM, built from the hub list (UI v3 W5a, 2026-10-18). Every
      // /system hub tile is one row here unless a Navigate row already reaches
      // its href (one destination, one door; audit 10-U10). Ids and keywords
      // ride on the tile in components/system/hub-cards.ts, so Recently Used
      // and typed searches keep working and a new tile cannot miss the
      // palette. Lab tiles say "Lab". Pinned by
      // tests/components/command-palette-hub-rows.test.tsx. The v10.0.304
      // "Live Event Stream" entry stays gone: /system/logs covers it. ═══
      ...hubRows.map((r) => ({
        id: r.id,
        label: r.label,
        group: "System",
        icon: <r.icon className="size-4" />,
        action: () => navigate(r.href),
        keywords: r.keywords,
      })),

      // ═══ QUICK ACTIONS ═══
      // 2026-10-10 · audit 02-F12: "Start Flow Mode" opened chat with a `mode`
      // param nothing reads; without it, it was a second door to /chat. Chat
      // detects a brain dump on its own, so its keywords live here now.
      { id: "action-chat-nick", label: "Talk to Nick", group: "Quick Actions", icon: <BrainIcon className="size-4" />, action: () => navigate("/chat"), keywords: ["nick", "ai", "ask", "help", "flow", "dump", "journal", "debrief"] },
      { id: "action-generate-image", label: "Generate Image", group: "Quick Actions", icon: <ImageIcon className="size-4" />, action: () => navigate("/chat?prompt=generate+an+image+of+"), keywords: ["image", "picture", "art", "generate", "imagine"] },
      { id: "action-search-memory", label: "Search Brain Memories", group: "Quick Actions", icon: <SearchIcon className="size-4" />, action: () => navigate("/chat?prompt=search+my+memories+for+"), keywords: ["memory", "search", "recall", "remember"] },
      { id: "action-blind-spots", label: "Check Blind Spots", group: "Quick Actions", icon: <EyeIcon className="size-4" />, action: () => navigate("/chat?prompt=what+blind+spots+do+I+have+right+now"), keywords: ["blind", "missing", "ignore", "neglect"] },

      // ═══ POWER — one-keystroke ops surface (ENR5 new) ═══
      {
        id: "power-health-digest",
        label: "Run Health Digest Now",
        group: "Power",
        icon: <RocketIcon className="size-4" />,
        action: probe("Health digest", async () => {
          // Manually trigger the digest, useful right after fixing
          // something to watch the overall bubble down to healthy.
          // There is no cron (f87fb7e62 removed it): GET
          // /api/ultron/health-digest's 4 h read-through is the scheduler.
          // trpc.operator.refreshHealthDigest (the same
          // `refreshHealthDigest` POST /api/ultron/health-digest calls). It returns the
          // full `SystemHealthDigest` where `highlights` is an ARRAY
          // (the cron route returned a count) — so this reads
          // `.highlights.length`.
          const d = await trpcVanilla.operator.refreshHealthDigest.mutate();
          return `overall=${d.overall} · ${d.counts?.critical ?? 0}c / ${d.counts?.warning ?? 0}w · ${d.highlights?.length ?? 0} highlights`;
        }),
        keywords: ["digest", "run", "trigger", "health", "now"],
      },
      {
        id: "power-reconnect-google",
        label: "Reconnect Google OAuth",
        group: "Power",
        icon: <KeyIcon className="size-4" />,
        // Full-page navigation — this is an OAuth start URL that
        // redirects to Google, not a Next.js route we can router.push.
        action: () => {
          closePalette();
          window.location.assign(new URL("/api/oauth/google-data/start", window.location.origin));
        },
        keywords: ["google", "oauth", "reconnect", "drive", "gmail", "calendar", "refresh", "token"],
      },
      {
        id: "power-recent-captures",
        label: "View Recent Captures",
        group: "Power",
        icon: <HistoryIcon className="size-4" />,
        // Captures are journal entries, newest first. This used to open `/`, which has no captures list.
        action: () => navigate("/journal"),
        keywords: ["capture", "recent", "omni", "inbox", "journal"],
      },
      {
        id: "power-pulse-digest",
        label: "Check Pulse Digest (bell)",
        group: "Power",
        icon: <PlayIcon className="size-4" />,
        action: probe("Pulse digest", async () => {
          // scattered-components slice · trpc.brain.pulseDigest (the
          // same `buildPulseDigest` service the legacy GET
          // /api/ultron/pulse-digest called · added by slice 1).
          const d = await trpcVanilla.brain.pulseDigest.query();
          return `priority ${d.priority?.length ?? 0} · emerging ${d.emerging?.length ?? 0} · wins ${d.wins?.length ?? 0} · maintenance ${d.maintenance?.count ?? 0}`;
        }),
        keywords: ["pulse", "digest", "bell", "notification", "priority"],
      },

      // ═══ SYSTEM PROBES — live data via toast (replaces old alert()) ═══
      {
        // Was a second "sys-health" id (the navigate entry above owns it).
        id: "probe-health",
        label: "Run Health Check",
        group: "System Probes",
        icon: <HeartPulseIcon className="size-4" />,
        action: probe("System Health", async () => {
          // scattered-components slice · trpc.system.healthSummary (the
          // same `buildSystemHealth` service the legacy GET /api/health
          // called · added by the system-pages slice).
          const d = await trpcVanilla.system.healthSummary.query();
          return `${d.status ?? "unknown"} · db ${d.db?.latency_ms ?? "?"}ms · devices ${d.devices?.online ?? "?"}/${d.devices?.total ?? "?"}`;
        }),
        keywords: ["health", "status", "ping"],
      },
      {
        id: "sys-diagnostics",
        label: "Full Diagnostics (KPIs)",
        group: "System Probes",
        icon: <WrenchIcon className="size-4" />,
        action: probe("Diagnostics", async () => {
          // scattered-components slice · trpc.system.diagnostics (the
          // same `buildDiagnostics` service the legacy GET
          // /api/system/diagnostics called · added by the system-pages
          // slice). `kpis` is a `Record<string, unknown>` on the typed
          // view — read the numeric KPIs through a narrow cast.
          const d = await trpcVanilla.system.diagnostics.query();
          const kpis = d.kpis as Record<string, number | undefined>;
          return `db ${d.db?.latency_ms}ms · req24h ${kpis.requests_24h ?? 0} · err ${kpis.errors_24h ?? 0} · AI $${((kpis.ai_cost_7d_cents ?? 0) / 100).toFixed(2)}`;
        }),
        keywords: ["diagnostic", "check"],
      },
      {
        id: "sys-brain",
        label: "Brain Status",
        group: "System Probes",
        icon: <BrainIcon className="size-4" />,
        action: probe("Brain", async () => {
          // scattered-components slice · trpc.brain.status (the same
          // three-source assembly the legacy GET /api/brain/status used
          // · added by the settings slice). `memories` is
          // `brainMemory.getStatus()`'s `Record<string, unknown>` —
          // read its numeric fields through a narrow cast.
          const d = await trpcVanilla.brain.status.query();
          const m = d.memories as Record<string, number | undefined>;
          return `${m.total ?? 0} memories (${m.permanent ?? 0} perm) · conf ${((m.avgConfidence ?? 0) * 100).toFixed(0)}% · rules ${d.automationRules?.active ?? 0}`;
        }),
        keywords: ["brain", "memory", "intelligence"],
      },
      {
        id: "sys-ai-spend",
        label: "AI Spend Today",
        group: "System Probes",
        icon: <ZapIcon className="size-4" />,
        action: probe("AI Spend", async () => {
          // scattered-components slice · trpc.system.aiSpend — returns
          // `checkBudget()`'s `BudgetStatus` directly (the legacy
          // /api/system/ai-analytics nested the same budget under
          // `data.budget`; the one-line toast only ever read that
          // slice, so the procedure returns just it).
          const b = await trpcVanilla.system.aiSpend.query();
          return `$${((b.spent ?? 0) / 100).toFixed(2)} / $${((b.limit ?? 0) / 100).toFixed(2)} (${b.percentUsed ?? 0}%)`;
        }),
        keywords: ["cost", "budget", "spend"],
      },
      {
        id: "sys-devices",
        label: "Refresh Device Fleet",
        group: "System Probes",
        icon: <RefreshCwIcon className="size-4" />,
        action: probe("Devices", async () => {
          // scattered-components slice · trpc.system.deviceFleet (the
          // same `buildDeviceFleet` service the legacy GET /api/devices
          // called · added by the system-pages slice). The fleet view
          // exposes per-status counts on `summary.byStatus` directly —
          // no client-side filter needed.
          const d = await trpcVanilla.system.deviceFleet.query();
          const online = d.summary.byStatus.ONLINE ?? 0;
          return `${online}/${d.summary.total} devices online`;
        }),
        keywords: ["device", "sync"],
      },
    ],
    // lint-baseline 2026-08-13 · `openExternal` was flagged as an
    // unnecessary dep (no longer referenced in the memo body).
    [closePalette, navigate, probe, navCommands, navTabCommands, hubRows],
  );

  // Keyboard shortcuts:
  //   ⌘K / Ctrl+K       → toggle palette
  //   ⌘⇧K / Ctrl+⇧K    → re-run most-recently-used command (repeat-last)
  // This listener lives AFTER the finalized action list so repeat-last can
  // read current actions directly — no render-time mutable ref required.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "k" || (!e.metaKey && !e.ctrlKey)) return;
      e.preventDefault();

      if (e.shiftKey) {
        if (!open) {
          const mostRecent = loadRecents()[0];
          const match = mostRecent ? actions.find((action) => action.id === mostRecent) : undefined;
          if (match) {
            void match.action();
            saveRecent(match.id);
            return;
          }
          captureUrlFocus();
          setRecents(loadRecents());
          setOpen(true);
        }
        return;
      }

      if (!open) {
        captureUrlFocus();
        setRecents(loadRecents());
      }
      setOpen((value) => !value);
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [actions, captureUrlFocus, open]);

  // Recency boost: take last-used action IDs in order, surface them at
  // top as a "Recently Used" pseudo-group. Avoids re-ranking the whole
  // list — preserves muscle memory for unused groups.
  const recentActions = useMemo(() => {
    if (recents.length === 0) return [] as CommandAction[];
    const byId = new Map(actions.map((a) => [a.id, a]));
    return recents
      .map((id) => byId.get(id))
      .filter((a): a is CommandAction => a !== undefined)
      .slice(0, 5);
  }, [actions, recents]);

  const groups = [...new Set(actions.map((a) => a.group))];

  // 2026-09-15 · Intent Resolver · the actions for the focused / inspected
  // object lead the palette. Label from the row's own DOM (data-entity-label)
  // so nothing has to be plumbed through props.
  const focusTarget = urlFocus ?? focused;
  const objectActions: CommandAction[] = useMemo(() => {
    if (!focusTarget) return [];
    const ref = focusTarget;
    const key = formatEntityRef(ref);
    const label = entityLabelFromDom(key) ?? `${ENTITY_KIND_LABEL[ref.kind]} ${ref.id}`;
    const group = `Focused · ${ENTITY_KIND_LABEL[ref.kind]}`;
    return [
      {
        id: `object:inspect:${key}`,
        label: `Inspect · ${label}`,
        group,
        icon: <EyeIcon className="size-4" />,
        action: () => openInspector(ref),
        keywords: ["inspect", "open", "peek", ref.kind],
      },
      ...(homeRouteFor(ref)
        ? [
            {
              id: `object:open:${key}`,
              label: "Open on its page",
              group,
              icon: <ZapIcon className="size-4" />,
              action: () => navigate(homeRouteFor(ref) as string),
              keywords: ["page", "go", "jump"],
            },
          ]
        : []),
      {
        id: `object:ask:${key}`,
        label: "Ask Nick about it",
        group,
        icon: <BrainIcon className="size-4" />,
        action: () =>
          navigate(`/chat?prompt=${encodeURIComponent(askNickPrompt([ref], { labelOf: () => label }))}`),
        keywords: ["nick", "why", "ask", "explain"],
      },
      {
        id: `object:workset:${key}`,
        label: "Add to workset · today",
        group,
        icon: <BookmarkIcon className="size-4" />,
        action: () => {
          worksetAdd(ref, label, "today");
          toast.success(`Added to workset · ${label}`);
        },
        keywords: ["workset", "pin", "carry", "shelf"],
      },
    ];
  }, [focusTarget, navigate, openInspector, worksetAdd]);

  const worksetActions: CommandAction[] = useMemo(
    () =>
      worksetEntries.map((entry) => ({
        id: `workset:${formatEntityRef(entry.ref)}`,
        label: entry.label,
        group: "Workset",
        icon: <BookmarkIcon className="size-4" />,
        action: () => openInspector(entry.ref),
        keywords: ["workset", entry.ref.kind, entry.horizon],
      })),
    [worksetEntries, openInspector],
  );

  const modeActions: CommandAction[] = useMemo(
    () => [
      {
        id: "mode-reality",
        label: realityMode
          ? "Reality Mode · on — turn off (provenance back to chips)"
          : "Reality Mode · show provenance inline on every evidence mark",
        group: "Modes",
        icon: <EyeIcon className="size-4" />,
        action: () => {
          const next = !realityMode;
          setRealityMode(next);
          toast.success(next ? "Reality Mode on · every evidence mark now reads inline" : "Reality Mode off");
        },
        keywords: ["reality", "provenance", "evidence", "proof", "truth", "mode"],
      },
    ],
    [realityMode, setRealityMode],
  );

  // 2026-05-24 · Wave W Phase 2 · debounced hybrid spotlight fetch.
  // 250ms debounce · only fires for queries ≥ 3 chars · clears
  // results immediately when query empties so cmdk's own
  // action-filter shows alone for short queries. Calls the existing
  // /api/brain/search-hybrid endpoint which already does RRF over
  // FTS + KNN cosine on brain_memory + chat_message (~22 days of
  // paid-for embeddings · zero UI consumer pre-Wave-W).
  useEffect(() => {
    if (!open || query.trim().length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSemanticLoading(true);
      try {
        // search-hybrid IS apiHandler-wrapped, so this is the one call site of
        // the eighteen that genuinely holds an envelope. It was already reaching
        // through `.data` by hand and was therefore correct — `apiFetch` just
        // removes the hop, and with it the chance of the next editor forgetting
        // it. The payload is { results: SearchHit[] }, where SearchHit carries
        // { id (the embedding row), sourceType, sourceId, content, rrfScore };
        // navigation needs sourceId — the brain_memory or chat_message id — not
        // id.
        const payload = await apiFetch<{
          results?: Array<{
            id: string;
            sourceType: string;
            sourceId: string;
            content: string;
            // search-hybrid joins this for chat hits; it is absent when that
            // lookup failed, and semanticHitHref falls back.
            conversationId?: string | null;
          }>;
        }>(`/api/brain/search-hybrid?q=${encodeURIComponent(query.trim())}&limit=5`, {
          signal: controller.signal,
          credentials: "same-origin",
        });
        const results = payload.results ?? [];
        setSemanticHits(
          results.map((r) => ({
            id: r.sourceId,
            sourceType: r.sourceType,
            content: r.content,
            conversationId: r.conversationId ?? null,
          })),
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // Silent degrade · cmdk's local action filter still works.
        setSemanticHits([]);
      } finally {
        setSemanticLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  // 2026-05-24 · Wave W Phase 2 · semantic-hit navigation; the target is
  // decided by semanticHitHref (module scope, tested).
  const navigateToHit = useCallback(
    (hit: { id: string; sourceType: string; conversationId?: string | null }) => {
      closePalette();
      router.push(semanticHitHref(hit, query));
    },
    [closePalette, router, query],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        closePalette();
        return;
      }
      captureUrlFocus();
      setRecents(loadRecents());
      setOpen(true);
    },
    [captureUrlFocus, closePalette],
  );

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (value.trim().length < 3) {
      setSemanticHits([]);
      setSemanticLoading(false);
    }
  }, []);

  // 2026-10-02 · UI v2 · control chrome, so the panel is `.ui-material` on an
  // UNSTYLED DialogContent (the styled one paints a solid `.neural-glass-modal`
  // step behind it, which would cancel the material). The sr-only title /
  // description mirror what `CommandDialog` rendered. The explicit
  // `CommandPrimitive` root is also what makes the palette WORK: `CommandDialog`
  // never mounted one, and cmdk's Input throws without a root context
  // ("Cannot read properties of undefined (reading 'subscribe')").
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        unstyled
        showCloseButton={false}
        className="fixed left-1/2 top-[10vh] z-[70] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 outline-none sm:max-w-2xl data-open:animate-fade-in-scale data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>Search for a command to run...</DialogDescription>
        </DialogHeader>
        <CommandPrimitive
          data-slot="command"
          className="ui-material flex size-full flex-col overflow-hidden rounded-overlay border border-edge-default text-fg shadow-l2"
        >
      <CommandInput
        placeholder="Type a command or search brain... (⌘K)"
        value={query}
        onValueChange={handleQueryChange}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* 2026-05-27 · Power Atlas Task 1.10 · log-anywhere ledger
            action. Renders ONLY when the typed query matches the
            `<name> <+|-><number> [<note>]` parser. Sits above the
            semantic brain-search so a ledger-syntax query lands on
            the operator's intended action immediately. */}
        <RelationshipLogAction
          query={query.trim()}
          onLogged={closePalette}
        />

        {/* 2026-09-15 · Intent Resolver · the focused / inspected object's
            actions lead; the workset follows. Both empty on a cold palette. */}
        {objectActions.length > 0 && (
          <CommandGroup heading={objectActions[0]!.group}>
            {objectActions.map((action) => (
              <PaletteRow
                key={action.id}
                value={`${action.label} ${action.keywords?.join(" ") ?? ""}`}
                onSelect={() => runAction(action.id, action.action)}
                disabled={loading === action.id}
              >
                {action.icon}
                <span>{loading === action.id ? "Running..." : action.label}</span>
              </PaletteRow>
            ))}
          </CommandGroup>
        )}
        {worksetActions.length > 0 && (
          <CommandGroup heading={`Workset · ${worksetActions.length}`}>
            {worksetActions.map((action) => (
              <PaletteRow
                key={action.id}
                value={`${action.label} ${action.keywords?.join(" ") ?? ""}`}
                onSelect={() => runAction(action.id, action.action)}
              >
                {action.icon}
                <span>{action.label}</span>
                <span className={PALETTE_HINT}>
                  {action.keywords?.[1]}
                </span>
              </PaletteRow>
            ))}
          </CommandGroup>
        )}

        {/* 2026-05-24 · Wave W Phase 2 · semantic spotlight group ·
            top-5 RRF-fused hits across brain_memory + chat_message.
            Rendered above the action groups so a fresh search lands
            on actual content first · navigation second. Hidden when
            query < 3 chars · loading shows a placeholder so the
            operator doesn't perceive a dead palette during the
            ~150ms embedding fetch. */}
        {query.trim().length >= 3 && (
          <CommandGroup
            heading={
              semanticLoading
                ? "Searching brain…"
                : `From your brain · ${semanticHits.length}`
            }
          >
            {semanticHits.map((hit) => {
              const preview = hit.content.slice(0, 140);
              return (
                <PaletteRow
                  key={`semantic-${hit.id}`}
                  value={`semantic-${hit.id}-${hit.content.slice(0, 80)}`}
                  onSelect={() => navigateToHit(hit)}
                >
                  <SearchIcon className="size-4 text-fg-tertiary" />
                  <span className="truncate">{preview}</span>
                  <span className={PALETTE_HINT}>
                    {hit.sourceType === "brain_memory" ? "memory" : "chat"}
                  </span>
                </PaletteRow>
              );
            })}
            {!semanticLoading && semanticHits.length === 0 && (
              <PaletteRow disabled value="no-semantic-hits">
                <span className="text-fg-tertiary">
                  No matches in brain · keep typing or scroll for actions
                </span>
              </PaletteRow>
            )}
          </CommandGroup>
        )}

        {recentActions.length > 0 && (
          <>
            <CommandGroup heading="Recently Used">
              {recentActions.map((action) => (
                <PaletteRow
                  key={`recent-${action.id}`}
                  value={`recent ${action.label} ${action.keywords?.join(" ") ?? ""}`}
                  onSelect={() => runAction(action.id, action.action)}
                  disabled={loading === action.id}
                >
                  {action.icon}
                  <span>{loading === action.id ? "Running..." : action.label}</span>
                  <span className={PALETTE_HINT}>
                    {action.group}
                  </span>
                </PaletteRow>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {groups.map((group, i) => (
          <div key={group}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {actions
                .filter((a) => a.group === group)
                .map((action) => (
                  <PaletteRow
                    key={action.id}
                    value={`${action.label} ${action.keywords?.join(" ") ?? ""}`}
                    onSelect={() => runAction(action.id, action.action)}
                    disabled={loading === action.id}
                  >
                    {action.icon}
                    <span>{loading === action.id ? "Running..." : action.label}</span>
                    {action.shortcut && <kbd className={PALETTE_KBD}>{action.shortcut}</kbd>}
                  </PaletteRow>
                ))}
            </CommandGroup>
          </div>
        ))}

        <CommandSeparator />
        <CommandGroup heading="Modes">
          {modeActions.map((action) => (
            <PaletteRow
              key={action.id}
              value={`${action.label} ${action.keywords?.join(" ") ?? ""}`}
              onSelect={() => runAction(action.id, action.action)}
            >
              {action.icon}
              <span>{action.label}</span>
            </PaletteRow>
          ))}
        </CommandGroup>
      </CommandList>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
