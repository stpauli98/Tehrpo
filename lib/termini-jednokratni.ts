/**
 * Spajanje profil-stavki (klijent_provjere) i „siročadi" — termina koji nemaju
 * odgovarajuću profil-stavku.
 *
 * Yoink 2026-07-30, stavka 11c. Do sada su takvi termini bili vidljivi samo u
 * tabu Termini: ID karta i Usluge čitaju isključivo klijent_provjere, pa je
 * usluga unesena kroz plan aktivnosti djelovala kao da ne postoji. Ovo ih
 * prikazuje bez ijedne izmjene podataka — označene kao jednokratne.
 */

/** Minimalni oblik profil-stavke koji spajanje treba (podskup ProfilStavka). */
export type ProfilZaSpajanje = {
  id: string
  vrsta_provjere_id: string
  lokacija_id: string | null
  vrsta_naziv: string
  lokacija_naziv: string | null
  interval_mjeseci: number | null
  zadnji_datum: string | null
  sljedeci_rok: string | null
  termin_status: string | null
}

/** Minimalni oblik reda iz termini_view koji spajanje treba. */
export type TerminZaSpajanje = {
  id: string
  vrsta_provjere_id: string | null
  lokacija_id: string | null
  vrsta_naziv: string | null
  lokacija_naziv: string | null
  rok_dospijeca: string | null
  status: string | null
  status_izvedeni: string | null
  datum_izvrsenja: string | null
}

export type StavkaUsluge = ProfilZaSpajanje & { jednokratna: boolean }

/** Otkazani termini nisu obaveza — ne prikazuju se kao usluga. */
const SKRIVENI_STATUSI = new Set(["otkazano"])

const kljuc = (vrstaId: string | null, lokacijaId: string | null) =>
  `${vrstaId ?? ""}|${lokacijaId ?? ""}`

/**
 * Vraća profil-stavke (nepromijenjene) plus po jednu izvedenu stavku za svaki
 * par (vrsta, lokacija) koji ima termine ali nema profil-stavku.
 *
 * Dates su ISO `yyyy-mm-dd` pa se porede leksikografski.
 */
export function spojiJednokratne(
  profil: ProfilZaSpajanje[],
  termini: TerminZaSpajanje[],
): StavkaUsluge[] {
  const pokriveni = new Set(profil.map((p) => kljuc(p.vrsta_provjere_id, p.lokacija_id)))
  const izvedene = new Map<string, StavkaUsluge>()

  for (const t of termini) {
    if (SKRIVENI_STATUSI.has(t.status ?? "")) continue
    const k = kljuc(t.vrsta_provjere_id, t.lokacija_id)
    if (pokriveni.has(k)) continue

    const postojeca = izvedene.get(k)
    if (!postojeca) {
      izvedene.set(k, {
        id: `jednokratna:${k}`,
        vrsta_provjere_id: t.vrsta_provjere_id ?? "",
        lokacija_id: t.lokacija_id,
        vrsta_naziv: t.vrsta_naziv ?? "—",
        lokacija_naziv: t.lokacija_naziv,
        interval_mjeseci: null, // jednokratna nema periodiku
        zadnji_datum: t.status === "izvrseno" ? t.datum_izvrsenja : null,
        sljedeci_rok: t.rok_dospijeca,
        termin_status: t.status_izvedeni,
        jednokratna: true,
      })
      continue
    }

    // Najraniji rok je „sljedeći", najkasnije izvršenje je „zadnji put".
    if (t.rok_dospijeca && (!postojeca.sljedeci_rok || t.rok_dospijeca < postojeca.sljedeci_rok)) {
      postojeca.sljedeci_rok = t.rok_dospijeca
      postojeca.termin_status = t.status_izvedeni
    }
    if (
      t.status === "izvrseno" && t.datum_izvrsenja &&
      (!postojeca.zadnji_datum || t.datum_izvrsenja > postojeca.zadnji_datum)
    ) {
      postojeca.zadnji_datum = t.datum_izvrsenja
    }
  }

  return [
    ...profil.map((p) => ({ ...p, jednokratna: false })),
    ...izvedene.values(),
  ]
}
