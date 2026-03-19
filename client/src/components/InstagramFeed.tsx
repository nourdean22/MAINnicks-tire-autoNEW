/**
 * Instagram Feed Section
 * Displays recent posts from @nicks_tire_euclid on the homepage.
 * Falls back gracefully if the API is unavailable.
 */

import { useRef } from "react";
import { Instagram, Heart, MessageCircle, Play } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function truncateCaption(caption: string, maxLen: number = 120): string {
  if (!caption) return "";
  if (caption.length <= maxLen) return caption;
  return caption.slice(0, maxLen).trim() + "...";
}

function timeAgo(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  } catch {
    return "";
  }
}

export default function InstagramFeed() {
  const { data: posts, isLoading } = trpc.instagram.posts.useQuery(
    { limit: 6 },
    { staleTime: 30 * 60 * 1000, retry: 1 }
  );
  const { data: account } = trpc.instagram.account.useQuery(
    undefined,
    { staleTime: 30 * 60 * 1000, retry: 1 }
  );

  // Don't render the section if no posts available
  if (!isLoading && (!posts || posts.length === 0)) return null;

  return (
    <section className="section-darker py-20 lg:py-28">
      <div className="h-1.5 w-full bg-gradient-to-r from-nick-yellow via-nick-orange to-nick-teal" />
      <div className="container pt-16">
        <FadeIn>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <span className="font-mono text-nick-orange text-sm tracking-widest uppercase flex items-center gap-2">
                <Instagram className="w-4 h-4" />
                From The Shop Floor
              </span>
              <h2 className="font-heading font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
                FOLLOW <span className="text-gradient-yellow">ALONG</span>
              </h2>
              {account && (
                <p className="mt-2 text-foreground/50 text-sm font-mono">
                  @{account.username} · {account.followers.toLocaleString()} followers · {account.posts} posts
                </p>
              )}
            </div>
            <a
              href="https://www.instagram.com/nicks_tire_euclid/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 text-white px-5 py-2.5 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:opacity-90 transition-opacity"
            >
              <Instagram className="w-4 h-4" />
              FOLLOW US
            </a>
          </div>
        </FadeIn>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card-vibrant bg-card/80 rounded-lg animate-pulse overflow-hidden">
                  <div className="aspect-square bg-background/60" />
                  <div className="p-4 space-y-2">
                    <div className="h-3 bg-background/60 rounded w-3/4" />
                    <div className="h-3 bg-background/60 rounded w-1/2" />
                  </div>
                </div>
              ))
            : posts?.map((post, i) => (
                <FadeIn key={post.id} delay={i * 0.08}>
                  <a
                    href={post.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group card-vibrant bg-card/80 rounded-lg overflow-hidden block"
                  >
                    {/* Post image or video thumbnail */}
                    <div className="relative aspect-square bg-background/60 overflow-hidden">
                      {(post as any).mediaUrl || (post as any).thumbnailUrl ? (
                        <img
                          src={(post as any).thumbnailUrl || (post as any).mediaUrl}
                          alt={post.caption ? truncateCaption(post.caption, 80) : "Instagram post"}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Instagram className="w-10 h-10 text-nick-orange/30" />
                        </div>
                      )}

                      {/* Video play indicator */}
                      {post.type === "VIDEO" && (
                        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm p-1.5 rounded-full">
                          <Play className="w-4 h-4 text-white fill-white" />
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-nick-dark/80 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-6 gap-6">
                        <span className="flex items-center gap-1.5 text-white font-mono text-sm">
                          <Heart className="w-5 h-5 fill-nick-yellow text-nick-yellow" />
                          {post.likes}
                        </span>
                        <span className="flex items-center gap-1.5 text-white font-mono text-sm">
                          <MessageCircle className="w-5 h-5 fill-nick-teal text-nick-teal" />
                          {post.comments}
                        </span>
                      </div>
                    </div>

                    {/* Caption and meta */}
                    <div className="p-4">
                      {post.caption && (
                        <p className="text-foreground/70 text-sm leading-relaxed line-clamp-3">
                          {truncateCaption(post.caption)}
                        </p>
                      )}
                      <div className="mt-3 flex items-center justify-between text-foreground/40 text-xs font-mono">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1 text-nick-yellow/60">
                            <Heart className="w-3 h-3" />
                            {post.likes}
                          </span>
                          <span className="flex items-center gap-1 text-nick-teal/60">
                            <MessageCircle className="w-3 h-3" />
                            {post.comments}
                          </span>
                        </div>
                        <span>{timeAgo(post.posted)}</span>
                      </div>
                    </div>
                  </a>
                </FadeIn>
              ))}
        </div>
      </div>
    </section>
  );
}
