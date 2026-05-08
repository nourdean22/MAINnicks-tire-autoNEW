/**
 * SmsSection — extracted from Admin.tsx for maintainability.
 *
 * Wave-105: added Conversations panel — list + thread + reply.
 * Operator can now see every customer SMS conversation and respond
 * inline without leaving the admin.
 */
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BUSINESS } from "@shared/business";
import {
  MessageSquare, Inbox, ArrowLeft, Send as SendIcon
} from "lucide-react";
import { PageHeader } from "./shared";

// ─── Wave-108: dual-gateway status card ────────────────
function GatewayStatusCard() {
  const status = trpc.sms.status.useQuery();
  const health = trpc.sms.gatewayHealth.useQuery(undefined, {
    refetchInterval: 60_000, // re-poll every minute
  });

  const shopConfigured = status.data?.shopGateway?.configured ?? false;
  const twilioConfigured = status.data?.twilio?.configured ?? false;
  const killSwitch = status.data?.twilio?.killSwitchActive ?? false;
  const shopOnline = health.data?.online ?? false;
  const ageMin = health.data && "ageMinutes" in health.data ? health.data.ageMinutes : null;

  return (
    <div className="bg-card border border-border/30 p-6">
      <h3 className="font-bold text-lg text-foreground tracking-[-0.01em] mb-4">SMS GATEWAYS</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Shop Gateway (primary) */}
        <div className="border border-border/20 p-4 bg-foreground/[0.03]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-foreground/50 text-[10px] uppercase tracking-[0.2em]">Primary</span>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${shopConfigured && shopOnline ? "bg-emerald-400" : shopConfigured ? "bg-amber-400" : "bg-red-400"}`} />
              <span className="text-[11px] text-foreground/60">
                {!shopConfigured ? "NOT CONFIGURED" : shopOnline ? "ONLINE" : "OFFLINE"}
              </span>
            </div>
          </div>
          <p className="font-bold text-foreground tracking-[-0.01em]">Shop F25e Gateway</p>
          <p className="text-foreground/50 text-[13px] mt-1">From: +1 216-862-0005</p>
          {shopConfigured && (
            <div className="mt-3 space-y-1 text-[12px] text-foreground/50">
              {ageMin !== null && (
                <p>Last seen: {ageMin === 0 ? "just now" : `${ageMin}m ago`}</p>
              )}
              {health.data?.deviceName && <p>Device: {health.data.deviceName}</p>}
              {health.data && "error" in health.data && health.data.error && (
                <p className="text-amber-400">{health.data.error}</p>
              )}
            </div>
          )}
        </div>

        {/* Twilio (fallback) */}
        <div className="border border-border/20 p-4 bg-foreground/[0.03]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-foreground/50 text-[10px] uppercase tracking-[0.2em]">Fallback</span>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${twilioConfigured && !killSwitch ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="text-[11px] text-foreground/60">
                {!twilioConfigured ? "NOT CONFIGURED" : killSwitch ? "KILL SWITCH ON" : "READY"}
              </span>
            </div>
          </div>
          <p className="font-bold text-foreground tracking-[-0.01em]">Twilio</p>
          <p className="text-foreground/50 text-[13px] mt-1">From: {status.data?.twilio?.fromNumber || "—"}</p>
          {killSwitch && (
            <p className="mt-3 text-[12px] text-amber-400">SMS_KILL_SWITCH=true — Twilio path blocked. Shop gateway still works. Set to false on Railway when Twilio is restored.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Wave-105: Conversation thread panel ────────────────
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

function formatPhone(p: string): string {
  const d = (p || "").replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return p;
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
}

function formatRelativeTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ConversationThread({
  conversation,
  onBack,
}: {
  conversation: ConversationRow;
  onBack: () => void;
}) {
  const utils = trpc.useUtils();
  const [reply, setReply] = useState("");
  const messages = trpc.smsConversations.messages.useQuery({ conversationId: conversation.id, limit: 200 });
  const markRead = trpc.smsConversations.markRead.useMutation();
  const send = trpc.smsConversations.send.useMutation({
    onSuccess: () => {
      void messages.refetch();
      void utils.smsConversations.list.invalidate();
      setReply("");
    },
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Mark read on open
  useEffect(() => {
    if ((conversation.unreadCount ?? 0) > 0) {
      markRead.mutate({ conversationId: conversation.id });
      // Optimistic refresh of the list to clear the badge
      void utils.smsConversations.list.invalidate();
      void utils.smsConversations.unreadCount.invalidate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.data?.length]);

  const handleSend = async () => {
    if (!reply.trim()) return;
    try {
      const res = await send.mutateAsync({
        phone: conversation.customerPhone,
        message: reply.trim(),
        customerName: conversation.customerName || undefined,
      });
      if (res.success) toast.success("Sent");
      else toast.error("Failed to send");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    }
  };

  return (
    <div className="bg-card border border-border/30">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border/20">
        <button
          onClick={onBack}
          className="p-2 hover:bg-foreground/5 transition-colors"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="w-4 h-4 text-foreground/70" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-foreground tracking-[-0.01em] truncate">
            {conversation.customerName || formatPhone(conversation.customerPhone)}
          </h3>
          <p className="text-foreground/50 text-xs">{formatPhone(conversation.customerPhone)}</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="h-[420px] overflow-y-auto p-4 space-y-3 bg-foreground/[0.02]">
        {messages.isLoading && (
          <div className="text-foreground/40 text-sm text-center py-8">Loading…</div>
        )}
        {messages.data && messages.data.length === 0 && (
          <div className="text-foreground/40 text-sm text-center py-8">No messages yet</div>
        )}
        {(messages.data as MessageRow[] | undefined)?.map((m) => {
          const outbound = m.direction === "outbound";
          return (
            <div key={m.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] px-3 py-2 text-sm leading-relaxed ${
                  outbound
                    ? "bg-primary text-primary-foreground"
                    : "bg-foreground/10 text-foreground"
                }`}
              >
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div className={`mt-1 text-[10px] uppercase tracking-wider ${outbound ? "text-primary-foreground/60" : "text-foreground/40"}`}>
                  {formatRelativeTime(m.createdAt)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply box */}
      <div className="p-3 border-t border-border/20 bg-card">
        <div className="flex gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Type a reply…"
            rows={2}
            maxLength={1600}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSend();
              }
            }}
            className="flex-1 bg-foreground/5 border border-border/30 px-3 py-2 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none text-sm"
          />
          <button
            onClick={() => void handleSend()}
            disabled={send.isPending || !reply.trim()}
            className="bg-primary text-primary-foreground px-4 py-2 font-bold text-sm tracking-wide hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
            title="Send (⌘/Ctrl + Enter)"
          >
            <SendIcon className="w-4 h-4" />
            {send.isPending ? "…" : "SEND"}
          </button>
        </div>
        <p className="mt-1 text-foreground/30 text-[10px]">
          {reply.length}/1600 · ⌘/Ctrl+Enter to send
        </p>
      </div>
    </div>
  );
}

function ConversationsPanel() {
  const list = trpc.smsConversations.list.useQuery({ limit: 50 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = (list.data as ConversationRow[] | undefined)?.find((c) => c.id === selectedId) ?? null;

  if (selected) {
    return <ConversationThread conversation={selected as ConversationRow} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="bg-card border border-border/30 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-lg text-foreground tracking-[-0.01em] flex items-center gap-2">
          <Inbox className="w-5 h-5 text-foreground/70" /> CONVERSATIONS
        </h3>
        <button
          onClick={() => void list.refetch()}
          className="text-foreground/50 text-xs hover:text-foreground/80 transition-colors"
        >
          {list.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {list.isLoading && (
        <div className="text-foreground/40 text-sm text-center py-8">Loading conversations…</div>
      )}
      {list.data && list.data.length === 0 && (
        <div className="text-foreground/40 text-sm text-center py-8">
          No conversations yet. New customer texts to <strong>{BUSINESS.phone.dashed}</strong> will show here.
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <div className="divide-y divide-border/20">
          {(list.data as ConversationRow[]).map((c) => {
            const unread = (c.unreadCount ?? 0) > 0;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left py-3 hover:bg-foreground/[0.04] transition-colors flex items-start gap-3 ${unread ? "" : ""}`}
              >
                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${unread ? "bg-primary" : "bg-transparent"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate ${unread ? "text-foreground font-bold" : "text-foreground/85"}`}>
                      {c.customerName || formatPhone(c.customerPhone)}
                    </p>
                    <span className="text-foreground/40 text-[11px] flex-shrink-0">{formatRelativeTime(c.lastMessageAt)}</span>
                  </div>
                  <p className={`text-sm truncate ${unread ? "text-foreground/80" : "text-foreground/50"}`}>
                    {c.lastMessage || <span className="italic">No messages</span>}
                  </p>
                  <p className="text-foreground/40 text-[11px] mt-0.5">{formatPhone(c.customerPhone)}</p>
                </div>
                {unread && (
                  <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
                    {c.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SmsSection() {
  const { data: smsStatus } = trpc.sms.status.useQuery();
  const sendTest = trpc.sms.sendTest.useMutation();
  const sendManual = trpc.sms.sendManual.useMutation();
  const [testPhone, setTestPhone] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualMsg, setManualMsg] = useState("");
  const [lastResult, setLastResult] = useState<{ success: boolean; sid?: string; error?: string } | null>(null);

  const handleSendTest = async () => {
    if (!testPhone) return;
    try {
      const res = await sendTest.mutateAsync({ phone: testPhone });
      setLastResult(res);
      if (res.success) toast.success("Test SMS sent successfully!");
      else toast.error(res.error || "Failed to send test SMS");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  };

  const handleSendManual = async () => {
    if (!manualPhone || !manualMsg) return;
    try {
      const res = await sendManual.mutateAsync({ phone: manualPhone, message: manualMsg });
      setLastResult(res);
      if (res.success) {
        toast.success("SMS sent!");
        setManualMsg("");
      } else {
        toast.error(res.error || "Failed to send");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="SMS"
        subtitle="Customer conversations · gateway status · ad-hoc send. Primary: shop F25e at 216-862-0005. Fallback: Twilio."
        icon={<MessageSquare className="w-5 h-5" />}
      />

      {/* Wave-105: Conversations panel — list + thread + reply */}
      <ConversationsPanel />

      {/* Wave-108: dual-gateway status card */}
      <GatewayStatusCard />

      {/* Auto-send reference */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-lg text-foreground tracking-[-0.01em] mb-4">AUTO-SEND TRIGGERS</h3>
        <div className="bg-foreground/5 p-4 border border-border/20">
          <p className="text-foreground/60 text-sm leading-relaxed">
            <strong className="text-foreground/80">Through 216-862-0005 (shop gateway):</strong><br />
            • Booking confirmations (when customer books online)<br />
            • Drop-off recaps (when car checked in)<br />
            • Callback confirmations (during business hours)<br />
            • Nick AI's address text after a phone call<br />
            • Lead confirmations + financing follow-ups<br />
            • Manager-on-duty alerts on every new booking/lead/emergency<br /><br />
            <strong className="text-foreground/80">Through Twilio (fallback / bulk):</strong><br />
            • Marketing campaigns + winback drips<br />
            • Review request batches<br />
            • Cron-based bulk outreach (declined-work recovery, retention)<br />
            • Anything that fails through the shop gateway (auto-fallback + Telegram alert)
          </p>
        </div>
      </div>

      {/* Send Test SMS */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-lg text-foreground tracking-[-0.01em] mb-4">SEND TEST SMS</h3>
        <p className="text-foreground/50 text-sm mb-4">Send a test message to verify Twilio is working correctly.</p>
        <div className="flex gap-3">
          <input
            type="tel"
            placeholder={`Phone number (e.g. ${BUSINESS.phone.dashed})`}
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            className="flex-1 bg-foreground/5 border border-border/30 px-4 py-2.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
          />
          <button
            onClick={handleSendTest}
            disabled={sendTest.isPending || !testPhone}
            className="bg-primary text-primary-foreground px-6 py-2.5 font-bold text-sm tracking-wide hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {sendTest.isPending ? "SENDING..." : "SEND TEST"}
          </button>
        </div>
      </div>

      {/* Send Manual SMS */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-lg text-foreground tracking-[-0.01em] mb-4">SEND MANUAL SMS</h3>
        <p className="text-foreground/50 text-sm mb-4">Send a custom message to any phone number.</p>
        <div className="space-y-3">
          <input
            type="tel"
            placeholder="Phone number"
            value={manualPhone}
            onChange={(e) => setManualPhone(e.target.value)}
            className="w-full bg-foreground/5 border border-border/30 px-4 py-2.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
          />
          <textarea
            placeholder="Type your message..."
            value={manualMsg}
            onChange={(e) => setManualMsg(e.target.value)}
            rows={4}
            maxLength={1600}
            className="w-full bg-foreground/5 border border-border/30 px-4 py-2.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-foreground/30 text-xs">{manualMsg.length}/1600</span>
            <button
              onClick={handleSendManual}
              disabled={sendManual.isPending || !manualPhone || !manualMsg}
              className="bg-primary text-primary-foreground px-6 py-2.5 font-bold text-sm tracking-wide hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {sendManual.isPending ? "SENDING..." : "SEND MESSAGE"}
            </button>
          </div>
        </div>
      </div>

      {/* Last Result */}
      {lastResult && (
        <div className={`p-4 border ${lastResult.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
          <p className={`text-[13px] ${lastResult.success ? "text-emerald-400" : "text-red-400"}`}>
            {lastResult.success ? `Sent successfully (SID: ${lastResult.sid})` : `Failed: ${lastResult.error}`}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── MAIN ADMIN COMPONENT ───────────────────────────────

