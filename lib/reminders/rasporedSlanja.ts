/**
 * Veza između cron rasporeda i podešavanja „Vrijeme slanja".
 *
 * Raspored je u vercel.json: "0 9 * * *" i "0 13 * * *" (UTC), dakle po Beču
 * 10:00 i 14:00 zimi (CET), 11:00 i 15:00 ljeti (CEST). Gate u cron ruti je
 * `sat >= vrijeme_slanja_sat`, pa je najkasnija vrijednost koja radi CIJELE
 * godine jednaka najranijem popodnevnom cron satu — 14.
 *
 * Sve iznad toga tiho ne šalje ništa: ruta uredno vrati `izvan_sata` i 200.
 * Zato forma nudi samo dvije opcije, a baza ima `check` na ovaj opseg.
 *
 * Vercel raspored se ne može pročitati u runtime-u, pa je ova veza konvencija
 * koju čuva `rasporedSlanja.test.ts` — ako se cron promijeni a konstante ne,
 * ti testovi pucaju.
 */

/** Najkasniji sat koji cron raspored pouzdano dostiže u obje sezone. */
export const NAJKASNIJI_DOSTIZAN_SAT = 14

/** Prolazi na prvom dnevnom runu (10:00 zimi, 11:00 ljeti). */
export const SAT_UJUTRO = 8

/** Preskače prvi run, prolazi na drugom (14:00 zimi, 15:00 ljeti). */
export const SAT_POSLIJEPODNE = 13

export type TerminSlanja = "ujutro" | "poslijepodne"

/**
 * Najveći sat koji se još smatra jutarnjim. 11 je sat prvog LJETNOG run-a:
 * vrijednost 12 je najmanja koja ga pouzdano preskače u obje sezone.
 */
const GORNJA_GRANICA_JUTRA = 11

/** U koju opciju spada zatečena brojčana vrijednost iz baze. */
export function terminIzSata(sat: number): TerminSlanja {
  return sat <= GORNJA_GRANICA_JUTRA ? "ujutro" : "poslijepodne"
}

/** Koja se brojčana vrijednost upisuje za izabranu opciju. */
export function satIzTermina(termin: TerminSlanja): number {
  return termin === "ujutro" ? SAT_UJUTRO : SAT_POSLIJEPODNE
}
