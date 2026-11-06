import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "../../lib/cn";

export const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }>(
  ({ className, indicatorClassName, value, ...props }, ref) => (
    <ProgressPrimitive.Root ref={ref} className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/10", className)} value={value} {...props}>
      <ProgressPrimitive.Indicator className={cn("h-full bg-primary transition-all", indicatorClassName)} style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
    </ProgressPrimitive.Root>
  ),
);
Progress.displayName = "Progress";
