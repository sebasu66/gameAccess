import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-sans text-[11px] font-bold leading-4", {
  variants: {
    variant: {
      default: "border-border bg-foreground/10 text-foreground",
      success: "border-success/40 bg-success/15 text-success",
      warning: "border-warning/40 bg-warning/15 text-warning",
      destructive: "border-destructive/50 bg-destructive/15 text-[#e1898f]",
      info: "border-info/40 bg-info/15 text-info",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
export const Badge = ({ className, variant, ...props }: BadgeProps) => <span className={cn(badgeVariants({ variant }), className)} {...props} />;
