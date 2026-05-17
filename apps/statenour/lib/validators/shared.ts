import { z } from "zod";

export const requiredString = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`);

export const optionalString = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.string().trim().optional()
);

export const nullableString = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.string().trim().nullable()
);

export const nullableEmail = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.string().trim().email("Must be a valid email address.").nullable()
);

export const nullableDate = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.coerce.date().nullable()
);

export const nullableInteger = (min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().int().min(min).max(max).nullable()
  );

export const integerRange = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const nullableNumber = (min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().min(min).max(max).nullable()
  );

export const booleanFlag = z.preprocess(
  (value) => {
    if (value === "" || value == null) {
      return false;
    }

    return value;
  },
  z.coerce.boolean()
);
