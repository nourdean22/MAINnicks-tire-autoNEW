"use client";

/**
 * PageTabs · the canonical route-level tab primitive for statenour surface
 * consolidation (Wave 2). When several former pages merge into one surface
 * (e.g. /brain ← board+wisdom+reason, /market ← seo+radar), each former page
 * becomes a tab here.
 *
 * Contract:
 *  - URL-synced: the active tab lives in `?tab=<key>` so a tab is deep-linkable,
 *    survives reload, and old routes can 301 → `/surface?tab=<key>`.
 *  - Lazy-mounted: only the ACTIVE tab's `render()` runs, so merging N pages
 *    into one route does NOT mount N pages' worth of data fetches on first paint.
 *  - SSR-safe: `useSearchParams` needs a Suspense boundary under Next's static
 *    export — wrapped here so consuming pages don't each have to remember.
 *
 * Lenses (2026-09-16 · Visible Transformation): a page with many tabs can
 * group them into a few LENSES, each with its own composition. The `?tab=`
 * contract is untouched — a lens is derived from the active tab key, and
 * choosing a lens selects its first tab — so every existing deep link
 * (`?tab=memory&resolve=`, `?tab=wisdom&focus=`, …) keeps working. Each lens
 * declares a layout archetype, so switching lenses changes the page's shape
 * (a full-bleed canvas, an indexed library, a reading column, a ledger, a
 * board), not just the label under a bar.
 *
 * Aesthetic (UI v2, 2026-10-02 · docs/design/ui-v2/SYSTEM.md): Geist sentence-case labels, the
 * selected tab is the one gold signal (a 2px underline), everything else is text colour. No
 * display face on a tab, no uppercase, no gold text.
 *
 * UI v3 W4 (2026-10-17, PLAN section 4 "compact content-width tab strips", audit item 8): the lens
 * strip is ONE row at content width (it scrolls, never wraps), 14px labels with the hint as a
 * tooltip only, and a lens's sub-sections are a filter row INSIDE the tabpanel, so the phone shows
 * one strip of chrome before the canvas instead of two. Pinned by
 * tests/components/page-tabs-compact-lens.test.tsx.
 */

import { Suspense, useCallback } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export interface PageTab {
  /** Stable `?tab=` value · also the redirect target key. */
  key: string;
  /** Segmented-control label. */
  label: string;
  /** Lazy — only invoked while this tab is active. */
  render: () => ReactNode;
}

export type PageLensLayout = "canvas" | "index" | "reading" | "ledger" | "board";

export interface PageLens {
  key: string;
  /** Display-type label on the lens bar. */
  label: string;
  /** Tooltip on the lens tab (W4: no longer drawn as a line under the label). */
  hint?: string;
  /** Tab keys grouped under this lens, in display order; the first is its landing tab. */
  tabs: string[];
  /** Composition archetype — the reason lenses exist. */
  layout: PageLensLayout;
}

interface PageTabsProps {
  tabs: PageTab[];
  /** Query param name (default "tab"). */
  param?: string;
  /** Fallback when `?tab=` is missing/invalid (defaults to the first tab). */
  defaultKey?: string;
  /** Optional lens grouping; without it the classic underline tab bar renders. */
  lenses?: PageLens[];
  className?: string;
}

const SUB_ITEM =
  "inline-flex min-h-[44px] shrink-0 items-center text-[13px] font-medium transition-colors duration-[var(--motion-state)]";

function SubSwitch({
  tabs,
  activeKey,
  onSelect,
  label,
  variant,
}: {
  tabs: PageTab[];
  activeKey: string;
  onSelect: (key: string) => void;
  label: string;
  variant: "index" | "row" | "centered";
}) {
  if (tabs.length < 2) return null;
  // Every scrolling row here carries py-1 and px-1 (-mx-1 keeps it aligned) and no tab uses -mb-px:
  // overflow-x-auto clips at the padding box, which cut the 4px focus ring off the edge tabs (audit 09-F16).
  return (
    <nav
      aria-label={label}
      className={cn(
        "-mx-1 flex gap-x-5 gap-y-1 overflow-x-auto px-1 py-1",
        variant === "index" && "xl:flex-col xl:gap-y-0 xl:border-r xl:border-edge xl:pr-6",
        variant === "row" && "justify-end",
        variant === "centered" && "justify-center",
      )}
    >
      {tabs.map((t) => {
        const isActive = t.key === activeKey;
        return (
          <button
            key={t.key}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect(t.key)}
            className={cn(
              SUB_ITEM,
              variant === "index" && "xl:border-l-2 xl:pl-3",
              variant !== "index" && "border-b-2 px-1",
              isActive
                ? cn("text-fg", variant === "index" ? "xl:border-accent" : "border-accent")
                : cn("text-fg-tertiary hover:text-fg-secondary", variant === "index" ? "xl:border-transparent" : "border-transparent"),
            )}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

function LensBody({
  lens,
  tabs,
  activeKey,
  onSelect,
  children,
}: {
  lens: PageLens;
  tabs: PageTab[];
  activeKey: string;
  onSelect: (key: string) => void;
  children: ReactNode;
}) {
  const label = `${lens.label} sections`;
  switch (lens.layout) {
    case "canvas":
      // A full-bleed surface: the content IS the page; no secondary chrome.
      return (
        <div role="tabpanel" data-lens-layout="canvas" className="mt-4">
          {children}
        </div>
      );
    case "index":
      // An indexed library: a vertical index on the left at >=1280px, the
      // reading surface beside it; the index collapses to a row below that.
      return (
        <div role="tabpanel" data-lens-layout="index" className="mt-4 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:gap-10">
          <SubSwitch tabs={tabs} activeKey={activeKey} onSelect={onSelect} label={label} variant="index" />
          <div className="mt-3 min-w-0 xl:mt-0">{children}</div>
        </div>
      );
    case "reading":
      // A reading column: operator cognition gets a narrow, centered measure.
      return (
        <div role="tabpanel" data-lens-layout="reading" className="mx-auto mt-4 max-w-3xl">
          <SubSwitch tabs={tabs} activeKey={activeKey} onSelect={onSelect} label={label} variant="centered" />
          <div className="mt-4">{children}</div>
        </div>
      );
    case "ledger":
      // A governed ledger: full width, the switch (if any) tucked right.
      return (
        <div role="tabpanel" data-lens-layout="ledger" className="mt-4">
          <SubSwitch tabs={tabs} activeKey={activeKey} onSelect={onSelect} label={label} variant="row" />
          <div className="mt-3">{children}</div>
        </div>
      );
    case "board":
      // A ruled board: a left rule frames the pulse readings.
      return (
        <div role="tabpanel" data-lens-layout="board" className="mt-4 border-l-2 border-edge pl-5 sm:pl-6">
          <SubSwitch tabs={tabs} activeKey={activeKey} onSelect={onSelect} label={label} variant="row" />
          <div className="mt-3">{children}</div>
        </div>
      );
  }
}

function PageTabsInner({ tabs, param = "tab", defaultKey, lenses, className }: PageTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlKey = searchParams.get(param);
  const activeKey =
    tabs.some((t) => t.key === urlKey) && urlKey
      ? urlKey
      : defaultKey ?? tabs[0]?.key;

  const select = useCallback(
    (key: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(param, key);
      // Shallow URL update · keep scroll position when switching tabs.
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, param],
  );

  const active = tabs.find((t) => t.key === activeKey);

  if (lenses && lenses.length > 0) {
    const activeLens = lenses.find((l) => l.tabs.includes(activeKey ?? "")) ?? lenses[0];
    const lensTabs = activeLens.tabs
      .map((key) => tabs.find((t) => t.key === key))
      .filter((t): t is PageTab => Boolean(t));
    return (
      <div className={className} data-lens={activeLens.key}>
        <div
          role="tablist"
          aria-label="Lenses"
          className="-mx-1 flex w-fit max-w-full flex-nowrap items-end gap-x-5 overflow-x-auto border-b border-edge px-1 py-1"
        >
          {lenses.map((l) => {
            const isActive = l.key === activeLens.key;
            return (
              <button
                key={l.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={l.hint}
                onClick={() => select(l.tabs[0])}
                className={cn(
                  "inline-flex min-h-[44px] shrink-0 items-center border-b-2 text-[14px] font-medium transition-colors duration-[var(--motion-state)]",
                  isActive ? "border-accent text-fg" : "border-transparent text-fg-tertiary hover:text-fg-secondary",
                )}
              >
                {l.label}
              </button>
            );
          })}
        </div>
        <LensBody lens={activeLens} tabs={lensTabs} activeKey={activeKey ?? ""} onSelect={select}>
          {active?.render()}
        </LensBody>
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Page sections"
        className="-mx-1 flex items-center gap-1 overflow-x-auto border-b border-edge-subtle px-1 py-1"
      >
        {tabs.map((t) => {
          const isActive = t.key === activeKey;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => select(t.key)}
              className={cn(
                "min-h-11 shrink-0 px-3 py-2 text-[13px] font-medium",
                "border-b-2 transition-colors duration-[var(--motion-state)]",
                isActive
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-tertiary hover:text-fg-secondary",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="mt-4">
        {active?.render()}
      </div>
    </div>
  );
}

export function PageTabs(props: PageTabsProps) {
  return (
    <Suspense fallback={null}>
      <PageTabsInner {...props} />
    </Suspense>
  );
}
