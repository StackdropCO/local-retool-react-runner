import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "./utils"

interface TypographyProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean
}

const H1 = React.forwardRef<HTMLHeadingElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "h1"
    return (
      <Comp
        ref={ref}
        className={cn(
          "scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl",
          className
        )}
        {...props}
      />
    )
  }
)
H1.displayName = "H1"

const H2 = React.forwardRef<HTMLHeadingElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "h2"
    return (
      <Comp
        ref={ref}
        className={cn(
          "scroll-m-20 border-b pb-density-sm text-3xl font-semibold tracking-tight first:mt-0",
          className
        )}
        {...props}
      />
    )
  }
)
H2.displayName = "H2"

const H3 = React.forwardRef<HTMLHeadingElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "h3"
    return (
      <Comp
        ref={ref}
        className={cn(
          "scroll-m-20 text-2xl font-semibold tracking-tight",
          className
        )}
        {...props}
      />
    )
  }
)
H3.displayName = "H3"

const H4 = React.forwardRef<HTMLHeadingElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "h4"
    return (
      <Comp
        ref={ref}
        className={cn(
          "scroll-m-20 text-xl font-semibold tracking-tight",
          className
        )}
        {...props}
      />
    )
  }
)
H4.displayName = "H4"

const P = React.forwardRef<HTMLParagraphElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "p"
    return (
      <Comp
        ref={ref}
        className={cn(
          "leading-7 [&:not(:first-child)]:mt-density-lg",
          className
        )}
        {...props}
      />
    )
  }
)
P.displayName = "P"

const Blockquote = React.forwardRef<HTMLElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "blockquote"
    return (
      <Comp
        ref={ref}
        className={cn(
          "mt-density-lg border-l-2 pl-density-lg italic",
          className
        )}
        {...props}
      />
    )
  }
)
Blockquote.displayName = "Blockquote"

const InlineCode = React.forwardRef<HTMLElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "code"
    return (
      <Comp
        ref={ref}
        className={cn(
          "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
          className
        )}
        {...props}
      />
    )
  }
)
InlineCode.displayName = "InlineCode"

const Lead = React.forwardRef<HTMLParagraphElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "p"
    return (
      <Comp
        ref={ref}
        className={cn("text-xl text-muted-foreground", className)}
        {...props}
      />
    )
  }
)
Lead.displayName = "Lead"

const Large = React.forwardRef<HTMLDivElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "div"
    return (
      <Comp
        ref={ref}
        className={cn("text-lg font-semibold", className)}
        {...props}
      />
    )
  }
)
Large.displayName = "Large"

const Small = React.forwardRef<HTMLElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "small"
    return (
      <Comp
        ref={ref}
        className={cn("text-sm font-medium leading-none", className)}
        {...props}
      />
    )
  }
)
Small.displayName = "Small"

const Muted = React.forwardRef<HTMLParagraphElement, TypographyProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "p"
    return (
      <Comp
        ref={ref}
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
      />
    )
  }
)
Muted.displayName = "Muted"

export { H1, H2, H3, H4, P, Blockquote, InlineCode, Lead, Large, Small, Muted }