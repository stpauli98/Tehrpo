/**
 * Čista logika taba "Poslati mejlovi": mape enum → i18n ključ / Badge varijanta,
 * tip reda tabele i `jeGreska`.
 *
 * Zašto zaseban lib fajl: klijentska filter-forma (`PoslatiMejloviFilteri`) i
 * klijentsko dugme (`OznaciPregledanimButton`) trebaju iste mape kao serverska
 * tabela. Import iz `PoslatiMejloviTabela.tsx` bi u klijentski bundle povukao
 * `next-intl/server` i server akciju, pa mape žive ovdje — bez ijedne zavisnosti
 * osim generisanih tipova.
 *
 * Granice dana (APP_TIME_ZONE, Europe/Belgrade) za `od`/`do` filtere (S7) NISU ovdje — isporučio ih je
 * Talas 0 u `lib/date.ts` (`utcGranicaDana`, `dodajDan`); `page.tsx` ih
 * konzumira odatle.
 */

import type { Database } from "@/db/types"

type MejlTip = Database["public"]["Enums"]["mejl_tip"]
type MejlStatus = Database["public"]["Enums"]["mejl_status"]
type MejlDostava = Database["public"]["Enums"]["mejl_dostava_status"]

export const TIP_KEY = {
  podsjetnik_interni: "podsjetnikInterni",
  podsjetnik_firma: "podsjetnikFirma",
  podsjetnik_rok_istekao_interni: "podsjetnikRokIstekaoInterni",
  podsjetnik_rok_istekao_firma: "podsjetnikRokIstekaoFirma",
  podsjetnik_digest: "podsjetnikDigest",
  zakazano_nakon_roka: "zakazanoNakonRoka",
  test: "test",
} as const satisfies Record<MejlTip, string>

export const STATUS_KEY = {
  poslato: "poslato",
  greska_slanja: "greskaSlanja",
  // Demo režim: mejl je sastavljen do kraja ali namjerno nije poslat. NIJE greška —
  // `jeGreska` ga zato ne hvata, pa red nema crvenu pozadinu ni „Označi pregledanim".
  demo: "demo",
} as const satisfies Record<MejlStatus, string>

export const DOSTAVA_KEY = {
  nepoznato: "nepoznato",
  delivered: "delivered",
  opened: "opened",
  delivery_failed: "deliveryFailed",
  bounced: "bounced",
  complained: "complained",
} as const satisfies Record<MejlDostava, string>

export const DOSTAVA_VARIJANTA = {
  nepoznato: "secondary",
  delivered: "default",
  opened: "default",
  delivery_failed: "destructive",
  bounced: "destructive",
  complained: "destructive",
} as const satisfies Record<MejlDostava, "secondary" | "default" | "destructive">

/**
 * Podskup kolona RPC-a `get_poslati_mejlovi` koje tabela zapravo prikazuje.
 * Generisani tip vraća sve kolone kao non-null (limitacija codegen-a), ali stvarne
 * vrijednosti mogu biti null (npr. interni podsjetnik nema klijent_naziv) — otud
 * klijent_naziv/greska/klijent_id ovdje eksplicitno dozvoljavaju null, a render
 * koristi ?? "—". `klijent_id` nosi O4 gate za "Označi pregledanim".
 */
export type MejlRed = {
  id: string
  created_at: string
  tip: MejlTip
  primaoci: string[] | null
  subject: string
  klijent_id: string | null
  klijent_naziv: string | null
  status: MejlStatus
  greska: string | null
  delivery_status: MejlDostava
  /** Adrese koje je neuspjeh stvarno pogodio (Resend `data.to`). Prazno = nemamo podatak. */
  dostava_pogodjeni: string[] | null
}

/**
 * Type-guard za datumske URL parametre (`od`/`do`) prije slanja u
 * `utcGranicaDana`: helper na nevaljanom ulazu baca `RangeError`
 * (Intl nad Invalid Date), što bi cijelu rutu srušilo u `error.tsx` umjesto da
 * greška ostane u stranici (S1). Traži strogi `yyyy-MM-dd` i odbacuje nepostojeće
 * datume ("2026-13-45" bi se inače tiho prelio u februar 2027).
 */
export function jeIsoDatum(v: string | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  // Round-trip: `Date.UTC` prelijeva prekoračenje (31.02. → 03.03.), pa se
  // vrijednost prihvata samo ako se vrati identična. `Date.parse` ovo NE hvata:
  // ISO gramatika dozvoljava DD do 31 u svakom mjesecu.
  const [g, m, d] = v.split("-").map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(g, m - 1, d))
  return dt.getUTCFullYear() === g && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Red je "neriješena greška" ako je slanje palo ILI je dostava neuspjela. */
/**
 * Demo red: mejl je sastavljen do kraja ali NAMJERNO nije poslat.
 *
 * Zašto zasebna funkcija a ne inline provjera: prikaz se razlikuje na dva mjesta
 * (bedž statusa i kolona dostave), pa uslov ima jedno ime i jedno mjesto za izmjenu.
 */
export function jeDemo(r: Pick<MejlRed, "status">): boolean {
  return r.status === "demo"
}

export function jeGreska(r: Pick<MejlRed, "status" | "delivery_status">): boolean {
  return (
    r.status === "greska_slanja" ||
    r.delivery_status === "bounced" ||
    r.delivery_status === "complained" ||
    r.delivery_status === "delivery_failed"
  )
}

/**
 * Koliko je široko neuspjeh pogodio jedan red.
 *
 * Zašto postoji: jedan red u `mejl_log` je JEDAN Resend send (jedan `email_id`) sa više
 * primalaca, a Resend za taj send šalje jedan `email.bounced` event. Do sada je taj jedan
 * event cijeli red bojio u „Odbijeno" — pa je red za mejl koji je stigao dvojici od tri
 * primaoca izgledao kao da nije stigao nikome (PROD, 30.07.2026: kriva je bila jedina
 * `.local` adresa u nizu).
 *
 * Event u `data.to` nosi POGOĐENE adrese; presijecamo ih sa `primaoci` da se razlikuje
 * djelimičan od potpunog neuspjeha. Namjerno konzervativno — sve što nije dokazano
 * djelimično vodi se kao potpuno:
 *   • prazno/`null` `dostava_pogodjeni` (redovi upisani prije ove kolone),
 *   • adresa koja nije među primaocima (ne znamo šta znači → ne izmišljamo),
 *   • pogođeni == svi primaoci.
 * Tako izmjena nikad ne umanji stvarni problem, samo ga precizira kad ima čime.
 *
 * NAPOMENA o brojaču grešaka: djelimičan bounce OSTAJE greška (`jeGreska` se ne mijenja).
 * Adresa koja tiho ispadne iz podsjetnika je upravo ono što ovaj sistem treba da uhvati —
 * pogrešna je bila samo etiketa, ne i to što red traži pažnju.
 */
export type DostavaObim =
  | { vrsta: "nije_greska" }
  | { vrsta: "potpuna" }
  | { vrsta: "djelimicna"; pogodjeni: string[]; pogodjenih: number; ukupno: number }

export function dostavaObim(
  r: Pick<MejlRed, "delivery_status"> & {
    status?: MejlRed["status"]
    primaoci: string[] | null
    dostava_pogodjeni: string[] | null
  },
): DostavaObim {
  const neuspjeh =
    r.status === "greska_slanja" ||
    r.delivery_status === "bounced" ||
    r.delivery_status === "complained" ||
    r.delivery_status === "delivery_failed"
  if (!neuspjeh) return { vrsta: "nije_greska" }

  const norm = (s: string) => s.trim().toLowerCase()
  const svi = new Set((r.primaoci ?? []).map(norm))
  const ukupno = svi.size
  const pogodjeni = [...new Set((r.dostava_pogodjeni ?? []).map(norm))].filter((e) => svi.has(e))

  if (pogodjeni.length === 0 || pogodjeni.length >= ukupno) return { vrsta: "potpuna" }
  return { vrsta: "djelimicna", pogodjeni, pogodjenih: pogodjeni.length, ukupno }
}
