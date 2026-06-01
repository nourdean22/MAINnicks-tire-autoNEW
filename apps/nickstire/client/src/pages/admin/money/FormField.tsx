import React from "react";

// ─── FORM FIELD ─────────────────────────────────────────
// wave-119 — added inputMode prop for proper iOS keyboard hints. Without
// it, type="number" shows a numpad with no decimal key (bad for $) and
// type="text" shows full QWERTY (bad for phone). Pass inputMode="decimal"
// for money, "tel" for phone, "numeric" for integers.
export function FormField({ label, value, onChange, placeholder, type = "text", inputMode }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "tel" | "decimal" | "numeric" | "email" | "url" | "search";
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">{label}</label>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-background border border-border/30 px-3 py-2 text-[12px] text-foreground placeholder:text-foreground/20 focus:border-primary/50 focus:outline-none"
      />
    </div>
  );
}
