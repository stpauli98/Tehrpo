import { DodajProvjeruButton } from "@/components/domain/DodajProvjeruButton"
import { ObrisiProfilButton } from "@/components/domain/ObrisiProfilButton"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { formatDatum } from "@/lib/date"

export type ProfilStavka = {
  id: string
  vrsta_naziv: string
  lokacija_naziv: string | null
  /** Efektivni interval (override stavke ili podrazumijevani vrste). */
  interval_mjeseci: number | null
  /** Zadnje stvarno izvršenje iz termina (fallback: statični datum unesen pri kreiranju). */
  zadnji_datum: string | null
  /** Rok aktivnog termina iz baze (fallback: izračun zadnji + interval). */
  sljedeci_rok: string | null
  /** status_izvedeni aktivnog termina, null kad aktivnog termina nema. */
  termin_status: string | null
}

export function ProfilTab({
  klijentId,
  stavke,
  vrste,
  lokacije,
}: {
  klijentId: string
  stavke: ProfilStavka[]
  vrste: { id: string; naziv: string; interval: number | null }[]
  lokacije: { id: string; naziv: string }[]
}) {
  return (
    <div data-testid="tab-profil-content" className="space-y-4">
      <div className="flex justify-end">
        <DodajProvjeruButton klijentId={klijentId} vrste={vrste} lokacije={lokacije} />
      </div>
      {stavke.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Nema provjera u profilu. Dodajte provjeru da generišete termine.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Vrsta", "Lokacija", "Interval (mj)", "Zadnji put", "Sljedeći rok", ""].map((c) => (
                  <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stavke.map((s) => (
                <tr key={s.id} data-testid="profil-row" className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{s.vrsta_naziv}</td>
                  <td className="px-3 py-2 text-slate-600">{s.lokacija_naziv ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{s.interval_mjeseci ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {s.zadnji_datum ? formatDatum(s.zadnji_datum) : "— (prvi put)"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums font-medium">{formatDatum(s.sljedeci_rok)}</span>
                      {s.termin_status && <StatusBadge status={s.termin_status} />}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right"><ObrisiProfilButton id={s.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
