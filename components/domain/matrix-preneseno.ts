/**
 * Godišnja matrica: obaveze PRENESENE iz ranijih godina.
 *
 * Godišnja matrica prikazuje 12 mjeseci jedne kalendarske godine. Sve otvoreno
 * čiji je `datum_prikaza` prije 1. januara te godine nema svoju kolonu — do
 * ove ispravke je jednostavno nestajalo iz plana (audit B2: 01.01. iz plana
 * ispadne većina otvorenih obaveza). Zato matrica dobija dodatnu, nulti-ju
 * kolonu „Preneseno“.
 *
 * Ovdje je čista logika (bez React-a) da se granica godine može testirati.
 */
import { formatDatum } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import type { MatrixInput, MatrixColumn } from "@/lib/matrix"

/** Id kolone za prenesene obaveze. Nije mjesec — MatrixGrid ga posebno renderuje. */
export const PRENESENO_COL = "preneseno"

/** Minimum koji `termini_view` red mora imati da bi ušao u matricu. */
export type PrenesenTermin = {
  id?: string | null
  vrsta_provjere_id?: string | null
  vrsta_naziv?: string | null
  datum_prikaza?: string | null
  status_izvedeni?: string | null
}

/**
 * MatrixInput-i za kolonu „Preneseno“ + mapa terminId → formatiran datum
 * (u toj koloni sam dan u mjesecu ne znači ništa — datum je iz druge godine).
 */
export function prenesenoUlazi(redovi: PrenesenTermin[]): {
  inputs: MatrixInput[]
  datumi: Record<string, string>
} {
  const validni = redovi.filter((r) => r.id && r.vrsta_provjere_id && r.datum_prikaza)
  return {
    inputs: validni.map((r) => ({
      id: r.id!,
      vrstaId: r.vrsta_provjere_id!,
      vrstaNaziv: r.vrsta_naziv ?? "—",
      columnKey: PRENESENO_COL,
      dan: Number(r.datum_prikaza!.slice(8, 10)),
      status: toDerivedStatus(r.status_izvedeni),
    })),
    datumi: Object.fromEntries(validni.map((r) => [r.id!, formatDatum(r.datum_prikaza!)])),
  }
}

/**
 * Kolone godišnje matrice. Kolona „Preneseno“ se dodaje SAMO kad zaostataka
 * stvarno ima — prazna kolona bi u godinama bez prenosa samo zbunjivala.
 */
export function godisnjeKolone(
  mjeseci: MatrixColumn[],
  imaPrenesenih: boolean,
  prenesenoLabel: string,
): MatrixColumn[] {
  return imaPrenesenih ? [{ id: PRENESENO_COL, label: prenesenoLabel }, ...mjeseci] : mjeseci
}
