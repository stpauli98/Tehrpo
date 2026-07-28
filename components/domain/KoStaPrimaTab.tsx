import Link from "next/link"
import { AlertTriangle, ArrowUp, Send } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { href } from "@/i18n/routes"
import { podsjetniciAktivni as citajPodsjetniciAktivni } from "@/lib/reminders/gating"
import { EMAIL_RE } from "@/lib/reminders/recipients"
import { izracunajIshodReda, type RazlogNePrima } from "@/lib/podsjetnici/koStaPrima"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { cn, FOCUS_RING } from "@/lib/utils"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { CollapsibleSection } from "./CollapsibleSection"
import { SaljiFirmiToggle } from "./SaljiFirmiToggle"
import { UkljuciSlanjeFirmamaButton } from "./UkljuciSlanjeFirmamaButton"

// Razlog zašto firma NE prima — koristi se za objašnjenje pored "Ne" u pregledu.
const RAZLOG_KEY: Record<RazlogNePrima, string> = {
  automatika: "razlogAutomatika",
  globalno: "razlogGlobalno",
  firma: "razlogFirma",
  nemaAdrese: "razlogNemaAdrese",
}

export async function KoStaPrimaTab() {
  const t = await getTranslations("postavke.koStaPrima")
  const tSalji = await getTranslations("postavke.saljiKlijentima")
  const supabase = await createServerSupabaseClient()
  const [postRes, korisniciRes, klijentiRes, dodjeleRes, kontaktiRes] = await Promise.all([
    supabase.from("postavke").select("salji_klijentima, podsjetnici_aktivni").eq("id", 1).maybeSingle(),
    supabase.from("korisnici").select("id, ime, prima_podsjetnike, aktivan").order("ime"),
    supabase.from("klijenti").select("id, naziv, salji_podsjetnik_klijentu, podsjetnik_emails").order("naziv"),
    supabase.from("korisnik_klijent").select("korisnik_id, klijent_id"),
    supabase.from("kontakt_osobe").select("klijent_id, email, podsjetnik_primalac"),
  ])
  const saljiGlobalno = postRes.data?.salji_klijentima ?? false
  // Fallback „nema reda/kolone = uključeno" je isti onaj kojim se vodi cron ruta.
  const automatikaAktivna = citajPodsjetniciAktivni(postRes.data)
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
    const { prima: firmaPrima, razlog } = izracunajIshodReda({
      podsjetniciAktivni: automatikaAktivna,
      saljiGlobalno,
      saljiFirmi: k.salji_podsjetnik_klijentu ?? false,
      brojAdresa: adrese.length,
    })
    return {
      id: k.id,
      naziv: k.naziv,
      radnici,
      adrese,
      firmaPrima,
      razlog,
      // Sirovi flag — ulazi u toggle. Razlikuje se od `firmaPrima` (izvedeno).
      salji: k.salji_podsjetnik_klijentu ?? false,
    }
  })

  const brojPrima = redovi.filter((r) => r.firmaPrima).length
  const brojAdresaKandidata = redovi.filter(
    (r) => saljiGlobalno && r.salji && r.adrese.length > 0,
  ).length

  return (
    <CollapsibleSection
      title={t("naslov")}
      description={t("opis")}
      icon={<Send className="h-[18px] w-[18px]" />}
    >
      {!automatikaAktivna && (
        <div
          data-testid="ksp-automatika-off-banner"
          className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden />
          <span>{t("automatikaIskljucenaBanner")}</span>
        </div>
      )}

      {!saljiGlobalno && (
        <div
          data-testid="ksp-global-off-banner"
          className="mb-3 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden />
          <span className="inline-flex flex-1 items-center gap-1">
            {t("globalnoIskljucenoBanner", { prekidac: tSalji("naslov") })}
            <ArrowUp className="h-[18px] w-[18px] shrink-0" aria-hidden />
          </span>
          {/* Akcija u banneru, ne link na prekidač: prekidač je u zatvorenoj
              CollapsibleSection sekciji, pa anchor na njega ne bi imao gdje skočiti. */}
          <UkljuciSlanjeFirmamaButton />
        </div>
      )}

      <div className="mb-2 flex items-center justify-end">
        <span className="text-xs text-muted-foreground" data-testid="ksp-sazetak">
          {automatikaAktivna
            ? t("sazetak", { prima: brojPrima, ukupno: redovi.length })
            : t("sazetakAutomatikaOff", { prima: brojAdresaKandidata, ukupno: redovi.length })}
        </span>
      </div>

      <div className="max-h-[26rem] overflow-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full text-sm" data-testid="ko-sta-prima-tabela">
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">{t("firma")}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t("radnici")}</th>
              <th scope="col" className="px-4 py-2 text-center font-medium">{t("saljiFirmi")}</th>
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
                <td className="px-4 py-2.5 text-center">
                  {/* Kad je globalno isključeno kontrola je disabled — a `title` na
                      disabled elementu Chrome ne prikazuje, pa razlog nosi hover
                      tooltip na OMOTAČU (omotač nije disabled, pa hover radi). */}
                  <span
                    className="group/tt relative inline-flex"
                    data-testid={`ksp-salji-omotac-${r.id}`}
                  >
                    <SaljiFirmiToggle
                      klijentId={r.id}
                      naziv={r.naziv}
                      salji={r.salji}
                      globalnoIskljuceno={!saljiGlobalno}
                    />
                    {!saljiGlobalno && <Tooltip>{t("saljiFirmiIskljuceno")}</Tooltip>}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {r.firmaPrima ? (
                    <span
                      data-testid={`ksp-prima-${r.id}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success"
                    >
                      <span className="size-1.5 rounded-full bg-success" aria-hidden />
                      {t("da")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span
                        data-testid={`ksp-prima-${r.id}`}
                        className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                      >
                        {t("ne")}
                      </span>
                      {r.razlog && (
                        <span data-testid={`ksp-razlog-${r.id}`} className="text-xs text-muted-foreground">
                          {t(RAZLOG_KEY[r.razlog])}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {/* Primaoci se ne uređuju odavde — biranje kontakt-osoba i ad-hoc adresa
                      traži kontekst (ime, funkcija, validacija), pa ćelija vodi na klijentov
                      tab gdje `PrimaociCombobox` već postoji.
                      ALI: dok je globalno slanje isključeno taj tab uopšte ne prikazuje
                      formu (samo poruku „prvo uključi u postavkama"), pa link tamo bi bio
                      ćorsokak — u tom stanju ćelija je običan tekst sa istim razlogom. */}
                  {saljiGlobalno ? (
                    <Link
                      href={href(`/klijenti/${r.id}?tab=podsjetnici`)}
                      title={t("uredi")}
                      data-testid={`ksp-adrese-link-${r.id}`}
                      className={cn(
                        "rounded-sm underline-offset-2 hover:underline",
                        r.adrese.length > 0 ? "text-muted-foreground" : "font-medium text-brand",
                        FOCUS_RING,
                      )}
                    >
                      {r.adrese.length > 0 ? r.adrese.join(", ") : t("uredi")}
                    </Link>
                  ) : (
                    <span className="group/tt relative inline-flex text-muted-foreground">
                      {r.adrese.length > 0 ? r.adrese.join(", ") : "—"}
                      <Tooltip>{t("saljiFirmiIskljuceno")}</Tooltip>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {redovi.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
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
