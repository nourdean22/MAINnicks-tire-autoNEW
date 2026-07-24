/**
 * The Instagram admin's view vocabulary + URL persistence.
 *
 * Views live in the URL (?igview=) so a refresh, a PWA relaunch, or a shared
 * link lands on the SAME screen — the old shell kept the active tab in local
 * React state and every reload silently reset the operator to HQ.
 *
 * history.replaceState (not a router navigation) on purpose: the admin shell
 * owns ?tab= routing, and replacing state preserves every other param without
 * pushing history entries for tab flips.
 */

/** Five primary destinations + the secondary surfaces behind the gear menu. */
export type IgView =
  | "today"
  | "create"
  | "publish"
  | "community"
  | "insights"
  | "planning"
  | "actions"
  | "control"
  | "settings";

export const IG_PRIMARY_VIEWS: Array<{ key: IgView; label: string }> = [
  { key: "today", label: "Today" },
  { key: "create", label: "Create" },
  { key: "publish", label: "Publish" },
  { key: "community", label: "Community" },
  { key: "insights", label: "Insights" },
];

export const IG_SECONDARY_VIEWS: Array<{ key: IgView; label: string }> = [
  { key: "planning", label: "Planning board" },
  { key: "actions", label: "Reel recovery (Action Center)" },
  { key: "control", label: "Autonomy control" },
  { key: "settings", label: "Settings" },
];

const ALL_VIEWS = new Set<string>([...IG_PRIMARY_VIEWS, ...IG_SECONDARY_VIEWS].map((v) => v.key));

/** Old tab keys deep-linked from anywhere (HQ buttons, docs, muscle memory)
 *  keep working — navigation vocabulary changes must not strand links. */
const LEGACY_TAB_KEYS: Record<string, IgView> = {
  hq: "today",
  studio: "create",
  queue: "publish",
  inbox: "community",
  learn: "insights",
  drafts: "planning",
};

export function normalizeIgView(raw: string | null | undefined): IgView {
  if (!raw) return "today";
  if (ALL_VIEWS.has(raw)) return raw as IgView;
  return LEGACY_TAB_KEYS[raw] ?? "today";
}

export function readIgViewFromUrl(): IgView {
  if (typeof window === "undefined") return "today";
  return normalizeIgView(new URLSearchParams(window.location.search).get("igview"));
}

export function writeIgViewToUrl(view: IgView): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("igview", view);
  window.history.replaceState(window.history.state, "", url.toString());
}
