"use client";

/**
 * Command Palette — ⌘K universal launcher.
 *
 * Press ⌘K (Mac) / Ctrl+K (PC) from anywhere to open. Type to search
 * across:
 *   - Navigate (core pages + depth pages)
 *   - System Ops (live decks: crons, errors, ai-cost, power, ...)
 *   - Diagnostics (push/pull probes + fix-it surfaces)
 *   - Quick Actions (talk to Nick, generate image, flow mode, ...)
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
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
// 2026-05-27 · Power Atlas Phase 1 Task 1.10 · cmdk log-anywhere.
// Parses `<name> <+|-><number> [<note>]` and surfaces fuzzy-matched
// PersonProfile candidates as a dedicated CommandGroup. Hidden when
// the parser returns null (i.e. the query is normal cmdk text).
import RelationshipLogAction from "@/components/command-palette/relationship-log-action";
import {
  ActivityIcon,
  BrainIcon,
  ClipboardListIcon,
  ClockIcon,
  CogIcon,
  HeartPulseIcon,
  MonitorIcon,
  ZapIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
  BotIcon,
  DollarSignIcon,
  WrenchIcon,
  MessageSquareIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  ImageIcon,
  SearchIcon,
  BookOpenIcon,
  EyeIcon,
  ShieldIcon,
  Layers3Icon,
  InboxIcon,
  StethoscopeIcon,
  DatabaseIcon,
  PlayIcon,
  KeyIcon,
  RocketIcon,
  HistoryIcon,
} from "lucide-react";

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
    Array<{ id: string; sourceType: string; content: string }>
  >([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const router = useRouter();
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

  // Keyboard shortcuts:
  //   ⌘K / Ctrl+K       → toggle palette
  //   ⌘⇧K / Ctrl+⇧K    → re-run most-recently-used command (repeat-last)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          // Repeat-last shortcut. Read recents from storage (fresh)
          // and fire the most recent action's callback. Only fires
          // when the palette is CLOSED — if it's already open, let
          // the ⌘K handler close it (predictable).
          if (!open) {
            const ids = loadRecents();
            const mostRecent = ids[0];
            if (mostRecent) {
              const match = actionsRef.current.find((a) => a.id === mostRecent);
              if (match) {
                // Fire immediately without opening the palette.
                void match.action();
                saveRecent(match.id);
                return;
              }
            }
            // No recent yet — fall through to just open the palette.
            setOpen(true);
          }
          return;
        }
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open]);

  // 2026-06-18 · IA reorg Phase 1 · tap-to-open. On the iOS PWA there is no
  // ⌘K — the FloatingHome "Search" button (and the future bottom-bar search)
  // dispatch COMMAND_PALETTE_OPEN_EVENT to open the palette by tap.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen);
  }, []);

  // Refresh recents every time the palette opens — cheap, and makes
  // ranking reflect what he actually just used (multi-tab safe).
  useEffect(() => {
    if (open) setRecents(loadRecents());
  }, [open]);

  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router],
  );

  const openExternal = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  }, []);

  const runAction = useCallback(async (id: string, fn: () => void | Promise<void>) => {
    setLoading(id);
    try {
      await fn();
      saveRecent(id);
    } finally {
      setLoading(null);
      setOpen(false);
    }
  }, []);

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

  const actions: CommandAction[] = useMemo(
    () => [
      // ═══ NAVIGATE — Core 5 + depth pages ═══
      { id: "nav-hq", label: "HQ Dashboard", group: "Navigate", icon: <ShieldIcon className="size-4" />, action: () => navigate("/"), shortcut: "G H" },
      { id: "nav-chat", label: "Nick (AI Chat)", group: "Navigate", icon: <MessageSquareIcon className="size-4" />, action: () => navigate("/chat"), shortcut: "G N" },
      { id: "nav-brain", label: "Brain Dashboard", group: "Navigate", icon: <BrainIcon className="size-4" />, action: () => navigate("/brain"), keywords: ["memory", "skill", "identity", "belief", "ghost", "nick"] },
      { id: "nav-tasks", label: "Tasks / Actions", group: "Navigate", icon: <ClipboardListIcon className="size-4" />, action: () => navigate("/missions"), shortcut: "G T", keywords: ["tasks", "actions", "missions", "loops", "queue"] },
      { id: "nav-journal", label: "Journal", group: "Navigate", icon: <BookOpenIcon className="size-4" />, action: () => navigate("/journal"), shortcut: "G J", keywords: ["journal", "reflect", "dump"] },
      { id: "nav-mastery", label: "Stats", group: "Navigate", icon: <BrainIcon className="size-4" />, action: () => navigate("/stats"), keywords: ["mastery", "growth", "goals", "character", "level", "xp", "stats"] },
      { id: "nav-financial", label: "Financial / Money", group: "Navigate", icon: <DollarSignIcon className="size-4" />, action: () => navigate("/business?tab=money"), keywords: ["money", "income", "business", "funnel"] },
      { id: "nav-settings", label: "Settings", group: "Navigate", icon: <CogIcon className="size-4" />, action: () => navigate("/settings") },

      // ═══ DIAGNOSTICS — push+pull probe hub (ENR3/ENR4) ═══
      { id: "diag-hub", label: "Diagnostics Hub (all probes)", group: "Diagnostics", icon: <StethoscopeIcon className="size-4" />, action: () => navigate("/system/health"), keywords: ["diagnostics", "health", "push", "pull", "probe", "env", "oauth", "pulse", "stale", "cron"] },
      { id: "diag-crons", label: "Cron Diagnostics (silent/slow)", group: "Diagnostics", icon: <ClockIcon className="size-4" />, action: () => navigate("/system/crons"), keywords: ["cron", "silent", "slow", "schedule", "diagnose"] },
      { id: "diag-stale", label: "Stale Data (purge surface)", group: "Diagnostics", icon: <DatabaseIcon className="size-4" />, action: () => navigate("/system/calibration"), keywords: ["stale", "purge", "clean", "orphan", "dismissed"] },
      // v10.0.304 · "Live Event Stream" entry removed · /system/events
      // page deleted. /system/logs covers the same data with broader
      // source list, just slower poll. Manual refresh = live enough.

      // ═══ SYSTEM OPS DECK ═══
      { id: "sys-crons", label: "Crons · live deck", group: "System Ops", icon: <ClockIcon className="size-4" />, action: () => navigate("/system/crons"), keywords: ["cron", "schedule", "job", "kill", "manual"] },
      { id: "sys-errors", label: "Errors · fingerprints", group: "System Ops", icon: <AlertTriangleIcon className="size-4" />, action: () => navigate("/system/logs?view=errors"), keywords: ["error", "log", "stack", "fingerprint"] },
      { id: "sys-ai-cost", label: "AI Cost · burn rate", group: "System Ops", icon: <DollarSignIcon className="size-4" />, action: () => navigate("/system/ai-cost"), keywords: ["cost", "nick", "tokens", "budget", "burn"] },
      { id: "sys-actions", label: "Actions · Nick audit", group: "System Ops", icon: <BotIcon className="size-4" />, action: () => navigate("/system/actions"), keywords: ["action", "autonomous", "rule", "audit", "approval"] },
      { id: "sys-quality", label: "Nick Quality · trend", group: "System Ops", icon: <TrendingUpIcon className="size-4" />, action: () => navigate("/system/calibration"), keywords: ["quality", "critic", "regen", "specificity", "cliche"] },
      { id: "sys-anti", label: "Anti-patterns · library", group: "System Ops", icon: <TrendingDownIcon className="size-4" />, action: () => navigate("/system/calibration"), keywords: ["lesson", "failure", "mistake", "antipattern", "revisit"] },
      { id: "sys-devices", label: "Devices · fleet", group: "System Ops", icon: <MonitorIcon className="size-4" />, action: () => navigate("/system"), keywords: ["device", "ring", "eufy", "tuya", "camera", "agent", "bridge"] },
      { id: "sys-power", label: "Power · master control", group: "System Ops", icon: <ZapIcon className="size-4" />, action: () => navigate("/system"), keywords: ["power", "kill", "provider", "budget", "quiet", "shadow", "emergency"] },
      // 2026-05-23 · UI #4 · new surfaces shipped this session
      { id: "sys-operator-state", label: "Operator State · live pulse", group: "System Ops", icon: <BrainIcon className="size-4" />, action: () => navigate("/system/calibration"), keywords: ["mood", "focus", "capacity", "drift", "momentum", "lecun", "state", "pulse"] },
      { id: "sys-calibration", label: "State Calibration · mood × kind", group: "System Ops", icon: <TrendingUpIcon className="size-4" />, action: () => navigate("/system/calibration"), keywords: ["calibration", "m1", "heatmap", "mood", "kind", "hit rate", "suggestion"] },
      { id: "sys-api-tokens", label: "API Tokens · Chrome ext", group: "System Ops", icon: <CogIcon className="size-4" />, action: () => navigate("/system"), keywords: ["token", "api", "chrome", "extension", "bearer", "sn_"] },
      { id: "sys-judge-eval", label: "Judge-eval · V1↔V2 + calibration", group: "System Ops", icon: <TrendingUpIcon className="size-4" />, action: () => navigate("/system/calibration"), keywords: ["judge", "eval", "v1", "v2", "prompt", "shadow", "calibration", "ground truth"] },
      { id: "sys-lens-stats", label: "Lens Stats · framework fire-rate", group: "System Ops", icon: <ActivityIcon className="size-4" />, action: () => navigate("/system/calibration"), keywords: ["lens", "framework", "elon", "pareto", "stats", "fire"] },
      { id: "nav-brain-board", label: "Brain Board · multi-advisor", group: "Pages", icon: <BrainIcon className="size-4" />, action: () => navigate("/brain?tab=board"), keywords: ["board", "advisor", "consult", "council", "elon", "buffett", "warren", "decision"] },

      // ═══ PAGES — remaining live surfaces ═══
      // 2026-06-18 · IA reorg Phase 1 · STOPGAP — surface the 5 orphan pages
      // (reachable from neither nav nor cmdK before this) so they're tappable
      // on the phone now. Phase 3 makes cmdK iterate the NAV source, after
      // which these no longer need hand-listing here.
      { id: "nav-crm", label: "CRM · Coaching Clients", group: "Pages", icon: <InboxIcon className="size-4" />, action: () => navigate("/crm"), keywords: ["crm", "coaching", "client", "lead", "booking", "agreement", "pipeline"] },
      { id: "nav-finance", label: "Finance · Personal Ledger", group: "Pages", icon: <DollarSignIcon className="size-4" />, action: () => navigate("/finance"), keywords: ["finance", "money", "ledger", "cash", "spending", "csv", "bookkeeping"] },
      { id: "nav-wealth", label: "Wealth · Portfolio", group: "Pages", icon: <TrendingUpIcon className="size-4" />, action: () => navigate("/wealth"), keywords: ["wealth", "portfolio", "investment", "net worth", "holdings", "stocks"] },
      { id: "nav-voice", label: "Voice · Brief + Talk", group: "Pages", icon: <PlayIcon className="size-4" />, action: () => navigate("/voice"), keywords: ["voice", "brief", "audio", "talk", "call", "speak", "morning"] },
      { id: "nav-learn", label: "Learn · Build-Your-Own-X", group: "Pages", icon: <BookOpenIcon className="size-4" />, action: () => navigate("/learn"), keywords: ["learn", "tutorial", "build", "reference", "catalog", "how"] },
      { id: "nav-body", label: "Body Tracking", group: "Pages", icon: <HeartPulseIcon className="size-4" />, action: () => navigate("/stats#body"), keywords: ["weight", "workout", "boxing", "body"] },
      { id: "nav-knowledge", label: "Knowledge Base", group: "Pages", icon: <BookOpenIcon className="size-4" />, action: () => navigate("/knowledge") },
      { id: "nav-integrations", label: "Integrations", group: "Pages", icon: <Layers3Icon className="size-4" />, action: () => navigate("/settings") },
      { id: "nav-devices", label: "Devices", group: "Pages", icon: <MonitorIcon className="size-4" />, action: () => navigate("/system"), keywords: ["ring", "eufy", "camera"] },
      { id: "nav-system", label: "System (dashboard)", group: "Pages", icon: <ActivityIcon className="size-4" />, action: () => navigate("/system") },
      { id: "nav-shop-admin", label: "Shop Admin (nickstire)", group: "Pages", icon: <TrendingUpIcon className="size-4" />, action: () => openExternal("https://nickstire.org/admin"), keywords: ["admin", "nickstire", "business", "shop"] },

      // ═══ QUICK ACTIONS ═══
      { id: "action-chat-nick", label: "Talk to Nick", group: "Quick Actions", icon: <BrainIcon className="size-4" />, action: () => navigate("/chat"), keywords: ["nick", "ai", "ask", "help"] },
      { id: "action-generate-image", label: "Generate Image", group: "Quick Actions", icon: <ImageIcon className="size-4" />, action: () => navigate("/chat?prompt=generate+an+image+of+"), keywords: ["image", "picture", "art", "generate", "imagine"] },
      { id: "action-flow", label: "Start Flow Mode (Brain Dump)", group: "Quick Actions", icon: <ActivityIcon className="size-4" />, action: () => navigate("/chat?mode=flow"), keywords: ["flow", "dump", "journal", "debrief"] },
      { id: "action-search-memory", label: "Search Brain Memories", group: "Quick Actions", icon: <SearchIcon className="size-4" />, action: () => navigate("/chat?prompt=search+my+memories+for+"), keywords: ["memory", "search", "recall", "remember"] },
      { id: "action-blind-spots", label: "Check Blind Spots", group: "Quick Actions", icon: <EyeIcon className="size-4" />, action: () => navigate("/chat?prompt=what+blind+spots+do+I+have+right+now"), keywords: ["blind", "missing", "ignore", "neglect"] },
      {
        id: "action-leads",
        label: "Check Business Dashboard",
        group: "Quick Actions",
        icon: <InboxIcon className="size-4" />,
        action: probe("Business Dashboard", async () => {
          // scattered-components slice · trpc.operator.businessDashboard
          // (the same `getDashboardSummary` service the legacy GET
          // /api/analytics/dashboard called). PRE-EXISTING BUG: the old
          // probe read `d.leads.active/urgent/convertedThisWeek` — but
          // `getDashboardSummary` returns NO `leads` key (its shape is
          // revenue / customers / reviews / jobs / bridgeHealth). The
          // line always showed "Active 0 · Urgent 0 · Converted 0". The
          // typed result forces the real fields — month revenue,
          // customers, jobs today.
          const d = await trpcVanilla.operator.businessDashboard.query();
          return `Revenue $${d.revenue.totalRevenue} · Customers ${d.customers.total ?? 0} (+${d.customers.newThisMonth ?? 0}) · Jobs today ${d.jobs.today ?? 0}`;
        }),
        keywords: ["leads", "pipeline", "business", "revenue", "dashboard"],
      },

      // ═══ POWER — one-keystroke ops surface (ENR5 new) ═══
      {
        id: "power-health-digest",
        label: "Run Health Digest Now",
        group: "Power",
        icon: <RocketIcon className="size-4" />,
        action: probe("Health digest", async () => {
          // Manually trigger the digest — useful right after fixing
          // something to watch the overall bubble down to healthy
          // without waiting until 4am. scattered-components slice ·
          // trpc.operator.refreshHealthDigest (the same
          // `refreshHealthDigest` the legacy GET /api/cron/health-digest
          // / POST /api/ultron/health-digest both call). It returns the
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
          setOpen(false);
          window.location.href = "/api/oauth/google-data/start";
        },
        keywords: ["google", "oauth", "reconnect", "drive", "gmail", "calendar", "refresh", "token"],
      },
      {
        id: "power-diag-all",
        label: "Open Diagnostics Hub (auto-scans)",
        group: "Power",
        icon: <RefreshCwIcon className="size-4" />,
        action: () => navigate("/system/health"),
        keywords: ["probe", "rescan", "diagnose", "all"],
      },
      {
        id: "power-recent-captures",
        label: "View Recent Captures",
        group: "Power",
        icon: <HistoryIcon className="size-4" />,
        action: () => navigate("/"),
        keywords: ["capture", "recent", "omni", "inbox"],
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
        id: "sys-health",
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
    [navigate, openExternal, probe],
  );

  // Keep a ref so the ⌘⇧K keyboard handler can reach the current
  // action list without resubscribing the listener on every re-render.
  const actionsRef = useRef<CommandAction[]>(actions);
  actionsRef.current = actions;

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

  // 2026-05-24 · Wave W Phase 2 · debounced hybrid spotlight fetch.
  // 250ms debounce · only fires for queries ≥ 3 chars · clears
  // results immediately when query empties so cmdk's own
  // action-filter shows alone for short queries. Calls the existing
  // /api/brain/search-hybrid endpoint which already does RRF over
  // FTS + KNN cosine on brain_memory + chat_message (~22 days of
  // paid-for embeddings · zero UI consumer pre-Wave-W).
  useEffect(() => {
    if (!open) {
      setSemanticHits([]);
      return;
    }
    if (query.trim().length < 3) {
      setSemanticHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSemanticLoading(true);
      try {
        const res = await fetch(
          `/api/brain/search-hybrid?q=${encodeURIComponent(query.trim())}&limit=5`,
          { signal: controller.signal, credentials: "same-origin" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        // apiHandler wraps responses in { ok, data, meta } · the
        // search-hybrid handler returns { results: SearchHit[] } where
        // SearchHit has { id (embedding row), sourceType, sourceId,
        // content, rrfScore }. For navigation we need sourceId (the
        // brain_memory or chat_message id) · id is the embedding row.
        const payload = (await res.json()) as {
          data?: {
            results?: Array<{
              id: string;
              sourceType: string;
              sourceId: string;
              content: string;
            }>;
          };
        };
        const results = payload.data?.results ?? [];
        setSemanticHits(
          results.map((r) => ({
            id: r.sourceId,
            sourceType: r.sourceType,
            content: r.content,
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

  // 2026-05-24 · Wave W Phase 2 · semantic-hit navigation. Brain
  // memory hits route to /brain/wisdom?focus=<key> when possible ·
  // chat message hits route to /chat with the message id anchor.
  // Mirror the operator's existing deep-link patterns elsewhere on
  // the page (e.g. /brain/wisdom?focus= from the evolution panel).
  const navigateToHit = useCallback(
    (hit: { id: string; sourceType: string }) => {
      setOpen(false);
      if (hit.sourceType === "brain_memory") {
        router.push(`/brain?tab=wisdom&focus=${encodeURIComponent(hit.id)}`);
      } else if (hit.sourceType === "chat_message") {
        router.push(`/chat#${encodeURIComponent(hit.id)}`);
      } else {
        // Future sources (knowledge_file, task, pin) wire here.
        router.push(`/chat?prompt=${encodeURIComponent(query)}`);
      }
    },
    [router, query],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Type a command or search brain... (⌘K)"
        value={query}
        onValueChange={setQuery}
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
          onLogged={() => setOpen(false)}
        />

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
                <CommandItem
                  key={`semantic-${hit.id}`}
                  value={`semantic-${hit.id}-${hit.content.slice(0, 80)}`}
                  onSelect={() => navigateToHit(hit)}
                >
                  <SearchIcon className="size-4 text-[var(--gold)]/70" />
                  <span className="truncate">{preview}</span>
                  <span className="ml-auto text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                    {hit.sourceType === "brain_memory" ? "memory" : "chat"}
                  </span>
                </CommandItem>
              );
            })}
            {!semanticLoading && semanticHits.length === 0 && (
              <CommandItem disabled value="no-semantic-hits">
                <span className="text-[var(--text-tertiary)]">
                  No matches in brain · keep typing or scroll for actions
                </span>
              </CommandItem>
            )}
          </CommandGroup>
        )}

        {recentActions.length > 0 && (
          <>
            <CommandGroup heading="Recently Used">
              {recentActions.map((action) => (
                <CommandItem
                  key={`recent-${action.id}`}
                  value={`recent ${action.label} ${action.keywords?.join(" ") ?? ""}`}
                  onSelect={() => runAction(action.id, action.action)}
                  disabled={loading === action.id}
                >
                  {action.icon}
                  <span>{loading === action.id ? "Running..." : action.label}</span>
                  <span className="ml-auto text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                    {action.group}
                  </span>
                </CommandItem>
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
                  <CommandItem
                    key={action.id}
                    value={`${action.label} ${action.keywords?.join(" ") ?? ""}`}
                    onSelect={() => runAction(action.id, action.action)}
                    disabled={loading === action.id}
                  >
                    {action.icon}
                    <span>{loading === action.id ? "Running..." : action.label}</span>
                    {action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
                  </CommandItem>
                ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
