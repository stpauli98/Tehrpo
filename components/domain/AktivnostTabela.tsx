import { getTranslations } from "next-intl/server"
import type { AktivnostRed } from "@/lib/queries/aktivnost"

// Izvuci izmijenjena polja za UPDATE (staro→novo), inače čitljiv opis iz detalji.
function opisDetalja(red: AktivnostRed): string {
  if (red.akcija === "UPDATE" && red.staro && red.novo) {
    const staro = red.staro as Record<string, unknown>
    const novo = red.novo as Record<string, unknown>
    const promjene = Object.keys(novo)
      .filter((k) => JSON.stringify(staro[k]) !== JSON.stringify(novo[k]))
      .map((k) => `${k}: ${JSON.stringify(staro[k])} → ${JSON.stringify(novo[k])}`)
    return promjene.join(", ") || "—"
  }
  const d = red.detalji as Record<string, unknown> | null
  if (!d) return "—"
  if (d.ekran) return String(d.ekran)
  if (d.filteri) return Object.entries(d.filteri as Record<string, string>)
    .map(([k, v]) => `${k}=${v}`).join(", ")
  return JSON.stringify(d)
}

export async function AktivnostTabela({ redovi }: { redovi: AktivnostRed[] }) {
  const t = await getTranslations("aktivnost")
  if (redovi.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("prazno")}</p>
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2">{t("kolone.vrijeme")}</th>
            <th className="px-3 py-2">{t("kolone.korisnik")}</th>
            <th className="px-3 py-2">{t("kolone.akcija")}</th>
            <th className="px-3 py-2">{t("kolone.cilj")}</th>
            <th className="px-3 py-2">{t("kolone.detalji")}</th>
          </tr>
        </thead>
        <tbody>
          {redovi.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-3 py-2 whitespace-nowrap">
                {new Date(r.vrijeme).toLocaleString("sr-Latn")}
              </td>
              <td className="px-3 py-2">{r.korisnik_ime ?? t("sistemski")}</td>
              <td className="px-3 py-2">{t(`akcije.${r.akcija}` as never)}</td>
              <td className="px-3 py-2">
                {r.entitet ?? "—"}{r.entitet_id ? ` #${r.entitet_id}` : ""}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{opisDetalja(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
