// Čista logika ekrana „Postavke → Ko šta prima". Bez React-a i bez Supabase-a, da
// precedencija razloga može imati testove i da JSX ne bude jedino mjesto gdje živi.

import {
  assembleRecipients,
  buildRecipientIndex,
  parseEmailList,
  EMAIL_RE,
  type KorisnikRow,
} from "@/lib/reminders/recipients"

/** Zašto firma NE prima — poredano po precedenciji (viši razlog nadjačava niže). */
export type RazlogNePrima = "automatika" | "globalno" | "firma" | "nemaAdrese"

export type UlazReda = {
  /** postavke.podsjetnici_aktivni — cron ruta na false ne pošalje NIŠTA (route.ts:47). */
  podsjetniciAktivni: boolean
  /** postavke.salji_klijentima — globalni prekidač firminog kanala. */
  saljiGlobalno: boolean
  /** klijenti.salji_podsjetnik_klijentu — per-firma flag. */
  saljiFirmi: boolean
  /** broj validnih adresa firme (flagovani kontakti + ad-hoc, dedupirano). */
  brojAdresa: number
}

export type IshodReda = { prima: boolean; razlog: RazlogNePrima | null }

/**
 * „Firma prima?" je izvedeno, nikad kontrola. `automatika` je najviši razlog jer
 * ugašena automatika zaustavlja i pre-due i post-due, bez obzira na ostalo.
 */
export function izracunajIshodReda(u: UlazReda): IshodReda {
  if (!u.podsjetniciAktivni) return { prima: false, razlog: "automatika" }
  if (!u.saljiGlobalno) return { prima: false, razlog: "globalno" }
  if (!u.saljiFirmi) return { prima: false, razlog: "firma" }
  if (u.brojAdresa <= 0) return { prima: false, razlog: "nemaAdrese" }
  return { prima: true, razlog: null }
}

/** „—" u koloni radnika ima dva različita značenja; ovo ih razdvaja. */
export type StatusRadnika = "ima" | "optOut" | "nemaDodijeljenih"

export function izracunajStatusRadnika(
  ukupnoDodijeljenih: number,
  brojPrimalaca: number,
): StatusRadnika {
  if (brojPrimalaca > 0) return "ima"
  return ukupnoDodijeljenih > 0 ? "optOut" : "nemaDodijeljenih"
}

/**
 * Primaoci koje NIJEDNA per-firma postavka ne mijenja: admini (aktivni i sa uključenim
 * podsjetnicima) + adrese iz env `REMINDER_TO`. Namjerno se koristi engine i za predikat
 * „ko je admin-primalac" (`buildRecipientIndex`) i za sastavljanje spiska (`assembleRecipients`),
 * da prikaz i stvarno slanje ne mogu razići ni u pravilu prihvatljivosti ni u redoslijedu
 * (base pa admini).
 */
export function stalniPrimaoci(
  korisnici: KorisnikRow[],
  reminderToRaw: string | null | undefined,
): string[] {
  const { adminEmails } = buildRecipientIndex(korisnici, [])
  return assembleRecipients({ base: parseEmailList(reminderToRaw), adminEmails })
}

export type LokacijaRef = { id: string; naziv: string }

export type UlazPokrivenosti = {
  /** Sve lokacije firme. */
  lokacije: LokacijaRef[]
  /** Broj validnih adresa koje pokrivaju CIJELU firmu (kontakti bez lokacija_id + ad-hoc). */
  brojAdresaFirme: number
  /** lokacija_id → broj validnih adresa vezanih baš za tu lokaciju. */
  adresePoLokaciji: ReadonlyMap<string, number>
  /** Ima li firma ijedan termin bez lokacije (lokacija_id IS NULL). */
  imaTerminaBezLokacije: boolean
}

export type IshodPokrivenosti = {
  /** Lokacije bez ijednog primaoca — isto ponašanje kao ranije. */
  lokacije: LokacijaRef[]
  /**
   * true kad firma ima termine bez lokacije, a nijednu adresu koja pokriva cijelu firmu —
   * podsjetnici za te termine tad ne stižu nikome (lokacijski kontakt ne može znati tiče
   * li ga se termin bez lokacije, isto pravilo kao u `firmaRecipientsZa`).
   */
  terminiBezLokacije: boolean
}

/**
 * Rupe u pokrivenosti koje red-po-firmi (`izracunajIshodReda`) ne vidi: red gleda samo
 * „ima li firma ijednu adresu", ovo je dodatno upozorenje kad ta adresa ipak ne pokriva
 * baš sve što firma ima — ili pojedinu lokaciju, ili termine koji nemaju lokaciju uopšte.
 * Namjerno se vraćaju oba nezavisno (nema sentinel `LokacijaRef` za drugi slučaj — to bi
 * procurilo u UI kao izmišljen naziv lokacije).
 */
export function nepokriveneLokacije(u: UlazPokrivenosti): IshodPokrivenosti {
  const lokacije =
    u.brojAdresaFirme > 0 ? [] : u.lokacije.filter((l) => (u.adresePoLokaciji.get(l.id) ?? 0) <= 0)
  const terminiBezLokacije = u.imaTerminaBezLokacije && u.brojAdresaFirme === 0
  return { lokacije, terminiBezLokacije }
}

export type KontaktZaGrupisanje = {
  klijent_id: string
  email: string | null
  podsjetnik_primalac: boolean | null
  lokacija_id: string | null
}

export type KlijentZaGrupisanje = {
  id: string
  podsjetnik_emails: string[] | null
}

export type AdreseFirme = {
  /** Sve validne adrese firme (firma-široke + lokacijske + ad-hoc) — za `brojAdresa`/prikaz. */
  sve: Set<string>
  /** Adrese koje pokrivaju CIJELU firmu (kontakt bez `lokacija_id` + ad-hoc). */
  firma: Set<string>
  /** `lokacija_id` → adrese vezane baš za tu lokaciju. */
  poLokaciji: Map<string, Set<string>>
}

/**
 * Razvrstava flagovane kontakte i ad-hoc adrese na firma-široke i lokacijske, po klijentu.
 *
 * Pravila MORAJU biti identična engine-u (`lib/reminders/recipients.ts`) — ovdje su se
 * prikaz i stvarno slanje prvi put razišli (prikaz je brojao lokacijski kontakt kao
 * firmin), pa je grupisanje izdvojeno u čistu, testiranu funkciju da se razilaženje
 * ne može ponoviti a da test ne padne:
 *  - `.trim().toLowerCase()` + `EMAIL_RE` (isto kao `recipients.ts` Krug 2)
 *  - dedup kroz `Set`
 *  - `lokacija_id ?? null`, NIKAD truthy provjera — usklađeno sa BUILD stranom engine-a
 *    (`buildRecipientIndex`/`dodajFirmin` na `recipients.ts:106`, isto `?? null`). Napomena:
 *    READ strana (`firmaRecipientsZa`, `recipients.ts:149`) truthy-testira TERMINOV
 *    `lokacijaId` parametar (ne kontaktov), pa kontakt sa `lokacija_id === ""` engine ionako
 *    nikad ne isporuči — praktično nedostižno jer je `lokacije.id` uuid FK, nikad prazan
 *    string, pa razlika ne mijenja stvarno ponašanje, samo je ovdje da tvrdnja ne overclaimuje
 *  - kontakt bez `podsjetnik_primalac` se ne broji
 *  - ad-hoc adrese (`klijenti.podsjetnik_emails`) pokrivaju cijelu firmu, nikad lokaciju
 */
export function grupisiAdrese(ulaz: {
  kontakti: ReadonlyArray<KontaktZaGrupisanje>
  klijenti: ReadonlyArray<KlijentZaGrupisanje>
}): Map<string, AdreseFirme> {
  const rezultat = new Map<string, AdreseFirme>()
  const zaKlijenta = (id: string): AdreseFirme => {
    let r = rezultat.get(id)
    if (!r) {
      r = { sve: new Set<string>(), firma: new Set<string>(), poLokaciji: new Map<string, Set<string>>() }
      rezultat.set(id, r)
    }
    return r
  }
  for (const ko of ulaz.kontakti) {
    if (!ko.podsjetnik_primalac) continue
    const email = (ko.email ?? "").trim().toLowerCase()
    if (!EMAIL_RE.test(email)) continue
    const r = zaKlijenta(ko.klijent_id)
    r.sve.add(email)
    const lokacijaId = ko.lokacija_id ?? null
    if (lokacijaId !== null) {
      const set = r.poLokaciji.get(lokacijaId) ?? new Set<string>()
      set.add(email)
      r.poLokaciji.set(lokacijaId, set)
    } else {
      r.firma.add(email)
    }
  }
  for (const k of ulaz.klijenti) {
    const r = zaKlijenta(k.id)
    for (const raw of k.podsjetnik_emails ?? []) {
      const email = (raw ?? "").trim().toLowerCase()
      if (!EMAIL_RE.test(email)) continue
      r.sve.add(email)
      r.firma.add(email)
    }
  }
  return rezultat
}

/**
 * Treba li red uopšte da dobije upozorenje o nepokrivenim lokacijama. Isti predikat kao
 * `brojAdresaKandidata` u ekranu (automatika se ignoriše — pin-ovano na `true`, jer
 * pojedinačne postavke važe i za „Pokreni sada"): dok viši razlog iz `izracunajIshodReda`
 * (globalni prekidač, firmin flag, „nema adrese") već objašnjava zašto firma ne prima,
 * upozorenje o rupi na nivou lokacije bi bio šum/duplikat, ne novi razlog. Zato tip
 * namjerno izostavlja `podsjetniciAktivni` — pozivalac ga ne može slučajno proslijediti.
 */
export function trebaUpozorenje(u: Omit<UlazReda, "podsjetniciAktivni">): boolean {
  return izracunajIshodReda({ ...u, podsjetniciAktivni: true }).prima
}

/**
 * Je li PostgREST rezultat odsječen implicitnim (~1000 redova) ili eksplicitnim
 * (`.range()`) limitom. `count` je `null` kad Supabase odgovor nema `{ count: "exact" }`
 * ili kad je red/tabela prazna (tretira se kao „nije odsječeno" — nema šta odsjeći).
 */
export function jeOdsjeceno(count: number | null | undefined, vraceno: number): boolean {
  return count != null && count > vraceno
}
