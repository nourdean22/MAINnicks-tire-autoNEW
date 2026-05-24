-- v10.0.526 · Arc A Feature 3 · Voice Latency capture
--
-- Source: Arc A roadmap · per-VAPI-call STT/LLM/TTS latency timestamps
-- so the sub-800ms voice-agent target (per `voice-agents` skill) is
-- observable. Surfaces P50/P95 per stage, breach-streak alerts, and a
-- nightly recommended-delta payload for the apply-route.
--
-- WHY THIS FILE LIVES IN `migrations-pending/`
-- ─────────────────────────────────────────────────────────────────
-- Operator preference (per docs/cohort-2026-05-08-eod-summary.md
-- + prisma/migrations-pending/README.md) · new schema changes are
-- parked here until the operator confirms DATABASE_URL points at
-- production Neon. The Prisma client at runtime degrades gracefully
-- when the table is missing (lib/services/voice-latency.ts catches
-- every write so VAPI handlers never fail because of an un-applied
-- migration).
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────
-- This migration uses standard CREATE TABLE + CREATE INDEX which
-- DO run inside a transaction · safe via `prisma migrate deploy`:
--
--   mv prisma/migrations-pending/20260512_v526_voice_latency \
--      prisma/migrations/20260512_v526_voice_latency
--   pnpm release:db
--   pnpm prisma migrate status   # verify "applied"
--
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS "voice_latency_events";

-- ═══════════════════════════════════════════════════════════════
-- CreateTable
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE "voice_latency_events" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "assistant_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_latency_events_pkey" PRIMARY KEY ("id")
);

-- ═══════════════════════════════════════════════════════════════
-- CreateIndex
-- ═══════════════════════════════════════════════════════════════
--
-- callId+stage · the cron uses (callId, stage) to dedupe events on
-- replay · most-frequent query shape.
-- createdAt    · drives the P50/P95-by-stage rolling window scan +
-- breach-streak read.

CREATE INDEX "voice_latency_events_call_id_stage_idx"
    ON "voice_latency_events"("call_id", "stage");

CREATE INDEX "voice_latency_events_created_at_idx"
    ON "voice_latency_events"("created_at");
