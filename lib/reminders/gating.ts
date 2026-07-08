// Da li je automatsko (cron) slanje podsjetnika uključeno za ovu instancu.
// Nedostajući red/kolona = uključeno: sigurnosna tolerancija za trenutak
// između deploy-a koda i primjene migracije (spec §Ponašanje).
export function podsjetniciAktivni(
  row: { podsjetnici_aktivni: boolean } | null | undefined,
): boolean {
  return row?.podsjetnici_aktivni ?? true
}

/**
 * Lokalni sat (0–23) i ISO datum (YYYY-MM-DD) za dati trenutak u datoj zoni.
 * `now` i `timeZone` se ubacuju (bez Date.now()) → čisto i testabilno.
 */
export function lokalniSatIDatum(
  now: Date,
  timeZone = "Europe/Vienna",
): { sat: number; datum: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(now)
  const get = (t: string) => parts.find((x) => x.type === t)!.value
  const sat = Number(get("hour")) % 24 // 24 → 0 (ponoć u nekim okruženjima)
  return { sat, datum: `${get("year")}-${get("month")}-${get("day")}` }
}

/**
 * Treba li automatski (cron) run slati SADA: lokalni sat je dostigao izabrani
 * i danas (po lokalnom datumu) još nije slato.
 */
export function trebaSlatiSada(
  vrijemeSat: number,
  zadnjeSlanjeDatum: string | null,
  now: Date,
  timeZone = "Europe/Vienna",
): boolean {
  const { sat, datum } = lokalniSatIDatum(now, timeZone)
  return sat >= vrijemeSat && zadnjeSlanjeDatum !== datum
}
