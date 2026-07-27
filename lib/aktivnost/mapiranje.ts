import type { DogadjajUnos } from "./tipovi"

// Fizički (srpski) segment → labela ekrana za NAVIGATE. Fallback: sam segment.
// Napomena: na en/de deploymentu usePathname vraća lokalizovan segment; tada labela
// pada na raw segment (svjesno ograničenje MVP-a — entitet nosi lokalizovan naziv).
export const EKRAN_LABELE: Record<string, string> = {
  pregled: "Pregled",
  "plan-aktivnosti": "Plan aktivnosti",
  obilasci: "Obilasci",
  klijenti: "Klijenti",
  asistent: "Asistent",
  zapisnici: "Zapisnici",
  postavke: "Postavke",
  aktivnost: "Aktivnost",
  termini: "Termini",
  dokumenti: "Dokumenti",
  "poslati-mejlovi": "Poslati mejlovi",
}

// Rute čiji drugi segment je id konkretnog zapisa → VIEW.
const ENTITET_RUTE = new Set(["klijenti", "zapisnici", "termini", "dokumenti"])

// Per-ekran allowlist filter ključeva iz searchParams.
export const FILTER_KLJUCEVI: Record<string, string[]> = {
  termini: ["status", "vrsta", "klijent", "q"],
  klijenti: ["q", "grad", "status"],
  obilasci: ["period", "godina", "mjesec", "kvartal", "status", "grad"],
  "plan-aktivnosti": ["view", "od", "do", "status"],
  // "page" je paginacija, NE filter — ne ulazi.
  "poslati-mejlovi": ["tip", "status", "od", "do", "samo_greske", "nepregledano"],
}

export function segmenti(pathname: string): string[] {
  return pathname.split("/").filter(Boolean)
}

export function dogadjajZaRutu(pathname: string): DogadjajUnos | null {
  const segs = segmenti(pathname)
  if (segs.length === 0) return null
  const prvi = segs[0]!
  const drugi = segs[1]
  if (drugi && ENTITET_RUTE.has(prvi)) {
    return { akcija: "VIEW", entitet: prvi, entitet_id: drugi, detalji: null }
  }
  return {
    akcija: "NAVIGATE",
    entitet: prvi,
    entitet_id: null,
    detalji: { ekran: EKRAN_LABELE[prvi] ?? prvi },
  }
}

export function dogadjajZaFilter(
  pathname: string,
  params: Record<string, string>,
): DogadjajUnos | null {
  const segs = segmenti(pathname)
  if (segs.length === 0) return null
  const prvi = segs[0]!
  const dozvoljeni = FILTER_KLJUCEVI[prvi]
  if (!dozvoljeni) return null
  const filteri: Record<string, string> = {}
  for (const k of dozvoljeni) {
    if (params[k]) filteri[k] = params[k]
  }
  if (Object.keys(filteri).length === 0) return null
  return { akcija: "FILTER", entitet: prvi, entitet_id: null, detalji: { filteri } }
}
