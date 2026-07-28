import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { dohvatiAktivnostStranu } from "@/lib/queries/aktivnost"
import { parsirajAktivnostFiltere, kljucFiltera, upitFiltera } from "@/lib/aktivnost/filteri"
import { AktivnostFilteri } from "@/components/domain/AktivnostFilteri"
import { AktivnostSearch } from "@/components/domain/AktivnostSearch"
import { AktivnostLista } from "@/components/domain/AktivnostLista"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"

export default async function AktivnostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const korisnik = await getTrenutniKorisnik()
  if (korisnik?.uloga !== "admin") notFound()

  const t = await getTranslations("aktivnost")
  const sp = await searchParams
  const jedan = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  // Stranica uvijek renderuje PRVU porciju — kursor se ne čita iz URL-a stranice,
  // nego ga „Učitaj još" drži u stanju klijenta. Time je URL uvijek dijeljiv.
  const f = parsirajAktivnostFiltere((k) => jedan(sp[k]))
  f.kursor = null

  const supabase = await createServerSupabaseClient()
  const [rezultat, korisniciRes] = await Promise.all([
    dohvatiAktivnostStranu(f),
    supabase.rpc("get_aktivni_korisnici"),
  ])
  // Pad dohvata korisnika NE ruši stranicu — filter tad ima samo „Svi korisnici", lista i dalje radi.
  const korisnici = (korisniciRes.data ?? []) as { id: string; ime: string }[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("naslov")}</h1>
        <p className="text-sm text-muted-foreground">{t("opis")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <AktivnostSearch />
        <AktivnostFilteri key={kljucFiltera(f)} korisnici={korisnici} />
      </div>
      {/* S1: greška čitanja NIJE prazan rezultat — lista se ne renderuje,
          ali naslov i filteri ostaju (promjena filtera = novi pokušaj). */}
      {rezultat.ok ? (
        // `key` na ključu filtera: promjena filtera remontira listu i briše
        // akumulirane porcije, umjesto da se nove nakalemе na stare.
        <AktivnostLista
          key={kljucFiltera(f)}
          pocetna={rezultat.redovi}
          imaJosPocetna={rezultat.imaJos}
          upit={upitFiltera(f)}
        />
      ) : (
        <GreskaUcitavanja />
      )}
    </div>
  )
}
