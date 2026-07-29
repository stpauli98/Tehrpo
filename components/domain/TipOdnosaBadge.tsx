import { getTranslations } from "next-intl/server"
import { cn } from "@/lib/utils"

export async function TipOdnosaBadge({ tip }: { tip: "ugovor" | "ponuda" | null | undefined }) {
  if (!tip) return null
  const t = await getTranslations("klijenti.tipOdnosa")
  const isUgovor = tip === "ugovor"
  return (
    <span
      data-testid="tip-odnosa-badge"
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset",
        isUgovor
          ? "bg-brand/10 text-brand-dark ring-brand/25 dark:bg-brand/20 dark:text-brand-light dark:ring-brand/40"
          : "bg-muted text-muted-foreground ring-border"
      )}
    >
      {isUgovor ? t("ugovor") : t("ponuda")}
    </span>
  )
}
