import { useEffect, useRef } from "react";

/**
 * Tracks form abandonment — fires when name + phone are filled but form
 * is not submitted within 3 minutes. Only fires once per session per form.
 */
export function useFormAbandonment(
  formType: "booking" | "lead" | "callback",
  fields: { name?: string; phone?: string; email?: string },
  submitted: boolean
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    // Don't fire if already submitted or already fired this session
    if (submitted || firedRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const sessionKey = `nta_abandon_${formType}`;
    try { if (sessionStorage.getItem(sessionKey)) { firedRef.current = true; return; } } catch {}

    // Start 3-minute timer when name AND phone are filled
    const hasNameAndPhone = (fields.name?.trim().length ?? 0) >= 2 && (fields.phone?.trim().length ?? 0) >= 7;

    if (hasNameAndPhone) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (firedRef.current) return;
        firedRef.current = true;
        try { sessionStorage.setItem(sessionKey, "1"); } catch {}

        fetch("/api/track-abandonment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: fields.phone,
            name: fields.name,
            email: fields.email,
            formType,
            fieldsCompleted: Object.entries(fields)
              .filter(([, v]) => v && String(v).trim().length > 0)
              .map(([k]) => k),
          }),
        }).catch((err) => { console.error("[form-abandonment] track failed", err); });
      }, 3 * 60 * 1000); // 3 minutes
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fields.name, fields.phone, fields.email, submitted, formType]);
}
