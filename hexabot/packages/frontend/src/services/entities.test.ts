/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { normalize } from "normalizr";
import { describe, expect, it } from "vitest";

import { ContentTypeEntity, RagHelperEntity } from "./entities";
import { EntityType, normalizeEntity } from "./types";

describe("ContentType entity", () => {
  it("normalizes timestamps as dates", () => {
    const createdAt = "2026-07-27T08:32:11.261Z";
    const updatedAt = "2026-07-27T15:09:25.884Z";
    const normalized = normalize(
      [{ id: "content-type-id", name: "Article", createdAt, updatedAt }],
      [ContentTypeEntity],
    );
    const contentType =
      normalized.entities?.[EntityType.CONTENT_TYPE]?.["content-type-id"];

    expect(contentType).toMatchObject({
      createdAt: new Date(createdAt),
      updatedAt: new Date(updatedAt),
    });
  });
});

describe("RagHelper entity", () => {
  it("normalizes helpers by name", () => {
    expect(normalize([{ name: "fulltext-search" }], [RagHelperEntity])).toEqual(
      {
        entities: {
          [EntityType.RAG_HELPER]: {
            "fulltext-search": {
              name: "fulltext-search",
            },
          },
        },
        result: ["fulltext-search"],
      },
    );
  });

  it("is accepted by dynamic autocomplete entity normalization", () => {
    expect(normalizeEntity("RagHelper")).toBe(EntityType.RAG_HELPER);
  });
});
