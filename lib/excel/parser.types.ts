export type Izvor = "izvrseno" | "planirano"

export type ParsedTermin = {
  firma_naziv: string
  lokacija_naziv: string | null
  vrsta_naziv: string
  sheet_naziv: string
  datum: string // ISO "YYYY-MM-DD"
  izvor: Izvor
}

export type ParseResult = {
  firme: string[]      // jedinstveni kanonski nazivi firmi
  lokacije: { firma_naziv: string; lokacija_naziv: string; grad: string | null }[] // dedup pari
  vrste: string[]      // jedinstveni nazivi vrsta pregleda
  termini: ParsedTermin[]
  skipped: SkippedRow[]
}

export type SkippedRow = {
  sheet: string
  row: number
  col: number
  reason: string
}
