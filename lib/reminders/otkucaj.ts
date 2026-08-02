/**
 * O1 — „srce" cron poslova: dokaz da je posao POKRENUT.
 *
 * ZAŠTO POSTOJI
 * Sve što sistem ostavlja iza sebe je POSLJEDICA slanja (`podsjetnici`, `post_due_obavijesti`,
 * `mejl_log`, `postavke.zadnje_slanje_datum`). Na dan kad nema šta da se pošalje — a takvih
 * dana je većina — mrtav cron i miran dan izgledaju IDENTIČNO. Zato je pre-due motor mogao
 * stajati 9 dana a da to niko ne primijeti. Otkucaj se upisuje na kraju SVAKOG poziva, i kad
 * nije poslato ništa, pa odsustvo svježeg otkucaja postaje samo po sebi dokaz kvara.
 *
 * Signal koji ovo NE pokriva je HTTP status (B3): status vidi samo krugove u kojima je cron
 * zaista pozvan. Ova dva se dopunjuju i namjerno su nezavisna.
 *
 * NIKAD NE BACA i nikad ne mijenja odgovor rute. Nadzor koji obori posao koji nadzire je
 * gori od nikakvog nadzora: podsjetnik o zakonskom roku ne smije pasti zato što upis
 * telemetrije nije prošao. Neuspjeh se vidi u logu i — što je važnije — kao ustajao otkucaj
 * u `zdravlje_sistema()`.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"

/** Ključ reda u `cron_otkucaji`. Mora se poklapati sa `zdravlje_sistema()` (posao 'podsjetnici'). */
export type CronPosao = "podsjetnici" | "ciscenje-audita" | "ciscenje-storagea"

/**
 * `preskoceno` JESTE uspjeh: posao je pozvan i odlučio da nema šta da radi (već slato danas,
 * izvan izabranog sata, prekidač isključen). Razlikuje se od `ok` samo zato da se u nadzoru
 * vidi ŠTA se desilo — obje vrijednosti pomjeraju `zadnji_uspjeh`.
 */
export type CronIshod = "ok" | "preskoceno" | "greska"

/**
 * db/types.ts se generiše IZ baze i još ne zna za `zabiljezi_cron_otkucaj` (funkcija dolazi
 * migracijom 20260802160000 uz ovaj deploy). Umjesto `any` — uska, eksplicitno otkucana
 * tačka poziva; kad se tipovi regenerišu, kast se briše bez ijedne druge izmjene.
 */
type OtkucajKlijent = {
  rpc: (
    fn: "zabiljezi_cron_otkucaj",
    args: { p_posao: string; p_ishod: string; p_detalji: unknown; p_greska: string | null },
  ) => PromiseLike<{ error: { message: string } | null }>
}

export async function zabiljeziOtkucaj(
  supabase: SupabaseClient<Database>,
  posao: CronPosao,
  ishod: CronIshod,
  detalji: Record<string, unknown> = {},
  greska: string | null = null,
): Promise<void> {
  try {
    const { error } = await (supabase as unknown as OtkucajKlijent).rpc("zabiljezi_cron_otkucaj", {
      p_posao: posao,
      p_ishod: ishod,
      p_detalji: detalji,
      // Poruka greške ide u bazu i vidi je administrator u ekranu zdravlja — skraćuje je
      // i sama funkcija (2000 znakova), ovdje je samo normalizacija praznog stringa.
      p_greska: greska && greska.length > 0 ? greska : null,
    })
    if (error) console.error(`[otkucaj] upis nije uspio (${posao}/${ishod}):`, error.message)
  } catch (e) {
    console.error(`[otkucaj] upis bacio (${posao}/${ishod}):`, e instanceof Error ? e.message : String(e))
  }
}

/**
 * Ishod cron poziva izveden iz odgovora koji ruta ionako vraća — bez diranja ijedne
 * `return` grane u samoj ruti.
 *
 * Pravila:
 *  • HTTP ≥ 500 ili `ok: false` u tijelu → `greska` (ruta je već presudila; B3 vraća 500 kad
 *    udio grešaka slanja pređe prag).
 *  • `skipped` u tijelu → `preskoceno` (prekidač, izvan sata, već slato danas).
 *  • sve ostalo → `ok`.
 *
 * 401 se NE bilježi i to je namjerno: neautorizovan poziv nije naš cron, a kad bi upisivao
 * otkucaj, bilo ko sa URL-om bi mogao lažirati „sistem radi" i ugasiti alarm.
 */
export function ishodIzOdgovora(
  status: number,
  tijelo: { ok?: boolean; skipped?: string; error?: string } | null,
): CronIshod {
  if (status >= 500 || tijelo?.ok === false || typeof tijelo?.error === "string") return "greska"
  if (typeof tijelo?.skipped === "string") return "preskoceno"
  return "ok"
}
