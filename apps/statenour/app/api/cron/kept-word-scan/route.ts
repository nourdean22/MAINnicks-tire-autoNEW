/**
 * GET /api/cron/kept-word-scan · 2026-05-27 · Power Atlas Phase 2
 *
 * Daily 02:00 UTC = 9pm ET (prev night). Scans last 24h chat for
 * promises made TO the operator BY known persons, upserts one
 * BrainMemory(category="kept_word") row per (personId, chatMessageId).
 *
 * Silent · no Telegram · operator reads the kept-ratio in /relationships
 * via the future trust-score-from-kept-word derivation.
 */

import { cronHandler } from "@/lib/utils/http";
import { scanKeptWords } from "@/lib/brain/kept-word-tracker";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const result = await scanKeptWords();
  return { ok: true, ...result };
});
