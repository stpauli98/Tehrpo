import { AlertTriangle } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { CollapsibleSection } from "./CollapsibleSection"

// Razlog zašto firma NE prima — koristi se za objašnjenje pored "Ne" u pregledu.
type Razlog = "globalno" | "firma" | "nemaAdrese"
const RAZLOG_KEY: Record<Razlog, string> = {
  globalno: "razlogGlobalno",
  firma: "razlogFirma",
  nemaAdrese: "razlogNemaAdrese",
}

export async function KoStaPrimaTab() {
  const t = await getTranslations("postavke.koStaPrima")
  const tSalji = await getTranslations("postavke.saljiKlijentima")
  const supabase = await createServerSupabaseClient()
  const [postRes, korisniciRes, klijentiRes, dodjeleRes] = await Promise.all([
    supabase.from("postavke").select("salji_klijentima").eq("id", 1).maybeSingle(),
    supabase.from("korisnici").select("id, ime, prima_podsjetnike, aktivan").order("ime"),
    supabase.from("klijenti").select("id, naziv, salji_podsjetnik_klijentu, podsjetnik_emails").order("naziv"),
    supabase.from("korisnik_klijent").select("korisnik_id, klijent_id"),
  ])
  const saljiGlobalno = postRes.data?.salji_klijentima ?? false
  const korisnici = korisniciRes.data ?? []
  const dodjele = dodjeleRes.data ?? []
  const imeZa = (id: string) => korisnici.find((k) => k.id === id)?.ime ?? "—"
  const primaZa = (id: string) => {
    const k = korisnici.find((k) => k.id === id)
    return k ? k.aktivan && k.prima_podsjetnike : false
  }

  const redovi = (klijentiRes.data ?? []).map((k) => {
    const radnici = dodjele
      .filter((d) => d.klijent_id === k.id)
      .map((d) => d.korisnik_id)
      .filter((uid) => primaZa(uid))
      .map((uid) => imeZa(uid))
    const adrese = k.podsjetnik_emails ?? []
    const firmaPrima = saljiGlobalno && k.salji_podsjetnik_klijentu && adrese.length > 0
    // Precedencija: globalni prekidač je nadređen; zatim po-firma flag; zatim adrese.
    const razlog: Razlog | null = firmaPrima
      ? null
      : !saljiGlobalno
        ? "globalno"
        : !k.salji_podsjetnik_klijentu
          ? "firma"
          : "nemaAdrese"
    return { id: k.id, naziv: k.naziv, radnici, adrese, firmaPrima, razlog }
  })

  return (
    <CollapsibleSection title={t("naslov")} description={t("opis")}>
      {!saljiGlobalno && (
        <div
          data-testid="ksp-global-off-banner"
          className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t("globalnoIskljucenoBanner", { prekidac: tSalji("naslov") })} ↑</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="ko-sta-prima-tabela">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="px-3 py-2">{t("firma")}</th>
              <th className="px-3 py-2">{t("radnici")}</th>
              <th className="px-3 py-2">{t("firmaPrima")}</th>
              <th className="px-3 py-2">{t("adrese")}</th>
            </tr>
          </thead>
          <tbody>
            {redovi.map((r) => (
              <tr key={r.id} className="border-t border-slate-100" data-testid={`ksp-red-${r.id}`}>
                <td className="px-3 py-2 font-medium">{r.naziv}</td>
                <td className="px-3 py-2">{r.radnici.length > 0 ? r.radnici.join(", ") : "—"}</td>
                <td className="px-3 py-2">
                  {r.firmaPrima ? (
                    <span className="text-green-700">{t("da")}</span>
                  ) : (
                    <span className="text-slate-400">
                      {t("ne")}
                      {r.razlog && (
                        <span className="ml-1 text-xs text-slate-400">({t(RAZLOG_KEY[r.razlog])})</span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-600">{r.adrese.length > 0 ? r.adrese.join(", ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}
