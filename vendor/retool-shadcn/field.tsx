import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "./utils"

interface FieldContextValue {
  id: string
  descriptionId: string
  errorId: string
  isInvalid: boolean
  isRequired: boolean
}

const FieldContext = React.createContext<FieldContextValue | null>(null)

function useField(): FieldContextValue | null {
  return React.useContext(FieldContext)
}

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical"
  /** When true, FieldControl applies aria-invalid="true" to its child. */
  invalid?: boolean
  /** When true, FieldControl applies aria-required="true" to its child. */
  required?: boolean
}

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  (
    { className, orientation = "vertical", invalid = false, required = false, ...props },
    ref
  ) => {
    const id = React.useId()
    const value = React.useMemo<FieldContextValue>(
      () => ({
        id,
        descriptionId: `${id}-description`,
        errorId: `${id}-error`,
        isInvalid: invalid,
        isRequired: required,
      }),
      [id, invalid, required]
    )

    return (
      <FieldContext.Provider value={value}>
        <div
          ref={ref}
          role="group"
          data-orientation={orientation}
          className={cn(
            "flex gap-density-sm",
            orientation === "vertical" ? "flex-col" : "flex-row items-center",
            className
          )}
          {...props}
        />
      </FieldContext.Provider>
    )
  }
)
Field.displayName = "Field"

const FieldGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="group"
    className={cn("flex flex-col gap-density-lg", className)}
    {...props}
  />
))
FieldGroup.displayName = "FieldGroup"

interface FieldLabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  asChild?: boolean
}

const FieldLabel = React.forwardRef<HTMLLabelElement, FieldLabelProps>(
  ({ className, asChild, htmlFor, ...props }, ref) => {
    const Comp = asChild ? Slot : "label"
    const ctx = useField()
    return (
      <Comp
        ref={ref}
        htmlFor={htmlFor ?? ctx?.id}
        className={cn(
          "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          className
        )}
        {...props}
      />
    )
  }
)
FieldLabel.displayName = "FieldLabel"

const FieldLegend = React.forwardRef<
  HTMLLegendElement,
  React.HTMLAttributes<HTMLLegendElement>
>(({ className, ...props }, ref) => (
  <legend
    ref={ref}
    className={cn("text-sm font-medium", className)}
    {...props}
  />
))
FieldLegend.displayName = "FieldLegend"

const FieldSet = React.forwardRef<
  HTMLFieldSetElement,
  React.HTMLAttributes<HTMLFieldSetElement>
>(({ className, ...props }, ref) => (
  <fieldset
    ref={ref}
    className={cn("flex flex-col gap-density-md", className)}
    {...props}
  />
))
FieldSet.displayName = "FieldSet"

/**
 * Wraps a single form control (input, textarea, select, etc.) and injects the
 * Field's id and ARIA attributes via Radix Slot. The Field owns the control's
 * id and label association — do not set an explicit id on the wrapped child,
 * or the FieldLabel's htmlFor will no longer point at the rendered control.
 */
const FieldControl = React.forwardRef<
  HTMLElement,
  Omit<React.HTMLAttributes<HTMLElement>, "id">
>(({ ...props }, ref) => {
  const ctx = useField()
  const describedBy = ctx
    ? ctx.isInvalid
      ? `${ctx.descriptionId} ${ctx.errorId}`
      : ctx.descriptionId
    : undefined
  return (
    <Slot
      ref={ref}
      id={ctx?.id}
      aria-describedby={describedBy}
      aria-invalid={ctx?.isInvalid || undefined}
      aria-required={ctx?.isRequired || undefined}
      {...props}
    />
  )
})
FieldControl.displayName = "FieldControl"

/**
 * The Field owns this element's id (it is referenced by the FieldControl's
 * aria-describedby), so id is not part of the prop surface.
 */
const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  Omit<React.HTMLAttributes<HTMLParagraphElement>, "id">
>(({ className, ...props }, ref) => {
  const ctx = useField()
  return (
    <p
      ref={ref}
      id={ctx?.descriptionId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
})
FieldDescription.displayName = "FieldDescription"

/**
 * The Field owns this element's id (it is referenced by the FieldControl's
 * aria-describedby when invalid is set), so id is not part of the prop surface.
 *
 * The role="alert" live region stays mounted whether or not there is an error
 * message. Assistive tech observes mutations on existing live regions; an
 * element that appears already populated (because it was just mounted) is
 * silently ignored, so unmounting between errors would defeat announcement on
 * the first error. React skips rendering null/undefined/false children, so
 * the element is visually empty when there is no error.
 */
const FieldError = React.forwardRef<
  HTMLParagraphElement,
  Omit<React.HTMLAttributes<HTMLParagraphElement>, "id">
>(({ className, children, ...props }, ref) => {
  const ctx = useField()
  return (
    <p
      ref={ref}
      id={ctx?.errorId}
      role="alert"
      className={cn("text-sm font-medium text-destructive", className)}
      {...props}
    >
      {children}
    </p>
  )
})
FieldError.displayName = "FieldError"

const FieldSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="separator"
    className={cn("h-px w-full bg-border", className)}
    {...props}
  />
))
FieldSeparator.displayName = "FieldSeparator"

export {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldSeparator,
}