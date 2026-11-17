import * as React from "react";
import { cn } from "../../lib/cn";

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(({ className, ...props }, ref) => (
  <table ref={ref} className={cn("w-full caption-bottom border-collapse font-sans text-sm", className)} {...props} />
));
Table.displayName = "Table";
export const TableHeader = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn("sticky top-0 z-10 bg-card", className)} {...props} />;
export const TableBody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn(className)} {...props} />;
export const TableRow = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("border-b border-border transition-colors hover:bg-foreground/5 data-[state=selected]:bg-primary/10", className)} {...props} />;
export const TableHead = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn("h-10 whitespace-nowrap border-b border-border px-3 text-left align-middle text-[11px] font-bold uppercase tracking-wider text-muted-foreground", className)} {...props} />;
export const TableCell = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
