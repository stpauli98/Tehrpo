import Link from "next/link"
import { User } from "lucide-react"
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
                {["Naziv", "Lokacija / Adresa", "Grad / Regija", "Kontakt", "Akcije"].map((c) => (
                  <th
                    key={c}
                    className="px-3 py-2 text-left align-top text-xs font-medium uppercase tracking-wide text-slate-500"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lokacije.map((l) => (
                <tr key={l.id} data-testid="lokacija-row" className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2.5 font-medium text-slate-900">{l.naziv}</td>
                  <td className="px-3 py-2.5 text-slate-600">{l.adresa || "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {[l.grad, l.regija].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {l.kontakt_osoba ? (
                      <Link
                        href={`/klijenti/${klijentId}?tab=kontakti&highlight=${l.id}`}
                        scroll={false}
                        className="inline-flex items-center gap-1 font-medium text-brand transition-colors hover:underline"
                        data-testid={`lokacija-kontakt-link-${l.id}`}
                        title="Otvori u tabu Kontakti"
                      >
                        <User className="h-3.5 w-3.5" aria-hidden />
                        {l.kontakt_osoba}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
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
