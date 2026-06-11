/**
 * WalkInCalculatorSection — internal price quote tool for the front desk.
 *
 * Not a public page. This is the "customer is standing at the counter,
 * what do I charge them?" tool. Shows margin and wholesale cost details
 * that never appear on the public Cost Estimator.
 *
 * Presets cover the 90% case (oil / tires / brakes / alignment). Custom
 * row handles the rest. Runs entirely client-side — no tRPC, no cost.
 */

import React, { useState, useMemo } from "react";
import { PageHeader } from "./shared";
import {
  Calculator, Plus, Trash2, Printer, Copy, Zap, Percent,
  DollarSign, Wrench,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import { toast } from "sonner";
import { OIL_PRICE } from "@shared/pricing";

// Ohio sales tax — parts only, NOT labor. This is the legal split.
const OHIO_TAX_RATE = 0.08;
const DEFAULT_LABOR_RATE = 115; // $/hr — editable in UI

interface LineItem {
  id: string;
  description: string;
  partsCostCents: number;   // wholesale cost to shop
  partsMarkup: number;      // multiplier (e.g. 2.0 = 100% markup)
  laborHours: number;
}

export const PRESETS: Array<Omit<LineItem, "id">> = [
  // Oil is a flat-rate service: the advertised price ($49 conv/blend, $80 full synthetic — shared/pricing.ts)
  // is all-in for parts + labor, so NO separate labor bundle. partsCost x markup lands the pre-tax line on
  // the advertised number exactly; Ohio tax (parts-only) still shows separately, as on a real receipt.
  { description: `Oil Change (conventional/blend 5qt) — starting at $${OIL_PRICE.conventional}`, partsCostCents: (OIL_PRICE.conventional * 100) / 2, partsMarkup: 2.0, laborHours: 0 },
  { description: `Oil Change (full synthetic 5qt) — starting at $${OIL_PRICE.fullSynthetic}`,     partsCostCents: (OIL_PRICE.fullSynthetic * 100) / 2, partsMarkup: 2.0, laborHours: 0 },
  { description: "Used Tire ($60 each, mount+balance)", partsCostCents: 2500, partsMarkup: 2.4, laborHours: 0 },
  { description: "Brake Pads — Front Axle",        partsCostCents: 3500, partsMarkup: 2.2, laborHours: 1.5 },
  { description: "Brake Pads + Rotors — Front",    partsCostCents: 9500, partsMarkup: 1.9, laborHours: 2.0 },
  { description: "Wheel Alignment (4-wheel)",      partsCostCents: 0,    partsMarkup: 1,   laborHours: 1.0 },
  { description: "Battery (standard)",             partsCostCents: 7000, partsMarkup: 1.8, laborHours: 0.3 },
  { description: "Diagnostic Scan",                partsCostCents: 0,    partsMarkup: 1,   laborHours: 1.0 },
  { description: "Engine Air Filter",              partsCostCents: 1200, partsMarkup: 2.5, laborHours: 0.2 },
  { description: "Cabin Air Filter",               partsCostCents: 1500, partsMarkup: 2.3, laborHours: 0.3 },
  { description: "Wiper Blades (pair)",            partsCostCents: 1800, partsMarkup: 2.2, laborHours: 0.2 },
  { description: "Coolant Flush",                  partsCostCents: 2500, partsMarkup: 2.0, laborHours: 1.5 },
  { description: "A/C Recharge (R134a)",           partsCostCents: 3500, partsMarkup: 1.8, laborHours: 1.0 },
];

function genId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatCents(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

function formatDollars(dollars: number): string {
  return "$" + dollars.toFixed(2);
}

export default function WalkInCalculatorSection() {
  const [items, setItems] = useState<LineItem[]>([]);
  const [laborRate, setLaborRate] = useState(DEFAULT_LABOR_RATE);
  const [customerName, setCustomerName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [discountPct, setDiscountPct] = useState(0);

  function addPreset(preset: Omit<LineItem, "id">) {
    setItems((prev) => [...prev, { ...preset, id: genId() }]);
  }

  function addBlank() {
    setItems((prev) => [
      ...prev,
      { id: genId(), description: "", partsCostCents: 0, partsMarkup: 2.0, laborHours: 1.0 },
    ]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  function updateItem(id: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function resetAll() {
    setItems([]);
    setCustomerName("");
    setVehicle("");
    setDiscountPct(0);
  }

  const totals = useMemo(() => {
    const lines = items.map((item) => {
      const partsSell = Math.round(item.partsCostCents * item.partsMarkup);
      const laborCostCents = Math.round(item.laborHours * laborRate * 100);
      const partsCost = item.partsCostCents;
      const partsMargin = partsSell - partsCost;
      const laborMargin = laborCostCents; // assume ~100% labor margin
      const taxableCents = partsSell; // only parts taxed in Ohio
      const taxCents = Math.round(taxableCents * OHIO_TAX_RATE);
      const lineTotalCents = partsSell + laborCostCents + taxCents;
      return {
        ...item,
        partsCost,
        partsSell,
        laborCostCents,
        taxCents,
        lineTotalCents,
        partsMargin,
        laborMargin,
      };
    });
    const subtotalCents = lines.reduce((s, l) => s + l.partsSell + l.laborCostCents, 0);
    const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
    const grossCents = subtotalCents + taxCents;
    const discountCents = Math.round(grossCents * (discountPct / 100));
    const totalCents = grossCents - discountCents;
    const totalPartsCost = lines.reduce((s, l) => s + l.partsCost, 0);
    const totalMargin = lines.reduce((s, l) => s + l.partsMargin + l.laborMargin, 0) - discountCents;
    const marginPct = totalCents > 0 ? (totalMargin / totalCents) * 100 : 0;

    return {
      lines,
      subtotalCents,
      taxCents,
      discountCents,
      totalCents,
      totalPartsCost,
      totalMargin,
      marginPct,
    };
  }, [items, laborRate, discountPct]);

  function copyQuote() {
    if (items.length === 0) return;
    const lines = totals.lines
      .map((l) => `  - ${l.description}: ${formatCents(l.lineTotalCents)}`)
      .join("\n");
    const quote = [
      customerName ? `Customer: ${customerName}` : null,
      vehicle ? `Vehicle: ${vehicle}` : null,
      "",
      "Line items:",
      lines,
      "",
      `Subtotal: ${formatCents(totals.subtotalCents)}`,
      `Tax (Ohio 8%, parts only): ${formatCents(totals.taxCents)}`,
      totals.discountCents > 0 ? `Discount: -${formatCents(totals.discountCents)}` : null,
      `Total: ${formatCents(totals.totalCents)}`,
      "",
      `Nick's Tire & Auto · ${BUSINESS.phone.display}`,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(quote).then(
      () => toast.success("Quote copied to clipboard"),
      () => toast.error("Copy failed"),
    );
  }

  function printQuote() {
    window.print();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Walk-In Price Calculator"
        subtitle="Front-desk quote tool. Parts/labor/tax math + margin visibility. Internal only."
        icon={<Calculator className="w-5 h-5" />}
        actions={
          <>
            <button
              onClick={copyQuote}
              disabled={items.length === 0}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-50"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy
            </button>
            <button
              onClick={printQuote}
              disabled={items.length === 0}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button
              onClick={resetAll}
              disabled={items.length === 0}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Reset
            </button>
          </>
        }
      />

      {/* Customer + vehicle */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Customer name (optional)"
          className="bg-card border border-border/30 px-3 py-2 text-sm"
        />
        <input
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
          placeholder="Vehicle (year make model)"
          className="bg-card border border-border/30 px-3 py-2 text-sm"
        />
      </div>

      {/* Presets */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2 flex items-center gap-1">
          <Zap className="w-3 h-3" /> Quick presets
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => addPreset(p)}
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 bg-card border border-border/30 hover:border-primary/40 hover:text-foreground active:scale-95 transition-all"
            >
              <Plus className="w-3 h-3" />
              {p.description}
            </button>
          ))}
          <button
            onClick={addBlank}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 active:scale-95 transition-all"
          >
            <Plus className="w-3 h-3" />
            Custom row
          </button>
        </div>
        <div className="mt-3 p-3 border border-yellow-500/30 bg-yellow-500/5 text-yellow-600 dark:text-yellow-400 text-xs rounded">
          ⚠️ Note: Oil change presets include base conventional/synthetic oil changes (up to 5 quarts). Extra oil, specialized filters, disposal fees, and Ohio sales tax apply separately. Do NOT add separate labor hours for oil changes or tire flat-rate presets.
        </div>
      </div>

      {/* Labor rate + discount */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="border border-border/30 bg-card/50 p-3">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold flex items-center gap-1 mb-2">
            <Wrench className="w-3 h-3" /> Labor rate ($/hr)
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={laborRate}
            onChange={(e) => setLaborRate(Number(e.target.value) || 0)}
            min={0}
            step={5}
            className="w-full bg-background/50 border border-border/30 px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="border border-border/30 bg-card/50 p-3">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold flex items-center gap-1 mb-2">
            <Percent className="w-3 h-3" /> Discount % (applied to total)
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={discountPct}
            onChange={(e) => setDiscountPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            min={0}
            max={100}
            className="w-full bg-background/50 border border-border/30 px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      {/* Line items */}
      {items.length === 0 ? (
        <div className="border border-dashed border-border/30 bg-card/30 p-10 text-center text-sm text-muted-foreground">
          Pick a preset or add a custom row to start quoting.
        </div>
      ) : (
        <div className="space-y-2">
          {totals.lines.map((line) => (
            <div key={line.id} className="border border-border/30 bg-card/50 p-3">
              <div className="flex items-start gap-3">
                <input
                  value={line.description}
                  onChange={(e) => updateItem(line.id, { description: e.target.value })}
                  placeholder="Service / part description"
                  className="flex-1 bg-background/50 border border-border/30 px-3 py-2 text-sm min-w-0"
                />
                <div className="text-right">
                  <div className="font-mono font-black text-lg text-foreground">
                    {formatCents(line.lineTotalCents)}
                  </div>
                  <div className="text-[10px] font-mono text-emerald-400">
                    margin {formatCents(line.partsMargin + line.laborMargin)}
                  </div>
                </div>
                <button
                  onClick={() => removeItem(line.id)}
                  className="shrink-0 p-2 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  aria-label="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Inputs grid */}
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <label className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-1">
                    Parts cost (cents)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={line.partsCostCents}
                    onChange={(e) => updateItem(line.id, { partsCostCents: Number(e.target.value) || 0 })}
                    min={0}
                    className="w-full bg-background/50 border border-border/30 rounded px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-1">
                    Markup ×
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={line.partsMarkup}
                    onChange={(e) => updateItem(line.id, { partsMarkup: Number(e.target.value) || 1 })}
                    min={1}
                    step={0.1}
                    className="w-full bg-background/50 border border-border/30 rounded px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase tracking-widest text-muted-foreground block mb-1">
                    Labor hrs
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={line.laborHours}
                    onChange={(e) => updateItem(line.id, { laborHours: Number(e.target.value) || 0 })}
                    min={0}
                    step={0.1}
                    className="w-full bg-background/50 border border-border/30 rounded px-2 py-1 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Math breakdown */}
              <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] text-muted-foreground border-t border-border/20 pt-2">
                <div>Parts: <span className="font-mono text-foreground">{formatCents(line.partsSell)}</span></div>
                <div>Labor: <span className="font-mono text-foreground">{formatCents(line.laborCostCents)}</span></div>
                <div>Tax: <span className="font-mono text-foreground">{formatCents(line.taxCents)}</span></div>
                <div>Cost: <span className="font-mono text-muted-foreground">{formatCents(line.partsCost)}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Totals */}
      {items.length > 0 && (
        <div className="sticky bottom-0 border border-primary/30 bg-gradient-to-br from-[#0a0a0a] to-[#1a1a1a] p-4 shadow-xl">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Subtotal</div>
              <div className="font-mono font-bold text-foreground">{formatCents(totals.subtotalCents)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Tax (parts, 8%)</div>
              <div className="font-mono font-bold text-foreground">{formatCents(totals.taxCents)}</div>
            </div>
            {totals.discountCents > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Discount</div>
                <div className="font-mono font-bold text-amber-400">-{formatCents(totals.discountCents)}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-widest text-primary">Customer pays</div>
              <div className="font-mono font-black text-2xl text-primary">
                {formatCents(totals.totalCents)}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-3 gap-4 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Parts cost (to shop)</div>
              <div className="font-mono text-muted-foreground">{formatCents(totals.totalPartsCost)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-emerald-400">Gross margin</div>
              <div className="font-mono font-bold text-emerald-400">{formatCents(totals.totalMargin)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-emerald-400">Margin %</div>
              <div className="font-mono font-bold text-emerald-400">
                {totals.marginPct.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
