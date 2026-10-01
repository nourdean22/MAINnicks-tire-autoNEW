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
 * Aesthetic: gold-on-dark underline tab bar, matching StandardPage. No purple.
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
  /** One mono line under the label (desktop only). */
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
  "inline-flex min-h-[44px] shrink-0 items-center font-mono text-[12px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/40";

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
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex gap-x-6 gap-y-1 overflow-x-auto",
        variant === "index" && "border-b border-edge pb-2 xl:flex-col xl:gap-y-0 xl:border-b-0 xl:border-r xl:border-edge xl:pb-0 xl:pr-6",
        variant === "row" && "justify-end border-b border-edge",
        variant === "centered" && "justify-center border-b border-edge",
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
              variant !== "index" && "-mb-px border-b-2 px-1",
              isActive
                ? cn("text-gold", variant === "index" ? "xl:border-gold" : "border-gold")
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
        <div data-lens-layout="index" className="mt-6 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:gap-10">
          <SubSwitch tabs={tabs} activeKey={activeKey} onSelect={onSelect} label={label} variant="index" />
          <div role="tabpanel" className="mt-4 min-w-0 xl:mt-0">
            {children}
          </div>
        </div>
      );
    case "reading":
      // A reading column: operator cognition gets a narrow, centered measure.
      return (
        <div data-lens-layout="reading" className="mx-auto mt-6 max-w-3xl">
          <SubSwitch tabs={tabs} activeKey={activeKey} onSelect={onSelect} label={label} variant="centered" />
          <div role="tabpanel" className="mt-6">
            {children}
          </div>
        </div>
      );
    case "ledger":
      // A governed ledger: full width, the switch (if any) tucked right.
      return (
        <div data-lens-layout="ledger" className="mt-6">
          <SubSwitch tabs={tabs} activeKey={activeKey} onSelect={onSelect} label={label} variant="row" />
          <div role="tabpanel" className="mt-4">
            {children}
          </div>
        </div>
      );
    case "board":
      // A ruled board: a left rule frames the pulse readings.
      return (
        <div data-lens-layout="board" className="mt-6 border-l-2 border-edge pl-5 sm:pl-6">
          <SubSwitch tabs={tabs} activeKey={activeKey} onSelect={onSelect} label={label} variant="row" />
          <div role="tabpanel" className="mt-4">
            {children}
          </div>
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
          className="flex flex-wrap items-end gap-x-8 gap-y-1 overflow-x-auto border-b border-edge"
        >
          {lenses.map((l) => {
            const isActive = l.key === activeLens.key;
            return (
              <button
                key={l.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => select(l.tabs[0])}
                className={cn(
                  "-mb-px flex min-h-[52px] shrink-0 flex-col justify-end border-b-2 pb-2 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/40",
                  isActive ? "border-gold text-fg" : "border-transparent text-fg-tertiary hover:text-fg-secondary",
                )}
              >
                <span className="font-display text-2xl font-bold uppercase leading-none tracking-tight sm:text-[28px]">
                  {l.label}
                </span>
                {l.hint && (
                  <span className="mt-1 hidden font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary sm:block">
                    {l.hint}
                  </span>
                )}
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
        className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-default)]"
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
                "min-h-11 shrink-0 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em]",
                "border-b-2 -mb-px transition-colors focus-visible:outline-none",
                "focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40",
                isActive
                  ? "border-[var(--gold)] text-[var(--gold)]"
                  : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
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
