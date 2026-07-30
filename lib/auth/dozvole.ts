import type { Uloga } from "./roles"

/**
 * Četiri prekidača koje admin pali/gasi po operateru (potvrđeno 30.07.2026.).
 * Izvor istine je Postgres (RLS + trigeri) — ovo je ogledalo za UI i poruke.
 */
export type Dozvole = {
  /** briše redove koje je sam unio */
  smije_brisati_svoje: boolean
  /** briše tuđe redove na firmama koje su mu dodijeljene */
  smije_brisati_tudje: boolean
  /** briše klijenta, ugovor, lokaciju, kontakt osobu i profil provjere */
  smije_brisati_klijente: boolean
  /** označava aktivnost kao izvršenu bez priloženog nalaza */
  smije_zatvoriti_bez_nalaza: boolean
}

// Zamrznute: obje se vraćaju po referenci iz `efektivneDozvole`, a PRAZNE_DOZVOLE je i
// izvezena — bez freeze-a bi jedan slučajan upis zatrovao svakog kasnijeg potrošača.
export const PRAZNE_DOZVOLE: Dozvole = Object.freeze({
  smije_brisati_svoje: false,
  smije_brisati_tudje: false,
  smije_brisati_klijente: false,
  smije_zatvoriti_bez_nalaza: false,
})

const SVE_DOZVOLE: Dozvole = Object.freeze({
  smije_brisati_svoje: true,
  smije_brisati_tudje: true,
  smije_brisati_klijente: true,
  smije_zatvoriti_bez_nalaza: true,
})

/** admin → sve; pregled → ništa; operater → kolone kakve jesu. */
export function efektivneDozvole(uloga: Uloga, d: Dozvole): Dozvole {
  if (uloga === "admin") return SVE_DOZVOLE
  if (uloga === "pregled") return PRAZNE_DOZVOLE
  return {
    smije_brisati_svoje: d.smije_brisati_svoje,
    smije_brisati_tudje: d.smije_brisati_tudje,
    smije_brisati_klijente: d.smije_brisati_klijente,
    smije_zatvoriti_bez_nalaza: d.smije_zatvoriti_bez_nalaza,
  }
}
