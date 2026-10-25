import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-sans text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-primary bg-primary text-primary-foreground hover:bg-primary/85",
        secondary: "border border-border bg-muted text-foreground hover:border-primary hover:bg-muted/70",
        ghost: "border border-transparent bg-transparent text-foreground hover:bg-foreground/10",
        destructive: "border border-destructive bg-destructive text-white hover:bg-destructive/85",
        outline: "border border-border bg-transparent text-foreground hover:border-primary",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3", icon: "size-8 p-0" },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, ...props }, ref) => {
  const Component = asChild ? Slot : "button";
  return <Component ref={ref} {...(asChild ? {} : { type: type ?? "button" })} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
