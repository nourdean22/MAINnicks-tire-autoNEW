/**
 * AeoAnswerBlock — a self-contained, declarative "short answer" rendered as
 * the first body content of a page so AI answer-engines (ChatGPT / Perplexity
 * / Gemini / Claude) and featured-snippet parsers lift a clean, machine-
 * extractable answer instead of guessing from marketing copy.
 *
 * Per the GEO research: AI engines extract a passage (~the first declarative
 * sentence under a heading), and a self-contained answer with specifics
 * (price + NAP) materially raises citation likelihood for a young, low-
 * authority domain. Plain server-rendered text — no hooks / interactivity —
 * so it survives prerender and is visible to non-JS crawlers (GPTBot,
 * ClaudeBot, PerplexityBot).
 */
import { Link } from "wouter";

export default function AeoAnswerBlock({
  answer,
  eyebrow = "The short answer",
  link,
}: {
  answer: string;
  eyebrow?: string;
  link?: { href: string; label: string };
}) {
  return (
    <section className="bg-card/20 border-y border-border/20 py-8">
      <div className="container max-w-3xl">
        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-nick-blue-light mb-2">
          {eyebrow}
        </p>
        <p className="text-foreground/90 text-lg leading-relaxed body-pretty">{answer}</p>
        {link && (
          <Link
            href={link.href}
            className="mt-3 inline-flex min-h-[44px] items-center font-semibold text-primary underline underline-offset-4"
          >
            {link.label}
          </Link>
        )}
      </div>
    </section>
  );
}
