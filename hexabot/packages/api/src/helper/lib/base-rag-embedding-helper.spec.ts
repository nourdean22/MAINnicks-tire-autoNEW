/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { RagHit } from '@/cms/types/rag';

import BaseRagEmbeddingHelper, { RagChunk } from './base-rag-embedding-helper';

class ChunkingRagHelper extends BaseRagEmbeddingHelper {
  constructor() {
    super('chunking-rag-helper');
  }

  async retrieve(): Promise<RagHit[]> {
    return [];
  }

  /** Exposes the inherited protected chunker to the assertions below. */
  chunk(source: string, chunkSize: number, overlap: number): RagChunk[] {
    return this.chunkSearchText(source, chunkSize, overlap);
  }
}

describe('BaseRagEmbeddingHelper chunking', () => {
  const helper = new ChunkingRagHelper();

  it('prefers paragraph and line boundaries with deterministic overlap', () => {
    const source =
      'First paragraph line.\nSecond paragraph line.\nThird paragraph line.';
    const first = helper.chunk(source, 50, 8);
    const second = helper.chunk(source, 50, 8);

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first[0].text).toBe('First paragraph line.\nSecond paragraph line.');
    expect(first[1].text).toContain('Third paragraph line.');
    expect(first.map(({ index }) => index)).toEqual([0, 1]);
  });

  it('hard-splits oversized lines while retaining overlap', () => {
    expect(helper.chunk('abcdefghij', 4, 1)).toEqual([
      { index: 0, text: 'abcd' },
      { index: 1, text: 'defg' },
      { index: 2, text: 'ghij' },
    ]);
  });

  it('normalizes line endings and discards blank chunks', () => {
    const chunks = helper.chunk('alpha\r\n\r\nbeta', 7, 1);

    expect(chunks.every(({ text }) => text.length > 0)).toBe(true);
    expect(chunks.map(({ text }) => text).join(' ')).not.toContain('\r');
  });

  it('rejects invalid chunking settings', () => {
    expect(() => helper.chunk('text', 0, 0)).toThrow(RangeError);
    expect(() => helper.chunk('text', 4, 4)).toThrow(RangeError);
    expect(() => helper.chunk('text', 4, -1)).toThrow(RangeError);
  });

  it('chunks identically for every helper that inherits it', () => {
    // The window boundaries are baked into stored vectors, so two embedding
    // helpers must never disagree about them.
    const other = new ChunkingRagHelper();
    const source = 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta';

    expect(helper.chunk(source, 12, 3)).toEqual(other.chunk(source, 12, 3));
  });
});
