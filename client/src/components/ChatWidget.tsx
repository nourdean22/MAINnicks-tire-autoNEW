/**
 * AI Vehicle Diagnosis Chat Widget
 * Floating chat bubble in the bottom-right corner.
 * Powered by Gemini AI via the server.
 */

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Wrench, Phone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";

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
      // After 3 exchanges, suggest capturing contact info
      if (messages.length >= 4 && !leadSubmitted && !showLeadCapture) {
        setShowLeadCapture(true);
      }
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
      {/* Chat bubble */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-20 lg:bottom-6 right-4 z-[90] w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
          >
            <MessageCircle className="w-6 h-6" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat window */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-20 lg:bottom-6 right-4 z-[90] w-[360px] max-w-[calc(100vw-2rem)] bg-nick-dark border border-border/50 shadow-2xl flex flex-col"
            style={{ height: "480px" }}
          >
            {/* Header */}
            <div className="bg-primary px-4 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-primary-foreground" />
                <div>
                  <span className="font-heading font-bold text-primary-foreground text-sm tracking-wider block">
                    NICK'S AUTO ASSISTANT
                  </span>
                  <span className="text-primary-foreground/70 text-xs font-mono">
                    Describe your car problem
                  </span>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-primary-foreground/70 hover:text-primary-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center py-8">
                  <Wrench className="w-10 h-10 text-primary/30 mx-auto mb-3" />
                  <p className="text-foreground/50 text-sm leading-relaxed">
                    Tell me what's going on with your car. I'll help figure out what might be wrong and recommend the right service.
                  </p>
                  <div className="mt-4 space-y-2">
                    {["Check engine light is on", "Brakes are squealing", "Car shakes at highway speed"].map(q => (
                      <button
                        key={q}
                        onClick={() => {
                          setInput("");
                          setMessages([{ role: "user", content: q }]);
                          sendMessage.mutate({ message: q });
                        }}
                        className="block w-full text-left text-xs font-mono text-foreground/40 hover:text-primary border border-border/30 px-3 py-2 hover:border-primary/50 transition-colors"
                      >
                        "{q}"
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] px-3 py-2 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-nick-charcoal text-foreground/90 border border-border/30"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {sendMessage.isPending && (
                <div className="flex justify-start">
                  <div className="bg-nick-charcoal border border-border/30 px-3 py-2 text-sm text-foreground/50">
                    <span className="inline-flex gap-1">
                      <span className="animate-pulse">●</span>
                      <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
                      <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
                    </span>
                  </div>
                </div>
              )}

              {/* Lead capture inline */}
              {showLeadCapture && !leadSubmitted && (
                <div className="bg-nick-charcoal border border-primary/30 p-3 space-y-2">
                  <p className="text-foreground/70 text-xs font-mono">
                    Want us to call you with a free assessment?
                  </p>
                  <input
                    type="text"
                    placeholder="Your name"
                    value={leadForm.name}
                    onChange={e => setLeadForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-nick-dark border border-border/50 text-foreground px-3 py-2 text-xs font-mono placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                  />
                  <input
                    type="tel"
                    placeholder="Phone number"
                    value={leadForm.phone}
                    onChange={e => setLeadForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full bg-nick-dark border border-border/50 text-foreground px-3 py-2 text-xs font-mono placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                  />
                  <button
                    onClick={handleLeadSubmit}
                    disabled={submitLead.isPending}
                    className="w-full bg-primary text-primary-foreground py-2 font-heading font-bold tracking-wider uppercase text-xs hover:bg-primary/90 transition-colors"
                  >
                    {submitLead.isPending ? "SENDING..." : "CALL ME"}
                  </button>
                </div>
              )}

              {leadSubmitted && (
                <div className="bg-nick-charcoal border border-green-500/30 p-3 text-center">
                  <p className="text-green-400 text-xs font-mono">
                    Got it. We'll call you shortly.
                  </p>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-border/30 p-3 flex gap-2 shrink-0">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                placeholder="Describe your problem..."
                className="flex-1 bg-nick-charcoal border border-border/50 text-foreground px-3 py-2 text-sm font-mono placeholder:text-foreground/30 focus:border-primary focus:outline-none"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sendMessage.isPending}
                className="bg-primary text-primary-foreground px-3 py-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            {/* Call CTA */}
            <div className="border-t border-border/20 px-3 py-2 flex items-center justify-center gap-2 text-foreground/30 text-xs shrink-0">
              <Phone className="w-3 h-3" />
              <span className="font-mono">Or call: (216) 862-0005</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
