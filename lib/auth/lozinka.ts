export type LozinkaValidacija = { ok: true } | { ok: false; razlog: "min" | "nePoklapaju" }

/** Validacija nove lozinke: min 8 znakova, i mora se poklapati s potvrdom. */
export function validirajNovuLozinku(nova: string, potvrda: string): LozinkaValidacija {
  if (nova.length < 8) return { ok: false, razlog: "min" }
  if (nova !== potvrda) return { ok: false, razlog: "nePoklapaju" }
  return { ok: true }
}
