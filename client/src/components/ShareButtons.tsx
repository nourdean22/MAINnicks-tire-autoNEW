/**
 * ShareButtons — SMS text + copy-link sharing for service pages.
 * Mobile-first: shows "Text to a friend" on mobile, "Copy link" on all.
 */
import { useState } from "react";
import { MessageCircle, Link2, Check } from "lucide-react";
import { BUSINESS } from "@shared/business";

interface ShareButtonsProps {
  title: string;
  /** The path, e.g. "/brakes" */
  path: string;
}

export default function ShareButtons({ title, path }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const fullUrl = `${window.location.origin}${path}`;
  const smsBody = `Check out ${title} at Nick's Tire & Auto — ${fullUrl}`;
  const smsHref = `sms:?body=${encodeURIComponent(smsBody)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = fullUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* SMS share — only useful on mobile but renders everywhere */}
      <a
        href={smsHref}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#1A1A1A] border border-[#2A2A2A] text-foreground/60 hover:text-foreground hover:border-[#3A3A3A] transition-colors duration-200"
        aria-label={`Text ${title} to a friend`}
      >
        <MessageCircle className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Text a Friend</span>
        <span className="sm:hidden">Text</span>
      </a>

      {/* Copy link */}
      <button
        onClick={copyLink}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#1A1A1A] border border-[#2A2A2A] text-foreground/60 hover:text-foreground hover:border-[#3A3A3A] transition-colors duration-200"
        aria-label="Copy link to clipboard"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-green-400" />
            <span>Copied!</span>
          </>
        ) : (
          <>
            <Link2 className="w-3.5 h-3.5" />
            <span>Copy Link</span>
          </>
        )}
      </button>
    </div>
  );
}
