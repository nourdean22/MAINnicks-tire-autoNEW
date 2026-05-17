/**
 * FaqWithSchema — accessible FAQ accordion that emits FAQPage JSON-LD.
 *
 * On Google: FAQPage rich-result eligibility is restricted (Aug 2023)
 * to government/healthcare authority sites. The schema is still useful
 * for AI search citation (Perplexity, ChatGPT, Google AI Overviews
 * frequently cite FAQ-marked content) and for general structured-data
 * health. We emit it with that caveat in mind.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface FaqItem {
  question: string;
  answer: string;
}

interface FaqWithSchemaProps {
  faqs: FaqItem[];
  /** H2 above the FAQ list */
  heading?: string;
  /** Optional intro paragraph above the list */
  intro?: string;
}

export default function FaqWithSchema({ faqs, heading = "Frequently Asked Questions", intro }: FaqWithSchemaProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };

  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28 border-t border-border/30">
      <div className="container max-w-3xl">
        <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold uppercase text-foreground tracking-tight leading-[0.95] headline-balance mb-6">
          {heading}
        </h2>
        {intro ? (
          <p className="text-foreground/65 text-base sm:text-lg leading-relaxed mb-10 body-pretty">
            {intro}
          </p>
        ) : null}
        <div className="space-y-3">
          {faqs.map((f, i) => {
            const isOpen = openIndex === i;
            return (
              <div
                key={i}
                className="rounded-[1rem] p-[2px] bg-white/[0.03] ring-1 ring-white/[0.06]"
              >
                <div className="bg-[#141414] rounded-[calc(1rem-2px)] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    className="group w-full flex items-center justify-between gap-4 p-5 sm:p-6 text-left transition-colors duration-300 hover:bg-white/[0.02]"
                    aria-expanded={isOpen}
                  >
                    <span className="font-semibold text-foreground text-base sm:text-lg leading-snug">
                      {f.question}
                    </span>
                    <ChevronDown
                      className={`flex-shrink-0 w-5 h-5 text-[#FDB913] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <div
                    className="overflow-hidden transition-[max-height] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                    style={{ maxHeight: isOpen ? "500px" : "0px" }}
                  >
                    <p className="px-5 sm:px-6 pb-5 sm:pb-6 text-foreground/70 leading-relaxed body-pretty">
                      {f.answer}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </section>
  );
}
