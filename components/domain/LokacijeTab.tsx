import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { User } from "lucide-react"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import type { Database } from "@/db/types"
import { LokacijaSheet } from "@/components/domain/LokacijaSheet"
import { ObrisiLokacijuButton } from "@/components/domain/ObrisiLokacijuButton"
import { href } from "@/i18n/routes"

type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]

export async function LokacijeTab({
  klijentId,
  lokacije,
  kontakti = [],
  slanjeUgaseno = false,
}: {
  klijentId: string
  lokacije: LokacijaRow[]
  /** Kontakti firme — forma lokacije nudi vezivanje postojećeg umjesto ponovnog kucanja. */
  kontakti?: { id: string; ime: string; lokacija_id: string | null }[]
  /** Oba prekidača (globalni + per-firma) nisu uključena → checkbox podsjetnika je bez efekta. */
  slanjeUgaseno?: boolean
}) {
  const t = await getTranslations("klijenti.lokacije")
  const vezani = (lokacijaId: string) => kontakti.filter((k) => k.lokacija_id === lokacijaId)
  return (
    <div data-testid="tab-lokacije-content" className="space-y-4">
      <div className="flex justify-end">
        <LokacijaSheet klijentId={klijentId} kontakti={kontakti} slanjeUgaseno={slanjeUgaseno} />
      </div>

      {lokacije.length === 0 ? (
        <div
          data-testid="lokacije-empty"
          className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/10"
        >
          {t("prazno")}
        </div>
      ) : (
        <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
          <table className="w-full text-sm" data-testid="lokacije-table">
            <thead className="bg-muted">
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
                    scope="col"
                    className="px-3 py-2 text-left align-top text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lokacije.map((l) => (
                <tr key={l.id} data-testid="lokacija-row" className="border-t border-border align-top">
                  <td className="px-3 py-2.5 font-medium text-foreground">{l.naziv}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{l.adresa || "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {[l.grad, l.regija].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {vezani(l.id).length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      vezani(l.id).map((k) => (
                        <Link
                          key={k.id}
                          href={href(`/klijenti/${klijentId}?tab=kontakti&highlight=${k.id}`)}
                          scroll={false}
                          className="group/tt relative mt-1 flex items-center gap-1 font-medium text-brand transition-colors motion-reduce:transition-none hover:underline"
                          data-testid={`lokacija-vezani-kontakt-${l.id}`}
                        >
                          <User className="h-[18px] w-[18px] shrink-0" aria-hidden />
                          {k.ime}
                          <Tooltip>{t("kontaktLinkTitle")}</Tooltip>
                        </Link>
                      ))
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-2">
                      <LokacijaSheet klijentId={klijentId} lokacija={l} kontakti={kontakti} slanjeUgaseno={slanjeUgaseno} />
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
