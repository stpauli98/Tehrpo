"use client"

import { useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Search, Download, Eye, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { IKONA_INLINE_KLASA, Tooltip } from "@/components/ui/ikona-tooltip"
import { formatDatum } from "@/lib/date"
import { ObrisiDokumentButton } from "./ObrisiDokumentButton"
import { href } from "@/i18n/routes"

type Zapisnik = {
  id: string
  naziv: string
  klijent_naziv: string | null
  vrsta_naziv: string | null
  uploaded_at: string
}

/**
 * `dokumenti` je JEDNA strana (server paginira sa PER_PAGE, v. zapisnici/page.tsx),
 * `ukupno` je broj svih AI zapisnika. Pretraga je svjesno ostala klijentska pa
 * filtrira samo tekuću stranu — server-side pretraga po klijentu/vrsti traži
 * obrnuti upit kroz `termini_view` (van obima, v. nalog 22 §4).
 */
export function ZapisniciTabela({ dokumenti, ukupno }: { dokumenti: Zapisnik[]; ukupno: number }) {
  const t = useTranslations("zapisnici")
  const tCommon = useTranslations("common")
  const [q, setQ] = useState("")
  const [preuzimaId, setPreuzimaId] = useState<string | null>(null)
  const upit = q.trim().toLowerCase()
  const vidljivi =
    upit === ""
      ? dokumenti
      : dokumenti.filter(
          (d) =>
            (d.klijent_naziv ?? "").toLowerCase().includes(upit) ||
            (d.vrsta_naziv ?? "").toLowerCase().includes(upit),
        )

  // S13: ruta /api/dokumenti/[id] na grešku vraća JSON — goli <a> bi korisnika
  // odveo na sirovi JSON, pa se preuzima kroz fetch + blob uz toast na neuspjeh.
  async function preuzmi(d: Zapisnik) {
    setPreuzimaId(d.id)
    try {
      const res = await fetch(`/api/dokumenti/${d.id}`)
      if (!res.ok) {
        toast.error(tCommon("greska"))
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = d.naziv
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(tCommon("greska"))
    } finally {
      setPreuzimaId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-[18px] w-[18px] shrink-0 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("pretragaPlaceholder")}
            aria-label={t("pretragaPlaceholder")}
            className="pl-8"
            data-testid="zapisnici-pretraga"
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {upit === ""
            ? t("brojUkupno", { count: ukupno })
            : t("brojFiltrirano", { prikazano: vidljivi.length, ukupno: dokumenti.length })}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full text-sm" aria-label={t("naslov")} data-testid="zapisnici-tabela">
          <thead className="bg-muted">
            <tr>
              {[t("kolone.klijent"), t("kolone.vrsta"), t("kolone.datum"), t("kolone.akcije")].map((c) => (
                <th key={c} scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vidljivi.map((d) => (
              <tr key={d.id} data-testid="zapisnici-red" className="border-t border-border">
                <td className="px-3 py-2">{d.klijent_naziv ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{d.vrsta_naziv ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatDatum(d.uploaded_at)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <Link href={href(`/zapisnici?preview=${d.id}`)} className={IKONA_INLINE_KLASA} data-testid="zapisnici-preview" aria-label={t("pregled")}>
                      <Eye className="h-[18px] w-[18px] shrink-0" aria-hidden />
                      <Tooltip>{t("pregled")}</Tooltip>
                    </Link>
                    <button
                      type="button"
                      onClick={() => void preuzmi(d)}
                      disabled={preuzimaId === d.id}
                      className={`${IKONA_INLINE_KLASA} disabled:pointer-events-none disabled:opacity-60`}
                      data-testid="zapisnici-download"
                      aria-label={t("preuzmi")}
                    >
                      {preuzimaId === d.id ? (
                        <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                      ) : (
                        <Download className="h-[18px] w-[18px] shrink-0" aria-hidden />
                      )}
                      <Tooltip>{t("preuzmi")}</Tooltip>
                    </button>
                    <ObrisiDokumentButton dokumentId={d.id} label={t("obrisiZapisnik")} testId="zapisnici-delete" />
                  </div>
                </td>
              </tr>
            ))}
            {vidljivi.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  {t("prazniRezultati", { upit: q })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
