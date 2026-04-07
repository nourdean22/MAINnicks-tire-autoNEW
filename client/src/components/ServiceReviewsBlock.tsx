/**
 * ServiceReviewsBlock — Dynamic social proof showing REAL recent reviews
 * that mention the current service. Falls back to existing static testimonials
 * when no real reviews match.
 */

import { Star } from "lucide-react";
import { trpc } from "@/lib/trpc";
import FadeIn from "@/components/FadeIn";

interface ServiceReviewsBlockProps {
  /** Service slug e.g. "brakes", "tires", "oil-change" */
  service: string;
  /** Service display name e.g. "Brake Service" */
  serviceTitle: string;
}

export default function ServiceReviewsBlock({ service, serviceTitle }: ServiceReviewsBlockProps) {
  const { data, isLoading } = trpc.serviceReviews.forService.useQuery(
    { service },
    {
      staleTime: 10 * 60 * 1000, // Cache 10 min
      retry: 1,
    }
  );

  // Don't render if loading or no reviews
  if (isLoading) return null;
  if (!data?.reviews?.length) return null;

  return (
    <FadeIn>
      <div className="mt-16">
        <span className="font-mono text-nick-blue-light text-sm tracking-wide">Real Reviews</span>
        <h3 className="font-semibold font-bold text-2xl lg:text-3xl text-foreground mt-2 tracking-tight">
          WHAT CLEVELAND DRIVERS SAY ABOUT OUR{" "}
          <span className="text-primary">{serviceTitle.toUpperCase()}</span>
        </h3>
        <p className="mt-3 text-foreground/50 text-sm">
          Recent verified reviews from customers who got this exact service.
        </p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.reviews.map((review, i) => (
            <FadeIn key={i} delay={i * 0.1}>
              <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-5 h-full flex flex-col">
                {/* Stars */}
                <div className="flex gap-0.5 mb-3">
                  {Array.from({ length: review.rating }, (_, j) => (
                    <Star
                      key={j}
                      size={14}
                      fill="#FDB913"
                      color="#FDB913"
                    />
                  ))}
                </div>

                {/* Review text */}
                <p className="text-foreground/80 text-sm leading-relaxed flex-1 italic">
                  &ldquo;{review.text.length > 200 ? `${review.text.slice(0, 200)}...` : review.text}&rdquo;
                </p>

                {/* Attribution */}
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-foreground/50 text-xs font-medium">
                    &mdash; {review.name}
                  </span>
                  {review.date && (
                    <span className="text-foreground/30 text-xs">
                      {review.date}
                    </span>
                  )}
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </FadeIn>
  );
}
