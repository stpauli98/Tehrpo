export type Izvor = "izvrseno" | "planirano"

export type ParsedTermin = {
  klijent_naziv: string
  vrsta_naziv: string
  sheet_naziv: string
  datum: string // ISO "YYYY-MM-DD"
  izvor: Izvor
}

export type ParseResult = {
  termini: ParsedTermin[]
  klijenti: string[]   // jedinstveni nazivi
  vrste: string[]      // jedinstveni nazivi
  skipped: SkippedRow[] // za debugging
}

export type SkippedRow = {
  sheet: string
  row: number
  col: number
  reason: string
}
