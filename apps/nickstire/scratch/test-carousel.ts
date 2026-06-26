import { renderCarouselBrief } from "../server/services/carouselStudio/carouselRender";
import { CarouselBrief } from "../client/src/lib/igCarouselStudio";

async function run() {
  const brief: CarouselBrief = {
    id: "test-carousel-" + Date.now(),
    title: "Test Carousel",
    topic: "Tire Maintenance",
    approved: true,
    scheduledFor: new Date().toISOString(),
    slides: [
      {
        slideNumber: 1,
        role: "pattern_interrupt",
        body: "You're ruining your tires without knowing it.",
        kicker: "TIRE TRUTHS",
        visual: "hero"
      },
      {
        slideNumber: 2,
        role: "context_escalation",
        body: "Underinflation causes the edges to wear out twice as fast.",
        kicker: "THE PROBLEM",
        visual: "tread"
      },
      {
        slideNumber: 5,
        role: "saveable_recap",
        body: "Check your pressure monthly. Save hundreds.",
        kicker: "THE FIX",
        visual: "tread"
      }
    ]
  };

  try {
    const urls = await renderCarouselBrief(brief);
    console.log("Carousel URLs:", urls);
  } catch (err) {
    console.error("Error rendering carousel:", err);
  }
}

run();
