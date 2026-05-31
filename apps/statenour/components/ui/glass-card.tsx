// FRESHNESS_EXEMPT — structural primitive (no data, just a wrapper)
import Link from "next/link";
import { cn } from "@/lib/utils";

interface GlassCardBaseProps {
  children: React.ReactNode;
  className?: string;
  active?: boolean;
  critical?: boolean;
  success?: boolean;
}

interface GlassCardDivProps extends GlassCardBaseProps {
  /** v10.0.529.61 · polymorphic as prop · 'div' (default) | 'a' | 'button'.
   *  Renders a <div> if undefined or 'div'. Use 'a' with href to render a
   *  Next.js Link (preserves keyboard ENTER, middle-click, role=link
   *  semantics). Use 'button' if you need a clickable card with full
   *  button semantics (still emits onClick · still focus-visible). */
  as?: "div";
  href?: never;
  target?: never;
  onClick?: () => void;
  ariaLabel?: never;
  type?: never;
}

interface GlassCardLinkProps extends GlassCardBaseProps {
  as: "a";
  href: string;
  target?: "_blank" | "_self";
  onClick?: () => void;
  ariaLabel?: string;
  type?: never;
}

interface GlassCardButtonProps extends GlassCardBaseProps {
  as: "button";
  href?: never;
  target?: never;
  onClick: () => void;
  ariaLabel?: string;
  type?: "button" | "submit";
}

type GlassCardProps =
  | GlassCardDivProps
  | GlassCardLinkProps
  | GlassCardButtonProps;

export function GlassCard(props: GlassCardProps) {
  const { children, className, active, critical, success } = props;
  const classes = cn(
    "neural-glass",
    active && "neural-glass-active",
    critical && "neural-glass-critical critical-glow",
    success && "border-green-500/50 shadow-[0_0_20px_rgba(34,197,94,0.15)]",
    (props.as === "a" || props.as === "button" || props.onClick) &&
      "cursor-pointer card-hover-lift glow-on-hover touch-feedback",
    className,
  );

  if (props.as === "a") {
    return (
      <Link
        href={props.href}
        target={props.target}
        onClick={props.onClick}
        aria-label={props.ariaLabel}
        className={classes}
      >
        {children}
      </Link>
    );
  }

  if (props.as === "button") {
    return (
      <button
        type={props.type ?? "button"}
        onClick={props.onClick}
        aria-label={props.ariaLabel}
        className={classes}
      >
        {children}
      </button>
    );
  }

  // Default div branch. A bare <div onClick> is a keyboard- and
  // screen-reader-invisible trap, so when an onClick is supplied we
  // promote the div to a real button role: focusable (tabIndex 0) and
  // operable via Enter/Space (Space gets preventDefault to stop the
  // page from scrolling). Without an onClick it stays a plain,
  // non-interactive container — no spurious role/tabindex.
  if (props.onClick) {
    const onClick = props.onClick;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            if (e.key === " ") e.preventDefault();
            onClick();
          }
        }}
        className={classes}
      >
        {children}
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}
