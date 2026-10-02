"use client";

/**
 * DeployChip — tiny identity badge for the current build.
 *
 * Shows: short SHA · branch · "deployed Xh ago". Clicking opens the
 * commit on GitHub. Lives in the HQ top strip so every time Nour hits
 * the home screen he knows exactly which code is live — critical after
 * a push when you're about to debug something.
 *
 * Silent in dev (SHA = "dev") — no noise when running locally.
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

const GITHUB_REPO = "nourdean22/statenour-os";

export function DeployChip() {
  const [info, setInfo] = useState<DeployInfo | null>(null);
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
        /* silent — dev environment or network hiccup */
      }
    }
    void load();
  }, [utils]);

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
