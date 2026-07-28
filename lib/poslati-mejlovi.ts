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
 * Granice sarajevskog dana za `od`/`do` filtere (S7) NISU ovdje — isporučio ih je
 * Talas 0 u `lib/date.ts` (`utcGranicaSarajevskogDana`, `dodajDan`); `page.tsx` ih
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
}

/**
 * Type-guard za datumske URL parametre (`od`/`do`) prije slanja u
 * `utcGranicaSarajevskogDana`: helper na nevaljanom ulazu baca `RangeError`
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
export function jeGreska(r: Pick<MejlRed, "status" | "delivery_status">): boolean {
  return (
    r.status === "greska_slanja" ||
    r.delivery_status === "bounced" ||
    r.delivery_status === "complained" ||
    r.delivery_status === "delivery_failed"
  )
}
