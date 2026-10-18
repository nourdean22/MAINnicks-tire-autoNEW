/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JSONSchema7 } from "json-schema";
import { z } from "zod";

import { baseStubSchema } from "../shared/base";

const contentTypeObjectSchema = baseStubSchema.extend({
  name: z.string(),
  schema: z.any(),
});

export const DEFAULT_CONTENT_TYPE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", title: "Title" },
    status: { type: "boolean", title: "Status" },
  },
} satisfies JSONSchema7;

export const CONTENT_TYPE_READ_ONLY_PROPERTY_KEYS = Object.keys(
  DEFAULT_CONTENT_TYPE_SCHEMA.properties,
);

export const withDefaultContentTypeProperties = <
  T extends Record<string, unknown> | undefined,
>(
  properties?: T,
) => ({
  ...DEFAULT_CONTENT_TYPE_SCHEMA.properties,
  ...properties,
});

export const contentTypeJsonSchema = z.looseObject({
  type: z.literal(DEFAULT_CONTENT_TYPE_SCHEMA.type),
  properties: z.looseObject(
    Object.fromEntries(
      Object.entries(DEFAULT_CONTENT_TYPE_SCHEMA.properties).map(
        ([key, { type }]) => [
          key,
          z.looseObject({ type: z.literal(type), title: z.string() }),
        ],
      ),
    ),
  ),
});

export const contentTypeStubSchema = contentTypeObjectSchema;

export const contentTypeSchema = contentTypeObjectSchema;

export const contentTypeFullSchema = contentTypeObjectSchema;

export type ContentTypeStub = z.infer<typeof contentTypeStubSchema>;

export type ContentType = z.infer<typeof contentTypeSchema>;

export type ContentTypeFull = z.infer<typeof contentTypeFullSchema>;
