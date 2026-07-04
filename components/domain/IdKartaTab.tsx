import { UgovoriTab } from "@/components/domain/UgovoriTab"
import { KontaktiKlijentList } from "@/components/domain/KontaktiKlijentList"
import { PrikaziJosLista } from "@/components/domain/PrikaziJosLista"
import { InfoIkona } from "@/components/ui/info-ikona"
import { formatDatum } from "@/lib/date"
import { APP_NAME } from "@/lib/brand"
import { Building2, ClipboardCheck } from "lucide-react"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"

export function IdKartaTab({
  klijentId,
  osnovni,
  zaduzeniIme,
  ugovori,
  kontakti,
  usluge,
}: {
  klijentId: string
  osnovni: {
    adresa: string | null; telefon: string | null; email: string | null
    pib: string | null; maticni_broj: string | null; sifra_djelatnosti: string | null
  }
  zaduzeniIme: string | null
  ugovori: UgovorRow[]
  kontakti: KontaktRow[]
  usluge: { vrsta_naziv: string; lokacija_naziv: string | null; sljedeci_rok: string | null }[]
}) {
  const redovi: [string, string | null][] = [
    ["Adresa", osnovni.adresa],
    ["Telefon", osnovni.telefon],
    ["Email", osnovni.email],
    ["PIB", osnovni.pib],
    ["Matični broj", osnovni.maticni_broj],
    ["Šifra djelatnosti", osnovni.sifra_djelatnosti],
    [`Zadužen (${APP_NAME})`, zaduzeniIme],
  ]
  return (
    <div className="space-y-5" data-testid="tab-id-karta-content">
      <section className={CARD}>
        <div className="mb-4 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-slate-400" aria-hidden />
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            Osnovni podaci
            <InfoIkona
              tekst="Registracioni i kontakt podaci firme (adresa, PIB, matični broj…) i osoba zadužena za klijenta. Uređuje se preko dugmeta Uredi u zaglavlju."
              testId="info-sekcija-osnovni"
            />
          </h3>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-3">
          {redovi.map(([label, val]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-slate-400">{label}</dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-slate-800" title={val || undefined}>
                {val || "—"}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={CARD}>
        <UgovoriTab
          klijentId={klijentId}
          ugovori={ugovori}
          info="Ugovori sklopljeni sa klijentom. Samo jedan ugovor može biti aktivan; stariji ostaju kao istorija."
        />
      </section>

      <section className={CARD}>
        <KontaktiKlijentList
          klijentId={klijentId}
          kontakti={kontakti}
          previewLimit={4}
          seeAllHref={`/klijenti/${klijentId}?tab=kontakti`}
          info="Skraćeni pregled kontakata firme (prvih nekoliko). Puni spisak i pretraga su u tabu Kontakti."
        />
      </section>

      <section className={CARD}>
        <div className="mb-4 flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-slate-400" aria-hidden />
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            Ugovorene usluge
            <InfoIkona
              tekst="Sažetak provjera iz Profila sa sljedećim rokom za svaku — brzi uvid u to šta je ugovoreno i šta prvo dolazi na red."
              testId="info-sekcija-usluge"
            />
          </h3>
        </div>
        {usluge.length === 0 ? (
          <p className="text-sm text-slate-500">Nema definisanih usluga. Dodajte ih kroz tab Profil.</p>
        ) : (
          <PrikaziJosLista
            ulClassName="divide-y divide-slate-100 text-sm"
            imenicaGenitiv="usluga"
            testId="usluge-prikazi-jos"
            items={usluge.map((u, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="text-slate-700">
                  {u.vrsta_naziv}
                  {u.lokacija_naziv && <span className="text-slate-400"> · {u.lokacija_naziv}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs tabular-nums text-slate-500">
                  sljedeći: {formatDatum(u.sljedeci_rok)}
                </span>
              </li>
            ))}
          />
        )}
      </section>
    </div>
  )
}
