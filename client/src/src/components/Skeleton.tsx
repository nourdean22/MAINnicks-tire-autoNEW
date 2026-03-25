import type { CSSProperties } from "react";

const pulseKeyframes = `
@keyframes skeletonPulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;

const baseStyle: CSSProperties = {
  background: "linear-gradient(90deg, #1A1A1A 25%, #222222 50%, #1A1A1A 75%)",
  backgroundSize: "200% 100%",
  animation: "skeletonPulse 1.5s ease-in-out infinite",
};

// Inject keyframes once
let injected = false;
if (typeof document !== "undefined" && !injected) {
  const style = document.createElement("style");
  style.textContent = pulseKeyframes;
  document.head.appendChild(style);
  injected = true;
}

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

export default function Skeleton({ className = "", width, height }: SkeletonProps) {
  return (
    <div
      className={`rounded ${className}`}
      style={{ ...baseStyle, width, height }}
    />
  );
}

interface VariantProps {
  className?: string;
}

export function SkeletonCard({ className = "" }: VariantProps) {
  return (
    <div
      className={`rounded-lg ${className}`}
      style={{ ...baseStyle, height: "200px", width: "100%" }}
    />
  );
}

interface SkeletonTextProps extends VariantProps {
  width?: string;
}

export function SkeletonText({ className = "", width = "100%" }: SkeletonTextProps) {
  return (
    <div
      className={`rounded ${className}`}
      style={{ ...baseStyle, height: "16px", width }}
    />
  );
}

export function SkeletonAvatar({ className = "" }: VariantProps) {
  return (
    <div
      className={`${className}`}
      style={{
        ...baseStyle,
        width: "40px",
        height: "40px",
        borderRadius: "50%",
      }}
    />
  );
}

export function SkeletonImage({ className = "" }: VariantProps) {
  return (
    <div
      className={`rounded-lg ${className}`}
      style={{ ...baseStyle, width: "100%", aspectRatio: "16 / 9" }}
    />
  );
}

export function SkeletonStatNumber({ className = "" }: VariantProps) {
  return (
    <div
      className={`rounded ${className}`}
      style={{ ...baseStyle, width: "80px", height: "56px" }}
    />
  );
}
