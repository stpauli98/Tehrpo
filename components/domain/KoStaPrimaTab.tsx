import Link from "next/link"
import { AlertTriangle, ArrowUp, Send } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { href } from "@/i18n/routes"
import { podsjetniciAktivni as citajPodsjetniciAktivni } from "@/lib/reminders/gating"
import {
  izracunajIshodReda,
  izracunajStatusRadnika,
  stalniPrimaoci,
  nepokriveneLokacije,
  grupisiAdrese,
  trebaUpozorenje,
  jeOdsjeceno,
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
  // PostgREST implicitno limitira na ~1000 redova (isti rizik kao u recipients.ts:192-193).
  // Tiha trunkacija bi ovdje bila GORA od kvara koji se popravlja: odsječeni `kontakt_osobe`
  // daju lažno pozitivno upozorenje (lokacija prijavljena kao bez primaoca iako ima kontakt),
  // odsječene `lokacije` ga sakriju, odsječeni `klijenti` skrate cijelu tabelu. Sve tri zato
  // nose `{ count: "exact" }` + eksplicitan `.range()` na istih 5000 redova, provjereno niže.
  const RASPON_GORNJA_GRANICA = 4999
  const [postRes, korisniciRes, klijentiRes, dodjeleRes, kontaktiRes, lokacijeRes, terminiBezLokacijeRes] =
    await Promise.all([
      supabase.from("postavke").select("salji_klijentima, podsjetnici_aktivni").eq("id", 1).maybeSingle(),
      // NAPOMENA (van obima ove izmjene, namjerno neriješeno): `korisnici` i `korisnik_klijent`
      // nemaju isti { count: "exact" } + .range() tretman. Preko ~1000 dodjela bi PostgREST
      // tiho odsjekao `korisnik_klijent`, kolona „Radnici" bi pogrešno prikazala „nema
      // dodijeljenih"/optOut, i BEZ ikakvog banera (podaciNepotpuni ovo ne provjerava). Ista
      // klasa kvara kao kontakt_osobe/klijenti/lokacije — zaseban posao.
      supabase.from("korisnici").select("id, ime, email, uloga, aktivan, prima_podsjetnike").order("ime"),
      supabase
        .from("klijenti")
        .select("id, naziv, salji_podsjetnik_klijentu, podsjetnik_emails", { count: "exact" })
        .order("naziv")
        .range(0, RASPON_GORNJA_GRANICA),
      supabase.from("korisnik_klijent").select("korisnik_id, klijent_id"),
      supabase
        .from("kontakt_osobe")
        .select("klijent_id, email, podsjetnik_primalac, lokacija_id", { count: "exact" })
        .order("klijent_id")
        .range(0, RASPON_GORNJA_GRANICA),
      supabase
        .from("lokacije")
        .select("id, naziv, klijent_id", { count: "exact" })
        .order("naziv")
        .range(0, RASPON_GORNJA_GRANICA),
      // Koje firme imaju bar jedan termin bez lokacije — treba i njemu { count: "exact" } +
      // .range() (isti tretman kao klijenti/kontakt_osobe/lokacije): tiho odsijecanje ovdje
      // bi dalo lažno negativno (firma bi izgledala pokriveno iako joj fali baš ta adresa).
      supabase
        .from("termini")
        .select("klijent_id", { count: "exact" })
        .is("lokacija_id", null)
        .order("klijent_id")
        .range(0, RASPON_GORNJA_GRANICA),
    ])
  // Vidljiva napomena, ne samo log: recenzija je pokazala da je ekran sa odsječenim
  // podacima bajt-identičan ekranu koji je stvarno pokriven — `console.warn` ide u
  // Vercel logove koje korisnik nikad ne vidi.
  const podaciNepotpuni =
    jeOdsjeceno(klijentiRes.count, klijentiRes.data?.length ?? 0) ||
    jeOdsjeceno(kontaktiRes.count, kontaktiRes.data?.length ?? 0) ||
    jeOdsjeceno(lokacijeRes.count, lokacijeRes.data?.length ?? 0) ||
    jeOdsjeceno(terminiBezLokacijeRes.count, terminiBezLokacijeRes.data?.length ?? 0)
  if (podaciNepotpuni) {
    console.warn(
      `[ko-sta-prima] podaci odsječeni na ${RASPON_GORNJA_GRANICA + 1} redova ` +
        `(klijenti ${klijentiRes.data?.length ?? 0}/${klijentiRes.count ?? "?"}, ` +
        `kontakt_osobe ${kontaktiRes.data?.length ?? 0}/${kontaktiRes.count ?? "?"}, ` +
        `lokacije ${lokacijeRes.data?.length ?? 0}/${lokacijeRes.count ?? "?"}, ` +
        `termini_bez_lokacije ${terminiBezLokacijeRes.data?.length ?? 0}/${terminiBezLokacijeRes.count ?? "?"}) — tabela i upozorenja o pokrivenosti mogu biti nepotpuni`,
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
  // klijent_id → { sve, firma, poLokaciji } — grupisanje je čista, testirana funkcija
  // (`grupisiAdrese`) baš zato što je ovo mjesto gdje su se prikaz i engine prvi put razišli.
  const grupisano = grupisiAdrese({
    kontakti: kontaktiRes.data ?? [],
    klijenti: klijentiRes.data ?? [],
  })
  // klijent_id → lokacije te firme (za upozorenje o nepokrivenim lokacijama).
  const lokacijeByKlijent = new Map<string, LokacijaRef[]>()
  for (const lok of lokacijeRes.data ?? []) {
    const arr = lokacijeByKlijent.get(lok.klijent_id) ?? []
    arr.push({ id: lok.id, naziv: lok.naziv })
    lokacijeByKlijent.set(lok.klijent_id, arr)
  }
  // klijent_id-jevi firmi koje imaju bar jedan termin bez lokacije (lokacija_id IS NULL).
  const klijentiSaTerminimaBezLokacije = new Set((terminiBezLokacijeRes.data ?? []).map((t) => t.klijent_id))
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
    const grupa = grupisano.get(k.id)
    const adrese = [...(grupa?.sve ?? [])]
    const { prima: firmaPrima, razlog } = izracunajIshodReda({
      podsjetniciAktivni: automatikaAktivna,
      saljiGlobalno,
      saljiFirmi: k.salji_podsjetnik_klijentu ?? false,
      brojAdresa: adrese.length,
    })
    // `trebaUpozorenje` nosi isti predikat kao `brojAdresaKandidata` (automatika ignorisana):
    // precedencija razloga iz izracunajIshodReda mora nadjačati upozorenje — dok globalni
    // prekidač ili firmin flag već kažu „ne prima", rupa po lokaciji (ili po terminima bez
    // lokacije) je šum, ne novi razlog.
    const { lokacije: nepokrivene, terminiBezLokacije } = trebaUpozorenje({
      saljiGlobalno,
      saljiFirmi: k.salji_podsjetnik_klijentu ?? false,
      brojAdresa: adrese.length,
    })
      ? nepokriveneLokacije({
          lokacije: lokacijeByKlijent.get(k.id) ?? [],
          brojAdresaFirme: grupa?.firma.size ?? 0,
          adresePoLokaciji: new Map(
            [...(grupa?.poLokaciji ?? new Map<string, Set<string>>())].map(([id, set]) => [id, set.size]),
          ),
          imaTerminaBezLokacije: klijentiSaTerminimaBezLokacije.has(k.id),
        })
      : { lokacije: [], terminiBezLokacije: false }
    return {
      id: k.id,
      naziv: k.naziv,
      radnici,
      statusRadnika,
      adrese,
      firmaPrima,
      razlog,
      nepokrivene,
      terminiBezLokacije,
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
      {podaciNepotpuni && (
        <div
          data-testid="ksp-nepotpuni-banner"
          className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden />
          <span>{t("nepotpuniPodaciBanner")}</span>
        </div>
      )}

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
                  {(r.nepokrivene.length > 0 || r.terminiBezLokacije) && (
                    <div
                      data-testid={`ksp-nepokrivene-${r.id}`}
                      className="mt-0.5 flex items-center gap-1 text-xs font-normal text-warning"
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      <span>
                        {r.nepokrivene.length > 0 &&
                          t("nepokriveneLokacije", {
                            // `naziv` je NOT NULL bez check constrainta — prazan string prolazi
                            // u bazu, pa fallback na id spriječava „, Lokacija B" bez prvog imena.
                            lokacije: r.nepokrivene.map((l) => l.naziv || l.id).join(", "),
                          })}
                        {r.nepokrivene.length > 0 && r.terminiBezLokacije && " "}
                        {r.terminiBezLokacije && t("terminiBezLokacijeNepokriveni")}
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
