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

interface PageTabsProps {
  tabs: PageTab[];
  /** Query param name (default "tab"). */
  param?: string;
  /** Fallback when `?tab=` is missing/invalid (defaults to the first tab). */
  defaultKey?: string;
  className?: string;
}

function PageTabsInner({ tabs, param = "tab", defaultKey, className }: PageTabsProps) {
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
                "shrink-0 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em]",
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
