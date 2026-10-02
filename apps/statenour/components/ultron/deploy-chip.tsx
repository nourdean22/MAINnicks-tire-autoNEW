"use client";

/**
 * DeployChip — tiny identity badge for the current build.
 *
 * Shows: short SHA · "deployed Xh ago". Clicking opens the commit on GitHub.
 * Mounted in the /system page header since the full-circle wave 2
 * recomposition (2026-10-02; it sat under Settings > Diagnostics before), so
 * the page that answers "is everything OK?" also says which code is live.
 *
 * Failure vocabulary: a failed deployInfo read renders "build · unknown",
 * never nothing — the old silent catch made a failed read look like dev.
 * Silent only in dev (SHA = "dev"), where the chip has nothing to say.
 */

import { useEffect, useState } from "react";
import { GitCommit } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

interface DeployInfo {
  sha: string;
  shaShort: string;
  commitMessage: string | null;
  branch: string;
  deploymentId: string | null;
  env: string;
  buildTime: string | null;
  serverTime: string;
}

function ageLabel(iso: string | null): string {
  if (!iso) return "unknown";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// The monorepo. The retired standalone repo (nourdean22/statenour-os) was the
// link target until 2026-10-02 and had not carried a deployed SHA since the
// monorepo move (apps/statenour/docs/CURRENT-TRUTH.md).
const GITHUB_REPO = "nourdean22/MAINnicks-tire-autoNEW";

export function DeployChip() {
  const [info, setInfo] = useState<DeployInfo | null>(null);
  const [failed, setFailed] = useState(false);
  // Phase B.6c (2026-05-22) · migrated off `authedFetch("/api/system/
  // deploy-info")` onto `trpc.system.deployInfo`. The read is a one-shot
  // on mount, not a render-time query, so it fires imperatively via
  // `utils.system.deployInfo.fetch()`. The procedure returns the
  // DeployInfo object directly · the legacy `json.data` envelope unwrap
  // is gone.
  const utils = trpc.useUtils();

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await utils.system.deployInfo.fetch();
        if (alive) setInfo(data);
      } catch {
        if (alive) setFailed(true);
      }
    }
    void load();
  }, [utils]);

  if (failed) {
    return (
      <span
        title="deployInfo read failed — the build identity is unknown, not dev"
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/[0.06] px-2 py-0.5 font-mono text-[11px] text-amber-200"
      >
        <GitCommit className="h-3 w-3" />
        <span>build · unknown</span>
      </span>
    );
  }
  if (!info) return null;
  // Don't render the chip in dev/preview — noise without value.
  if (info.sha === "dev" || info.env === "development") return null;

  const href = `https://github.com/${GITHUB_REPO}/commit/${info.sha}`;
  const age = ageLabel(info.buildTime);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={
        info.commitMessage
          ? `${info.commitMessage}\n\n${info.shaShort} · ${info.branch} · deployed ${age}`
          : `${info.shaShort} · ${info.branch} · deployed ${age}`
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-edge-default bg-content px-2 py-0.5",
        "font-mono text-[11px] text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg-secondary",
      )}
    >
      <GitCommit className="h-3 w-3" />
      <span className="font-mono tabular-nums">{info.shaShort}</span>
      <span className="opacity-60">·</span>
      <span className="tabular-nums">{age}</span>
    </a>
  );
}
