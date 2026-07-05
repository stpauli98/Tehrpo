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
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        isUgovor
          ? "bg-blue-100 text-blue-700"
          : "bg-slate-100 text-slate-600"
      )}
    >
      {isUgovor ? t("ugovor") : t("ponuda")}
    </span>
  )
}
