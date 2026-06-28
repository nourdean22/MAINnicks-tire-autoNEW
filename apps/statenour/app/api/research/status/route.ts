/**
 * /api/research/status — Statenour Research Lab Status Endpoint
 *
 * GET → Returns research lab status metrics JSON payload.
 *
 * Secured by owner-auth.
 */

import fs from "fs";
import path from "path";
import { apiHandler } from "@/lib/utils/http";
import { redactPaths } from "@/lib/research/redact";

const monorepoRoot = path.join(process.cwd(), "..", "..");
const runtimeStatusPath = path.join(process.cwd(), ".runtime", "research-lab-status.json");

export const GET = apiHandler(
  async () => {
    let status = {
      lastPackGenerated: "",
      packCount: 0,
      lastIngest: null as string | null,
      failedPacks: 0,
      packsAwaitingNotebookLMReview: [] as string[],
      packsAwaitingActionExtraction: [] as string[],
    };

    if (fs.existsSync(runtimeStatusPath)) {
      try {
        const fileContent = fs.readFileSync(runtimeStatusPath, "utf-8");
        status = { ...status, ...JSON.parse(fileContent) };
      } catch (err) {
        console.error("❌ Failed to parse research status file:", err);
      }
    }

    // Refresh packCount in case directories changed manually
    const packsDir = path.join(monorepoRoot, "research-packs");
    if (fs.existsSync(packsDir)) {
      try {
        status.packCount = fs.readdirSync(packsDir).filter((f) => {
          return fs.statSync(path.join(packsDir, f)).isDirectory();
        }).length;
      } catch {}
    }

    // Redact everything just in case
    const jsonStr = JSON.stringify(status);
    return JSON.parse(redactPaths(jsonStr));
  },
  { auth: "owner" }
);
