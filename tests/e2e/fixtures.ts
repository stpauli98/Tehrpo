/**
 * Dijeljene E2E fiksture — testovi prave SVOJE podatke i brišu ih za sobom.
 *
 * Zašto: DEMO baza više ne nosi stvarna imena klijenata (izmišljeni demo skup),
 * pa se nijedan test ne smije oslanjati na konkretnu zasijanu firmu. Svaka
 * fikstura kreira jedinstvenu throwaway firmu sa lokacijama i terminima, a
 * `obrisi()` je uklanja (termini prije klijenta — FK je `on delete restrict`).
 *
 * Naziv uvijek počinje prefiksom koji `scripts/cleanup-test-data.ts` prepoznaje
 * (`JUNK_KLIJENT`), pa i zaostatak nakon pada testa ima svog čistača.
 */
import {
  insertKlijent,
  insertLokacija,
  insertTermin,
  firstActiveVrstaId,
  deleteTerminiByKlijent,
  deleteKlijentByNaziv,
} from "./db"

/** Mora ostati usklađen sa JUNK_KLIJENT regexom u scripts/cleanup-test-data.ts. */
const PREFIKS = "E2E-TMP"

let brojac = 0

/** Jedinstven naziv throwaway klijenta ("E2E-TMP [oznaka ]<ts>-<n>"). */
export function jedinstvenNaziv(oznaka?: string): string {
  brojac += 1
  return `${PREFIKS} ${oznaka ? `${oznaka} ` : ""}${Date.now()}-${brojac}`
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** Dan u tekućem mjesecu (UTC) — uvijek unutar podrazumijevanog "tekući+naredni" filtera liste. */
function danUTekucemMjesecu(dan = 15): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(dan)}`
}

export type CiljniMjesec = { godina: number; mjesec: number }

export type FirmaFiksturaOpcije = {
  /** Oznaka u nazivu radi lakšeg debug-a (npr. "TEMELJ"). */
  oznaka?: string
  /** Nazivi lokacija — default dvije (filter-lokacija se prikazuje samo kad firma ima lokacije). */
  lokacije?: string[]
  /** Dodatni mjesec u kojem se prave termini (matrica "po mjesecu" traži pogodak u tom mjesecu). */
  ciljniMjesec?: CiljniMjesec
}

export type FirmaFikstura = {
  naziv: string
  klijentId: string
  vrstaId: string
  lokacije: { id: string; naziv: string }[]
  /** Termini u tekućem mjesecu (jedan po lokaciji) — vidljivi u podrazumijevanom prikazu liste. */
  terminiTekuciIds: string[]
  /** Termini u `ciljniMjesec` (jedan po lokaciji); prazno ako mjesec nije tražen. */
  terminiCiljniIds: string[]
  /** Idempotentno brisanje — sigurno i kad je već pozvano ili kad kreiranje nije doteklo do kraja. */
  obrisi: () => Promise<void>
}

/**
 * Kreira firmu sa lokacijama i terminima:
 *  - jedan termin PO LOKACIJI u tekućem mjesecu (svi sa popunjenom lokacijom),
 *  - opcionalno jedan termin po lokaciji u `ciljniMjesec`.
 */
export async function kreirajFirmuFiksturu(o: FirmaFiksturaOpcije = {}): Promise<FirmaFikstura> {
  const nazivi = o.lokacije ?? ["E2E Lokacija A", "E2E Lokacija B"]
  const naziv = jedinstvenNaziv(o.oznaka)
  const klijentId = await insertKlijent(naziv)

  const obrisi = async () => {
    await deleteTerminiByKlijent(klijentId)
    await deleteKlijentByNaziv(naziv) // lokacije idu cascade
  }

  try {
    const [vrstaId, lokacije] = await Promise.all([
      firstActiveVrstaId(),
      Promise.all(nazivi.map(async (n) => ({ id: await insertLokacija(klijentId, n), naziv: n }))),
    ])
    if (!vrstaId) throw new Error("kreirajFirmuFiksturu: nema aktivne vrste provjere")

    const terminiTekuciIds = await Promise.all(
      lokacije.map((l) =>
        insertTermin({ klijentId, vrstaId, lokacijaId: l.id, rok: danUTekucemMjesecu() }),
      ),
    )

    const c = o.ciljniMjesec
    const terminiCiljniIds = c
      ? await Promise.all(
          lokacije.map((l) =>
            insertTermin({
              klijentId,
              vrstaId,
              lokacijaId: l.id,
              rok: `${c.godina}-${pad2(c.mjesec)}-10`,
            }),
          ),
        )
      : []

    return { naziv, klijentId, vrstaId, lokacije, terminiTekuciIds, terminiCiljniIds, obrisi }
  } catch (e) {
    // Polukreirana fikstura ne smije ostati u bazi.
    await obrisi()
    throw e
  }
}
