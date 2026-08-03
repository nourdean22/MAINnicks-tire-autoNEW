import { Link2Off, X } from "lucide-react";

interface Props {
  /** The raw `?tab=` slug that resolved to nothing, or null when the link was fine. */
  slug: string | null;
  onDismiss: () => void;
}

/**
 * Says out loud that a deep link pointed at a section that does not exist.
 *
 * `resolveInitialSection()` used to end in `?? "overview"`, so a mistyped, stale or
 * renamed `?tab=` slug landed on Today in silence — indistinguishable from the
 * operator deliberately opening Today. That is the same all-clear-on-failure shape
 * this admin has been pulling out of its counts and empty states: a failure that
 * renders as an ordinary success.
 *
 * Deliberately amber, not red. Nothing is broken and no data is wrong — the
 * operator is simply not where they asked to be, which is a navigation notice, not
 * a data alert. Red is reserved for `DegradedDataBanner`, where the numbers on
 * screen are not real.
 *
 * Any deliberate navigation clears this via the `setSection` wrapper in
 * `useAdminNavigation`, so it cannot outlive the moment it describes.
 */
export default function UnknownSectionNotice({ slug, onDismiss }: Props) {
  if (!slug) return null;

  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3"
    >
      <Link2Off className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-amber-200 text-sm">That link went nowhere</p>
        <p className="text-amber-100/80 text-xs mt-1 leading-relaxed">
          No admin section matches
          <span className="mx-1 font-mono opacity-80 break-all">?tab={slug}</span>
          so you are on Today instead. The link is probably stale or mistyped — search
          for the section you wanted rather than trusting it again.
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 text-amber-300/60 hover:text-amber-200 p-1 -m-1 rounded-md"
        aria-label="Dismiss bad-link notice"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
