/**
 * Instagram Feed Section
 * Displays recent posts from @nicks_tire_euclid on the homepage.
 * Falls back gracefully if the API is unavailable.
 */

import { useRef } from "react";
import { Instagram, Heart, MessageCircle, Play } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";
import FadeIn from "@/components/FadeIn";

interface InstagramPost {
  id: string;
  caption?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  type: "IMAGE" | "VIDEO" | "CAROUSEL";
  likes: number;
  comments: number;
  posted: string;
  link: string;
function truncateCaption(caption: string, maxLen: number = 120): string {
  if (!caption) return "";
  if (caption.length <= maxLen) return caption;
  return caption.slice(0, maxLen).trim() + "...";
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

}
