/**
 * SmsSection — wave-129 minimalist UI redo.
 *
 * Operator screenshot bug-class: "i don't think it's wired up to the SMS
 * gateway / doesn't open an in-browser texting UI." The wiring was already
 * correct (smsConversations.send → sendSms via shop F25e gateway). The
 * problem was discoverability — the texting was buried two tabs deep with
 * a Test/Manual send form pretending to be the primary action.
 *
 * This rewrite leads with the conversation pane, iPhone-Messages-style:
 *   · 2-col on desktop (list left, thread right)
 *   · single-col on mobile (list → drill to thread, back arrow)
 *   · compact gateway pill in header (no oversized status card)
 *   · "New" button to start a thread to any number
 *   · day-divider in thread, bubble message rows
 *   · single composer with cmd-enter send
 *
 * Backend untouched — server/routers/smsConversations.ts already routes
 * outbound through the F25e shop gateway with Twilio fallback (wave-105).
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BUSINESS } from "@shared/business";
import {
  ArrowLeft, Send as SendIcon, Plus, MessageSquare, Search, X,
} from "lucide-react";
import { PageHeader } from "./shared";

// ─── Types ──────────────────────────────────────────────
interface ConversationRow {
  id: number;
  customerPhone: string;
  customerName: string | null;
  lastMessage: string | null;
  lastMessageAt: string | Date | null;
  unreadCount: number | null;
}

interface MessageRow {
  id: number;
  conversationId: number;
  direction: "inbound" | "outbound";
  body: string;
  twilioSid: string | null;
  status: "queued" | "sent" | "delivered" | "failed" | "received";
  createdAt: string | Date;
}

// ─── Format helpers ─────────────────────────────────────
function formatPhone(p: string): string {
  const d = (p || "").replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function dayKey(iso: string | Date): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function dayLabel(iso: string | Date): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: today.getFullYear() === d.getFullYear() ? undefined : "numeric" });
}

function initialsFor(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase()).filter(Boolean).join("") || phone.slice(-2);
  }
  return formatPhone(phone).replace(/\D/g, "").slice(-2);
}

// ─── Compact gateway status pill ────────────────────────
function GatewayPill() {
  const status = trpc.sms.status.useQuery();
  const health = trpc.sms.gatewayHealth.useQuery(undefined, { refetchInterval: 60_000 });
  const shopOnline = health.data?.online ?? false;
  const shopConfigured = status.data?.shopGateway?.configured ?? false;
  const tone = !shopConfigured ? "bg-red-400" : shopOnline ? "bg-emerald-400" : "bg-amber-400";
  const label = !shopConfigured ? "Gateway: not configured" : shopOnline ? "Live" : "Gateway offline";
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-foreground/[0.04] border border-border/30 rounded-full text-[11px] text-foreground/60">
      <span className={`w-1.5 h-1.5 rounded-full ${tone}`} />
      <span>{label}</span>
      <span className="text-foreground/30">·</span>
      <span className="font-mono">{BUSINESS.phone.dashed}</span>
    </div>
  );
}

// ─── Day-grouped messages ───────────────────────────────
function ThreadView({
  conversation,
  onBack,
}: {
  conversation: ConversationRow;
  onBack: () => void;
}) {
  const utils = trpc.useUtils();
  const [reply, setReply] = useState("");
  const messagesQ = trpc.smsConversations.messages.useQuery(
    { conversationId: conversation.id, limit: 200 },
    { refetchInterval: 15_000 },
  );
  const markRead = trpc.smsConversations.markRead.useMutation();
  const send = trpc.smsConversations.send.useMutation({
    onSuccess: () => {
      void messagesQ.refetch();
      void utils.smsConversations.list.invalidate();
      void utils.smsConversations.unreadCount.invalidate();
      setReply("");
    },
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Mark read on open
  useEffect(() => {
    if ((conversation.unreadCount ?? 0) > 0) {
      markRead.mutate({ conversationId: conversation.id });
      void utils.smsConversations.list.invalidate();
      void utils.smsConversations.unreadCount.invalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messagesQ.data?.length]);

  // Group by day
  const grouped = useMemo(() => {
    const rows = (messagesQ.data as MessageRow[] | undefined) ?? [];
    const groups: { key: string; label: string; items: MessageRow[] }[] = [];
    for (const m of rows) {
      const k = dayKey(m.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.key === k) {
        last.items.push(m);
      } else {
        groups.push({ key: k, label: dayLabel(m.createdAt), items: [m] });
      }
    }
    return groups;
  }, [messagesQ.data]);

  const handleSend = async () => {
    if (!reply.trim()) return;
    try {
      const res = await send.mutateAsync({
        phone: conversation.customerPhone,
        message: reply.trim(),
        customerName: conversation.customerName || undefined,
      });
      if (res.success) toast.success("Sent");
      else toast.error("Send failed — check gateway status");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    }
  };

  const displayName = conversation.customerName || formatPhone(conversation.customerPhone);

  return (
    <div className="flex flex-col h-full bg-card border border-border/30 rounded-lg overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border/20 bg-foreground/[0.02]">
        <button
          onClick={onBack}
          className="lg:hidden p-1.5 -ml-1.5 hover:bg-foreground/5 rounded-md transition-colors"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="w-4 h-4 text-foreground/70" />
        </button>
        <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold text-[13px] flex-shrink-0">
          {initialsFor(conversation.customerName, conversation.customerPhone)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground tracking-tight truncate text-[15px]">{displayName}</h3>
          <a href={`tel:${conversation.customerPhone}`} className="text-foreground/50 text-xs font-mono hover:text-primary transition-colors">
            {formatPhone(conversation.customerPhone)}
          </a>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-5 bg-background/40 min-h-[420px]">
        {messagesQ.isLoading && (
          <div className="text-foreground/40 text-sm text-center py-12">Loading messages…</div>
        )}
        {messagesQ.data && messagesQ.data.length === 0 && (
          <div className="text-foreground/40 text-sm text-center py-12">No messages yet — say hi.</div>
        )}
        {grouped.map((g) => (
          <div key={g.key} className="space-y-2">
            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 h-px bg-border/30" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/40 font-medium">{g.label}</span>
              <div className="flex-1 h-px bg-border/30" />
            </div>
            {g.items.map((m) => {
              const outbound = m.direction === "outbound";
              const failed = m.status === "failed";
              return (
                <div key={m.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] flex flex-col ${outbound ? "items-end" : "items-start"}`}>
                    <div
                      className={`px-3.5 py-2 text-[14px] leading-relaxed rounded-2xl ${
                        outbound
                          ? failed
                            ? "bg-red-500/15 text-red-300 border border-red-500/30 rounded-br-md"
                            : "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-foreground/8 text-foreground rounded-bl-md"
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    </div>
                    <div className="mt-1 px-1 text-[10px] text-foreground/40 flex items-center gap-1.5">
                      <span>{formatTime(m.createdAt)}</span>
                      {outbound && (
                        <>
                          <span>·</span>
                          <span className={failed ? "text-red-400 font-medium" : ""}>{m.status === "failed" ? "Failed" : m.status === "delivered" ? "Delivered" : m.status === "sent" ? "Sent" : m.status}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="px-3 py-3 border-t border-border/20 bg-card">
        <div className="flex items-end gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Message…"
            rows={1}
            maxLength={1600}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSend();
              }
            }}
            className="flex-1 bg-foreground/5 border border-border/30 rounded-2xl px-4 py-2.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none text-[14px] max-h-32"
            style={{ minHeight: "42px" }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={send.isPending || !reply.trim()}
            className="bg-primary text-primary-foreground w-10 h-10 rounded-full hover:bg-primary/90 disabled:opacity-30 transition-all flex items-center justify-center flex-shrink-0"
            title="Send (⌘/Ctrl + Enter)"
            aria-label="Send"
          >
            <SendIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-1.5 px-2 flex items-center justify-between text-[10px] text-foreground/30">
          <span>{reply.length}/1600 · ⌘/Ctrl+Enter to send</span>
          <span>via {BUSINESS.phone.dashed}</span>
        </div>
      </div>
    </div>
  );
}

// ─── New conversation composer ──────────────────────────
function NewConversationDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (conversationId: number) => void;
}) {
  const utils = trpc.useUtils();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const send = trpc.smsConversations.send.useMutation({
    onSuccess: (res) => {
      if (res.success && res.conversationId) {
        toast.success("Sent");
        void utils.smsConversations.list.invalidate();
        onCreated(res.conversationId);
      } else {
        toast.error("Send failed — check gateway status");
      }
    },
    onError: (err) => toast.error(err.message || "Send failed"),
  });

  const phoneClean = phone.replace(/\D/g, "");
  const valid = phoneClean.length >= 10 && message.trim().length > 0;

  const submit = () => {
    if (!valid) return;
    send.mutate({ phone: phoneClean, message: message.trim(), customerName: name.trim() || undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-border/40 rounded-t-2xl sm:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border/20">
          <h3 className="font-semibold text-foreground tracking-tight text-[15px]">New message</h3>
          <button
            onClick={onClose}
            className="p-1.5 -mr-1.5 hover:bg-foreground/5 rounded-md transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-foreground/60" />
          </button>
        </header>
        <div className="px-5 py-4 space-y-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">To</span>
            <input
              type="tel"
              autoFocus
              placeholder="(216) 555-1234"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-foreground/5 border border-border/30 rounded-md px-3 py-2.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 text-[14px]"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Name <span className="text-foreground/30 normal-case tracking-normal">(optional)</span></span>
            <input
              type="text"
              placeholder="Customer name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-foreground/5 border border-border/30 rounded-md px-3 py-2.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 text-[14px]"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Message</span>
            <textarea
              placeholder="Hey, this is Nick from Nick's Tire…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={1600}
              className="w-full bg-foreground/5 border border-border/30 rounded-md px-3 py-2.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none text-[14px]"
            />
          </label>
          <div className="text-[10px] text-foreground/40 flex items-center justify-between pt-1">
            <span>{message.length}/1600</span>
            <span>via {BUSINESS.phone.dashed}</span>
          </div>
        </div>
        <footer className="px-5 py-3.5 border-t border-border/20 flex items-center justify-end gap-2 bg-foreground/[0.02] rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium text-foreground/60 hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid || send.isPending}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md font-semibold text-[13px] hover:bg-primary/90 disabled:opacity-40 transition-colors flex items-center gap-2"
          >
            <SendIcon className="w-3.5 h-3.5" />
            {send.isPending ? "Sending…" : "Send"}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Conversation list ──────────────────────────────────
function ConversationList({
  selectedId,
  onSelect,
  onNew,
  searchQ,
  setSearchQ,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  searchQ: string;
  setSearchQ: (q: string) => void;
}) {
  const list = trpc.smsConversations.list.useQuery(
    { limit: 100 },
    { refetchInterval: 30_000 },
  );

  const filtered = useMemo(() => {
    const rows = (list.data as ConversationRow[] | undefined) ?? [];
    if (!searchQ.trim()) return rows;
    const q = searchQ.toLowerCase();
    return rows.filter((c) =>
      (c.customerName?.toLowerCase().includes(q)) ||
      formatPhone(c.customerPhone).toLowerCase().includes(q) ||
      (c.lastMessage?.toLowerCase().includes(q))
    );
  }, [list.data, searchQ]);

  const totalUnread = useMemo(() =>
    ((list.data as ConversationRow[] | undefined) ?? []).reduce((acc, c) => acc + (c.unreadCount ?? 0), 0),
    [list.data]
  );

  return (
    <div className="flex flex-col h-full bg-card border border-border/30 rounded-lg overflow-hidden">
      <header className="px-4 pt-4 pb-2 border-b border-border/20">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-foreground tracking-tight text-[15px]">Messages</h2>
            {totalUnread > 0 && (
              <p className="text-[11px] text-primary font-medium mt-0.5">{totalUnread} unread</p>
            )}
          </div>
          <button
            onClick={onNew}
            className="bg-primary text-primary-foreground w-8 h-8 rounded-full hover:bg-primary/90 transition-colors flex items-center justify-center"
            aria-label="New conversation"
            title="New conversation"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
          <input
            type="text"
            placeholder="Search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            className="w-full bg-foreground/5 border border-border/20 rounded-full pl-9 pr-3 py-1.5 text-[13px] text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/40"
          />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        {list.isLoading && (
          <div className="text-foreground/40 text-sm text-center py-12">Loading…</div>
        )}
        {!list.isLoading && filtered.length === 0 && !searchQ && (
          <div className="text-center py-12 px-4">
            <MessageSquare className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
            <p className="text-foreground/50 text-sm">No conversations yet</p>
            <p className="text-foreground/30 text-xs mt-1">Customers texting {BUSINESS.phone.dashed} will land here.</p>
            <button
              onClick={onNew}
              className="mt-4 text-primary text-[13px] font-medium hover:underline"
            >
              Send first message →
            </button>
          </div>
        )}
        {!list.isLoading && filtered.length === 0 && searchQ && (
          <div className="text-foreground/40 text-sm text-center py-12">No matches for "{searchQ}"</div>
        )}
        <div className="divide-y divide-border/10">
          {filtered.map((c) => {
            const unread = (c.unreadCount ?? 0) > 0;
            const active = selectedId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                  active ? "bg-primary/8" : "hover:bg-foreground/[0.04]"
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center font-semibold text-[12px] ${
                  unread ? "bg-primary/15 text-primary" : "bg-foreground/8 text-foreground/70"
                }`}>
                  {initialsFor(c.customerName, c.customerPhone)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate text-[14px] ${unread ? "text-foreground font-semibold" : "text-foreground/90"}`}>
                      {c.customerName || formatPhone(c.customerPhone)}
                    </p>
                    <span className={`text-[11px] flex-shrink-0 ${unread ? "text-primary font-semibold" : "text-foreground/40"}`}>
                      {formatRelative(c.lastMessageAt)}
                    </span>
                  </div>
                  <p className={`text-[13px] truncate mt-0.5 ${unread ? "text-foreground/70" : "text-foreground/45"}`}>
                    {c.lastMessage || <span className="italic text-foreground/30">No messages</span>}
                  </p>
                </div>
                {unread && (
                  <span className="bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    {c.unreadCount! > 9 ? "9+" : c.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main section ───────────────────────────────────────
export default function SmsSection() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const list = trpc.smsConversations.list.useQuery({ limit: 100 });

  const selected = useMemo(
    () => (list.data as ConversationRow[] | undefined)?.find((c) => c.id === selectedId) ?? null,
    [list.data, selectedId],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Messages"
          subtitle="Two-way SMS with customers · routes through the shop F25e gateway with Twilio fallback"
          icon={<MessageSquare className="w-5 h-5" />}
        />
        <GatewayPill />
      </div>

      {/* Two-pane on desktop · single-pane on mobile (drill in/out) */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[560px]">
        {/* List — hide on mobile when a conversation is selected */}
        <div className={`${selected ? "hidden lg:flex" : "flex"} flex-col min-h-0`}>
          <ConversationList
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={() => setShowNew(true)}
            searchQ={searchQ}
            setSearchQ={setSearchQ}
          />
        </div>

        {/* Thread — show on mobile only when a conversation is selected */}
        <div className={`${selected ? "flex" : "hidden lg:flex"} flex-col min-h-0`}>
          {selected ? (
            <ThreadView conversation={selected} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-card border border-border/30 rounded-lg text-center px-6">
              <MessageSquare className="w-10 h-10 text-foreground/15 mb-4" />
              <h3 className="font-semibold text-foreground/70 tracking-tight mb-1">Select a conversation</h3>
              <p className="text-foreground/40 text-sm max-w-xs">
                Pick a thread from the left, or start a new message to any phone number.
              </p>
              <button
                onClick={() => setShowNew(true)}
                className="mt-5 inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-full font-medium text-[13px] hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New message
              </button>
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewConversationDialog
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}
