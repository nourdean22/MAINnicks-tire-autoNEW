import { useState, useRef, useEffect, type ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface OptimizedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  /** Blur placeholder — a tiny base64-encoded image or CSS color */
  placeholderColor?: string;
  /** Whether to lazy load (default true) */
  lazy?: boolean;
}

/**
 * Optimized image component with:
 * - Native lazy loading (loading="lazy")
 * - Fade-in on load
 * - Blur placeholder background while loading
 * - Proper width/height to prevent CLS
 */
export default function OptimizedImage({
  src,
  alt,
  className,
  placeholderColor = "#1a1a1a",
  lazy = true,
  ...props
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // If image is already cached by the browser, mark as loaded immediately
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []);

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt || ""}
      loading={lazy ? "lazy" : "eager"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      className={cn(
        "transition-opacity duration-300",
        loaded ? "opacity-100" : "opacity-0",
        className
      )}
      style={{
        backgroundColor: loaded ? undefined : placeholderColor,
        ...props.style,
      }}
      {...props}
    />
  );
}
