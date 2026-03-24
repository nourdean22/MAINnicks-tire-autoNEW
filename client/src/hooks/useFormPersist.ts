/**
 * useFormPersist — Auto-saves form state to sessionStorage.
 * Restores on mount so users don't lose their booking form data
 * if they navigate away or accidentally refresh.
 */
import { useState, useEffect, useCallback, useRef } from "react";

export function useFormPersist<T extends Record<string, unknown>>(
  key: string,
  initialValues: T
): [T, (field: string, value: unknown) => void, () => void] {
  const [values, setValues] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...initialValues, ...parsed };
      }
    } catch {
      // Ignore parse errors
    }
    return initialValues;
  });

  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Save to sessionStorage on every change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(key, JSON.stringify(valuesRef.current));
      } catch {
        // Storage full or unavailable
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [values, key]);

  const update = useCallback((field: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const clear = useCallback(() => {
    sessionStorage.removeItem(key);
    setValues(initialValues);
  }, [key, initialValues]);

  return [values, update, clear];
}
