"use client"

import { useTranslations } from "next-intl"
import type { AktivnostRed } from "@/lib/queries/aktivnost"
import { formatDatum, formatDatumVrijeme } from "@/lib/date"
import { delokalizujSegment } from "@/i18n/routes"

type T = ReturnType<typeof useTranslations<"aktivnost">>

function prettify(k: string): string {
  const s = k.replace(/_/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function poljeLabel(k: string, t: T): string {
  const key = `polja.${k}`
  return t.has(key as never) ? t(key as never) : prettify(k)
}

function ekranLabel(seg: string, t: T): string {
  const fiz = delokalizujSegment(seg)
  const key = `ekrani.${fiz}`
  return t.has(key as never) ? t(key as never) : prettify(fiz)
}

function formatVrijednost(v: unknown, t: T): string {
  if (v === null || v === undefined || v === "") return t("vrijednosti.prazno")
  if (typeof v === "boolean") return v ? t("vrijednosti.da") : t("vrijednosti.ne")
  if (typeof v === "number") return String(v)
  if (typeof v === "string") {
    // ISO datum YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDatum(v)
    // ISO timestamp → datum + HH:mm (slice, TZ-safe; ne koristi Date() zbog TZ)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return `${formatDatum(v)} ${v.slice(11, 16)}`
    return v
  }
  return JSON.stringify(v)
}

// Izvuci izmijenjena polja za UPDATE (staro→novo), inače čitljiv opis iz detalji.
function opisDetalja(red: AktivnostRed, t: T): string {
  if (red.akcija === "UPDATE" && red.staro && red.novo) {
    const staro = red.staro as Record<string, unknown>
    const novo = red.novo as Record<string, unknown>
    const promjene = Object.keys(novo)
      .filter((k) => JSON.stringify(staro[k]) !== JSON.stringify(novo[k]))
      .map((k) => `${poljeLabel(k, t)}: ${formatVrijednost(staro[k], t)} → ${formatVrijednost(novo[k], t)}`)
    return promjene.join("\n") || "—"
  }
  if (red.akcija === "NAVIGATE") {
    return red.entitet ? ekranLabel(red.entitet, t) : "—"
  }
  const d = red.detalji as Record<string, unknown> | null
  if (!d) return "—"
  if (d.filteri) return Object.entries(d.filteri as Record<string, string>)
    .map(([k, v]) => `${poljeLabel(k, t)}: ${v}`).join(", ")
  if (d.ekran) return ekranLabel(red.entitet ?? String(d.ekran), t)
  return JSON.stringify(d)
}

function ciljLabel(r: AktivnostRed, t: T): string {
  const naziv =
    r.cilj_ime && r.cilj_klijent && r.cilj_ime !== r.cilj_klijent
      ? `${r.cilj_ime} (${r.cilj_klijent})`
      : (r.cilj_ime ?? r.cilj_klijent ?? (r.entitet_id ? `#${r.entitet_id}` : null))
  const ent = r.entitet ? ekranLabel(r.entitet, t) : null
  if (!ent) return naziv ?? "—"
  return naziv ? `${ent} · ${naziv}` : ent
}

export function AktivnostTabela({ redovi }: { redovi: AktivnostRed[] }) {
  const t = useTranslations("aktivnost")
  if (redovi.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("prazno")}</p>
  }
  // Kanon površine S6 (rounded-xl + bg-card + ring), ali overflow-x-auto umjesto
  // overflow-hidden iz ZapisniciTabela — ova tabela može biti šira od viewporta.
  return (
    <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2">{t("kolone.vrijeme")}</th>
            <th scope="col" className="px-3 py-2">{t("kolone.korisnik")}</th>
            <th scope="col" className="px-3 py-2">{t("kolone.akcija")}</th>
            <th scope="col" className="px-3 py-2">{t("kolone.cilj")}</th>
            <th scope="col" className="px-3 py-2">{t("kolone.detalji")}</th>
          </tr>
        </thead>
        <tbody>
          {redovi.map((r) => (
            // data-red-id je test-hook: React `key` ne dopire do DOM-a, a textContent
            // reda NIJE pouzdan identitet — dva različita audit zapisa (npr. isti
            // korisnik otvori isti ekran dvaput u istom minutu) mogu se prikazati
            // identično jer vrijeme ide samo do minute.
            <tr key={r.id} data-red-id={r.id} className="border-t border-border">
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDatumVrijeme(r.vrijeme)}
              </td>
              <td className="px-3 py-2">{r.korisnik_ime ?? t("sistemski")}</td>
              <td className="px-3 py-2">{t(`akcije.${r.akcija}` as never)}</td>
              <td className="px-3 py-2">{ciljLabel(r, t)}</td>
              <td className="px-3 py-2 text-muted-foreground whitespace-pre-line">{opisDetalja(r, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
