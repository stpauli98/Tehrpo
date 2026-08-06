"use client"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

// Renderuje se samo u DEMO režimu — gate je na pozivaocu ({DEMO_MODE && ...}),
// isti obrazac kao DEMO bedž u TopBar.tsx. Namjerno bez dugmeta za zatvaranje.
export function DemoTraka({ className }: { className?: string }) {
  const t = useTranslations("shell.demoTraka")
  return (
    <div
      data-testid="demo-traka"
      className={cn(
        "flex h-8 shrink-0 items-center justify-center bg-brand px-4 text-xs font-semibold tracking-wide text-white",
        className,
      )}
    >
      {t("tekst")}
    </div>
  )
}
