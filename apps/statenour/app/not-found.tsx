import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Panel } from "@/components/panel";

export default function NotFoundPage() {
  return (
    <>
      <PageHeader
        eyebrow="Missing"
        title="That screen does not exist."
        description="The route is missing or the record is gone. Return to the command center and re-enter through the active workflow."
      />
      <Panel>
        <Link
          href="/"
          className="inline-flex rounded-2xl border border-[var(--border-hover)] bg-[var(--bg-raised)]/[0.04] px-4 py-3 text-sm font-semibold text-white"
        >
          Back to Command Center
        </Link>
      </Panel>
    </>
  );
}
