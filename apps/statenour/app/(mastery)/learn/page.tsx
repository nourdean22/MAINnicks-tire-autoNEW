/**
 * /learn — Build Your Own X catalog · v10.0.52 · Apr 30.
 *
 * Browse surface for the curated codecrafters-io/build-your-own-x
 * tutorial index. Server component (no client interactivity needed
 * beyond native scroll-to-anchor + native search via the URL).
 *
 * Companion Nick tool: `searchBuildYourOwnX` lets the chat answer
 * "show me Python tutorials for building a database" with a
 * filtered list inline.
 */

import { getCategories, totalTutorials, type Tutorial } from "@/lib/learn/build-your-own-x";
import { Search, ExternalLink, Video } from "lucide-react";
import Link from "next/link";
import { StandardPage } from "@/components/layout/standard-page";

// 2026-06-21 · CSP follow-up · was "force-static", but a statically prerendered
// page ships no CSP nonce, so the runtime `'strict-dynamic'` header blocks all
// its scripts (blank page). The parent (mastery) layout is now force-dynamic;
// a force-static child under it also errors the build. Still server-rendered —
// only the render timing changes.
export const dynamic = "force-dynamic";

type LearnSort = "alpha-asc" | "alpha-desc" | "language" | "video-first";

export default function LearnPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; lang?: string; sort?: string }>;
}) {
  return <LearnPageInner searchParams={searchParams} />;
}

async function LearnPageInner({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; lang?: string; sort?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const q = (params.q ?? "").trim().toLowerCase();
  const lang = (params.lang ?? "").trim().toLowerCase();
  // v10.0.440 · URL-driven sort (kept server-rendered · pure static)
  const sort: LearnSort = (() => {
    const s = (params.sort ?? "").trim().toLowerCase() as LearnSort;
    return s === "alpha-desc" || s === "language" || s === "video-first"
      ? s
      : "alpha-asc";
  })();
  const cats = getCategories();
  const total = totalTutorials();

  const filterTutorials = (tutorials: Tutorial[]): Tutorial[] => {
    let out = tutorials;
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      out = out.filter((t) =>
        tokens.every((tok) =>
          `${t.category} ${t.title}`.toLowerCase().includes(tok),
        ),
      );
    }
    if (lang) {
      out = out.filter((t) => t.language && t.language.toLowerCase().includes(lang));
    }
    return out;
  };

  // v10.0.440 · sort tutorials within each category before render
  const sortTutorials = (list: Tutorial[]): Tutorial[] => {
    const out = [...list];
    switch (sort) {
      case "alpha-desc":
        out.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case "language":
        out.sort((a, b) => {
          const la = (a.language ?? "zzz").toLowerCase();
          const lb = (b.language ?? "zzz").toLowerCase();
          if (la !== lb) return la.localeCompare(lb);
          return a.title.localeCompare(b.title);
        });
        break;
      case "video-first":
        out.sort((a, b) => {
          const va = a.videoOnly ? 0 : 1;
          const vb = b.videoOnly ? 0 : 1;
          if (va !== vb) return va - vb;
          return a.title.localeCompare(b.title);
        });
        break;
      case "alpha-asc":
      default:
        out.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }
    return out;
  };

  const filteredCats = cats
    .map((c) => ({ ...c, tutorials: sortTutorials(filterTutorials(c.tutorials)) }))
    .filter((c) => c.tutorials.length > 0);

  const filteredTotal = filteredCats.reduce((s, c) => s + c.tutorials.length, 0);
  const hasFilter = !!q || !!lang;

  return (
    <StandardPage
      eyebrow="knowledge"
      title="Build Your Own X"
      description="curated tutorials for re-building canonical technologies from scratch."
      width="xl"
    >
      {/* v10.0.529.55 · Feynman quote cut · audit Wave 9 flagged AI-slop
          (every learning page ships this exact quote · adds nothing the
          title doesn't say · breaks the spare aesthetic). Stats line moved
          out of the hand-rolled header into the body top when this surface
          adopted the canonical StandardPage shell. */}
      <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
        {total} tutorials · {cats.length} categories ·{" "}
        <a
          href="https://github.com/codecrafters-io/build-your-own-x"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--gold)] hover:underline"
        >
          source
        </a>
      </p>

      {/* Filter form (GET, server-rendered, no client JS) */}
      <form
        action="/learn"
        method="GET"
        className="mb-5 flex flex-wrap gap-2 items-center"
      >
        <div className="flex-1 min-w-[220px] relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
          />
          <input
            name="q"
            defaultValue={q}
            placeholder="search topic / title"
            className="w-full pl-9 pr-3 py-2 bg-[var(--bg-raised)] border border-[var(--border-default)] rounded-lg text-[12px] text-[var(--text-primary)] focus:border-[var(--gold)]/40 outline-none"
          />
        </div>
        <select
          name="lang"
          defaultValue={lang}
          className="px-3 py-2 bg-[var(--bg-raised)] border border-[var(--border-default)] rounded-lg text-[12px] text-[var(--text-primary)] focus:border-[var(--gold)]/40 outline-none"
        >
          <option value="">any language</option>
          {[
            "C",
            "C++",
            "C#",
            "Go",
            "Java",
            "JavaScript",
            "TypeScript",
            "Python",
            "Rust",
            "Ruby",
            "Swift",
            "Kotlin",
            "Lua",
            "Haskell",
            "OCaml",
            "Elixir",
            "Scala",
          ].map((l) => (
            <option key={l} value={l.toLowerCase()}>
              {l}
            </option>
          ))}
        </select>
        {/* v10.0.529.58 · explicit Filter submit button cut · native
            <form action="/learn" method="GET"> submits on Enter
            already. The Clear link below stays · operator needs a
            visible way to reset filters. */}
        {hasFilter && (
          <Link
            href="/learn"
            className="px-3 py-2 border border-[var(--border-default)] text-[var(--text-tertiary)] text-[11px] uppercase tracking-wider rounded-lg hover:text-[var(--text-secondary)] transition-colors"
          >
            Clear
          </Link>
        )}
      </form>

      {hasFilter && (
        <p className="text-[11px] font-mono text-[var(--text-tertiary)] mb-3">
          {filteredTotal} match{filteredTotal === 1 ? "" : "es"} for{" "}
          {q && <span className="text-[var(--gold)]">&ldquo;{q}&rdquo;</span>}
          {q && lang && " · "}
          {lang && (
            <span className="text-[var(--gold)]">
              language: {lang}
            </span>
          )}
        </p>
      )}

      {/* TOC pills */}
      {!hasFilter && (
        <nav className="mb-6 flex flex-wrap gap-1.5">
          {cats.map((c) => (
            <a
              key={c.slug}
              href={`#${c.slug}`}
              className="text-[10px] font-mono uppercase tracking-[0.15em] px-2 py-1 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30 transition-colors"
            >
              {c.name} · {c.tutorials.length}
            </a>
          ))}
        </nav>
      )}

      {/* Category sections */}
      {filteredCats.length === 0 ? (
        <div className="text-center py-12 border border-[var(--border-default)] rounded-lg bg-[var(--bg-raised)]">
          <p className="text-[var(--text-tertiary)] text-[13px]">
            no tutorials match those filters.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredCats.map((c) => (
            <section key={c.slug} id={c.slug}>
              <h2 className="text-[14px] font-[var(--font-display)] font-bold text-[var(--gold)] mb-2 flex items-baseline gap-2">
                {c.name}
                <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">
                  {c.tutorials.length}
                </span>
              </h2>
              <ul className="space-y-1.5">
                {c.tutorials.map((t, i) => (
                  <li
                    key={`${t.url}-${i}`}
                    className="flex items-start gap-2 px-3 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] hover:border-[var(--gold)]/30 transition-colors"
                  >
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-0"
                    >
                      <div className="flex items-baseline gap-2 flex-wrap">
                        {t.language && (
                          <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--gold)] shrink-0">
                            {t.language}
                          </span>
                        )}
                        <span className="text-[12.5px] text-[var(--text-primary)] hover:text-[var(--gold)] transition-colors leading-snug">
                          {t.title}
                        </span>
                        {t.videoOnly && (
                          <Video
                            size={11}
                            className="text-[var(--text-tertiary)] shrink-0"
                          />
                        )}
                      </div>
                      <p className="text-[10px] text-[var(--text-tertiary)] font-mono mt-0.5 truncate">
                        {hostnameOf(t.url)}
                      </p>
                    </a>
                    <ExternalLink
                      size={11}
                      className="text-[var(--text-tertiary)] shrink-0 mt-1"
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Wave 2 (2026-06-03) · the active AI learning LOOP (KommandoLearn)
          moved to /stats?#learning (the personal-growth board). This page
          stays the static Build-Your-Own-X CATALOG — a force-static dev
          reference library. */}
    </StandardPage>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
