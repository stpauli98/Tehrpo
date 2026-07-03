"use client"

import { useState } from "react"
import Link from "next/link"
import { Search, Download, Eye } from "lucide-react"
import { Input } from "@/components/ui/input"
import { IKONA_INLINE_KLASA, Tooltip } from "@/components/ui/ikona-tooltip"
import { formatDatum } from "@/lib/date"
import { ObrisiDokumentButton } from "./ObrisiDokumentButton"

type Zapisnik = {
  id: string
  klijent_naziv: string | null
  vrsta_naziv: string | null
  uploaded_at: string
}

export function ZapisniciTabela({ dokumenti }: { dokumenti: Zapisnik[] }) {
  const [q, setQ] = useState("")
  const t = q.trim().toLowerCase()
  const vidljivi =
    t === ""
      ? dokumenti
      : dokumenti.filter(
          (d) =>
            (d.klijent_naziv ?? "").toLowerCase().includes(t) ||
            (d.vrsta_naziv ?? "").toLowerCase().includes(t),
        )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pretraži po klijentu ili vrsti provjere…"
            className="pl-8"
            data-testid="zapisnici-pretraga"
          />
        </div>
        <span className="shrink-0 text-xs text-slate-400">
          {t === "" ? `${dokumenti.length} zapisnika` : `${vidljivi.length} / ${dokumenti.length}`}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm" data-testid="pregled-tabela">
          <thead className="bg-slate-50">
            <tr>
              {["Klijent", "Vrsta provjere", "Datum", "Akcije"].map((c) => (
                <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vidljivi.map((d) => (
              <tr key={d.id} data-testid="pregled-red" className="border-t border-slate-100">
                <td className="px-3 py-2">{d.klijent_naziv ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{d.vrsta_naziv ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums text-slate-500">{formatDatum(d.uploaded_at)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <Link href={`/zapisnici?preview=${d.id}`} className={IKONA_INLINE_KLASA} data-testid="pregled-preview" aria-label="Pregled">
                      <Eye className="h-4 w-4" aria-hidden />
                      <Tooltip>Pregled</Tooltip>
                    </Link>
                    <a href={`/api/dokumenti/${d.id}`} className={IKONA_INLINE_KLASA} data-testid="pregled-download" aria-label="Preuzmi">
                      <Download className="h-4 w-4" aria-hidden />
                      <Tooltip>Preuzmi</Tooltip>
                    </a>
                    <ObrisiDokumentButton dokumentId={d.id} label="Obriši zapisnik" testId="pregled-delete" />
                  </div>
                </td>
              </tr>
            ))}
            {vidljivi.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                  Nema zapisnika za „{q}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
