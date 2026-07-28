// Čista logika ekrana „Postavke → Ko šta prima". Bez React-a i bez Supabase-a, da
// precedencija razloga može imati testove i da JSX ne bude jedino mjesto gdje živi.

/** Zašto firma NE prima — poredano po precedenciji (viši razlog nadjačava niže). */
export type RazlogNePrima = "automatika" | "globalno" | "firma" | "nemaAdrese"

export type UlazReda = {
  /** postavke.podsjetnici_aktivni — cron ruta na false ne pošalje NIŠTA (route.ts:47). */
  podsjetniciAktivni: boolean
  /** postavke.salji_klijentima — globalni prekidač firminog kanala. */
  saljiGlobalno: boolean
  /** klijenti.salji_podsjetnik_klijentu — per-firma flag. */
  saljiFirmi: boolean
  /** broj validnih adresa firme (flagovani kontakti + ad-hoc, dedupirano). */
  brojAdresa: number
}

export type IshodReda = { prima: boolean; razlog: RazlogNePrima | null }

/**
 * „Firma prima?" je izvedeno, nikad kontrola. `automatika` je najviši razlog jer
 * ugašena automatika zaustavlja i pre-due i post-due, bez obzira na ostalo.
 */
export function izracunajIshodReda(u: UlazReda): IshodReda {
  if (!u.podsjetniciAktivni) return { prima: false, razlog: "automatika" }
  if (!u.saljiGlobalno) return { prima: false, razlog: "globalno" }
  if (!u.saljiFirmi) return { prima: false, razlog: "firma" }
  if (u.brojAdresa <= 0) return { prima: false, razlog: "nemaAdrese" }
  return { prima: true, razlog: null }
}

/** „—" u koloni radnika ima dva različita značenja; ovo ih razdvaja. */
export type StatusRadnika = "ima" | "optOut" | "nemaDodijeljenih"

export function izracunajStatusRadnika(
  ukupnoDodijeljenih: number,
  brojPrimalaca: number,
): StatusRadnika {
  if (brojPrimalaca > 0) return "ima"
  return ukupnoDodijeljenih > 0 ? "optOut" : "nemaDodijeljenih"
}
