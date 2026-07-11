import { Monitor } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { APP_NAME } from "@/lib/brand"

export async function DesktopOnlyGate() {
  const t = await getTranslations("shell.desktopOnlyGate")
  return (
    <div className="lg:hidden fixed inset-0 z-50 bg-background flex items-center justify-center p-8">
      <div className="max-w-sm text-center space-y-4">
        <Monitor className="w-16 h-16 mx-auto text-brand" aria-hidden />
        <h1 className="text-xl font-semibold">{t("naslov", { appName: APP_NAME })}</h1>
        <p className="text-muted-foreground text-sm">
          {t("opis")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("napomena")}
        </p>
      </div>
    </div>
  )
}
