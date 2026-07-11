import { LogOut } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { odjaviSe } from "@/app/(dashboard)/odjava/actions"
import type { TrenutniKorisnik } from "@/lib/auth/current-user"
import { APP_NAME, APP_TAGLINE, APP_INITIAL } from "@/lib/brand"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { cn, FOCUS_RING } from "@/lib/utils"

export async function TopBar({ korisnik }: { korisnik: TrenutniKorisnik | null }) {
  const t = await getTranslations("shell.topBar")
  return (
    <header className="h-14 shrink-0 border-b border-border px-6 flex items-center justify-between bg-card">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded bg-brand text-white text-xs font-bold grid place-items-center">{APP_INITIAL}</div>
        <span className="font-semibold">{APP_NAME}</span>
        <span className="text-xs text-muted-foreground">{APP_TAGLINE}</span>
      </div>
      <div className="flex items-center gap-4">
        {korisnik && (
          <span className="text-xs text-muted-foreground">
            {korisnik.ime} · <span className="text-muted-foreground">{korisnik.uloga}</span>
          </span>
        )}
        <form action={odjaviSe}>
          <button
            type="submit"
            aria-label={t("odjava")}
            className={cn(
              "group/tt relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              FOCUS_RING,
            )}
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden />
            <Tooltip>{t("odjava")}</Tooltip>
          </button>
        </form>
      </div>
    </header>
  )
}
