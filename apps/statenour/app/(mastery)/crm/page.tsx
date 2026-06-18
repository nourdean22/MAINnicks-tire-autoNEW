"use client";

import { useState, useEffect } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { logger } from "@/lib/logger";

const log = logger.withSurface("crm-dashboard");

interface Booking {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  calEventId: string | null;
}

interface Agreement {
  id: string;
  title: string;
  documentUrl: string;
  status: string;
  signedAt: string | null;
}

interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  notes: string | null;
  psychProfile: {
    motivations?: string | null;
    goals?: string[];
    painPoints?: string[];
  } | null;
  bookings: Booking[];
  agreements: Agreement[];
}

interface CrmData {
  contacts: Contact[];
  recentBookings: (Booking & { contact: { name: string } })[];
  recentAgreements: (Agreement & { contact: { name: string } })[];
}

export default function CrmPage() {
  const [data, setData] = useState<CrmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("lead");
  const [submitting, setSubmitting] = useState(false);

  // Fetch data
  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/crm");
      if (!res.ok) throw new Error("Failed to load CRM data");
      const json = await res.json();
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
      log.error("load_crm_failed", { error: String(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/webhooks/inbound-crm?secret=f1a8e2b8c9d4e5f6a7b8c9d0e1f2a3b4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: email || phone || name,
          body: `Hi, my name is ${name}. I am interested in coaching. Role: ${role}.`,
          subject: "Coaching inquiry",
        }),
      });

      if (!res.ok) throw new Error("Failed to create contact");
      setName("");
      setEmail("");
      setPhone("");
      setRole("lead");
      setShowAddForm(false);
      fetchData();
    } catch (e) {
      alert("Error adding contact: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StandardPage
      eyebrow="mastery · crm"
      title="relationship brain"
      description="Natively consolidate coaching leads, client agreements, and session bookings."
      width="2xl"
      rhythm="comfortable"
      loading={loading && !data}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-[11px] font-mono uppercase tracking-wider"
        >
          {showAddForm ? "Cancel" : "+ Add Contact"}
        </Button>
      }
    >
      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-4 text-sm text-rose-300">
          Error loading CRM: {error}
        </div>
      )}

      {/* Add contact form */}
      {showAddForm && (
        <form
          onSubmit={handleAddContact}
          className="rounded-lg border border-[var(--gold)]/20 bg-[var(--bg-raised)] p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            Create Contact (AI-Analyzed)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                placeholder="e.g. John Doe"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                placeholder="e.g. john@example.com"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                placeholder="e.g. +123456789"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
              >
                <option value="lead">Lead</option>
                <option value="coaching_client">Coaching Client</option>
                <option value="sponsor">Sponsor</option>
                <option value="partner">Partner</option>
              </select>
            </div>
          </div>
          <Button
            type="submit"
            disabled={submitting}
            className="text-xs uppercase tracking-wider bg-[var(--gold)] text-black hover:bg-[var(--gold)]/80"
          >
            {submitting ? "Processing..." : "Add & Parse with AI"}
          </Button>
        </form>
      )}

      {/* Main dashboard grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Contacts column */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--text-tertiary)] px-1">
            Contacts &amp; Dossiers ({data?.contacts.length || 0})
          </h2>

          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {data?.contacts.map((contact) => (
              <div
                key={contact.id}
                className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3 space-y-2 hover:border-[var(--gold)]/30 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                      {contact.name}
                    </h3>
                    <p className="text-[11px] font-mono text-[var(--text-tertiary)] mt-0.5">
                      {[contact.email, contact.phone].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Badge className="bg-zinc-800 text-[10px] uppercase border border-zinc-700">
                      {contact.role.replace("_", " ")}
                    </Badge>
                    <Badge className="bg-emerald-950 text-emerald-300 text-[10px] uppercase border border-emerald-800/40">
                      {contact.status}
                    </Badge>
                  </div>
                </div>

                {/* AI-extracted Profile */}
                {contact.psychProfile &&
                  (contact.psychProfile.motivations ||
                    (contact.psychProfile.goals && contact.psychProfile.goals.length > 0) ||
                    (contact.psychProfile.painPoints && contact.psychProfile.painPoints.length > 0)) && (
                    <div className="mt-2 text-xs rounded bg-zinc-900/40 border border-zinc-800/60 p-2 space-y-1">
                      {contact.psychProfile.motivations && (
                        <p className="text-[var(--text-secondary)]">
                          <strong className="text-[10px] uppercase tracking-wider text-[var(--gold)]/70 mr-1">
                            Motivation:
                          </strong>
                          {contact.psychProfile.motivations}
                        </p>
                      )}
                      {contact.psychProfile.goals && contact.psychProfile.goals.length > 0 && (
                        <p className="text-[var(--text-secondary)]">
                          <strong className="text-[10px] uppercase tracking-wider text-[var(--gold)]/70 mr-1">
                            Goals:
                          </strong>
                          {contact.psychProfile.goals.join(", ")}
                        </p>
                      )}
                      {contact.psychProfile.painPoints && contact.psychProfile.painPoints.length > 0 && (
                        <p className="text-[var(--text-secondary)]">
                          <strong className="text-[10px] uppercase tracking-wider text-[var(--gold)]/70 mr-1">
                            Pain Points:
                          </strong>
                          {contact.psychProfile.painPoints.join(", ")}
                        </p>
                      )}
                    </div>
                  )}

                {contact.notes && (
                  <p className="text-xs text-[var(--text-secondary)] border-l-2 border-zinc-700 pl-2 mt-2 whitespace-pre-wrap">
                    {contact.notes}
                  </p>
                )}
              </div>
            ))}

            {data?.contacts.length === 0 && (
              <div className="text-center p-6 border border-dashed border-zinc-800 text-sm text-[var(--text-tertiary)] rounded-lg">
                No contacts registered. Create one or send a webhook payload.
              </div>
            )}
          </div>
        </div>

        {/* Side columns: Bookings & Agreements */}
        <div className="space-y-4">
          {/* Bookings panel */}
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3 space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--text-tertiary)] border-b border-zinc-800 pb-1">
              Recent Bookings
            </h2>
            <div className="space-y-2 max-h-[30vh] overflow-y-auto">
              {data?.recentBookings.map((booking) => (
                <div key={booking.id} className="text-xs space-y-0.5 border-b border-zinc-900 pb-2">
                  <div className="flex justify-between font-semibold">
                    <span className="text-[var(--text-primary)]">{booking.title}</span>
                    <Badge className="bg-zinc-800 text-[9px]">{booking.status}</Badge>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)]">{booking.contact.name}</p>
                  <p className="text-[10px] font-mono text-[var(--text-tertiary)]">
                    {new Date(booking.startTime).toLocaleString()}
                  </p>
                </div>
              ))}
              {data?.recentBookings.length === 0 && (
                <p className="text-xs text-[var(--text-tertiary)] text-center py-2">No bookings recorded.</p>
              )}
            </div>
          </div>

          {/* Agreements panel */}
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3 space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--text-tertiary)] border-b border-zinc-800 pb-1">
              Active Agreements
            </h2>
            <div className="space-y-2 max-h-[30vh] overflow-y-auto">
              {data?.recentAgreements.map((agreement) => (
                <div key={agreement.id} className="text-xs space-y-1 border-b border-zinc-900 pb-2">
                  <div className="flex justify-between font-semibold">
                    <span className="text-[var(--text-primary)]">{agreement.title}</span>
                    <Badge
                      className={
                        agreement.status === "signed" ? "bg-emerald-950 text-emerald-400" : "bg-amber-950 text-amber-400"
                      }
                    >
                      {agreement.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)]">{agreement.contact.name}</p>
                  <a
                    href={agreement.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-[var(--gold)] hover:underline inline-block mt-0.5"
                  >
                    View Document ↗
                  </a>
                </div>
              ))}
              {data?.recentAgreements.length === 0 && (
                <p className="text-xs text-[var(--text-tertiary)] text-center py-2">No agreements uploaded.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </StandardPage>
  );
}
