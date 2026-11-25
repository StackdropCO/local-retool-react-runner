import * as React from "react"

import { cn } from "./utils"

const Empty = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="empty"
    className={cn(
      "flex min-h-[400px] flex-col items-center justify-center gap-density-md rounded-lg border border-dashed p-density-xl text-center",
      className
    )}
    {...props}
  />
))
Empty.displayName = "Empty"

const EmptyHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col items-center gap-density-sm", className)}
    {...props}
  />
))
EmptyHeader.displayName = "EmptyHeader"

interface EmptyMediaProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "icon"
}

const EmptyMedia = React.forwardRef<HTMLDivElement, EmptyMediaProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      data-variant={variant}
      className={cn(
        "flex shrink-0 items-center justify-center",
        variant === "icon" &&
          "h-12 w-12 rounded-full bg-muted text-muted-foreground [&_svg]:size-6",
        className
      )}
      {...props}
    />
  )
)
EmptyMedia.displayName = "EmptyMedia"

const EmptyTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
))
EmptyTitle.displayName = "EmptyTitle"

const EmptyDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("max-w-sm text-sm text-muted-foreground", className)}
    {...props}
  />
))
EmptyDescription.displayName = "EmptyDescription"

const EmptyContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col items-center gap-density-md", className)}
    {...props}
  />
))
EmptyContent.displayName = "EmptyContent"

export {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
}