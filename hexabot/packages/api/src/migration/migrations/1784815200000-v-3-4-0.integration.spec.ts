/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import { ContentTypeOrmEntity } from '@/cms/entities/content-type.entity';
import { ContentOrmEntity } from '@/cms/entities/content.entity';
import { FullTextSearchStore } from '@/extensions/helpers/fulltext-search/fulltext-search.store';

import Migration1784815200000_V3_4_0 from './1784815200000-v-3-4-0.migration';

const databaseUrl = process.env.TEST_POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('v3.4.0 lexical provisioning (PostgreSQL)', () => {
  jest.setTimeout(30000);

  const schema = `mig_lexical_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let dataSource: DataSource;
  let contentTypeId: string;

  beforeAll(async () => {
    admin = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
    }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);

    dataSource = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
      schema,
      entities: [ContentOrmEntity, ContentTypeOrmEntity],
    }).initialize();
    await dataSource.query(
      `CREATE TABLE "${schema}"."content_types" (` +
        `"id" varchar PRIMARY KEY, "name" varchar NOT NULL UNIQUE` +
        `)`,
    );
    await dataSource.query(
      `CREATE TABLE "${schema}"."contents" (` +
        `"id" varchar PRIMARY KEY, ` +
        `"content_type_id" varchar NOT NULL REFERENCES "${schema}"."content_types"("id") ON DELETE CASCADE, ` +
        `"title" varchar NOT NULL, "status" boolean NOT NULL DEFAULT true, ` +
        `"properties" text NULL, "searchText" text NOT NULL` +
        `)`,
    );

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    await new Migration1784815200000_V3_4_0().up(queryRunner);
    await queryRunner.commitTransaction();
    await queryRunner.release();

    contentTypeId = randomUUID();
    await dataSource.query(
      `INSERT INTO "${schema}"."content_types" ("id", "name") VALUES ($1, 'Articles')`,
      [contentTypeId],
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('provisions lexical full-text search', async () => {
    const contentId = randomUUID();
    const source = 'title: Vector guide\nbody: semantic retrieval';
    await dataSource.query(
      `INSERT INTO "${schema}"."contents" ` +
        `("id", "content_type_id", "title", "status", "searchText") ` +
        `VALUES ($1, $2, 'Vector guide', true, $3)`,
      [contentId, contentTypeId, source],
    );

    const lexicalHits = await new FullTextSearchStore(dataSource).search(
      'semantic retrieval',
      { status: true },
    );
    expect(lexicalHits.some((hit) => hit.contentId === contentId)).toBe(true);
  });
});

describeWithPostgres('v3.4.0 contents.searchText btree index removal', () => {
  jest.setTimeout(30000);

  const schema = `mig_idx_${process.pid}_${Date.now()}`;
  // High-entropy text so TOAST compression can't shrink the btree entry back
  // under the 2704-byte limit (repetitive text would compress and slip through).
  const longText = randomBytes(4000).toString('hex'); // 8 KB, incompressible
  let admin: DataSource;
  let dataSource: DataSource;

  beforeAll(async () => {
    admin = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
    }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);

    dataSource = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
      schema,
    }).initialize();
    await dataSource.query(
      `CREATE TABLE "${schema}"."contents" (` +
        `"id" varchar PRIMARY KEY, ` +
        `"title" varchar NOT NULL, "status" boolean NOT NULL DEFAULT true, ` +
        `"searchText" text NOT NULL` +
        `)`,
    );
    // Reproduce the auto-generated btree index that TypeORM would create from
    // the (now removed) `@Index(['searchText'])` decorator.
    await dataSource.query(
      `CREATE INDEX "IDX_contents_searchText_legacy" ` +
        `ON "${schema}"."contents" ("searchText")`,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  const insertLongContent = (id: string) =>
    dataSource.query(
      `INSERT INTO "${schema}"."contents" ("id", "title", "searchText") ` +
        `VALUES ($1, 'Long', $2)`,
      [id, longText],
    );

  it('rejects long content while the btree index exists', async () => {
    await expect(insertLongContent('before')).rejects.toThrow(
      /index row size|maximum .* for index/i,
    );
  });

  it('drops the index so long content can be inserted', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    await new Migration1784815200000_V3_4_0().up(queryRunner);
    await queryRunner.commitTransaction();
    await queryRunner.release();

    const indexes = await dataSource.query(
      `SELECT i.relname AS name FROM pg_index ix ` +
        `JOIN pg_class i ON i.oid = ix.indexrelid ` +
        `JOIN pg_class t ON t.oid = ix.indrelid ` +
        `JOIN pg_namespace n ON n.oid = t.relnamespace ` +
        `JOIN pg_am am ON am.oid = i.relam ` +
        `JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0] ` +
        `WHERE t.relname = 'contents' AND a.attname = 'searchText' ` +
        `AND ix.indnatts = 1 AND am.amname = 'btree' AND n.nspname = $1`,
      [schema],
    );
    expect(indexes).toHaveLength(0);

    await expect(insertLongContent('after')).resolves.not.toThrow();
  });
});
