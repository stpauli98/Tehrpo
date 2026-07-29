import Link from "next/link"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { AsistentChat } from "@/components/domain/AsistentChat"
import { NoviRazgovorButton } from "@/components/domain/NoviRazgovorButton"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"
import type { UiPoruka } from "@/components/domain/ChatMessage"
import { href } from "@/i18n/routes"
import { cn, FOCUS_RING } from "@/lib/utils"
import type { Database } from "@/db/types"

type PorukaRow = Database["public"]["Tables"]["chat_poruke"]["Row"]

/**
 * Prozor user poruka iz kojeg se izvodi lista razgovora. Bez RPC-a (migracije su
 * zabranjene iz tab-grane) ovo je gornja granica koja drži upit konstantnim umjesto
 * da raste sa cijelom istorijom korisnika (S9).
 */
const SIDEBAR_PORUKA_LIMIT = 300
/** Maks. broj razgovora u sidebaru. */
const SIDEBAR_RAZGOVORA = 30
/** Maks. dužina naslova razgovora prije skraćivanja. */
const NASLOV_ZNAKOVA = 60

/** Naslov razgovora iz prve poruke; skraćeni naslov dobija elipsu (podatak, ne UI string). */
function skratiNaslov(sadrzaj: string): string {
  return sadrzaj.length > NASLOV_ZNAKOVA ? `${sadrzaj.slice(0, NASLOV_ZNAKOVA)}…` : sadrzaj
}

export default async function AsistentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("asistent")

  // Asistent je admin-only (yoink zahtjev 2026-07-29): tab je ne-adminima sakriven
  // (Sidebar), a ovdje se zatvara i direktan URL pristup.
  const korisnik = await getTrenutniKorisnik()
  if (korisnik?.uloga !== "admin") redirect(href("/pregled"))

  const sp = await searchParams
  const aktivni = typeof sp.k === "string" ? sp.k : null

  const supabase = await createServerSupabaseClient()

  // Dva odvojena, ograničena upita (paralelno): lagani prozor user poruka za sidebar
  // i puna istorija SAMO aktivne konverzacije. RLS ionako scope-uje po vlasniku.
  const [sidebarRes, aktivniRes] = await Promise.all([
    supabase
      .from("chat_poruke")
      .select("konverzacija_id, sadrzaj, created_at")
      .eq("uloga", "user")
      .order("created_at", { ascending: false })
      .limit(SIDEBAR_PORUKA_LIMIT),
    aktivni
      ? supabase
          .from("chat_poruke")
          .select("uloga, sadrzaj")
          .eq("konverzacija_id", aktivni)
          .order("created_at", { ascending: true })
      : Promise.resolve(null),
  ])

  // S1: pad upita ne smije izgledati kao prazna lista.
  const sidebarGreska = sidebarRes.error != null
  const aktivniGreska = aktivniRes?.error != null

  // Prozor je sortiran desc → posljednji upis po konverzaciji je NAJSTARIJA poruka
  // u prozoru (za tipičnu konverzaciju = prva poruka, tj. današnji naslov), a prvi
  // viđeni `created_at` je vrijeme najnovije poruke po kojem se lista sortira.
  const razgovoriMap = new Map<string, { id: string; naslov: string; zadnja: string }>()
  for (const r of (sidebarRes.data ?? []) as Pick<PorukaRow, "konverzacija_id" | "sadrzaj" | "created_at">[]) {
    razgovoriMap.set(r.konverzacija_id, {
      id: r.konverzacija_id,
      naslov: skratiNaslov(r.sadrzaj),
      zadnja: razgovoriMap.get(r.konverzacija_id)?.zadnja ?? r.created_at,
    })
  }
  const razgovori = [...razgovoriMap.values()]
    .sort((a, b) => b.zadnja.localeCompare(a.zadnja))
    .slice(0, SIDEBAR_RAZGOVORA)

  const pocetnePoruke: UiPoruka[] = (aktivniRes?.data ?? []).map((p): UiPoruka => ({
    role: p.uloga as "user" | "assistant",
    text: p.sadrzaj,
  }))

  return (
    <div className="grid grid-cols-[260px_1fr] gap-4">
      <aside className="space-y-3 border-r border-border pr-4" data-testid="razgovori-sidebar">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sidebar.naslov")}</h2>
          <NoviRazgovorButton />
        </div>
        {sidebarGreska ? (
          <GreskaUcitavanja className="p-4" />
        ) : (
          <ul className="space-y-1">
            {razgovori.length === 0 && <li className="text-xs text-muted-foreground">{t("sidebar.prazno")}</li>}
            {razgovori.map((r) => (
              <li key={r.id}>
                <Link
                  href={href(`/asistent?k=${r.id}`)}
                  data-testid="razgovor-link"
                  className={cn(
                    "block truncate rounded-lg px-2 py-1 text-sm hover:bg-muted",
                    FOCUS_RING,
                    r.id === aktivni ? "bg-muted font-medium" : "text-muted-foreground",
                  )}
                >
                  {r.naslov || t("sidebar.bezNaslova")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section>
        <h1 className="mb-3 text-2xl font-semibold">{t("naslov")}</h1>
        {aktivniGreska ? (
          <GreskaUcitavanja />
        ) : aktivni ? (
          <AsistentChat key={aktivni} konverzacijaId={aktivni} pocetnePoruke={pocetnePoruke} />
        ) : (
          <NoviRazgovorChat prazanRazgovor={t("prazanRazgovor")} />
        )}
      </section>
    </div>
  )
}

function NoviRazgovorChat({ prazanRazgovor }: { prazanRazgovor: string }) {
  return (
    <div data-testid="prazan-asistent" className="rounded-xl bg-card p-6 text-sm text-muted-foreground ring-1 ring-foreground/10">
      {prazanRazgovor}
    </div>
  )
}
