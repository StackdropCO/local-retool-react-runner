import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "./utils"

const Spinner = React.forwardRef<
  SVGSVGElement,
  React.ComponentProps<typeof Loader2Icon>
>(({ className, ...props }, ref) => (
  <Loader2Icon
    ref={ref}
    role="status"
    aria-label="Loading"
    className={cn("size-4 animate-spin", className)}
    {...props}
  />
))
Spinner.displayName = "Spinner"

export { Spinner }