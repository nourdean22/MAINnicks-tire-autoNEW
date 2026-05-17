-- v10.0.197 · ToolVerbRatio table extraction from BrainMemory
CREATE TABLE "tool_verb_ratios" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "trace_id" VARCHAR(40),
  "ratio" DOUBLE PRECISION NOT NULL,
  "tools_count" INTEGER NOT NULL,
  "claims_count" INTEGER NOT NULL,
  "hedged" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tool_verb_ratios_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tool_verb_ratios_conversation_id_created_at_idx" ON "tool_verb_ratios"("conversation_id", "created_at" DESC);
CREATE INDEX "tool_verb_ratios_created_at_idx" ON "tool_verb_ratios"("created_at" DESC);
