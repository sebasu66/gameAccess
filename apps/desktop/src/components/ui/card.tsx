import * as React from "react";
import { cn } from "../../lib/cn";

export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-lg border border-border bg-card text-foreground", className)} {...props} />;
export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...props} />;
export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("m-0 font-sans text-xs font-bold uppercase tracking-wider text-muted-foreground", className)} {...props} />;
export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-4 pt-2", className)} {...props} />;
