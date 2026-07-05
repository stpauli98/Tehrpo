import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { User } from "lucide-react"
import type { Database } from "@/db/types"
import { LokacijaSheet } from "@/components/domain/LokacijaSheet"
import { ObrisiLokacijuButton } from "@/components/domain/ObrisiLokacijuButton"
import { href } from "@/i18n/routes"

type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]

export async function LokacijeTab({
  klijentId,
  lokacije,
}: {
  klijentId: string
  lokacije: LokacijaRow[]
}) {
  const t = await getTranslations("klijenti.lokacije")
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
          {t("prazno")}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm" data-testid="lokacije-table">
            <thead className="bg-slate-50">
              <tr>
                {[
                  t("kolone.naziv"),
                  t("kolone.lokacijaAdresa"),
                  t("kolone.gradRegija"),
                  t("kolone.kontakt"),
                  t("kolone.akcije"),
                ].map((c) => (
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
                        href={href(`/klijenti/${klijentId}?tab=kontakti&highlight=${l.id}`)}
                        scroll={false}
                        className="inline-flex items-center gap-1 font-medium text-brand transition-colors hover:underline"
                        data-testid={`lokacija-kontakt-link-${l.id}`}
                        title={t("kontaktLinkTitle")}
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
