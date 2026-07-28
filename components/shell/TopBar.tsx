import { LogOut } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { odjaviSe } from "@/app/(dashboard)/odjava/actions"
import type { TrenutniKorisnik } from "@/lib/auth/current-user"
import { APP_NAME, APP_TAGLINE, APP_INITIAL } from "@/lib/brand"
import { DEMO_MODE } from "@/lib/demo"
import { KorisnikMeni } from "@/components/shell/KorisnikMeni"
import { cn, FOCUS_RING } from "@/lib/utils"

export async function TopBar({ korisnik }: { korisnik: TrenutniKorisnik | null }) {
  const t = await getTranslations("shell.topBar")
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-2.5">
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-brand text-[13px] font-bold text-white">
          {APP_INITIAL}
        </div>
        <span className="text-sm font-semibold text-foreground">{APP_NAME}</span>
        <span aria-hidden className="h-4 w-px bg-border" />
        <span className="text-xs text-muted-foreground">{APP_TAGLINE}</span>
        {/* Stoji na SVAKOM ekranu namjerno: ako demo režim ikad završi u produkciji,
            vidi se odmah, a ne tek kad neko otvori tab sa mejlovima. */}
        {DEMO_MODE && (
          <span
            data-testid="demo-bedz"
            title={t("demoBedzOpis")}
            className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-warning"
          >
            {t("demoBedz")}
          </span>
        )}
      </div>

      {korisnik ? (
        <KorisnikMeni korisnik={korisnik} />
      ) : (
        // Rijedak fail-open slučaj: sesija postoji ali profil (korisnici red) nedostaje —
        // ime/ulogu ne možemo prikazati, ali odjava mora ostati dostupna.
        <form action={odjaviSe}>
          <button
            type="submit"
            aria-label={t("odjava")}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              FOCUS_RING,
            )}
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </form>
      )}
    </header>
  )
}
