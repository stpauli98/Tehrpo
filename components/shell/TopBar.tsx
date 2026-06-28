import { odjaviSe } from "@/app/(dashboard)/odjava/actions"
import type { TrenutniKorisnik } from "@/lib/auth/current-user"
import { APP_NAME, APP_TAGLINE, APP_INITIAL } from "@/lib/brand"

export function TopBar({ korisnik }: { korisnik: TrenutniKorisnik | null }) {
  return (
    <header className="h-14 shrink-0 border-b border-slate-200 px-6 flex items-center justify-between bg-white">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded bg-brand text-white text-xs font-bold grid place-items-center">{APP_INITIAL}</div>
        <span className="font-semibold">{APP_NAME}</span>
        <span className="text-xs text-slate-400">{APP_TAGLINE}</span>
      </div>
      <div className="flex items-center gap-4">
        {korisnik && (
          <span className="text-xs text-slate-600">
            {korisnik.ime} · <span className="text-slate-400">{korisnik.uloga}</span>
          </span>
        )}
        <form action={odjaviSe}>
          <button type="submit" className="text-xs text-slate-500 hover:text-slate-900 hover:underline">
            Odjava
          </button>
        </form>
      </div>
    </header>
  )
}
