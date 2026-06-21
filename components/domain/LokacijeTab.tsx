import type { Database } from "@/db/types"
import { LokacijaSheet } from "@/components/domain/LokacijaSheet"
import { ObrisiLokacijuButton } from "@/components/domain/ObrisiLokacijuButton"

type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]

export function LokacijeTab({
  klijentId,
  lokacije,
}: {
  klijentId: string
  lokacije: LokacijaRow[]
}) {
  return (
    <div data-testid="tab-lokacije-content" className="space-y-4">
      <div className="flex justify-end">
        <LokacijaSheet klijentId={klijentId} />
      </div>

      {lokacije.length === 0 ? (
        <div
          data-testid="lokacije-empty"
          className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500"
        >
          Nema lokacija. Dodajte prvu lokaciju za ovog klijenta.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm" data-testid="lokacije-table">
            <thead className="bg-slate-50">
              <tr>
                {["Naziv", "Grad", "Kontakt", "Akcije"].map((c) => (
                  <th
                    key={c}
                    className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lokacije.map((l) => (
                <tr key={l.id} data-testid="lokacija-row" className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{l.naziv}</td>
                  <td className="px-3 py-2 text-slate-600">{l.grad ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{l.kontakt_osoba ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <LokacijaSheet klijentId={klijentId} lokacija={l} />
                      <ObrisiLokacijuButton lokacijaId={l.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
