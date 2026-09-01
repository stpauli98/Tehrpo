import { getTranslations } from "next-intl/server"
import { cn } from "@/lib/utils"

/**
 * `variant="tekst"` je tiha varijanta za grid kartica: tamo je jedini akcenat broj
 * koji kasni, pa tip odnosa ne smije da se takmiči trećim obojenim pilulom.
 * Default ostaje pilula — detaljna stranica klijenta se ne mijenja.
 */
export async function TipOdnosaBadge({
  tip,
  variant = "pilula",
}: {
  tip: "ugovor" | "ponuda" | null | undefined
  variant?: "pilula" | "tekst"
}) {
  if (!tip) return null
  const t = await getTranslations("klijenti.tipOdnosa")
  const isUgovor = tip === "ugovor"
  const label = isUgovor ? t("ugovor") : t("ponuda")

  if (variant === "tekst") {
    return (
      <span data-testid="tip-odnosa-badge" className="text-xs text-muted-foreground">
        {label}
      </span>
    )
  }

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
      {label}
    </span>
  )
}
