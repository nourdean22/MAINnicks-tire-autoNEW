/**
 * Admin UI v1 Wave 5, review round 1.
 *   1. A paused query (offline PWA: data undefined, isError false, fetchStatus "paused") is UNKNOWN, never
 *      "Loading" forever and never a confident 0 (Settings tiles, ContentManager row, Instagram Meta chip).
 *   2. The shared ErrorState Retry button is a 48 px target.
 *   3. Typed ALL-CAPS literals in the files W5 touched are sentence case (acronyms and clipboard text excepted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean; fetchStatus?: string };
const h = vi.hoisted(() => ({ queries: new Map<string, Partial<Q>>(), Null: () => null }));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isFetching: false,
    ...h.queries.get(path),
  });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() {
        return undefined;
      },
    });
  return { trpc: new Proxy({}, { get: (_t, key) => (key === "useUtils" || key === "useContext" ? () => node("utils") : node(String(key))) }) };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: vi.fn(async () => true), default: () => null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" }, loading: false }) }));
vi.mock("@/pages/admin/settings/FeatureFlagsPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/settings/DeclinedRecoveryPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/shared/SectionInsightStrip", () => ({ default: h.Null, SectionInsightStrip: h.Null }));
vi.mock("@/pages/admin/instagram/Today", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/StudioV2", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/QueueV2", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Inbox", () => ({ Inbox: h.Null }));
vi.mock("@/pages/admin/instagram/Learn", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Settings", () => ({ default: h.Null }));
vi.mock("@/pages/admin/DraftBoardPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/PatternLab", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Strategy", () => ({ default: h.Null }));
vi.mock("@/components/admin/AutonomyCommandCenter", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/ActionCenter", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Pipeline", () => ({ Pipeline: h.Null }));

import SettingsSection from "@/pages/admin/SettingsSection";
import { ContentManager } from "@/pages/admin/content/ContentManager";
import { InstagramAdmin } from "@/pages/admin/instagram/InstagramAdmin";
import { ErrorState } from "@/pages/admin/shared";

const PAUSED: Partial<Q> = { data: undefined, isError: false, isLoading: false, fetchStatus: "paused" };
const FETCHING: Partial<Q> = { data: undefined, isError: false, isLoading: true, fetchStatus: "fetching" };
const ok = (data: unknown): Partial<Q> => ({ data, isError: false });

beforeEach(() => {
  h.queries.clear();
  window.history.replaceState({}, "", "/admin");
});
afterEach(() => h.queries.clear());

describe("paused reads are unknown", () => {
  it("Settings tiles: a paused stats read says offline, not 'Loading', and shows no number", () => {
    window.history.replaceState({}, "", "/admin?settingsTab=shopdriver");
    h.queries.set("autoLabor.status", ok({ connected: true, accountId: "A1", fallbackCategories: 3, fallbackJobs: 9, totalLookups: 4 }));
    h.queries.set("adminDashboard.stats", PAUSED);
    render(<SettingsSection />);
    expect(screen.queryByText("Loading")).toBeNull();
    expect(screen.getAllByText("Offline, not checked")).toHaveLength(2);
    for (const label of ["Customers", "Website leads"]) {
      const card = screen.getByText(label).parentElement?.parentElement as HTMLElement;
      expect(card.querySelector(".stat-value")?.textContent, label).toBe("?");
    }
  });

  it("positive control: a read that is genuinely in flight still says Loading", () => {
    window.history.replaceState({}, "", "/admin?settingsTab=shopdriver");
    h.queries.set("autoLabor.status", ok({ connected: true, accountId: "A1" }));
    h.queries.set("adminDashboard.stats", FETCHING);
    render(<SettingsSection />);
    expect(screen.getAllByText("Loading")).toHaveLength(2);
    expect(screen.queryByText("Offline, not checked")).toBeNull();
  });

  it("ContentManager: paused article and generation reads leave the whole row unknown, not 0", () => {
    h.queries.set("contentAdmin.allArticles", PAUSED);
    h.queries.set("contentAdmin.allNotifications", PAUSED);
    h.queries.set("contentAdmin.generationLog", PAUSED);
    render(<ContentManager />);
    for (const label of ["Total Articles", "Published", "Drafts", "AI Generations"]) {
      const card = screen.getByText(label).parentElement?.parentElement as HTMLElement;
      expect(card.querySelector(".stat-value")?.textContent, label).not.toMatch(/\d/);
      expect(within(card).getByText("Unable to determine"), label).toBeTruthy();
    }
  });

  it("ContentManager positive control: real empty reads still read 0 in every tile", () => {
    h.queries.set("contentAdmin.allArticles", ok([]));
    h.queries.set("contentAdmin.allNotifications", ok([]));
    h.queries.set("contentAdmin.generationLog", ok([]));
    render(<ContentManager />);
    for (const label of ["Total Articles", "Published", "Drafts", "AI Generations"]) {
      const card = screen.getByText(label).parentElement?.parentElement as HTMLElement;
      expect(card.querySelector(".stat-value")?.textContent, label).toBe("0");
    }
  });

  it("Instagram: a paused pipeline-health read shows 'Meta unknown'", () => {
    h.queries.set("instagramAdmin.getPipelineHealth", PAUSED);
    render(<InstagramAdmin />);
    expect(screen.getByText("Meta unknown")).toBeTruthy();
  });

  it("Instagram positive control: a read still in flight shows no chip", () => {
    h.queries.set("instagramAdmin.getPipelineHealth", FETCHING);
    render(<InstagramAdmin />);
    expect(screen.queryByText("Meta unknown")).toBeNull();
  });
});

describe("shared ErrorState", () => {
  it("the Retry button is at least 48 px", () => {
    render(<ErrorState message="x couldn't load" onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: /try again/i }).className).toMatch(/\bmin-h-12\b/);
  });
});

describe("typed ALL-CAPS literals are sentence case", () => {
  const FILES = ["client/src/pages/admin/SettingsSection.tsx", "client/src/pages/admin/settings/IntegrationsSection.tsx"];
  // Acronyms and brand tokens that are real capitals.
  const ALLOWED = new Set(["TPMS", "TCPA"]);
  // The "Copy estimate" clipboard text is output, not a label: byte-identical on purpose, exempted by name.
  const CLIPBOARD_LITERAL = "\n\nTOTAL: $";

  /** Every JSX text and string/template piece in `source` that carries a word of 4+ capitals. */
  function capsLiteralsIn(source: string, fileName: string): string[] {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const hits: string[] = [];
    const check = (text: string) => {
      if (text === CLIPBOARD_LITERAL) return;
      for (const w of text.match(/\b[A-Z]{4,}\b/g) ?? []) if (!ALLOWED.has(w)) hits.push(`${w} in ${JSON.stringify(text.trim().slice(0, 50))}`);
    };
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n)) return;
      if (ts.isJsxText(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) check(n.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return hits;
  }
  const capsLiterals = (file: string) => capsLiteralsIn(readFileSync(join(process.cwd(), file), "utf8"), file);

  for (const file of FILES) {
    it(`${file.split("/").pop()} has none`, () => {
      expect(capsLiterals(file)).toEqual([]);
    });
  }

  it("positive control: the real scan catches single-line, multi-line JSX and multi-line template violations", () => {
    expect(capsLiteralsIn("export const A = () => <b>GATEWAY TIRE</b>;", "a.tsx")).toHaveLength(2);
    expect(capsLiteralsIn("export const A = () => (\n  <b>\n    GATEWAY TIRE\n  </b>\n);", "b.tsx")).toHaveLength(2);
    expect(capsLiteralsIn("export const A = (n: number) => `SEARCH\nTIRES ${n}`;", "c.tsx")).toHaveLength(2);
  });

  it("positive control: acronyms and the named clipboard literal pass", () => {
    expect(capsLiteralsIn("export const A = () => <b>TPMS and TCPA</b>;", "d.tsx")).toEqual([]);
    expect(capsLiteralsIn("export const A = (t: number) => `\n\nTOTAL: $${t}`;", "e2.tsx")).toEqual([]);
    // Any other multi-line literal with caps is NOT exempt.
    expect(capsLiteralsIn("export const A = (t: number) => `\n\nGRAND TOTAL: $${t}`;", "f.tsx")).toHaveLength(2);
  });
});
