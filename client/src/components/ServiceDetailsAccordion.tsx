import { useState } from "react";
import { ChevronDown } from "lucide-react";
import FadeIn from "./FadeIn";

interface AccordionItem {
  title: string;
  items?: string[];
  content?: string;
}

interface ServiceDetailsAccordionProps {
  sections: AccordionItem[];
  className?: string;
}

export default function ServiceDetailsAccordion({
  sections,
  className = "",
}: ServiceDetailsAccordionProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  return (
    <div className={`space-y-3 ${className}`}>
      {sections.map((section, idx) => {
        const isOpen = expandedIndex === idx;
        return (
          <FadeIn key={idx} delay={idx * 0.1}>
            <div className={`faq-item${isOpen ? " open" : ""}`}>
              <button
                onClick={() => setExpandedIndex(isOpen ? null : idx)}
                className="w-full text-left"
              >
                <div
                  className={`flex items-center justify-between w-full px-5 py-4 rounded-lg border transition-all ${
                    isOpen
                      ? "border-primary bg-primary/5"
                      : "border-border/50 bg-background/40 hover:border-primary/30"
                  }`}
                >
                  <h3 className="font-semibold text-[15px] text-foreground">
                    {section.title}
                  </h3>
                  <ChevronDown
                    className="faq-toggle w-5 h-5 text-foreground/60"
                  />
                </div>
              </button>

              {/* Smooth CSS max-height transition — no conditional rendering snap */}
              <div className="faq-answer bg-background/20 border border-border/30 rounded-lg">
                {section.items ? (
                  <ul className="space-y-2.5">
                    {section.items.map((item, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 text-[14px] text-foreground/70"
                      >
                        <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-nick-teal mt-2" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : section.content ? (
                  <p className="text-[14px] text-foreground/70 leading-relaxed">
                    {section.content}
                  </p>
                ) : null}
              </div>
            </div>
          </FadeIn>
        );
      })}
    </div>
  );
}
