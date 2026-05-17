import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-200 ease-out focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_0_8px_rgba(253,185,19,0.12)] [a]:hover:bg-primary/90 [a]:hover:shadow-[0_0_15px_rgba(253,185,19,0.25)]",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80 [a]:hover:shadow-[0_0_10px_rgba(255,255,255,0.05)]",
        destructive:
          "bg-destructive/10 text-destructive shadow-[0_0_8px_rgba(239,68,68,0.1)] focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20 [a]:hover:shadow-[0_0_15px_rgba(239,68,68,0.2)]",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:border-primary/40 [a]:hover:text-foreground [a]:hover:shadow-[0_0_10px_rgba(253,185,19,0.08)]",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline hover:text-primary/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
