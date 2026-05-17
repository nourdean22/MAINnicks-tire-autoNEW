function isDecimalLike(value: unknown): value is { toNumber?: () => number } {
  return Boolean(value) && typeof value === "object" && "toNumber" in (value as Record<string, unknown>);
}

export function serializeForJson<T>(value: T): any {
  return JSON.parse(
    JSON.stringify(value, (_, innerValue) => {
      if (innerValue instanceof Date) {
        return innerValue.toISOString();
      }

      if (isDecimalLike(innerValue)) {
        return typeof innerValue.toNumber === "function" ? innerValue.toNumber() : Number(innerValue);
      }

      return innerValue;
    })
  );
}
