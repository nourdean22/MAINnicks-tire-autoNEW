import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Kanban, Calendar as CalendarIcon, Filter, Search, Sparkles, RefreshCw } from "lucide-react";
import DraftCard from "@/components/admin/DraftCard";
import PublishDrawer from "@/components/admin/PublishDrawer";

export default function DraftBoardPanel() {
  const [view, setView] = useState<"board" | "calendar">("board");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDraftForPublish, setSelectedDraftForPublish] = useState<any | null>(null);

  const utils = trpc.useUtils();
  
  // Queries
  const { data: carousels, isLoading: carouselsLoading, refetch: refetchCarousels } = trpc.contentAdmin.allCarouselDrafts.useQuery();
  const { data: reels, isLoading: reelsLoading, refetch: refetchReels } = trpc.contentAdmin.allReelDrafts.useQuery();

  // Mutations
  const renderSlides = trpc.contentAdmin.renderCarouselSlides.useMutation({
    onError: (e: any) => toast.error("Slide render failed", { description: e.message }),
  });

  const handleRenderSlides = async (draft: any) => {
    toast.info("Rendering 4:5 slides...", { description: "Deterministic typography via the server renderer." });
    const res = await renderSlides.mutateAsync({
      brief: {
        id: draft.id,
        creativeTerritory: draft.creativeTerritory || "premium_product_ad",
        campaignKeyword: draft.campaignKeyword || "TREAD",
        topic: draft.topic,
        slides: (draft.slides || []).map((s: any) => ({ slideNumber: s.slideNumber, role: s.role, headline: s.headline, body: s.body })),
      },
    });
    const updatedBrief = { ...draft, renderedSlideUrls: res.urls, updatedAt: new Date().toISOString() };
    saveCarousel.mutate({ id: draft.id, topic: draft.topic, brief: updatedBrief });
    toast.success(`Rendered ${res.urls.length} slides`, { description: res.urls[0] });
  };

  const saveCarousel = trpc.contentAdmin.saveCarouselDraft.useMutation({
    onSuccess: () => {
      toast.success("Carousel draft updated");
      utils.contentAdmin.allCarouselDrafts.invalidate();
    },
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  });

  const saveReel = trpc.contentAdmin.saveReelDraft.useMutation({
    onSuccess: () => {
      toast.success("Reel draft updated");
      utils.contentAdmin.allReelDrafts.invalidate();
    },
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  });

  const handleRefetchAll = () => {
    refetchCarousels();
    refetchReels();
  };

  // Merge, normalize, and inject default statuses if missing
  const allDrafts = useMemo(() => {
    const normCarousels = (carousels || []).map((c: any) => ({
      ...c,
      contentType: "carousel" as const,
      status: c.status || "draft",
    }));

    const normReels = (reels || []).map((r: any) => ({
      ...r,
      contentType: "reel" as const,
      status: r.status || "draft",
      // Reels briefs store qualityScore; map to boostScore internally for card consistency
      boostScore: r.qualityScore || 0,
      creativeTerritory: r.archetype || "",
    }));

    // NO SAMPLE INJECTION. This board previously seeded SAMPLE_BRIEFS and
    // SAMPLE_REEL_BRIEFS whenever the real lists came back empty, "so the
    // workspace is never blank" — but it stamped them status "needs_review",
    // so fabricated drafts appeared as items awaiting the operator's review.
    // `isSample: true` was set and then never rendered anywhere, leaving them
    // visually indistinguishable from real work: an operator could review, edit
    // or attempt to publish content that does not exist.
    //
    // An empty board is a true statement about the business. The empty state
    // below already says it well and points at the studios. A blank workspace is
    // better than a populated lie.
    return [...normCarousels, ...normReels];
  }, [carousels, reels]);

  // Apply Search and Filters
  const filteredDrafts = useMemo(() => {
    return allDrafts.filter((d) => {
      const matchStatus = statusFilter === "all" || d.status === statusFilter;
      const matchType = typeFilter === "all" || d.contentType === typeFilter;
      const matchSearch =
        !searchQuery.trim() ||
        d.topic.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.campaignKeyword.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.selectedCaption && d.selectedCaption.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchStatus && matchType && matchSearch;
    });
  }, [allDrafts, statusFilter, typeFilter, searchQuery]);

  const handleUpdateStatus = (draft: any, status: string) => {
    const updatedBrief = { ...draft, status, updatedAt: new Date().toISOString() };
    if (draft.contentType === "carousel") {
      saveCarousel.mutate({ id: draft.id, topic: draft.topic, brief: updatedBrief });
    } else {
      saveReel.mutate({ id: draft.id, topic: draft.topic, brief: updatedBrief });
    }
  };

  const handleUpdateDate = (draft: any, plannedDate: string) => {
    const updatedBrief = { ...draft, plannedDate, updatedAt: new Date().toISOString() };
    if (draft.contentType === "carousel") {
      saveCarousel.mutate({ id: draft.id, topic: draft.topic, brief: updatedBrief });
    } else {
      saveReel.mutate({ id: draft.id, topic: draft.topic, brief: updatedBrief });
    }
  };

  const handleUpdateNotes = (draft: any, notes: string) => {
    const updatedBrief = { ...draft, notes, updatedAt: new Date().toISOString() };
    if (draft.contentType === "carousel") {
      saveCarousel.mutate({ id: draft.id, topic: draft.topic, brief: updatedBrief });
    } else {
      saveReel.mutate({ id: draft.id, topic: draft.topic, brief: updatedBrief });
    }
  };

  // Grouping for Kanban columns
  const COLUMNS = [
    { id: "draft", label: "Drafts" },
    { id: "needs_review", label: "Needs Review" },
    { id: "approved", label: "Approved" },
    { id: "posted", label: "Posted" },
    { id: "archived", label: "Archived" },
  ];

  const groupedByColumn = useMemo(() => {
    const cols: Record<string, any[]> = {
      draft: [],
      needs_review: [],
      approved: [],
      posted: [],
      archived: [],
    };
    filteredDrafts.forEach((d) => {
      if (cols[d.status]) {
        cols[d.status].push(d);
      } else {
        // Fallback to draft column
        cols.draft.push(d);
      }
    });
    return cols;
  }, [filteredDrafts]);

  // Grouping for Calendar view (dates sorted)
  const groupedByDate = useMemo(() => {
    const dates: Record<string, any[]> = {};
    const noDate: any[] = [];

    filteredDrafts.forEach((d) => {
      if (d.plannedDate) {
        if (!dates[d.plannedDate]) dates[d.plannedDate] = [];
        dates[d.plannedDate].push(d);
      } else {
        noDate.push(d);
      }
    });

    const sortedDates = Object.keys(dates).sort();
    return { sortedDates, dates, noDate };
  }, [filteredDrafts]);

  const loading = carouselsLoading || reelsLoading;

  return (
    <div className="space-y-4 relative">
      {/* Filters & Control bar */}
      <div className="bg-card border border-border/30 p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View Toggle */}
          <div className="flex bg-background border border-border/40 rounded p-0.5">
            <button
              onClick={() => setView("board")}
              className={`p-1.5 rounded text-xs font-bold flex items-center gap-1 transition-all ${view === "board" ? "bg-primary/20 text-primary border-primary" : "text-foreground/40 hover:text-foreground/60"}`}
            >
              <Kanban className="w-3.5 h-3.5" /> Board
            </button>
            <button
              onClick={() => setView("calendar")}
              className={`p-1.5 rounded text-xs font-bold flex items-center gap-1 transition-all ${view === "calendar" ? "bg-primary/20 text-primary border-primary" : "text-foreground/40 hover:text-foreground/60"}`}
            >
              <CalendarIcon className="w-3.5 h-3.5" /> Calendar
            </button>
          </div>

          {/* Type Filter */}
          <div className="flex bg-background border border-border/40 rounded p-0.5">
            <button
              onClick={() => setTypeFilter("all")}
              className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase transition-all ${typeFilter === "all" ? "bg-primary/15 text-primary" : "text-foreground/40"}`}
            >
              All
            </button>
            <button
              onClick={() => setTypeFilter("carousel")}
              className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase transition-all ${typeFilter === "carousel" ? "bg-primary/15 text-primary" : "text-foreground/40"}`}
            >
              Carousels
            </button>
            <button
              onClick={() => setTypeFilter("reel")}
              className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase transition-all ${typeFilter === "reel" ? "bg-primary/15 text-primary" : "text-foreground/40"}`}
            >
              Reels
            </button>
          </div>

          {/* Status Filter (Board view only) */}
          {view === "calendar" && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-background border border-border/40 text-[11px] p-1.5 rounded text-foreground/60 focus:outline-none"
            >
              <option value="all">ALL STATUSES</option>
              <option value="draft">DRAFT</option>
              <option value="needs_review">NEEDS REVIEW</option>
              <option value="approved">APPROVED</option>
              <option value="posted">POSTED</option>
              <option value="archived">ARCHIVED</option>
            </select>
          )}
        </div>

        {/* Search & Refresh */}
        <div className="flex items-center gap-2 flex-1 sm:flex-none">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 text-foreground/40 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search topic or keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-background border border-border/50 text-[11px] pl-8 pr-3 py-2 rounded focus:outline-none focus:border-primary/50 transition-colors w-full sm:w-[200px]"
            />
          </div>
          <button
            onClick={handleRefetchAll}
            className="p-2 border border-border/40 rounded hover:border-primary/40 text-foreground/50 hover:text-foreground transition-all"
            title="Refresh drafts"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary/60" />
          <span className="text-xs text-foreground/40 tracking-wider">Syncing drafts with Google Sheets...</span>
        </div>
      ) : allDrafts.length === 0 ? (
        <div className="text-center py-20 border border-border/30 bg-card rounded-lg space-y-3">
          <Sparkles className="w-12 h-12 text-foreground/20 mx-auto" />
          <p className="font-bold text-base text-foreground/40 tracking-wider">NO CONTENT DRAFTS YET</p>
          <p className="text-foreground/30 text-xs max-w-sm mx-auto leading-relaxed">
            Generate a carousel or reel in the respective studios and save it as a draft to begin your publishing schedule.
          </p>
        </div>
      ) : view === "board" ? (
        /* Kanban Board View */
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 items-start">
          {COLUMNS.map((col) => {
            const list = groupedByColumn[col.id] || [];
            return (
              <div key={col.id} className="space-y-3 bg-card/25 border border-border/20 rounded-lg p-3 min-h-[400px]">
                <div className="flex items-center justify-between border-b border-border/20 pb-2 mb-2">
                  <h4 className="font-bold text-xs tracking-wider text-foreground/60 uppercase">{col.label}</h4>
                  <span className="text-[10px] font-bold bg-foreground/5 px-2 py-0.5 rounded text-foreground/40">{list.length}</span>
                </div>
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {list.length === 0 ? (
                    <p className="text-[10px] text-foreground/20 italic text-center py-8">Empty column</p>
                  ) : (
                    list.map((d) => (
                      <DraftCard
                        key={d.id}
                        draft={d}
                        onUpdateStatus={(status) => handleUpdateStatus(d, status)}
                        onUpdateDate={(plannedDate) => handleUpdateDate(d, plannedDate)}
                        onUpdateNotes={(notes) => handleUpdateNotes(d, notes)}
                        onOpenPublish={() => setSelectedDraftForPublish(d)}
                        onRenderSlides={d.contentType === "carousel" && (d.slides || []).length ? () => handleRenderSlides(d) : undefined}
                        onOpenStudio={() => {
                          const route = d.contentType === "carousel" ? "/admin/ig-studio" : "/admin/reel-studio";
                          window.location.href = `${route}?briefId=${d.id}`;
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Calendar View */
        <div className="space-y-6 bg-card/15 border border-border/20 rounded-lg p-5">
          <div className="border-b border-border/20 pb-3">
            <h3 className="font-bold text-sm tracking-wide text-foreground uppercase">Scheduled Posts Calendar</h3>
            <p className="text-[11px] text-foreground/50 mt-0.5">Manage and organize your publishing schedule below.</p>
          </div>

          <div className="space-y-6">
            {groupedByDate.sortedDates.map((date) => {
              const list = groupedByDate.dates[date] || [];
              const formattedDate = new Date(date).toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              });
              return (
                <div key={date} className="space-y-3">
                  <h4 className="font-bold text-xs text-primary tracking-wider border-l-2 border-primary pl-2 uppercase">
                    {formattedDate} <span className="text-[10px] text-foreground/40 font-mono ml-2">({list.length} scheduled)</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {list.map((d) => (
                      <DraftCard
                        key={d.id}
                        draft={d}
                        onUpdateStatus={(status) => handleUpdateStatus(d, status)}
                        onUpdateDate={(plannedDate) => handleUpdateDate(d, plannedDate)}
                        onUpdateNotes={(notes) => handleUpdateNotes(d, notes)}
                        onOpenPublish={() => setSelectedDraftForPublish(d)}
                        onRenderSlides={d.contentType === "carousel" && (d.slides || []).length ? () => handleRenderSlides(d) : undefined}
                        onOpenStudio={() => {
                          const route = d.contentType === "carousel" ? "/admin/ig-studio" : "/admin/reel-studio";
                          window.location.href = `${route}?briefId=${d.id}`;
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Unscheduled Column */}
            {groupedByDate.noDate.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-border/10">
                <h4 className="font-bold text-xs text-amber-500 tracking-wider border-l-2 border-amber-500 pl-2 uppercase">
                  UNSCHEDULED DRAFTS <span className="text-[10px] text-foreground/40 font-mono ml-2">({groupedByDate.noDate.length} items)</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groupedByDate.noDate.map((d) => (
                    <DraftCard
                      key={d.id}
                      draft={d}
                      onUpdateStatus={(status) => handleUpdateStatus(d, status)}
                      onUpdateDate={(plannedDate) => handleUpdateDate(d, plannedDate)}
                      onUpdateNotes={(notes) => handleUpdateNotes(d, notes)}
                      onOpenPublish={() => setSelectedDraftForPublish(d)}
                      onRenderSlides={d.contentType === "carousel" && (d.slides || []).length ? () => handleRenderSlides(d) : undefined}
                        onOpenStudio={() => {
                        const route = d.contentType === "carousel" ? "/admin/ig-studio" : "/admin/reel-studio";
                        window.location.href = `${route}?briefId=${d.id}`;
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Copy-to-Publish Drawer */}
      <PublishDrawer
        isOpen={selectedDraftForPublish !== null}
        onClose={() => setSelectedDraftForPublish(null)}
        draft={selectedDraftForPublish}
        isPosting={saveCarousel.isPending || saveReel.isPending}
        onMarkPosted={() => {
          if (selectedDraftForPublish) {
            handleUpdateStatus(selectedDraftForPublish, "posted");
            setSelectedDraftForPublish(null);
          }
        }}
      />
    </div>
  );
}
