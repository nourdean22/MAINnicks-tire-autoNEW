import { useEffect, useState } from "react";
import { trackEvent } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";

// "By vehicle" on /tires: year > make > model > trim through trpc.fitment.* (fitment v1).
// Each level renders one of: waiting for the level above, loading, an error with a
// retry, a real empty list, or the options. An upstream failure is never an empty list.

export type SavedVehicle = { year: number; make: string; model: string; trim: string; label: string };

const STORAGE_KEY = "nick:vehicle";

function readSaved(): SavedVehicle | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return v && typeof v.year === "number" && typeof v.make === "string" && typeof v.model === "string"
      && typeof v.trim === "string" && typeof v.label === "string" ? v : null;
  } catch {
    return null;
  }
}

function writeSaved(v: SavedVehicle | null) {
  try {
    if (v) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or storage blocked: the picker still works, it just forgets.
  }
}

/** Vehicle from ?year&make&model&trim (a reloaded vehicle search), or null. */
export function vehicleFromUrl(): SavedVehicle | null {
  const p = new URLSearchParams(window.location.search);
  const year = Number(p.get("year"));
  const [make, model, trim] = [p.get("make"), p.get("model"), p.get("trim")];
  if (Number.isInteger(year) && year > 0 && make && model && trim) {
    return { year, make, model, trim, label: `${year} ${make} ${model} ${trim}` };
  }
  return null;
}

/** Vehicle from the URL, else the remembered one. */
function initialVehicle(): SavedVehicle | null {
  return vehicleFromUrl() ?? readSaved();
}

type Reason = "unconfigured" | "upstream_error" | "rate_limited" | "not_found";

/** A failed read: shown as an error with Retry, never as an empty list. */
const failedRead = (reason: Reason) => reason === "upstream_error" || reason === "rate_limited";
type Level<T> = { isLoading: boolean; isError: boolean; data?: ({ ok: true } & T) | { ok: false; reason: Reason }; refetch: () => unknown };

const UPSTREAM_TEXT = `We couldn't load vehicle data right now. Search by size below or call ${BUSINESS.phone.display}.`;

const selectClass =
  "h-12 w-full rounded-lg border border-border bg-background px-3 text-base text-foreground disabled:opacity-50";

function LevelError({ onRetry }: { onRetry: () => unknown }) {
  return (
    <div role="alert" className="mt-2 text-sm text-amber-400">
      <p>{UPSTREAM_TEXT}</p>
      <button type="button" onClick={() => onRetry()} className="mt-2 min-h-12 rounded-lg border border-border px-4 font-semibold text-foreground">
        Retry
      </button>
    </div>
  );
}

function LevelSelect<T>({
  id, label, plural, waiting, query, items, value, onChange,
}: {
  id: string;
  label: string;
  plural: string;
  waiting: boolean;
  query: Level<T>;
  items: { value: string; text: string }[] | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const failed = query.isError || (query.data?.ok === false && failedRead(query.data.reason));
  const empty = !waiting && items !== null && items.length === 0;
  const usable = !waiting && !query.isLoading && items !== null && items.length > 0;
  return (
    <div className="min-w-0 text-left">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-foreground">{label}</label>
      <select id={id} value={value} disabled={!usable} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        {query.isLoading ? <option value="">Loading...</option> : <option value="">{label}</option>}
        {usable && items!.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
      </select>
      {!waiting && failed && <LevelError onRetry={query.refetch} />}
      {empty && <p className="mt-2 text-sm text-muted-foreground">No {plural} found</p>}
    </div>
  );
}

/** Items for an ok result, [] for not_found (nothing there), null otherwise (loading, error, waiting). */
function listOf<T, I>(q: Level<T>, pickList: (d: T) => I[]): I[] | null {
  if (!q.data) return null;
  if (q.data.ok) return pickList(q.data);
  return q.data.reason === "not_found" ? [] : null;
}

export default function VehicleSizePicker({
  onPickSize,
  onUnconfigured,
  onVehicleCleared,
}: {
  /** The tapped size and the vehicle it belongs to (the order modal prefills from it). */
  onPickSize: (size: string, vehicle: SavedVehicle) => void;
  onUnconfigured: () => void;
  onVehicleCleared: () => void;
}) {
  const [remembered, setRemembered] = useState<SavedVehicle | null>(() => initialVehicle());
  const [year, setYear] = useState<number | null>(remembered?.year ?? null);
  const [make, setMake] = useState(remembered?.make ?? "");
  const [model, setModel] = useState(remembered?.model ?? "");
  const [trim, setTrim] = useState(remembered?.trim ?? "");

  const years = trpc.fitment.years.useQuery(undefined, { enabled: !remembered });
  const makes = trpc.fitment.makes.useQuery({ year: year ?? 0 }, { enabled: !remembered && year !== null });
  const models = trpc.fitment.models.useQuery({ year: year ?? 0, make }, { enabled: !remembered && year !== null && !!make });
  const trims = trpc.fitment.trims.useQuery({ year: year ?? 0, make, model }, { enabled: !remembered && year !== null && !!make && !!model });
  const sizes = trpc.fitment.sizes.useQuery({ year: year ?? 0, make, model, trim }, { enabled: year !== null && !!make && !!model && !!trim });

  const levels = [years, makes, models, trims, sizes] as Level<unknown>[];
  const unconfigured = levels.some((q) => q.data?.ok === false && q.data.reason === "unconfigured");
  useEffect(() => {
    if (unconfigured) onUnconfigured();
  }, [unconfigured, onUnconfigured]);

  const yearItems = listOf(years as Level<{ years: number[] }>, (d) => d.years.map((y) => ({ value: String(y), text: String(y) })));
  const makeItems = listOf(makes as Level<{ makes: { slug: string; name: string }[] }>, (d) => d.makes.map((m) => ({ value: m.slug, text: m.name })));
  const modelItems = listOf(models as Level<{ models: { slug: string; name: string }[] }>, (d) => d.models.map((m) => ({ value: m.slug, text: m.name })));
  const trimItems = listOf(trims as Level<{ trims: { slug: string; label: string }[] }>, (d) => d.trims.map((t) => ({ value: t.slug, text: t.label })));
  const sizeData = sizes.data as Level<{ sizes: { size: string; label: string; rimDiameter: number | null; searchable: boolean }[] }>["data"];

  const name = (items: { value: string; text: string }[] | null, v: string) => items?.find((o) => o.value === v)?.text ?? v;
  const label = remembered
    ? remembered.label
    : `${year} ${name(makeItems, make)} ${name(modelItems, model)} ${name(trimItems, trim)}`;

  const step = (s: "year" | "make" | "model" | "trim") => trackEvent("vehicle_search_step", { step: s });

  const choose = (size: string) => {
    if (year === null) return;
    const vehicle = { year, make, model, trim, label };
    writeSaved(vehicle);
    trackEvent("vehicle_size_selected", { size, year, make, model });
    const p = new URLSearchParams(window.location.search);
    p.set("year", String(year));
    p.set("make", make);
    p.set("model", model);
    p.set("trim", trim);
    window.history.replaceState({}, "", `${window.location.pathname}?${p}`);
    onPickSize(size, vehicle);
  };

  const change = () => {
    writeSaved(null);
    // Drop the vehicle from the URL too (keeping ?size and ?tab), or a remount restores it.
    const p = new URLSearchParams(window.location.search);
    ["year", "make", "model", "trim"].forEach((k) => p.delete(k));
    const qs = p.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    onVehicleCleared();
    setRemembered(null);
    setYear(null);
    setMake("");
    setModel("");
    setTrim("");
  };

  const heading = `Factory sizes for your ${label}`;
  const complete = year !== null && !!make && !!model && !!trim;

  return (
    <div className="p-1">
      {remembered ? (
        <div className="flex items-center justify-between gap-3 text-left">
          <p className="font-semibold text-foreground">Your {remembered.label}</p>
          <button type="button" onClick={change} className="min-h-12 rounded-lg border border-border px-4 font-semibold text-foreground">
            Change
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <LevelSelect id="vehicle-year" label="Year" plural="years" waiting={false} query={years as Level<unknown>} items={yearItems}
            value={year === null ? "" : String(year)}
            onChange={(v) => { setYear(v ? Number(v) : null); setMake(""); setModel(""); setTrim(""); step("year"); }} />
          <LevelSelect id="vehicle-make" label="Make" plural="makes" waiting={year === null} query={makes as Level<unknown>} items={makeItems}
            value={make} onChange={(v) => { setMake(v); setModel(""); setTrim(""); step("make"); }} />
          <LevelSelect id="vehicle-model" label="Model" plural="models" waiting={!make} query={models as Level<unknown>} items={modelItems}
            value={model} onChange={(v) => { setModel(v); setTrim(""); step("model"); }} />
          <LevelSelect id="vehicle-trim" label="Trim" plural="trims" waiting={!model} query={trims as Level<unknown>} items={trimItems}
            value={trim} onChange={(v) => { setTrim(v); step("trim"); }} />
        </div>
      )}

      {complete && (
        <div className="mt-4 text-left">
          {sizes.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {(sizes.isError || (sizeData?.ok === false && failedRead(sizeData.reason))) && <LevelError onRetry={sizes.refetch} />}
          {sizeData?.ok === false && sizeData.reason === "not_found" && (
            <p className="text-sm text-muted-foreground">No sizes found for that trim. Try another trim or call us.</p>
          )}
          {sizeData?.ok === true && sizeData.sizes.length === 0 && <p className="text-sm text-muted-foreground">No sizes found</p>}
          {sizeData?.ok === true && sizeData.sizes.length > 0 && (
            <>
              <h2 id="vehicle-sizes-heading" className="text-base font-bold text-foreground">{heading}</h2>
              <div role="group" aria-labelledby="vehicle-sizes-heading" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {sizeData.sizes.map((s) =>
                  s.searchable ? (
                    <button
                      key={s.size}
                      type="button"
                      onClick={() => choose(s.size)}
                      className="flex min-h-12 flex-col items-center justify-center rounded-lg border border-primary/40 px-3 py-2 font-bold text-foreground hover:border-primary"
                    >
                      {s.label}
                      {s.rimDiameter !== null && <span className="text-xs font-normal text-muted-foreground">{s.rimDiameter} in</span>}
                    </button>
                  ) : (
                    // The size search cannot look this one up (e.g. flotation sizes), so it is a call, not a search.
                    <a
                      key={s.size}
                      href={BUSINESS.phone.href}
                      className="col-span-2 flex min-h-12 items-center rounded-lg border border-border px-3 py-2 text-sm text-foreground sm:col-span-4"
                    >
                      {s.label}: call us for this size
                    </a>
                  ),
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
