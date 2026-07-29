import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IG_PRIMARY_VIEWS, IG_SECONDARY_VIEWS, type IgView, readIgViewFromUrl, writeIgViewToUrl } from "./igViews";
import Today from "./Today";
import StudioV2 from "./StudioV2";
import QueueV2 from "./QueueV2";
import { Inbox } from "./Inbox";
import Learn from "./Learn";
import Settings from "./Settings";
import DraftBoardPanel from "../DraftBoardPanel";
import PatternLab from "./PatternLab";
import AutonomyCommandCenter from "@/components/admin/AutonomyCommandCenter";
import ActionCenter from "./ActionCenter";

/**
 * The canonical five-view shell (audit Wave 4). The operator has five jobs —
 * what needs attention / create / approve+publish / respond / what worked —
 * not nine equal tabs. Rare surfaces (Planning, reel recovery, autonomy
 * control, settings) live behind the gear. The active view persists in the
 * URL (?igview=), so a refresh or PWA relaunch no longer resets to square one.
 */
export function InstagramAdmin() {
  const [activeView, setActiveView] = useState<IgView>(() => readIgViewFromUrl());
  const navigate = (view: IgView) => {
    setActiveView(view);
    writeIgViewToUrl(view);
  };

  // Same defect class as useUrlFilter's missing popstate listener (admin
  // Wave 4): a one-shot URL read means browser Back moves the address bar
  // but not the screen. Keep the active view honest against history.
  useEffect(() => {
    const sync = () => setActiveView(readIgViewFromUrl());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  // Count ON the surface, so a held reel is visible without going looking.
  // Three reels once sat stuck for 32 hours because nothing surfaced them.
  const attention = trpc.contentAdmin.reelJobsNeedingAttention.useQuery(undefined, {
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const needsAttention = attention.data?.count ?? 0;

  // Meta liveness chip in the header — the operator should not need to open
  // Settings to learn publishing is down. Tri-state, same source HQ uses.
  const health = trpc.instagramAdmin.getPipelineHealth.useQuery(undefined, { refetchInterval: 120_000 });
  const meta = health.data?.meta;
  const metaChip = !meta
    ? null
    : !meta.connected
      ? { className: "border-red-500/40 text-red-400", label: "Meta off" }
      : meta.live === true
        ? { className: "border-emerald-500/40 text-emerald-400", label: "Meta live" }
        : meta.live === false
          ? { className: "border-red-500/40 text-red-400", label: "Meta rejected" }
          : { className: "border-amber-500/40 text-amber-400", label: "Meta unverified" };

  const isSecondary = IG_SECONDARY_VIEWS.some((v) => v.key === activeView);

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">Instagram</h2>
          <p className="text-sm text-muted-foreground">Create, approve, publish, respond, learn — one controlled workflow.</p>
        </div>
        <div className="flex items-center gap-2">
          {metaChip && <Badge variant="outline" className={metaChip.className}>{metaChip.label}</Badge>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More surfaces" className="relative h-11 w-11">
                <Settings2 className="h-4 w-4" />
                {needsAttention > 0 && (
                  <span
                    className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white"
                    aria-label={`${needsAttention} reel job(s) need attention`}
                  >
                    {needsAttention}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>More surfaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {IG_SECONDARY_VIEWS.map((view) => (
                <DropdownMenuItem key={view.key} onSelect={() => navigate(view.key)}>
                  {view.label}
                  {view.key === "actions" && needsAttention > 0 && (
                    <Badge variant="outline" className="ml-2 border-amber-500/40 text-amber-500">{needsAttention}</Badge>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs value={isSecondary ? "" : activeView} onValueChange={(value) => navigate(value as IgView)} className="w-full">
        {/* h-auto is load-bearing (see Wave 3): the base TabsList fixes h-9. */}
        <TabsList className="grid h-auto w-full grid-cols-5 gap-1">
          {IG_PRIMARY_VIEWS.map((view) => (
            <TabsTrigger key={view.key} value={view.key} className="min-h-11">{view.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isSecondary && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button type="button" className="underline min-h-11" onClick={() => navigate("today")}>← Back to Today</button>
          <span>·</span>
          <span className="font-medium text-foreground">{IG_SECONDARY_VIEWS.find((v) => v.key === activeView)?.label}</span>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {activeView === "today" && <Today onNavigate={navigate} />}
        {activeView === "create" && <StudioV2 />}
        {activeView === "publish" && <QueueV2 />}
        {activeView === "community" && <Inbox onNavigate={(legacyTab) => navigate(legacyTab === "studio" ? "create" : "today")} />}
        {activeView === "insights" && <Learn onNavigate={(legacyTab) => navigate(legacyTab === "studio" ? "create" : "today")} />}
        {activeView === "planning" && <DraftBoardPanel onNavigate={() => navigate("create")} />}
        {activeView === "patterns" && <PatternLab onNavigate={navigate} />}
        {activeView === "actions" && <ActionCenter onPublishStaged={() => navigate("publish")} />}
        {activeView === "control" && <AutonomyCommandCenter />}
        {activeView === "settings" && <Settings />}
      </div>
    </div>
  );
}
