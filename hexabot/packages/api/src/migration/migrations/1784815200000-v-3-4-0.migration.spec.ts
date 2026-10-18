/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DataSource, QueryRunner, Repository } from 'typeorm';

import { SettingOrmEntity } from '@/setting/entities/setting.entity';

import Migration1784815200000_V3_4_0 from './1784815200000-v-3-4-0.migration';

describe('Migration v3.4.0', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  let settings: Repository<SettingOrmEntity>;

  beforeEach(async () => {
    dataSource = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [SettingOrmEntity],
      synchronize: true,
    }).initialize();
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    settings = queryRunner.manager.getRepository(SettingOrmEntity);
    await queryRunner.query(
      `CREATE TABLE "contents" (` +
        `"id" varchar PRIMARY KEY, "searchText" text NOT NULL` +
        `)`,
    );
    await queryRunner.query(
      `INSERT INTO "contents" ("id", "searchText") VALUES ('content-1', 'hello world')`,
    );
  });

  afterEach(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  const getValue = async (group: string, label: string) =>
    (
      await settings.findOneByOrFail({
        group,
        label,
      })
    ).value;

  it('drops a legacy btree index on searchText', async () => {
    await queryRunner.query(
      `CREATE INDEX "idx_contents_search_text" ON "contents" ("searchText")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_contents_id" ON "contents" ("id")`,
    );

    await new Migration1784815200000_V3_4_0().up(queryRunner);

    const remaining = await queryRunner.query(
      `SELECT name FROM sqlite_master WHERE type = 'index' ` +
        `AND name IN ('idx_contents_search_text', 'idx_contents_id')`,
    );
    // Only the searchText index is removed; unrelated indexes are preserved.
    expect(remaining).toEqual([{ name: 'idx_contents_id' }]);
  });

  const seedLegacyContentsFts = async () => {
    // Reproduces the llamaindex-era external-content FTS5 table and triggers.
    await queryRunner.query(
      `CREATE VIRTUAL TABLE "contents_fts" USING fts5(` +
        `title, searchText, content='contents', content_rowid='rowid')`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "contents_fts_after_insert" AFTER INSERT ON "contents" ` +
        `BEGIN INSERT INTO contents_fts(rowid, title, searchText) ` +
        `VALUES (new.rowid, new.title, new."searchText"); END`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "contents_fts_after_delete" AFTER DELETE ON "contents" ` +
        `BEGIN INSERT INTO contents_fts(contents_fts, rowid, title, searchText) ` +
        `VALUES ('delete', old.rowid, old.title, old."searchText"); END`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "contents_fts_after_update" AFTER UPDATE ON "contents" ` +
        `BEGIN INSERT INTO contents_fts(contents_fts, rowid, title, searchText) ` +
        `VALUES ('delete', old.rowid, old.title, old."searchText"); ` +
        `INSERT INTO contents_fts(rowid, title, searchText) ` +
        `VALUES (new.rowid, new.title, new."searchText"); END`,
    );
  };

  it('rebuilds a legacy llamaindex contents_fts table with the new schema', async () => {
    // The "contents" table needs a "title" column for the legacy triggers.
    await queryRunner.query(`ALTER TABLE "contents" ADD COLUMN "title" text`);
    await seedLegacyContentsFts();

    await new Migration1784815200000_V3_4_0().up(queryRunner);

    // The rebuilt table exposes the new "id"/"searchText" columns and is
    // backfilled from "contents".
    expect(
      await queryRunner.query(
        `SELECT "id", "searchText" FROM "contents_fts" ORDER BY "id"`,
      ),
    ).toEqual([{ id: 'content-1', searchText: 'hello world' }]);
    // No legacy triggers survive to break subsequent writes to "contents".
    expect(
      await queryRunner.query(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' ` +
          `AND name LIKE 'contents_fts_after_%'`,
      ),
    ).toEqual([]);
    // The new triggers keep the rebuilt index in sync.
    await queryRunner.query(
      `INSERT INTO "contents" ("id", "searchText") VALUES ('content-2', 'second doc')`,
    );
    expect(
      await queryRunner.query(
        `SELECT "id" FROM "contents_fts" WHERE "contents_fts" MATCH 'second' `,
      ),
    ).toEqual([{ id: 'content-2' }]);
  });

  const seedLegacyChunkRemnants = async () => {
    // Reproduces the llamaindex-era embedding-RAG storage tables plus the AFTER
    // triggers on "contents" that keep writing into them.
    await queryRunner.query(
      `CREATE TABLE "content_chunks" (` +
        `"content_id" varchar NOT NULL, "chunk_index" integer NOT NULL, ` +
        `"chunk_text" text NOT NULL, "content_hash" text NOT NULL, ` +
        `"chunk_hash" text NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE TABLE "content_embeddings" (` +
        `"content_id" varchar NOT NULL, "embedding" blob)`,
    );
    await queryRunner.query(
      `CREATE VIRTUAL TABLE "content_chunks_fts" USING fts5(` +
        `chunk_text, content='content_chunks', content_rowid='rowid')`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "content_chunks_after_content_insert" ` +
        `AFTER INSERT ON "contents" WHEN trim(new."searchText") <> '' BEGIN ` +
        `INSERT INTO content_chunks ` +
        `(content_id, chunk_index, chunk_text, content_hash, chunk_hash) ` +
        `VALUES (new.id, 0, new."searchText", '', ''); END`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "content_chunks_after_content_update" ` +
        `AFTER UPDATE OF "searchText" ON "contents" BEGIN ` +
        `DELETE FROM content_chunks WHERE content_id = new.id; END`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "content_chunks_after_content_delete" ` +
        `AFTER DELETE ON "contents" BEGIN ` +
        `DELETE FROM content_chunks WHERE content_id = old.id; END`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "content_embeddings_after_content_delete" ` +
        `AFTER DELETE ON "contents" BEGIN ` +
        `DELETE FROM content_embeddings WHERE content_id = old.id; END`,
    );
  };

  it('drops dormant llamaindex chunk/embedding remnants on SQLite', async () => {
    await seedLegacyChunkRemnants();

    await new Migration1784815200000_V3_4_0().up(queryRunner);

    // The dormant triggers on "contents" and the storage tables are gone.
    expect(
      await queryRunner.query(
        `SELECT name FROM sqlite_master WHERE name IN (` +
          `'content_chunks', 'content_embeddings', 'content_chunks_fts', ` +
          `'content_chunks_after_content_insert', ` +
          `'content_chunks_after_content_update', ` +
          `'content_chunks_after_content_delete', ` +
          `'content_embeddings_after_content_delete') ORDER BY name`,
      ),
    ).toEqual([]);

    // A content write no longer fires a dormant trigger into a missing table.
    // (Before the fix this threw `no such table: content_chunks`.)
    await queryRunner.query(
      `INSERT INTO "contents" ("id", "searchText") VALUES ('content-2', 'fresh')`,
    );
    expect(
      await queryRunner.query(
        `SELECT "id" FROM "contents" WHERE "id" = 'content-2'`,
      ),
    ).toEqual([{ id: 'content-2' }]);
  });

  it('defaults RAG to the lexical fulltext-search helper when unset', async () => {
    await new Migration1784815200000_V3_4_0().up(queryRunner);

    await expect(
      getValue('global_settings', 'default_rag_helper'),
    ).resolves.toBe('fulltext-search');
  });

  it('preserves an existing default RAG helper selection', async () => {
    await settings.save(
      settings.create({
        group: 'global_settings',
        label: 'default_rag_helper',
        value: 'custom-search',
      }),
    );

    await new Migration1784815200000_V3_4_0().up(queryRunner);

    await expect(
      getValue('global_settings', 'default_rag_helper'),
    ).resolves.toBe('custom-search');
  });

  it('is idempotent and rolls back lexical infrastructure and the default', async () => {
    const migration = new Migration1784815200000_V3_4_0();

    await migration.up(queryRunner);
    await migration.up(queryRunner);
    expect(
      await queryRunner.query(`SELECT COUNT(*) AS count FROM "contents_fts"`),
    ).toEqual([{ count: 1 }]);
    expect(
      await settings.countBy({
        group: 'global_settings',
        label: 'default_rag_helper',
      }),
    ).toBe(1);

    await migration.down(queryRunner);

    expect(
      await settings.countBy({
        group: 'global_settings',
        label: 'default_rag_helper',
      }),
    ).toBe(0);
    expect(
      await queryRunner.query(
        `SELECT name FROM sqlite_master WHERE name = 'contents_fts'`,
      ),
    ).toEqual([]);
  });
});
