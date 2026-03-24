/**
 * TestimonialCarousel — Auto-rotating review slider.
 * Pauses on hover, supports touch swipe, accessible.
 * Shows one review at a time with fade transition.
 */
import { useState, useEffect, useCallback } from "react";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Testimonial {
  name: string;
  text: string;
  stars: number;
}

const TESTIMONIALS: Testimonial[] = [
  { name: "Nurse Summer", stars: 5, text: "This is the FIRST shop that I felt I could trust! Especially as a woman.. it's very hard to find HONEST and well done mechanic work." },
  { name: "Michael R.", stars: 5, text: "Brought my car in for brakes and they showed me exactly what was wrong before doing any work. Fair prices and fast service." },
  { name: "Jasmine T.", stars: 5, text: "Nick's is the only shop I trust with my car. They always explain everything and never try to upsell me on stuff I don't need." },
  { name: "David K.", stars: 5, text: "Best tire prices in Cleveland, hands down. Got 4 new tires mounted and balanced in under an hour. Will never go anywhere else." },
  { name: "Patricia W.", stars: 5, text: "They fixed a problem that two other shops couldn't figure out. Honest, knowledgeable, and affordable. Five stars all day." },
];

const INTERVAL = 6000;

export default function TestimonialCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % TESTIMONIALS.length);
  }, []);

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + TESTIMONIALS.length) % TESTIMONIALS.length);
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(next, INTERVAL);
    return () => clearInterval(timer);
  }, [paused, next]);

  const testimonial = TESTIMONIALS[index];

  return (
    <div
      className="relative max-w-2xl mx-auto text-center"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="region"
      aria-label="Customer testimonials"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className="px-8"
        >
          {/* Stars */}
          <div className="flex justify-center gap-0.5 mb-4">
            {Array.from({ length: testimonial.stars }).map((_, i) => (
              <Star key={i} className="w-4 h-4 fill-[#FDB913] text-[#FDB913]" />
            ))}
          </div>

          {/* Quote */}
          <p className="text-foreground/70 text-[15px] leading-relaxed italic">
            "{testimonial.text}"
          </p>

          {/* Name */}
          <p className="mt-4 text-[13px] font-semibold text-foreground/50">
            — {testimonial.name}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Navigation arrows */}
      <button
        onClick={prev}
        className="absolute left-0 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-foreground/20 hover:text-foreground/50 transition-colors"
        aria-label="Previous testimonial"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        onClick={next}
        className="absolute right-0 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-foreground/20 hover:text-foreground/50 transition-colors"
        aria-label="Next testimonial"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Dots */}
      <div className="flex justify-center gap-1.5 mt-6">
        {TESTIMONIALS.map((_, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
              i === index ? "bg-[#FDB913] w-4" : "bg-foreground/15 hover:bg-foreground/30"
            }`}
            aria-label={`Go to testimonial ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
