import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "../../lib/cn";

export const ScrollArea = React.forwardRef<React.ElementRef<typeof ScrollAreaPrimitive.Root>, React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>>(
  ({ className, children, ...props }, ref) => (
    <ScrollAreaPrimitive.Root ref={ref} className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitive.Viewport className="size-full rounded-[inherit]">{children}</ScrollAreaPrimitive.Viewport>
      {(["vertical", "horizontal"] as const).map(orientation => (
        <ScrollAreaPrimitive.Scrollbar key={orientation} orientation={orientation} className={cn("flex touch-none select-none p-0.5 transition-colors", orientation === "vertical" ? "h-full w-2.5 border-l border-l-transparent" : "h-2.5 flex-col border-t border-t-transparent")}>
          <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-foreground/25 hover:bg-primary/70" />
        </ScrollAreaPrimitive.Scrollbar>
      ))}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  ),
);
ScrollArea.displayName = "ScrollArea";
