"use client";

/**
 * useCustomDomains · v10.0.529.13
 *
 * Single source of truth for the operator's custom-domain list stored
 * at `localStorage["nour:customDomains"]`. Pre-fix this list was parsed
 * twice — once in `app/(mastery)/tasks/page.tsx` (with normalize +
 * setter) and once in `components/actions/loop-stream.tsx` (read-only,
 * re-fired on every `domainEditId` change). The two reads could drift
 * mid-session because there was no cross-component sync.
 *
 * Behavior:
 *   · Reads on mount · returns normalized lowercase trimmed strings.
 *   · `setCustomDomains(next)` persists + dispatches a synthetic
 *     StorageEvent so OTHER components mounting this hook in the same
 *     tab re-render with the new list. Native `storage` events fire
 *     only cross-tab; the dispatch closes the same-tab gap.
 *   · SSR-safe · returns empty array when `window` is undefined.
 *
 * Storage shape: `string[]` of domain labels. Parsing is defensive ·
 * any malformed entry is silently dropped.
 */

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "nour:customDomains";

function readFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === "string")
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// React-style setter signature · supports both direct values and
// updater callbacks so consumers can swap a useState pair 1:1.
export type CustomDomainsSetter = (
  next: string[] | ((prev: string[]) => string[]),
) => void;

export interface UseCustomDomainsResult {
  customDomains: string[];
  setCustomDomains: CustomDomainsSetter;
}

export function useCustomDomains(): UseCustomDomainsResult {
  const [customDomains, setState] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : readFromStorage(),
  );

  // Cross-component sync · when one mount of the hook writes, every
  // other mount re-reads and re-renders. Native StorageEvent only
  // fires across TABS · the synthetic dispatch in `setCustomDomains`
  // covers the same-tab case.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setState(readFromStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setCustomDomains = useCallback<CustomDomainsSetter>((next) => {
    setState((prev) => {
      const resolved =
        typeof next === "function" ? next(prev) : next;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolved));
          // Synthetic event so OTHER `useCustomDomains` mounts in the
          // same tab re-read. Native `storage` event only crosses tab
          // boundaries · this closes that gap.
          window.dispatchEvent(
            new StorageEvent("storage", { key: STORAGE_KEY }),
          );
        } catch {
          // localStorage may be disabled · in-memory state is still valid.
        }
      }
      return resolved;
    });
  }, []);

  return { customDomains, setCustomDomains };
}
