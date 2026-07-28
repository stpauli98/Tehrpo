// JEDAN parser filtera za Aktivnost — koriste ga i server komponenta i API ruta.
// CLAUDE.md već navodi drift između te dvije putanje kao problem kod plan-aktivnosti
// ("route's filter logic deliberately mirrors the server-component query"); ovdje
// se on izbjegava time što izvor postoji samo na jednom mjestu.
import { dodajDan, utcGranicaSarajevskogDana } from "@/lib/date"
import { parsirajKursor, type AktivnostKursor } from "./kursor"

export type AktivnostFilteriUlaz = {
  od?: string
  do?: string
  korisnik?: string
  akcija?: string
  pretraga?: string
  kursor: AktivnostKursor | null
}

// utcGranicaSarajevskogDana baca RangeError na neispravnom datumu, pa se sanitacija
// radi PRIJE poziva: ručno pokvaren URL (?od=xyz) ignoriše filter umjesto da sruši stranicu.
const isoDatum = (v: string | undefined) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined

export function parsirajAktivnostFiltere(
  uzmi: (k: string) => string | undefined,
): AktivnostFilteriUlaz {
  const od = isoDatum(uzmi("od"))
  const doDatum = isoDatum(uzmi("do"))
  const f: AktivnostFilteriUlaz = {
    kursor: parsirajKursor(uzmi("prijeVrijeme"), uzmi("prijeId")),
  }
  if (od) f.od = utcGranicaSarajevskogDana(od)
  // `do` je ekskluzivna granica SLJEDEĆEG dana (RPC poredi vrijeme < p_do),
  // pa zadnja sekunda odabranog dana ne ispada.
  if (doDatum) f.do = utcGranicaSarajevskogDana(dodajDan(doDatum))
  const akcija = uzmi("akcija")
  if (akcija) f.akcija = akcija
  const korisnik = uzmi("korisnik")
  if (korisnik) f.korisnik = korisnik
  const q = uzmi("q")?.trim()
  if (q) f.pretraga = q
  return f
}

/** Stabilan ključ filtera bez kursora — React `key` koji resetuje listu na promjenu filtera. */
export function kljucFiltera(f: AktivnostFilteriUlaz): string {
  return [f.od ?? "", f.do ?? "", f.akcija ?? "", f.korisnik ?? "", f.pretraga ?? ""].join("|")
}

/** Query string filtera bez kursora — klijent mu dopisuje prijeVrijeme/prijeId. */
export function upitFiltera(f: AktivnostFilteriUlaz): string {
  const p = new URLSearchParams()
  if (f.od) p.set("odIso", f.od)
  if (f.do) p.set("doIso", f.do)
  if (f.akcija) p.set("akcija", f.akcija)
  if (f.korisnik) p.set("korisnik", f.korisnik)
  if (f.pretraga) p.set("q", f.pretraga)
  return p.toString()
}
