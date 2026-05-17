-- v10.0.196 · ProviderPing table extraction from BrainMemory
CREATE TABLE "provider_pings" (
  "id" TEXT NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "available" BOOLEAN NOT NULL,
  "latency_ms" INTEGER NOT NULL,
  "error_class" VARCHAR(80),
  "pinged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_pings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_pings_provider_pinged_at_idx" ON "provider_pings"("provider", "pinged_at" DESC);
