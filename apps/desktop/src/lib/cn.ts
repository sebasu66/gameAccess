import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Join class names and resolve conflicting Tailwind utilities (shadcn's `cn`). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
