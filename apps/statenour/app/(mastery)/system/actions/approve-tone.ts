// Kept out of page.tsx: a Next.js page may only export the page and its config fields.

/**
 * Fill for a pending request's Approve button. Gold is the page's one deliberate accent, so only the first request
 * gets it; N gold fills read as N equally urgent calls to act (audit 09-X5). Critical stays rose wherever it sits.
 */
export function approveTone(index: number, isCritical: boolean): string {
  if (isCritical) return "bg-rose-500 text-black hover:bg-rose-600 disabled:bg-rose-800";
  if (index === 0) return "bg-accent text-black hover:bg-accent-hover";
  return "border border-edge-strong bg-surface-interactive text-fg hover:bg-surface-hover";
}
