-- v10.0.198 · SemanticEdge table extraction from BrainMemory
CREATE TABLE "semantic_edges" (
  "id" TEXT NOT NULL,
  "from_memory_id" TEXT NOT NULL,
  "to_memory_id" TEXT NOT NULL,
  "from_category" VARCHAR(64) NOT NULL,
  "to_category" VARCHAR(64),
  "distance" DOUBLE PRECISION NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "semantic_edges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "semantic_edges_from_memory_id_to_memory_id_key" ON "semantic_edges"("from_memory_id", "to_memory_id");
CREATE INDEX "semantic_edges_from_memory_id_score_idx" ON "semantic_edges"("from_memory_id", "score" DESC);
CREATE INDEX "semantic_edges_to_memory_id_score_idx" ON "semantic_edges"("to_memory_id", "score" DESC);
