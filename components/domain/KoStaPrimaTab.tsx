import Link from "next/link"
import { AlertTriangle, ArrowUp, Send } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { href } from "@/i18n/routes"
import { podsjetniciAktivni as citajPodsjetniciAktivni } from "@/lib/reminders/gating"
import { EMAIL_RE } from "@/lib/reminders/recipients"
import {
  izracunajIshodReda,
  izracunajStatusRadnika,
  stalniPrimaoci,
  nepokriveneLokacije,
  type RazlogNePrima,
  type LokacijaRef,
} from "@/lib/podsjetnici/koStaPrima"
import { env } from "@/lib/env"
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
  const [postRes, korisniciRes, klijentiRes, dodjeleRes, kontaktiRes, lokacijeRes] = await Promise.all([
    supabase.from("postavke").select("salji_klijentima, podsjetnici_aktivni").eq("id", 1).maybeSingle(),
    supabase.from("korisnici").select("id, ime, email, uloga, aktivan, prima_podsjetnike").order("ime"),
    supabase.from("klijenti").select("id, naziv, salji_podsjetnik_klijentu, podsjetnik_emails").order("naziv"),
    supabase.from("korisnik_klijent").select("korisnik_id, klijent_id"),
    supabase.from("kontakt_osobe").select("klijent_id, email, podsjetnik_primalac, lokacija_id"),
    // PostgREST implicitno limitira na ~1000 redova (isti rizik kao u recipients.ts:192-193):
    // eksplicitan range + count, da tiha trunkacija ne izbriše lokacije iz upozorenja i ne
    // prijavi „sve pokriveno" za firmu koja to nije.
    supabase.from("lokacije").select("id, naziv, klijent_id", { count: "exact" }).order("naziv").range(0, 4999),
  ])
  if (lokacijeRes.count != null && lokacijeRes.count > (lokacijeRes.data?.length ?? 0)) {
    console.warn(
      `[ko-sta-prima] lokacije odsječene na ${lokacijeRes.data?.length ?? 0}/${lokacijeRes.count} — upozorenje o nepokrivenim lokacijama može biti nepotpuno`,
    )
  }
  const saljiGlobalno = postRes.data?.salji_klijentima ?? false
  // Fallback „nema reda/kolone = uključeno" je isti onaj kojim se vodi cron ruta.
  const automatikaAktivna = citajPodsjetniciAktivni(postRes.data)
  const korisnici = korisniciRes.data ?? []
  const dodjele = dodjeleRes.data ?? []
  // KorisnikRow očekuje email: string — red bez mejla ne može biti primalac, pa ispada.
  const stalni = stalniPrimaoci(
    korisnici
      .filter((k) => !!k.email)
      .map((k) => ({
        id: k.id, email: k.email!, uloga: k.uloga, aktivan: k.aktivan, prima_podsjetnike: k.prima_podsjetnike,
      })),
    env.REMINDER_TO,
  )
  // klijent_id → validne adrese flagovanih kontakata (lowercase + dedup, uskladeno s engine slanjem)
  const adreseByKlijent = new Map<string, Set<string>>()
  // klijent_id → adrese koje pokrivaju CIJELU firmu (kontakt bez lokacija_id + ad-hoc).
  const firmaAdreseByKlijent = new Map<string, Set<string>>()
  // klijent_id → lokacija_id → adrese vezane baš za tu lokaciju.
  const lokacijaAdreseByKlijent = new Map<string, Map<string, Set<string>>>()
  for (const ko of kontaktiRes.data ?? []) {
    if (!ko.podsjetnik_primalac) continue
    const email = (ko.email ?? "").trim().toLowerCase()
    if (!EMAIL_RE.test(email)) continue
    const set = adreseByKlijent.get(ko.klijent_id) ?? new Set<string>()
    set.add(email)
    adreseByKlijent.set(ko.klijent_id, set)
    // `?? null` a ne truthy provjera: usklađeno s engine-om (recipients.ts:106), da se prikaz
    // i stvarno slanje ne razmimoiđu za rubne vrijednosti (npr. prazan string).
    const lokacijaId = ko.lokacija_id ?? null
    if (lokacijaId !== null) {
      const poLok = lokacijaAdreseByKlijent.get(ko.klijent_id) ?? new Map<string, Set<string>>()
      const lokSet = poLok.get(lokacijaId) ?? new Set<string>()
      lokSet.add(email)
      poLok.set(lokacijaId, lokSet)
      lokacijaAdreseByKlijent.set(ko.klijent_id, poLok)
    } else {
      const firmaSet = firmaAdreseByKlijent.get(ko.klijent_id) ?? new Set<string>()
      firmaSet.add(email)
      firmaAdreseByKlijent.set(ko.klijent_id, firmaSet)
    }
  }
  // Ad-hoc „čiste" adrese (nisu kontakti) — pokrivaju cijelu firmu; u oba Seta
  // (dedup s kontakt-adresama je automatski).
  for (const k of klijentiRes.data ?? []) {
    const set = adreseByKlijent.get(k.id) ?? new Set<string>()
    const firmaSet = firmaAdreseByKlijent.get(k.id) ?? new Set<string>()
    for (const raw of k.podsjetnik_emails ?? []) {
      const email = (raw ?? "").trim().toLowerCase()
      if (!EMAIL_RE.test(email)) continue
      set.add(email)
      firmaSet.add(email)
    }
    if (set.size > 0) adreseByKlijent.set(k.id, set)
    if (firmaSet.size > 0) firmaAdreseByKlijent.set(k.id, firmaSet)
  }
  // klijent_id → lokacije te firme (za upozorenje o nepokrivenim lokacijama).
  const lokacijeByKlijent = new Map<string, LokacijaRef[]>()
  for (const lok of lokacijeRes.data ?? []) {
    const arr = lokacijeByKlijent.get(lok.klijent_id) ?? []
    arr.push({ id: lok.id, naziv: lok.naziv })
    lokacijeByKlijent.set(lok.klijent_id, arr)
  }
  const imeZa = (id: string) => korisnici.find((k) => k.id === id)?.ime ?? "—"
  const primaZa = (id: string) => {
    const k = korisnici.find((k) => k.id === id)
    return k ? k.aktivan && k.prima_podsjetnike : false
  }

  const redovi = (klijentiRes.data ?? []).map((k) => {
    const dodijeljeniSvi = dodjele.filter((d) => d.klijent_id === k.id)
    const radnici = dodijeljeniSvi
      .map((d) => d.korisnik_id)
      .filter((uid) => primaZa(uid))
      .map((uid) => imeZa(uid))
    const statusRadnika = izracunajStatusRadnika(dodijeljeniSvi.length, radnici.length)
    const adrese = [...(adreseByKlijent.get(k.id) ?? [])]
    const { prima: firmaPrima, razlog } = izracunajIshodReda({
      podsjetniciAktivni: automatikaAktivna,
      saljiGlobalno,
      saljiFirmi: k.salji_podsjetnik_klijentu ?? false,
      brojAdresa: adrese.length,
    })
    // Isti predikat kao `brojAdresaKandidata` (automatika:true) — precedencija razloga iz
    // izracunajIshodReda mora nadjačati upozorenje: dok globalni prekidač ili firmin flag već
    // kažu „ne prima", rupa po lokaciji je šum, ne novi razlog. Bez ovog gejta bi npr. globalno
    // isključena firma dobila i „Ne — globalni prekidač isključen" i „Bez primaoca za lokacije".
    const biPrimila = izracunajIshodReda({
      podsjetniciAktivni: true,
      saljiGlobalno,
      saljiFirmi: k.salji_podsjetnik_klijentu ?? false,
      brojAdresa: adrese.length,
    }).prima
    const lokacijePoKlijentu = lokacijaAdreseByKlijent.get(k.id) ?? new Map<string, Set<string>>()
    const adresePoLokaciji = new Map<string, number>()
    for (const [lokacijaId, set] of lokacijePoKlijentu) {
      adresePoLokaciji.set(lokacijaId, set.size)
    }
    const nepokrivene = biPrimila
      ? nepokriveneLokacije({
          lokacije: lokacijeByKlijent.get(k.id) ?? [],
          brojAdresaFirme: firmaAdreseByKlijent.get(k.id)?.size ?? 0,
          adresePoLokaciji,
        })
      : []
    return {
      id: k.id,
      naziv: k.naziv,
      radnici,
      statusRadnika,
      adrese,
      firmaPrima,
      razlog,
      nepokrivene,
      // Sirovi flag — ulazi u toggle. Razlikuje se od `firmaPrima` (izvedeno).
      salji: k.salji_podsjetnik_klijentu ?? false,
    }
  })

  const brojPrima = redovi.filter((r) => r.firmaPrima).length
  // „Koliko bi primilo da automatika radi" — ista funkcija kao r.firmaPrima, samo sa
  // podsjetniciAktivni:true, da ne postoji druga (netestirana) kopija istog pravila.
  const brojAdresaKandidata = redovi.filter(
    (r) =>
      izracunajIshodReda({
        podsjetniciAktivni: true,
        saljiGlobalno,
        saljiFirmi: r.salji,
        brojAdresa: r.adrese.length,
      }).prima,
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

      <div className="mb-2 flex items-start justify-between gap-4">
        <span className="text-xs text-muted-foreground" data-testid="ksp-uvijek-primaju">
          {stalni.length > 0 ? t("uvijekPrimaju", { adrese: stalni.join(", ") }) : t("uvijekPrimajuPrazno")}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground" data-testid="ksp-sazetak">
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
                <td className="px-4 py-2.5 font-medium">
                  {r.naziv}
                  {r.nepokrivene.length > 0 && (
                    <div
                      data-testid={`ksp-nepokrivene-${r.id}`}
                      className="mt-0.5 flex items-center gap-1 text-xs font-normal text-warning"
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      <span>
                        {t("nepokriveneLokacije", {
                          // `naziv` je NOT NULL bez check constrainta — prazan string prolazi
                          // u bazu, pa fallback na id spriječava „, Lokacija B" bez prvog imena.
                          lokacije: r.nepokrivene.map((l) => l.naziv || l.id).join(", "),
                        })}
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {r.statusRadnika === "ima" ? (
                    r.radnici.join(", ")
                  ) : (
                    <span className="text-muted-foreground" data-testid={`ksp-radnici-razlog-${r.id}`}>
                      {r.statusRadnika === "optOut" ? t("radniciOptOut") : t("radniciNema")}
                    </span>
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
                    {!saljiGlobalno && (
                      <Tooltip className="max-w-xs whitespace-normal text-left">
                        {t("saljiFirmiIskljuceno")}
                      </Tooltip>
                    )}
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
                      <Tooltip className="max-w-xs whitespace-normal text-left">
                        {t("saljiFirmiIskljuceno")}
                      </Tooltip>
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
