/**
 * BridgeShell · shared loading + down chrome for /funnel · /radar ·
 * /seo. Each bridge page hit the same 22-line down + loading shell
 * pattern · this primitive absorbs the duplication.
 *
 * Wave X.g (2026-05-24) · companion to the `usePollingFetch`
 * migration that landed in the same wave · the down + loading
 * states are now centralized so a bridge contract regression
 * (or a refresh of the "bridge unavailable" copy) touches one file.
 *
 * Variants:
 *   <BridgeShell title="Funnel" state="loading" />
 *   <BridgeShell title="Radar"  state="down"    />
 *
 * Title is the page name (capitalized) used in the H1 + the
 * down-state copy.
 */

interface BridgeShellProps {
  /** Page name shown in H1 + interpolated into the down-state copy. */
  title: string;
  /** Which empty-state to render. */
  state: "loading" | "down";
}

export function BridgeShell({ title, state }: BridgeShellProps) {
  return (
    <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        {state === "down" ? (
          <p className="mt-4 text-sm text-[var(--text-tertiary)]">
            Bridge to nickstire unavailable · the data lives there. Check
            the bridge status on <a className="underline" href="/system/brain-bus">/system/brain-bus</a>.
          </p>
        ) : (
          <p className="mt-4 text-sm text-[var(--text-tertiary)]/70 animate-pulse">
            Loading…
          </p>
        )}
      </div>
    </main>
  );
}
