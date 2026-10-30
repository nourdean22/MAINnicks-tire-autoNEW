/**
 * Home shortcuts (2026-10-30, home-pulse W2): one row of the surfaces the tab bar does not already carry
 * (Home, Chat, Missions, Journal and Command are tabs). Every entry is a real route.
 */
import Link from "next/link";

export const HOME_SHORTCUTS = [
  { label: "People", href: "/people" },
  { label: "Brain", href: "/brain" },
  { label: "Stats", href: "/stats" },
  { label: "System", href: "/system" },
  { label: "Shop", href: "https://nickstire.org/admin" },
] as const;

export function HomeShortcuts() {
  return (
    <nav aria-label="Shortcuts" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-2">
        {HOME_SHORTCUTS.map((s) => (
          <li key={s.href} className="shrink-0">
            <Link
              href={s.href}
              {...(s.href.startsWith("http") ? { target: "_blank" } : {})}
              className="inline-flex min-h-11 items-center rounded-control border border-edge-subtle px-4 text-[13px] text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
