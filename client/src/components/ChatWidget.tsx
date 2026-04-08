/**
 * Premium AI Vehicle Diagnosis Chat Widget
 * Floating chat bubble — glass morphism, refined typography.
 */

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Wrench, Phone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<number | undefined>();
  const [showLeadCapture, setShowLeadCapture] = useState(false);
  const [leadForm, setLeadForm] = useState({ name: "", phone: "" });
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sendMessage = trpc.chat.message.useMutation({
    onSuccess: (data) => {
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
      if (data.sessionId) setSessionId(data.sessionId);
      if (messages.length >= 4 && !leadSubmitted && !showLeadCapture) {
        setShowLeadCapture(true);
      }
    },
    onError: () => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, I'm having trouble right now. Please call us at (216) 862-0005 for immediate help."
      }]);
    },
  });

  const submitLead = trpc.lead.submit.useMutation({
    onSuccess: () => {
      setLeadSubmitted(true);
      setShowLeadCapture(false);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, showLeadCapture]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || sendMessage.isPending) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    sendMessage.mutate({ sessionId, message: text });
  };

  const handleLeadSubmit = () => {
    if (!leadForm.name.trim() || !leadForm.phone.trim()) return;
    const lastProblem = messages.filter(m => m.role === "user").pop()?.content || "";
    submitLead.mutate({
      name: leadForm.name.trim(),
      phone: leadForm.phone.trim(),
      problem: lastProblem,
      source: "chat",
    });
  };

  return (
    <>
      {/* ─── FLOATING BUBBLE ─── */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-20 lg:bottom-6 right-4 z-[90] w-13 h-13 bg-primary text-primary-foreground rounded-full shadow-lg shadow-primary/20 flex items-center justify-center hover:opacity-90 transition-opacity"
            aria-label="Chat with Nick's AI mechanic"
          >
            <MessageCircle className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ─── CHAT WINDOW ─── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed bottom-20 lg:bottom-6 right-4 z-[90] w-[360px] max-w-[calc(100vw-2rem)] bg-[oklch(0.08_0.004_260/0.97)] backdrop-blur-2xl border border-[oklch(0.17_0.004_260)] rounded-2xl shadow-2xl shadow-black/30 flex flex-col overflow-hidden"
            style={{ height: "480px" }}
          >
            {/* ─── HEADER ─── */}
            <div className="bg-[oklch(0.10_0.005_260)] border-b border-[oklch(0.17_0.004_260)] px-4 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Wrench className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <span className="font-semibold text-foreground text-[13px] tracking-[-0.01em] block">
                    Nick's AI Mechanic
                  </span>
                  <span className="text-foreground/40 text-[11px]">
                    What's going on with your car?
                  </span>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-foreground/30 hover:text-foreground/60 transition-colors p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ─── MESSAGES ─── */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center py-6 space-y-4">
                  {/* Greeting */}
                  <div>
                    <div className="w-12 h-12 rounded-full bg-foreground/[0.04] flex items-center justify-center mx-auto mb-3">
                      <Wrench className="w-5 h-5 text-foreground/15" />
                    </div>
                    <p className="text-foreground/70 text-[13px] font-medium">Hey — I'm Nick's AI mechanic.</p>
                    <p className="text-foreground/50 text-[12px] leading-relaxed max-w-[280px] mx-auto mt-1">
                      I can help with:
                    </p>
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        const prompt = "I need help diagnosing a car problem";
                        setInput(prompt);
                        setMessages([{ role: "user", content: prompt }]);
                        sendMessage.mutate({ message: prompt });
                      }}
                      className="w-full text-left text-[12px] text-foreground/60 hover:text-foreground border border-[oklch(0.17_0.004_260)] rounded-lg px-3 py-2.5 hover:border-foreground/15 hover:bg-foreground/[0.03] transition-all"
                    >
                      🔧 Diagnose a car problem
                    </button>
                    <button
                      onClick={() => {
                        const prompt = "I'd like a price estimate for";
                        setInput(prompt);
                        setMessages([{ role: "user", content: prompt }]);
                        sendMessage.mutate({ message: prompt });
                      }}
                      className="w-full text-left text-[12px] text-foreground/60 hover:text-foreground border border-[oklch(0.17_0.004_260)] rounded-lg px-3 py-2.5 hover:border-foreground/15 hover:bg-foreground/[0.03] transition-all"
                    >
                      💰 Get a price estimate
                    </button>
                    <button
                      onClick={() => {
                        const prompt = "I'd like to book an appointment";
                        setInput(prompt);
                        setMessages([{ role: "user", content: prompt }]);
                        sendMessage.mutate({ message: prompt });
                      }}
                      className="w-full text-left text-[12px] text-foreground/60 hover:text-foreground border border-[oklch(0.17_0.004_260)] rounded-lg px-3 py-2.5 hover:border-foreground/15 hover:bg-foreground/[0.03] transition-all"
                    >
                      📅 Book an appointment
                    </button>
                    <button
                      onClick={() => {
                        const inputEl = document.querySelector("[placeholder='What\\'s your car doing?']") as HTMLInputElement;
                        inputEl?.focus();
                      }}
                      className="w-full text-left text-[12px] text-foreground/60 hover:text-foreground border border-[oklch(0.17_0.004_260)] rounded-lg px-3 py-2.5 hover:border-foreground/15 hover:bg-foreground/[0.03] transition-all"
                    >
                      ❓ Answer a question
                    </button>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] px-3.5 py-2.5 text-[13px] leading-relaxed rounded-xl ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-foreground/[0.05] text-foreground/80 border border-[oklch(0.17_0.004_260)] rounded-bl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {sendMessage.isPending && (
                <div className="flex justify-start">
                  <div className="bg-foreground/[0.05] border border-[oklch(0.17_0.004_260)] rounded-xl rounded-bl-sm px-3.5 py-2.5 text-[13px] text-foreground/40">
                    <span className="inline-flex gap-1">
                      <span className="animate-pulse">●</span>
                      <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
                      <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
                    </span>
                  </div>
                </div>
              )}

              {/* Lead capture */}
              {showLeadCapture && !leadSubmitted && (
                <div className="bg-foreground/[0.03] border border-primary/15 rounded-xl p-3.5 space-y-2.5">
                  <p className="text-[11px] text-emerald-400/70 text-center mb-2">
                    We also offer lease-to-own starting at $10 down — ask us about it!
                  </p>
                  <p className="text-foreground/50 text-[12px]">
                    Want us to call you with a free assessment?
                  </p>
                  <input
                    type="text"
                    placeholder="Your name"
                    value={leadForm.name}
                    onChange={e => setLeadForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-foreground/[0.04] border border-[oklch(0.17_0.004_260)] rounded-lg text-foreground px-3 py-2 text-[12px] placeholder:text-foreground/25 focus:border-primary/30 focus:outline-none transition-all"
                  />
                  <input
                    type="tel"
                    placeholder="Phone number"
                    value={leadForm.phone}
                    onChange={e => setLeadForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full bg-foreground/[0.04] border border-[oklch(0.17_0.004_260)] rounded-lg text-foreground px-3 py-2 text-[12px] placeholder:text-foreground/25 focus:border-primary/30 focus:outline-none transition-all"
                  />
                  <button
                    onClick={handleLeadSubmit}
                    disabled={submitLead.isPending}
                    className="w-full bg-primary text-primary-foreground py-2 rounded-lg font-semibold text-[12px] hover:opacity-90 transition-opacity"
                  >
                    {submitLead.isPending ? "Sending..." : "Call Me"}
                  </button>
                </div>
              )}

              {leadSubmitted && (
                <div className="bg-foreground/[0.03] border border-nick-teal/20 rounded-xl p-3.5 text-center">
                  <p className="text-nick-teal text-[12px]">
                    Got it. We'll call you shortly.
                  </p>
                </div>
              )}
            </div>

            {/* ─── INPUT ─── */}
            <div className="border-t border-[oklch(0.17_0.004_260)] p-3 flex gap-2 shrink-0">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                placeholder="What's your car doing?"
                className="flex-1 bg-foreground/[0.04] border border-[oklch(0.17_0.004_260)] rounded-lg text-foreground px-3 py-2 text-[13px] placeholder:text-foreground/25 focus:border-foreground/15 focus:outline-none transition-all"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sendMessage.isPending}
                className="bg-primary text-primary-foreground w-9 h-9 rounded-lg flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            {/* ─── CALL CTA ─── */}
            <div className="border-t border-[oklch(0.12_0.004_260)] px-3 py-2 flex items-center justify-center gap-2 text-foreground/20 text-[11px] shrink-0">
              <Phone className="w-3 h-3" />
              <span>Or call: <a href={BUSINESS.phone.href} className="text-foreground/35 hover:text-foreground/50 transition-colors">{BUSINESS.phone.display}</a></span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
