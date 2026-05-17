import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-all duration-300 ease-out outline-none placeholder:text-muted-foreground hover:border-primary/30 hover:shadow-[0_0_10px_rgba(253,185,19,0.05)] focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/50 focus-visible:shadow-[0_0_20px_rgba(253,185,19,0.15)] disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
