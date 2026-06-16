-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_requests" (
    "id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "risk_class" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result_payload" JSONB,
    "requested_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "executed_at" TIMESTAMP(3),
    "screenshot_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "memory_inbox_items" (
    "id" TEXT NOT NULL,
    "source_url" TEXT,
    "source_type" TEXT NOT NULL,
    "raw_text_fenced" TEXT NOT NULL,
    "extracted_claims" JSONB NOT NULL,
    "contradiction_logs" JSONB,
    "privacy_class" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'quarantined',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_inbox_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prompt_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userPrompt" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_runs" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "promptVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'success',
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_memory_hits" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "usedInTurn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_memory_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_feedbacks" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "score" SMALLINT NOT NULL,
    "note" TEXT,
    "corrected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_requests_status_idx" ON "approval_requests"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_requests_created_at_idx" ON "approval_requests"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "memory_inbox_items_status_idx" ON "memory_inbox_items"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "memory_inbox_items_created_at_idx" ON "memory_inbox_items"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prompt_versions_active_idx" ON "prompt_versions"("active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "prompt_versions_version_key" ON "prompt_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runs_traceId_key" ON "agent_runs"("traceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_runs_createdAt_idx" ON "agent_runs"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_runs_model_idx" ON "agent_runs"("model");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_runs_provider_idx" ON "agent_runs"("provider");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_memory_hits_agentRunId_idx" ON "agent_memory_hits"("agentRunId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_memory_hits_memoryId_idx" ON "agent_memory_hits"("memoryId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_feedbacks_agentRunId_key" ON "agent_feedbacks"("agentRunId");

-- AddForeignKey
ALTER TABLE "agent_runs" DROP CONSTRAINT IF EXISTS "agent_runs_promptVersionId_fkey";
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memory_hits" DROP CONSTRAINT IF EXISTS "agent_memory_hits_agentRunId_fkey";
ALTER TABLE "agent_memory_hits" ADD CONSTRAINT "agent_memory_hits_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_feedbacks" DROP CONSTRAINT IF EXISTS "agent_feedbacks_agentRunId_fkey";
ALTER TABLE "agent_feedbacks" ADD CONSTRAINT "agent_feedbacks_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
