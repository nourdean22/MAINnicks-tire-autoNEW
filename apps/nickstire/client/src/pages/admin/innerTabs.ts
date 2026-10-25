/**
 * Inner tabs that a URL can select, and which roles may see each one.
 *
 * 2026-10-19 (admin prune W1): seven sections were folded into others as tabs.
 * The section components read their tab through resolveInnerTab, and the
 * registry's redirect table writes the same keys, so a link, the sidebar and
 * the page cannot disagree about which tab values exist. Role lists here only
 * HIDE tabs; the server's procedure permissions stay the real gate.
 */
import type { AdminRole } from "@shared/adminPermissions";

const FULL_ACCESS: readonly AdminRole[] = ["owner", "manager"];

interface InnerTabSpec {
  key: string;
  /** In display order; the first one a role may see is its default. */
  values: readonly string[];
  /** Tabs absent here are visible to every role that reaches the section. */
  roles?: Partial<Record<string, readonly AdminRole[]>>;
}

const INNER_TABS = {
  // 2026-10-25: the inner value "followups" is only ever read under leadsTab; Outreach's ?tab= alias is a different key.
  leads: { key: "leadsTab", values: ["followups", "leads", "hiring"] },
  voiceReceptionist: { key: "voiceTab", values: ["performance", "queue", "calls"] },
  opsHub: {
    key: "reportsTab",
    values: ["search", "traffic"],
    // Market and Traffic were owner/manager sections; their procedures need
    // marketing.manage / customers.manage, which accountant and viewer lack.
    // Owner Actions and the doc list were cut 2026-10-25, so those roles see no tab here.
    roles: { search: FULL_ACCESS, traffic: FULL_ACCESS },
  },
  content: {
    key: "contentTab",
    values: ["manager", "specials", "local", "qa", "photos", "entity", "competitors"],
  },
  customers: {
    key: "customersTab",
    values: ["customers", "members", "calls"],
    roles: {
      customers: [...FULL_ACCESS, "front_desk", "tech"],
      // Nonstop Nick admitted accountant; the customer list never did.
      members: [...FULL_ACCESS, "accountant"],
      calls: FULL_ACCESS,
    },
  },
} as const satisfies Record<string, InnerTabSpec>;

export type InnerTabSection = keyof typeof INNER_TABS;

/** Values an older link may still carry, mapped to the tab that replaced them. */
const LEGACY_VALUES: Partial<Record<InnerTabSection, Record<string, string>>> = {
  leads: { pipeline: "leads", opportunities: "followups" },
};

/** Tabs this role may see, in order. A null role (not loaded yet) sees only unrestricted tabs. */
export function innerTabsForRole(section: InnerTabSection, role: AdminRole | null): string[] {
  const spec: InnerTabSpec = INNER_TABS[section];
  return spec.values.filter((v) => {
    const allowed = spec.roles?.[v];
    return !allowed || (role !== null && allowed.includes(role));
  });
}

/**
 * The tab to render for a raw URL value: the value itself when it exists and the
 * role may see it, otherwise the role's first visible tab. A retired value
 * (customersTab=loyalty, contentTab=ideas, reportsTab=messages) lands on the
 * default instead of a blank panel. Returns null only when the role sees no tab.
 */
export function resolveInnerTab(section: InnerTabSection, raw: string | null, role: AdminRole | null): string | null {
  const visible = innerTabsForRole(section, role);
  const value = (raw && LEGACY_VALUES[section]?.[raw]) || raw;
  if (value && visible.includes(value)) return value;
  return visible[0] ?? null;
}
