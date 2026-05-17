-- v10.0.421 · MissionLink table for mission-to-mission relationships
-- Operator request: link missions together so dependencies/blocks/
-- related-work surface as graph relationships.
--
-- Self-referential many-to-many via explicit join. Optional `relation`
-- column lets future versions distinguish "depends-on" / "blocks" /
-- "related" without a schema migration.
--
-- ON DELETE CASCADE on both sides · if a mission is hard-deleted the
-- link rows clean up automatically. Mission has Restrict on Task so
-- it's already protected from accidental deletion · we just respect
-- the same convention here.

CREATE TABLE "mission_links" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "relation" VARCHAR(32),
  "note" TEXT,
  "created_by" VARCHAR(64) DEFAULT 'user',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mission_links_pkey" PRIMARY KEY ("id")
);

-- Prevent duplicate links between the same pair (regardless of
-- direction · we treat A→B and B→A as the same logical relationship,
-- even though the table stores them as separate rows for query
-- ergonomics).
CREATE UNIQUE INDEX "mission_links_source_target_key" ON "mission_links" ("source_id", "target_id");

-- Forward + reverse traversal indexes
CREATE INDEX "mission_links_source_idx" ON "mission_links" ("source_id");
CREATE INDEX "mission_links_target_idx" ON "mission_links" ("target_id");
CREATE INDEX "mission_links_created_at_idx" ON "mission_links" ("created_at" DESC);

ALTER TABLE "mission_links" ADD CONSTRAINT "mission_links_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "Mission" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mission_links" ADD CONSTRAINT "mission_links_target_id_fkey"
  FOREIGN KEY ("target_id") REFERENCES "Mission" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A mission can't link to itself · prevent self-loops at the DB level.
ALTER TABLE "mission_links" ADD CONSTRAINT "mission_links_no_self_loop"
  CHECK ("source_id" <> "target_id");
