import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";

// UI v3 W5c (2026-10-29 sync audit, finding 15): no Panel box and no hard-coded white; the same
// plain voice and 44 px link as the (mastery) error screen.
export default function NotFoundPage() {
  return (
    <>
      <PageHeader
        eyebrow="Not found"
        title="Nothing lives at this address."
        description="The page moved, or the record behind it was deleted."
      />
      <section className="border-l-2 border-edge-strong pl-5 sm:pl-6">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center rounded-control border border-edge-default bg-content px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
        >
          Back to home
        </Link>
      </section>
    </>
  );
}
