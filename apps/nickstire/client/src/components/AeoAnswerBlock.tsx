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
export default function AeoAnswerBlock({
  answer,
  eyebrow = "The short answer",
}: {
  answer: string;
  eyebrow?: string;
}) {
  return (
    <section className="bg-card/20 border-y border-border/20 py-8">
      <div className="container max-w-3xl">
        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-nick-blue-light mb-2">
          {eyebrow}
        </p>
        <p className="text-foreground/90 text-lg leading-relaxed body-pretty">{answer}</p>
      </div>
    </section>
  );
}
