/**
 * Shop media (2026-10-18, job shop-media-library): Nour's imported shop photos and
 * videos arrive quarantined with reuse off. Nothing reaches a post or a reel until
 * he approves it here, on his phone.
 *
 * Contract: shared/shopMedia.ts, router shopMedia (list / review / stats). Review is
 * a compare-and-swap on the server, so the result names every item it skipped and
 * why; those reasons are shown in words, never swallowed.
 *
 * Failure honesty: a failed or offline (paused) read renders "could not load" with a
 * retry, never an empty grid. Approve and Reject are two taps in the DOM: native
 * dialogs are dead in the iOS home-screen app.
 */
import { useState, type ReactNode } from "react";
import { Check, Images, Play } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ShopMediaItem, ShopMediaKind, ShopMediaOrientation, ShopMediaReviewResult, ShopMediaState } from "@shared/shopMedia";
import { PageHeader } from "./shared/layout";
import { ErrorState, LoadingState } from "./shared/states";
import { formatClipLength } from "./shared/format";

const TABS: Array<{ id: ShopMediaState; label: string; empty: string }> = [
  { id: "quarantined", label: "Quarantined", empty: "Nothing is quarantined." },
  { id: "approved", label: "Approved", empty: "Nothing is approved yet." },
  { id: "rejected", label: "Rejected", empty: "Nothing is rejected." },
];

const PEOPLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Any people" },
  { value: "none", label: "No people" },
  { value: "staff", label: "Staff" },
  { value: "nour", label: "Nour" },
  { value: "customer", label: "Customer" },
  { value: "unclear", label: "Unclear" },
];

type Decision = "approve" | "reject";

/** The server's skip reasons (shared/shopMedia.ts), in words a person can act on. */
function skipReasonInWords(reason: string): string {
  const [code, detail] = reason.split(":");
  switch (code) {
    case "not_found": return "no longer in the library";
    case "not_shop_media": return `not shop media (${detail ?? "unknown"} provider)`;
    case "not_current_version": return "a newer version exists";
    case "not_quarantined": return `already ${detail ?? "reviewed"}`;
    case "not_reviewable": return `cannot be reviewed while ${detail ?? "in this state"}`;
    case "changed_concurrently": return `changed by someone else, now ${detail ?? "in another state"}`;
    default: return reason;
  }
}

const itemTitle = (item: Pick<ShopMediaItem, "subject" | "assetId">) => item.subject?.trim() || `Item ${item.assetId}`;

export default function ShopMediaSection() {
  const [tab, setTab] = useState<ShopMediaState>("quarantined");
  const [kind, setKind] = useState<ShopMediaKind | "">("");
  const [orientation, setOrientation] = useState<ShopMediaOrientation | "">("");
  const [people, setPeople] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [result, setResult] = useState<(ShopMediaReviewResult & { decision: Decision; titles: Record<string, string> }) | null>(null);

  const stats = trpc.shopMedia.stats.useQuery(undefined, { staleTime: 30_000 });
  const list = trpc.shopMedia.list.useInfiniteQuery(
    {
      state: tab,
      limit: 48,
      ...(kind ? { kind } : {}),
      ...(orientation ? { orientation } : {}),
      ...(people ? { people } : {}),
      ...(tag ? { tag } : {}),
    },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  const review = trpc.shopMedia.review.useMutation({
    onSuccess: (res, input) => {
      // Names are captured now: after the refetch a reviewed item has left this tab's list.
      const titles = Object.fromEntries(items.map((i) => [i.assetId, itemTitle(i)]));
      setResult({ ...res, decision: input.decision, titles });
      setSelected(new Set());
      setConfirming(null);
      void list.refetch();
      void stats.refetch();
    },
    onError: (err) => {
      // A batch can fail after some rows changed, so the screen re-reads instead of trusting what it shows.
      setConfirming(null);
      setSelected(new Set());
      void list.refetch();
      void stats.refetch();
      toast.error("Review did not save. Some items may have changed, list refreshed.", { description: err.message });
    },
  });

  // Any change of view drops the selection, so a review never sends ids that are off screen.
  const changeView = (apply: () => void) => {
    apply();
    setSelected(new Set());
    setConfirming(null);
  };

  const selectable = tab !== "rejected";
  const toggle = (assetId: string) => {
    setConfirming(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const commitTag = () => {
    const next = tagDraft.trim();
    if (next !== tag) changeView(() => setTag(next));
  };

  const tabCount = (state: ShopMediaState) => {
    if (!stats.data) {
      return stats.isError
        ? <span aria-label="count unknown" title="Count unknown: the stats read failed" className="text-muted-foreground">?</span>
        : null;
    }
    return <span className="tabular-nums text-muted-foreground">{stats.data[state].photo + stats.data[state].video}</span>;
  };

  const emptyCopy = TABS.find((t) => t.id === tab)!.empty;

  let body: ReactNode;
  if (!list.data) {
    if (list.isError) body = <ErrorState message="Could not load shop media. This is unknown, not empty." onRetry={() => void list.refetch()} />;
    else if (list.fetchStatus === "paused") body = <ErrorState message="Offline: shop media could not load. This is unknown, not empty." onRetry={() => void list.refetch()} />;
    else body = <LoadingState label="Loading shop media..." />;
  } else if (items.length === 0) {
    body = <p className="py-12 text-center text-sm text-muted-foreground">{emptyCopy}{kind || orientation || people || tag ? " Try clearing a filter." : ""}</p>;
  } else {
    body = (
      <section aria-label="Shop media items" className="space-y-3">
        {list.isError && (
          <p className="text-xs text-amber-500">
            The last read failed; the items shown may be out of date.{" "}
            <button type="button" onClick={() => void list.refetch()} className="min-h-12 underline">Try again</button>
          </p>
        )}
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <MediaCard
              key={item.assetId}
              item={item}
              selectable={selectable}
              selected={selected.has(item.assetId)}
              onToggle={() => toggle(item.assetId)}
            />
          ))}
        </ul>
        {list.hasNextPage && (
          <button
            type="button"
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
            className="min-h-12 w-full rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            {list.isFetchingNextPage ? "Loading..." : "Load more"}
          </button>
        )}
      </section>
    );
  }

  const count = selected.size;
  const noun = count === 1 ? "item" : "items";

  return (
    <div className="space-y-4 pb-36 lg:pb-24">
      <PageHeader
        title="Shop media"
        subtitle="Imported shop photos and videos. Nothing is used in a post or reel until you approve it."
        icon={<Images className="h-5 w-5" />}
      />

      <div className="sticky top-0 z-10 space-y-2 border-b border-border bg-background py-2">
        <div role="tablist" aria-label="Review state" className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => changeView(() => setTab(t.id))}
              className={`inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${tab === t.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label} {tabCount(t.id)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
            {([["", "All"], ["photo", "Photos"], ["video", "Videos"]] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={kind === value}
                onClick={() => changeView(() => setKind(value))}
                className={`min-h-12 px-3 text-sm ${kind === value ? "bg-secondary font-medium text-foreground" : "text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            aria-label="Orientation"
            value={orientation}
            onChange={(e) => changeView(() => setOrientation(e.target.value as ShopMediaOrientation | ""))}
            className="h-12 shrink-0 rounded-md border border-border bg-background px-2 text-base"
          >
            <option value="">Any shape</option>
            <option value="vertical">Vertical</option>
            <option value="horizontal">Horizontal</option>
          </select>
          <select
            aria-label="People"
            value={people}
            onChange={(e) => changeView(() => setPeople(e.target.value))}
            className="h-12 shrink-0 rounded-md border border-border bg-background px-2 text-base"
          >
            {PEOPLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            aria-label="Tag"
            placeholder="Tag, e.g. brakes"
            value={tagDraft}
            maxLength={64}
            onChange={(e) => setTagDraft(e.target.value)}
            onBlur={commitTag}
            onKeyDown={(e) => { if (e.key === "Enter") commitTag(); }}
            enterKeyHint="search"
            className="h-12 w-40 shrink-0 rounded-md border border-border bg-background px-2 text-base"
          />
        </div>
      </div>

      {result && (
        <div role="status" aria-label="Review result" className="space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="font-medium">{result.changed.length} {result.decision === "approve" ? "approved" : "rejected"}.</p>
          {result.skipped.length > 0 && (
            <>
              <p>{result.skipped.length} skipped:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {result.skipped.map((s) => (
                  <li key={s.assetId}>
                    <span className="text-foreground">{result.titles[s.assetId] ?? `Item ${s.assetId}`}</span>: {skipReasonInWords(s.reason)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" onClick={() => setResult(null)} className="min-h-12 text-xs text-muted-foreground underline">Dismiss</button>
        </div>
      )}

      {body}

      {selectable && count > 0 && (
        <section
          aria-label="Selection"
          className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom,0px))] z-40 border-t border-border bg-[var(--surface-raised)] px-4 py-2 lg:inset-x-auto lg:bottom-4 lg:right-4 lg:w-[28rem] lg:rounded-lg lg:border"
        >
          {confirming ? (
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-sm">{confirming === "approve" ? "Approve" : "Reject"} {count} {noun}?</p>
              <button type="button" onClick={() => setConfirming(null)} className="min-h-12 rounded-md bg-secondary px-4 text-sm">Keep</button>
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate({ assetIds: [...selected], decision: confirming })}
                className={`min-h-12 rounded-md px-4 text-sm font-semibold disabled:opacity-60 ${confirming === "approve" ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"}`}
              >
                {review.isPending ? "Saving..." : confirming === "approve" ? "Confirm approve" : "Confirm reject"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-sm">{count} selected</p>
              <button type="button" onClick={() => setSelected(new Set())} className="min-h-12 px-2 text-sm text-muted-foreground underline">Clear</button>
              <button type="button" onClick={() => setConfirming("reject")} className="min-h-12 rounded-md bg-secondary px-4 text-sm font-medium">Reject</button>
              {tab === "quarantined" && (
                <button type="button" onClick={() => setConfirming("approve")} className="min-h-12 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Approve</button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * The rights label a reviewer must see before approving. Anything not captured footage says so
 * on the card, so an AI repaint is never approved as if it were evidence of real work.
 */
function rightsBadge(rightsStatus: string): string | null {
  if (rightsStatus === "real_shop") return null;
  if (rightsStatus === "operator_ai_edit" || rightsStatus === "ai_generated") return "AI edited";
  return rightsStatus;
}

// editRecipe is the contract field the server lane is adding (PR 3177 review); optional here so this compiles before it lands.
type ReviewCardItem = ShopMediaItem & { editRecipe?: string | null };

function MediaCard({ item, selectable, selected, onToggle }: {
  item: ReviewCardItem;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const length = item.kind === "video" ? formatClipLength(item.durationMs) : null;
  const flags = [
    item.faces ? `${item.faces} ${item.faces === 1 ? "face" : "faces"}` : null,
    item.moe ? "Old Moe sign" : null,
    item.plate ? "Plate visible" : null,
    item.quality !== null ? `Quality ${item.quality}/5` : null,
  ].filter(Boolean);
  const badge = rightsBadge(item.rightsStatus);
  const recipe = item.editRecipe?.trim() || null;

  return (
    <li className={`overflow-hidden rounded-lg border ${selected ? "border-primary ring-2 ring-primary/40" : "border-border"}`}>
      <button
        type="button"
        aria-pressed={selectable ? selected : undefined}
        aria-label={`${itemTitle(item)}, ${item.kind}${badge ? `, ${badge}` : ""}`}
        disabled={!selectable}
        onClick={onToggle}
        className="block w-full text-left"
      >
        <div className="relative aspect-square bg-muted">
          {!item.url ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No preview</div>
          ) : item.kind === "video" ? (
            // #t=0.1 makes iOS Safari paint a first frame without a separate poster image.
            <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" className="h-full w-full object-cover" />
          ) : (
            <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
          {item.kind === "video" && (
            <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
              <Play className="h-3 w-3" aria-hidden="true" />
              {length}
            </span>
          )}
          {badge && (
            <span className="absolute right-1 top-1 rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-black">{badge}</span>
          )}
          {selected && (
            <span className="absolute left-1 top-1 rounded bg-primary p-0.5 text-primary-foreground">
              <Check className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="space-y-1 p-2">
          <p className="line-clamp-2 text-xs font-medium">{itemTitle(item)}</p>
          {recipe && <p className="line-clamp-2 text-[11px] text-amber-500">Edit: {recipe}</p>}
          {item.tags.length > 0 && <p className="truncate text-[11px] text-muted-foreground">{item.tags.slice(0, 3).join(", ")}</p>}
          {flags.length > 0 && <p className="text-[11px] text-muted-foreground">{flags.join(" · ")}</p>}
        </div>
      </button>
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer" className="flex min-h-12 items-center px-2 text-xs text-primary underline">
          Open
        </a>
      )}
    </li>
  );
}
