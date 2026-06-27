import { UgovoriTab } from "@/components/domain/UgovoriTab"
import { KontaktiKlijentList } from "@/components/domain/KontaktiKlijentList"
import { formatDatum } from "@/lib/date"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]

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
  usluge: { vrsta_naziv: string; lokacija_naziv: string | null; sljedeci_rok: string }[]
}) {
  const redovi: [string, string | null][] = [
    ["Adresa", osnovni.adresa],
    ["Telefon", osnovni.telefon],
    ["Email", osnovni.email],
    ["PIB", osnovni.pib],
    ["Matični broj", osnovni.maticni_broj],
    ["Šifra djelatnosti", osnovni.sifra_djelatnosti],
    ["Zadužen (TEHPRO)", zaduzeniIme],
  ]
  return (
    <div className="space-y-6" data-testid="tab-id-karta-content">
      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-700">Osnovni podaci</h3>
        <dl className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {redovi.map(([label, val]) => (
            <div key={label} className="flex justify-between gap-2 text-sm">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-800">{val || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <UgovoriTab klijentId={klijentId} ugovori={ugovori} />
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <KontaktiKlijentList klijentId={klijentId} kontakti={kontakti} />
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-700">Ugovorene usluge</h3>
        {usluge.length === 0 ? (
          <p className="text-sm text-slate-500">Nema definisanih usluga. Dodajte ih kroz tab Profil.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {usluge.map((u, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="text-slate-700">{u.vrsta_naziv}{u.lokacija_naziv ? ` · ${u.lokacija_naziv}` : ""}</span>
                <span className="tabular-nums text-slate-500">sljedeći: {formatDatum(u.sljedeci_rok)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
