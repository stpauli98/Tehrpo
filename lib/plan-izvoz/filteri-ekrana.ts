import { todayIso } from "@/lib/date"

/**
 * Filteri sa trenutnog ekrana koje izvoz („Opseg: samo trenutno filtrirano") smije
 * proslijediti ruti. Jedan izvor istine — modal iz istog rezultata i šalje parametre
 * i računa indikator „filteri primijenjeni", pa to dvoje ne može da se raziđe.
 *
 * Datumski ključevi (`mjesec`, `godina`, `dan`) namjerno NISU ovdje: period iz modala
 * zamjenjuje datumski filter ekrana (ruta zove `applyPlanFilteriBezDatuma`).
 */
const FILTER_KLJUCEVI = ["status", "q", "klijent_id", "lokacija", "vrsta_id", "nacin"] as const

export type FilterKljuc = (typeof FILTER_KLJUCEVI)[number]

export function filteriSaEkrana(sp: URLSearchParams): Partial<Record<FilterKljuc, string>> {
  const izlaz: Partial<Record<FilterKljuc, string>> = {}
  for (const k of FILTER_KLJUCEVI) {
    const v = sp.get(k)
    if (v) izlaz[k] = v
  }

  // Matrica bira firmu kroz `klijent` (`klijent_id` je ključ liste) i uvažava ga samo
  // u modu "klijent" — u modu "mjesec" zaostali parametar nije aktivan filter
  // (`PrikazToolbar.setMode` ga ne briše pri prelasku).
  if (!izlaz.klijent_id && (sp.get("mode") ?? "klijent") === "klijent") {
    const saMatrice = sp.get("klijent")
    if (saMatrice) izlaz.klijent_id = saMatrice
  }

  return izlaz
}

/** Početni period izvoza, izveden iz onoga što ekran trenutno pokazuje. */
export type PeriodEkrana = {
  mod: "om" | "god" | "mj" | "svi"
  godina: number
  mjesec: number
}

/**
 * Period kojim se modal otvara. Ranije je uvijek bio „Ovaj mjesec", pa je izvoz nad
 * listom filtriranom na mart tiho vraćao tekući mjesec — datumski filter ekrana se u
 * izvozu NE primjenjuje (ruta zove `applyPlanFilteriBezDatuma`), period ga zamjenjuje.
 * Zato modal mora startovati od perioda koji je već na ekranu.
 *
 * `danas` je ISO override za test.
 */
export function periodSaEkrana(sp: URLSearchParams, danas?: string): PeriodEkrana {
  const iso = danas ?? todayIso()
  const godina = Number(sp.get("godina")) || Number(iso.slice(0, 4))
  const mjesecParam = sp.get("mjesec")
  const mjesecBroj = Number(mjesecParam)
  const validanMjesec = mjesecBroj >= 1 && mjesecBroj <= 12
  const mjesec = validanMjesec ? mjesecBroj : Number(iso.slice(5, 7))
  const osnova = { godina, mjesec }

  // Matrica u modu „klijent" prikazuje cijelu godinu za izabranu firmu; `mjesec` tu
  // može biti zaostao iz moda „mjesec" (`PrikazToolbar.setMode` ga ne briše).
  if (sp.get("view") === "matrica" && (sp.get("mode") ?? "klijent") === "klijent") {
    return { mod: "god", ...osnova }
  }

  if (mjesecParam === "svi") return { mod: "svi", ...osnova }
  if (validanMjesec) return { mod: "mj", ...osnova }
  // "tn" (podrazumijevano na listi), prazno ili smeće → tekući mjesec.
  return { mod: "om", ...osnova }
}
