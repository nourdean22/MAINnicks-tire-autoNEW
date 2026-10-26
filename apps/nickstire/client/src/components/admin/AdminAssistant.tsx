/**
 * Ask: the admin assistant sheet, reachable from every admin page.
 * Bottom sheet on the phone, side panel on the laptop, one thread per admin user and device.
 * Design and benchmark: apps/nickstire/docs/ADMIN-ASSISTANT.md.
 *
 * The server never writes. A proposal card runs the EXISTING mutation only when tapped,
 * and its receipt comes from that mutation's result, never from the model's words.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageSquare, X } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { openCustomerDrawer } from "@/pages/admin/shared/navigation";
import type { AdminSection } from "@/pages/admin/shared";

type Answer = RouterOutputs["nickActions"]["ask"];
type Proposal = Answer["proposals"][number];
export type AssistantPage = { section: string; title?: string; params?: Record<string, string>; customerId?: number };
type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  pageLabel?: string;
  answer?: Omit<Answer, "reply">;
  error?: boolean;
  /** Proposal index -> receipt text, written only after the mutation resolved. */
  done?: Record<number, string>;
};

export const OPEN_ADMIN_ASSISTANT_EVENT = "admin:open-assistant";
export function openAdminAssistant() {
  window.dispatchEvent(new CustomEvent(OPEN_ADMIN_ASSISTANT_EVENT));
}

const MAX_STORED = 40;
const SENT_TO_SERVER = 12;

/** The page envelope sent with a question: section, title, whitelisted URL params, the customer in view. */
export function buildPageContext(section: string, title: string | undefined, search: string): AssistantPage {
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) {
    if ((k === "tab" || k === "id" || k.endsWith("Tab")) && v) params[k.slice(0, 40)] = v.slice(0, 120);
  }
  const id = Number(params.id);
  const customerId = section === "customers" && Number.isInteger(id) && id > 0 ? id : undefined;
  return { section, title, params: Object.keys(params).length ? params : undefined, customerId };
}

export function pageLabel(page: AssistantPage): string {
  return [page.title || page.section, page.customerId ? `customer #${page.customerId}` : null].filter(Boolean).join(" · ");
}

export type ReplyPart = { text: string } | { ref: { type: string; id: number; label: string } };
/** Splits a verified reply into text and record chips. Unknown refs never reach here (server strips them). */
export function splitReply(reply: string, citations: Answer["citations"]): ReplyPart[] {
  const byKey = new Map(citations.map((c) => [`${c.type}:${c.id}`, c]));
  const parts: ReplyPart[] = [];
  let last = 0;
  for (const m of reply.matchAll(/\[\[(customer|invoice|lead):(\d+)\]\]/g)) {
    if (m.index! > last) parts.push({ text: reply.slice(last, m.index) });
    const hit = byKey.get(`${m[1]}:${m[2]}`);
    if (hit) parts.push({ ref: hit });
    last = m.index! + m[0].length;
  }
  if (last < reply.length) parts.push({ text: reply.slice(last) });
  return parts.map((p) => ("text" in p ? { text: p.text.replace(/\*\*/g, "") } : p));
}

const STARTERS: Partial<Record<string, string[]>> = {
  overview: ["How did we do this week vs last week?", "Anything I should follow up on today?"],
  customers: ["Who are my best customers that have not been back in 6 months?", "Summarize this customer"],
  revenue: ["What did we sell in the last 7 days?", "How much declined work is there this month?"],
  leads: ["Show the newest website leads", "Which leads have not been contacted?"],
  tireOrders: ["What do 225/65R17 tires cost us right now?"],
  voiceReceptionist: ["Show the last 10 calls"],
};
const DEFAULT_STARTERS = ["What did we sell yesterday?", "What are our Google reviews saying?"];

function loadThread(key: string): Turn[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-MAX_STORED) : [];
  } catch {
    return [];
  }
}

export function AdminAssistant({ userKey, section, sectionTitle, allowedSections, onNavigate }: {
  userKey: string;
  section: AdminSection;
  sectionTitle?: string;
  allowedSections: readonly AdminSection[];
  onNavigate: (section: AdminSection) => void;
}) {
  const storageKey = `nt-admin-assistant:v1:${userKey}`;
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<Turn[]>(() => loadThread(storageKey));
  const [draft, setDraft] = useState("");
  const [usePage, setUsePage] = useState(true);
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(min-width: 1024px)").matches);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ask = trpc.nickActions.ask.useMutation();

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(thread.slice(-MAX_STORED))); } catch { /* private mode: thread lives for this session only */ }
  }, [storageKey, thread]);
  useEffect(() => { setUsePage(true); }, [section]);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen((v) => !v); }
    };
    const mq = window.matchMedia?.("(min-width: 1024px)");
    const onMq = () => setDesktop(!!mq?.matches);
    window.addEventListener(OPEN_ADMIN_ASSISTANT_EVENT, onOpen);
    document.addEventListener("keydown", onKey);
    mq?.addEventListener?.("change", onMq);
    return () => {
      window.removeEventListener(OPEN_ADMIN_ASSISTANT_EVENT, onOpen);
      document.removeEventListener("keydown", onKey);
      mq?.removeEventListener?.("change", onMq);
    };
  }, []);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread, ask.isPending, open]);

  const page = useMemo(
    () => (open ? buildPageContext(section, sectionTitle, window.location.search) : null),
    // Recomputed when the sheet opens or the section changes; send() snapshots it again.
    [open, section, sectionTitle],
  );

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || ask.isPending) return;
    const snapshot = usePage ? buildPageContext(section, sectionTitle, window.location.search) : undefined;
    const userTurn: Turn = { id: crypto.randomUUID?.() ?? String(Date.now()), role: "user", content, at: Date.now(), pageLabel: snapshot ? pageLabel(snapshot) : undefined };
    const history = [...thread.filter((t) => !t.error), userTurn].slice(-SENT_TO_SERVER).map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }));
    setThread((t) => [...t, userTurn]);
    setDraft("");
    try {
      const { reply, ...answer } = await ask.mutateAsync({ messages: history, page: snapshot });
      setThread((t) => [...t, { id: `${userTurn.id}-a`, role: "assistant", content: reply, at: Date.now(), answer }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setThread((t) => [...t, { id: `${userTurn.id}-e`, role: "assistant", content: `Could not answer: ${message}. Nothing was read or changed.`, at: Date.now(), error: true }]);
    }
  }, [ask, thread, usePage, section, sectionTitle]);

  const markDone = (turnId: string, index: number, receipt: string) =>
    setThread((t) => t.map((x) => (x.id === turnId ? { ...x, done: { ...x.done, [index]: receipt } } : x)));

  const openRecord = (type: string, id: number) => {
    if (type !== "customer") return;
    setOpen(false);
    openCustomerDrawer(id);
  };

  const starters = STARTERS[section] ?? DEFAULT_STARTERS;
  return (
    <Drawer open={open} onOpenChange={setOpen} direction={desktop ? "right" : "bottom"}>
      <DrawerContent className="admin-assistant h-[88dvh] data-[vaul-drawer-direction=right]:h-dvh data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-md pb-[env(safe-area-inset-bottom,0px)]">
        <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-border">
          <DrawerTitle className="text-[15px] font-semibold flex-1">Ask</DrawerTitle>
          <DrawerDescription className="sr-only">Ask about the shop's records. Texts and notes are drafts until you tap them.</DrawerDescription>
          {thread.length > 0 && (
            <button type="button" onClick={() => setThread([])} className="min-h-11 px-3 text-[13px] text-muted-foreground hover:text-foreground">New chat</button>
          )}
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="inline-flex items-center justify-center w-11 h-11 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
          {thread.length === 0 && (
            <div className="space-y-2">
              <p className="text-[13px] text-muted-foreground">Answers come from the shop's records, with a link to each one. Texts and notes are drafts until you tap them.</p>
              {starters.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="block w-full text-left min-h-11 px-3 py-2 rounded-md border border-border text-[14px] hover:bg-muted">{s}</button>
              ))}
            </div>
          )}
          {thread.map((t) => (
            <TurnView key={t.id} turn={t} onRecord={openRecord} onDone={markDone} allowedSections={allowedSections}
              onOpenSection={(s, customerId) => {
                setOpen(false);
                if (customerId) openCustomerDrawer(customerId);
                else onNavigate(s);
              }} />
          ))}
          {ask.isPending && <p className="text-[13px] text-muted-foreground">Reading the shop's records...</p>}
        </div>

        <form className="border-t border-border px-3 pt-2 pb-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
          {page && usePage && (
            <div className="flex">
              <span className="inline-flex items-center gap-1 rounded-md bg-muted pl-2 text-[12px] text-muted-foreground">
                On: {pageLabel(page)}
                <button type="button" onClick={() => setUsePage(false)} aria-label="Do not send this page with my question" className="inline-flex items-center justify-center w-11 h-11"><X className="w-3.5 h-3.5" /></button>
              </span>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
              rows={1}
              enterKeyHint="send"
              maxLength={4000}
              aria-label="Ask a question"
              placeholder="Ask about customers, sales, calls, tires..."
              className="flex-1 resize-none max-h-32 min-h-11 rounded-md border border-border bg-background px-3 py-2.5 text-[16px] leading-snug"
            />
            <button type="submit" disabled={!draft.trim() || ask.isPending} className="min-h-11 min-w-16 px-4 rounded-md bg-primary text-primary-foreground text-[14px] font-medium disabled:opacity-50">Ask</button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function TurnView({ turn, onRecord, onDone, onOpenSection, allowedSections }: {
  turn: Turn;
  onRecord: (type: string, id: number) => void;
  onDone: (turnId: string, index: number, receipt: string) => void;
  onOpenSection: (section: AdminSection, customerId?: number) => void;
  allowedSections: readonly AdminSection[];
}) {
  if (turn.role === "user") {
    return (
      <div className="ml-8 rounded-lg bg-muted px-3 py-2 text-[14px] whitespace-pre-wrap">
        {turn.content}
        {turn.pageLabel && <div className="mt-1 text-[11px] text-muted-foreground">On: {turn.pageLabel}</div>}
      </div>
    );
  }
  const a = turn.answer;
  const failed = a?.receipts.filter((r) => !r.ok) ?? [];
  const read = a?.receipts.filter((r) => r.ok && r.source !== "client navigation") ?? [];
  return (
    <div className={`mr-4 text-[14px] leading-relaxed ${turn.error ? "text-destructive" : ""}`}>
      <div className="whitespace-pre-wrap">
        {splitReply(turn.content, a?.citations ?? []).map((p, i) => ("text" in p ? <span key={i}>{p.text}</span> : p.ref.type === "customer" ? (
          <button key={i} type="button" onClick={() => onRecord(p.ref.type, p.ref.id)} className="mx-0.5 inline-flex items-center min-h-8 px-1.5 rounded border border-border text-[12px] underline-offset-2 hover:underline">{p.ref.label}</button>
        ) : (
          <span key={i} className="mx-0.5 inline-flex items-center px-1.5 rounded border border-border text-[12px]">{p.ref.label}</span>
        )))}
      </div>
      {a?.proposals.map((p, i) => (
        <ProposalCard key={i} proposal={p} receipt={turn.done?.[i]} onDone={(r) => onDone(turn.id, i, r)} onOpenSection={onOpenSection} allowedSections={allowedSections} />
      ))}
      {(read.length > 0 || failed.length > 0 || (a?.unmatchedRefs ?? 0) > 0) && (
        <div className="mt-1.5 text-[11px] text-muted-foreground space-y-0.5">
          {read.length > 0 && <div>Read: {read.map((r) => `${r.source}${r.count != null ? ` (${r.count})` : ""}`).join(", ")}</div>}
          {failed.map((r) => <div key={r.tool} className="text-amber-600 dark:text-amber-400">UNKNOWN: {r.source} failed ({r.error})</div>)}
          {(a?.unmatchedRefs ?? 0) > 0 && <div>{a!.unmatchedRefs} reference(s) removed: not in the records read</div>}
        </div>
      )}
    </div>
  );
}

function ProposalCard({ proposal, receipt, onDone, onOpenSection, allowedSections }: {
  proposal: Proposal;
  receipt?: string;
  onDone: (receipt: string) => void;
  onOpenSection: (section: AdminSection, customerId?: number) => void;
  allowedSections: readonly AdminSection[];
}) {
  const utils = trpc.useUtils();
  const sms = trpc.customers.quickSms.useMutation();
  const notes = trpc.customers.updateNotes.useMutation();
  const [message, setMessage] = useState(proposal.kind === "sms" ? proposal.message : "");
  const busy = sms.isPending || notes.isPending;
  const card = "mt-2 rounded-lg border border-border p-3 space-y-2";
  const action = "min-h-11 w-full px-3 rounded-md bg-primary text-primary-foreground text-[14px] font-medium disabled:opacity-50";

  if (proposal.kind === "open") {
    const section = proposal.section as AdminSection;
    const allowed = !!proposal.customerId || allowedSections.includes(section);
    return (
      <div className="mt-2">
        {allowed
          ? <button type="button" onClick={() => onOpenSection(section, proposal.customerId)} className="min-h-11 px-3 rounded-md border border-border text-[14px] hover:bg-muted">{proposal.label}</button>
          : <p className="text-[12px] text-muted-foreground">That page is not open to your role.</p>}
      </div>
    );
  }
  if (receipt) return <div className={card}><p className="text-[13px]">{receipt}</p></div>;

  if (proposal.kind === "sms") {
    return (
      <div className={card}>
        <p className="text-[12px] text-muted-foreground">Draft text to {proposal.customerName} (...{proposal.phoneLast4}). Not sent.</p>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} rows={3} aria-label="Text message" className="w-full rounded-md border border-border bg-background px-3 py-2 text-[16px]" />
        <button type="button" disabled={busy || !message.trim()} className={action} onClick={async () => {
          try {
            const r = await sms.mutateAsync({ customerId: proposal.customerId, message: message.trim() });
            const out = r as { success?: boolean; queued?: boolean; uncertain?: boolean; error?: string };
            if (!out.success) { toast.error(`Not sent: ${out.error ?? "the text gateway refused it"}`); return; }
            onDone(out.queued ? `Queued for the morning window: text to ${proposal.customerName}.` : out.uncertain ? `Sent to the gateway, delivery not confirmed: text to ${proposal.customerName}.` : `Sent: text to ${proposal.customerName}.`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Not sent");
          }
        }}>{sms.isPending ? "Sending..." : `Send text to ${proposal.customerName}`}</button>
      </div>
    );
  }
  return (
    <div className={card}>
      <p className="text-[12px] text-muted-foreground">Note for {proposal.customerName}. Not saved.</p>
      <p className="text-[14px] whitespace-pre-wrap">{proposal.note}</p>
      <button type="button" disabled={busy} className={action} onClick={async () => {
        try {
          // Read the current notes at tap time so the note is appended, never replacing what is there.
          const current = await utils.customers.getById.fetch({ id: proposal.customerId });
          if (!current) { toast.error("Customer not found. Nothing saved."); return; }
          const stamp = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
          const next = [current.notes?.trim(), `${stamp}: ${proposal.note}`].filter(Boolean).join("\n").slice(0, 5000);
          const r = await notes.mutateAsync({ id: proposal.customerId, notes: next });
          if (!r.success) { toast.error("Not saved: the database did not take it."); return; }
          void utils.customers.getById.invalidate({ id: proposal.customerId });
          onDone(`Saved: note on ${proposal.customerName}.`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Not saved");
        }
      }}>{notes.isPending ? "Saving..." : `Add note to ${proposal.customerName}`}</button>
    </div>
  );
}

/** Header trigger for the laptop; the phone uses the Ask slot in the bottom tab bar. */
export function AdminAssistantButton() {
  return (
    <button type="button" onClick={openAdminAssistant} title="Ask (Ctrl+J)" className="hidden lg:inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] text-muted-foreground hover:text-foreground">
      <MessageSquare className="w-4 h-4" aria-hidden />Ask
    </button>
  );
}
