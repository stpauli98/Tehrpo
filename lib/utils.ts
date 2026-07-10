import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Kanonski focus-visible prsten (isti tretman kao shadcn primitivi button/input/select).
 * Dodaj na SVAKI custom interaktivni element (Link, div/tr sa onClick, custom dugme)
 * koji ne dolazi iz `components/ui/`. Vidi claudedocs/2026-07-10-ui-ux-standardi.md §8.
 */
export const FOCUS_RING =
  "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
