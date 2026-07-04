/** Mapira Postgres/PostgREST error kod na domaću poruku; nikad ne vraća sirovi interni tekst. */
export function friendlyDbError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): string {
  // Poznati constrainti → precizna poruka (prije generičkog mapiranja po kodu)
  if (error?.message?.includes("chk_termini_datumi")) {
    return "Neispravan datum: datum izvršenja ne može biti u budućnosti, a interval mora biti između 1 i 120 mjeseci."
  }
  switch (error?.code) {
    case "23505": return "Zapis sa tim vrijednostima već postoji."
    case "23503": return "Zapis je povezan s drugim podacima i u upotrebi je."
    case "23514": return "Nevažeći podaci — provjerite unos."
    case "23502": return "Nedostaje obavezno polje."
    default: return "Došlo je do greške pri spremanju. Pokušajte ponovo."
  }
}
