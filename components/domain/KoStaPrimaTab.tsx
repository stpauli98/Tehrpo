import { AlertTriangle, ArrowUp, Send } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { EMAIL_RE } from "@/lib/reminders/recipients"
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
  const [postRes, korisniciRes, klijentiRes, dodjeleRes, kontaktiRes] = await Promise.all([
    supabase.from("postavke").select("salji_klijentima").eq("id", 1).maybeSingle(),
    supabase.from("korisnici").select("id, ime, prima_podsjetnike, aktivan").order("ime"),
    supabase.from("klijenti").select("id, naziv, salji_podsjetnik_klijentu, podsjetnik_emails").order("naziv"),
    supabase.from("korisnik_klijent").select("korisnik_id, klijent_id"),
    supabase.from("kontakt_osobe").select("klijent_id, email, podsjetnik_primalac"),
  ])
  const saljiGlobalno = postRes.data?.salji_klijentima ?? false
  const korisnici = korisniciRes.data ?? []
  const dodjele = dodjeleRes.data ?? []
  // klijent_id → validne adrese flagovanih kontakata (lowercase + dedup, uskladeno s engine slanjem)
  const adreseByKlijent = new Map<string, Set<string>>()
  for (const ko of kontaktiRes.data ?? []) {
    if (!ko.podsjetnik_primalac) continue
    const email = (ko.email ?? "").trim().toLowerCase()
    if (!EMAIL_RE.test(email)) continue
    const set = adreseByKlijent.get(ko.klijent_id) ?? new Set<string>()
    set.add(email)
    adreseByKlijent.set(ko.klijent_id, set)
  }
  // Ad-hoc „čiste" adrese (nisu kontakti) — u isti Set (dedup s kontakt-adresama je automatski).
  for (const k of klijentiRes.data ?? []) {
    const set = adreseByKlijent.get(k.id) ?? new Set<string>()
    for (const raw of k.podsjetnik_emails ?? []) {
      const email = (raw ?? "").trim().toLowerCase()
      if (!EMAIL_RE.test(email)) continue
      set.add(email)
    }
    if (set.size > 0) adreseByKlijent.set(k.id, set)
  }
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
    const adrese = [...(adreseByKlijent.get(k.id) ?? [])]
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

  const brojPrima = redovi.filter((r) => r.firmaPrima).length

  return (
    <CollapsibleSection
      title={t("naslov")}
      description={t("opis")}
      icon={<Send className="h-[18px] w-[18px]" />}
    >
      {!saljiGlobalno && (
        <div
          data-testid="ksp-global-off-banner"
          className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden />
          <span className="inline-flex items-center gap-1">
            {t("globalnoIskljucenoBanner", { prekidac: tSalji("naslov") })}
            <ArrowUp className="h-[18px] w-[18px] shrink-0" aria-hidden />
          </span>
        </div>
      )}

      <div className="mb-2 flex items-center justify-end">
        <span className="text-xs text-muted-foreground">
          {t("sazetak", { prima: brojPrima, ukupno: redovi.length })}
        </span>
      </div>

      <div className="max-h-[26rem] overflow-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full text-sm" data-testid="ko-sta-prima-tabela">
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">{t("firma")}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t("radnici")}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t("firmaPrima")}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t("adrese")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {redovi.map((r) => (
              <tr
                key={r.id}
                className="transition-colors hover:bg-muted/40"
                data-testid={`ksp-red-${r.id}`}
              >
                <td className="px-4 py-2.5 font-medium">{r.naziv}</td>
                <td className="px-4 py-2.5">
                  {r.radnici.length > 0 ? (
                    r.radnici.join(", ")
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {r.firmaPrima ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                      <span className="size-1.5 rounded-full bg-success" aria-hidden />
                      {t("da")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {t("ne")}
                      </span>
                      {r.razlog && (
                        <span className="text-xs text-muted-foreground">{t(RAZLOG_KEY[r.razlog])}</span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {r.adrese.length > 0 ? r.adrese.join(", ") : "—"}
                </td>
              </tr>
            ))}
            {redovi.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  {t("prazno")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}
