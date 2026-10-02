"use client";

import { useState, useEffect } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { logger } from "@/lib/logger";

const log = logger.withSurface("links-dashboard");

interface ShortLink {
  id: string;
  url: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  clickCount: number;
  createdAt: string;
}

export default function LinksPage() {
  const [links, setLinks] = useState<ShortLink[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Row interaction
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/short");
      if (!res.ok) throw new Error("Failed to load short links");
      const json = await res.json();
      setLinks(json.data.links);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
      log.error("load_links_failed", { error: String(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !url) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/short", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          url,
          source: source || null,
          medium: medium || null,
          campaign: campaign || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to create link");
      }
      setCode("");
      setUrl("");
      setSource("");
      setMedium("");
      setCampaign("");
      setShowForm(false);
      fetchData();
    } catch (e) {
      // window.alert is suppressed in the iOS PWA shell — surface in-DOM.
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (linkCode: string) => {
    if (confirmDelete !== linkCode) {
      setConfirmDelete(linkCode);
      return;
    }
    try {
      const res = await fetch(`/api/short?code=${encodeURIComponent(linkCode)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setConfirmDelete(null);
      fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const shortUrl = (linkCode: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/api/short/${linkCode}`;

  const handleCopy = async (linkCode: string) => {
    try {
      await navigator.clipboard.writeText(shortUrl(linkCode));
      setCopiedCode(linkCode);
      setTimeout(() => setCopiedCode((c) => (c === linkCode ? null : c)), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  const inputClass =
    "w-full min-h-[44px] rounded-control border border-edge-default bg-content px-3 py-2 text-[13px] text-fg focus:outline-none focus:border-accent";
  const labelClass =
    "block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-1";

  return (
    <StandardPage
      eyebrow="mastery · growth"
      title="link forge"
      description="Branded short links with UTM tagging and anonymized click tracking."
      width="2xl"
      rhythm="comfortable"
      loading={loading && !links}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setShowForm(!showForm);
            setFormError(null);
          }}
          className="min-h-[44px] text-[13px] font-medium"
        >
          {showForm ? "Cancel" : "+ New link"}
        </Button>
      }
    >
      {error && (
        <div className="border-l-2 border-rose-500/60 py-1 pl-4 text-[14px] text-rose-300">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-3 border-l-2 border-edge-strong py-1 pl-4 sm:pl-5"
        >
          <h3 className="text-sm font-semibold text-fg">
            Create short link
          </h3>
          {formError && (
            <p className="text-xs text-rose-300 bg-rose-500/[0.05] border border-rose-500/20 rounded-control px-3 py-2">
              {formError}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Code / Slug</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={inputClass}
                placeholder="e.g. coaching"
              />
            </div>
            <div>
              <label className={labelClass}>Destination URL</label>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={inputClass}
                placeholder="https://example.com/landing"
              />
            </div>
            <div>
              <label className={labelClass}>UTM Source</label>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={inputClass}
                placeholder="e.g. instagram"
              />
            </div>
            <div>
              <label className={labelClass}>UTM Medium</label>
              <input
                type="text"
                value={medium}
                onChange={(e) => setMedium(e.target.value)}
                className={inputClass}
                placeholder="e.g. bio"
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>UTM Campaign</label>
              <input
                type="text"
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                className={inputClass}
                placeholder="e.g. spring_launch"
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] rounded-control bg-accent px-4 text-[14px] font-semibold text-[var(--text-inverse)] hover:bg-accent-hover"
          >
            {submitting ? "Creating..." : "Create link"}
          </Button>
        </form>
      )}

      <div className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary px-1">
          Links ({links?.length || 0})
        </h2>

        <div className="overflow-hidden border-y border-edge">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-edge-default bg-content font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
                  <th className="p-3">Code</th>
                  <th className="p-3">Destination</th>
                  <th className="p-3">UTM</th>
                  <th className="p-3 text-right">Clicks</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-subtle text-xs">
                {links?.map((link) => (
                  <tr key={link.id} className="hover:bg-surface-hover transition-colors duration-[var(--motion-state)] align-top">
                    <td className="p-3">
                      <div className="font-semibold text-[var(--text-primary)] font-mono">{link.id}</div>
                      <button
                        type="button"
                        onClick={() => handleCopy(link.id)}
                        className="mt-0.5 min-h-[44px] text-[12px] font-mono text-fg-tertiary hover:text-fg hover:underline"
                      >
                        {copiedCode === link.id ? "Copied!" : "Copy link ↗"}
                      </button>
                    </td>
                    <td className="p-3 max-w-[260px] truncate text-[var(--text-secondary)]" title={link.url}>
                      {link.url}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {[link.source, link.medium, link.campaign].filter(Boolean).length === 0 ? (
                          <span className="text-[var(--text-tertiary)]">—</span>
                        ) : (
                          [
                            { k: "src", v: link.source },
                            { k: "med", v: link.medium },
                            { k: "cmp", v: link.campaign },
                          ]
                            .filter((t) => t.v)
                            .map((t) => (
                              <Badge
                                key={t.k}
                                className="bg-surface-interactive text-[11px] font-mono border border-edge-subtle text-fg-secondary"
                              >
                                {t.k}:{t.v}
                              </Badge>
                            ))
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono font-semibold text-[var(--text-primary)]">
                      {link.clickCount}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(link.id)}
                        onMouseLeave={() => setConfirmDelete((c) => (c === link.id ? null : c))}
                        className={`min-h-[44px] text-[13px] font-medium hover:underline ${
                          confirmDelete === link.id ? "text-rose-400" : "text-[var(--text-tertiary)]"
                        }`}
                      >
                        {confirmDelete === link.id ? "Sure?" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}

                {links?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center p-6 text-sm text-[var(--text-tertiary)]">
                      No short links yet. Create one above — it resolves at{" "}
                      <span className="font-mono">/api/short/&lt;code&gt;</span>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </StandardPage>
  );
}
