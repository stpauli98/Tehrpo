import { APP_NAME } from "../brand"
import { APP_LOCALE, type Locale } from "../locale"

export type ZapisnikInput = {
  klijent: string
  lokacija: string | null
  vrstaProvjere: string
  datum: string // YYYY-MM-DD
  zaduzeni: string | null
}

export type ZapisnikContent = { nalaz: string; zakljucak: string; dryRun: boolean }

// Mock šabloni interpoliraju više polja + opcionu lokaciju (uslovni fragment) —
// ICU/katalog bi ovdje bio nezgrapan (select po prisustvu vrijednosti), pa ostaje
// lokalno-ključana mapa u modulu (isti pristup kao PROMPT_JEZIK_INSTRUKCIJA ispod;
// precedent za "model instrukcija/generisani tekst u content.ts, ne katalog").
const MOCK_SABLONI: Record<Locale, (input: ZapisnikInput) => ZapisnikContent> = {
  sr: (input) => {
    const lok = input.lokacija ? `, lokacija ${input.lokacija}` : ""
    return {
      nalaz:
        `Izvršena je provjera "${input.vrstaProvjere}" za klijenta ${input.klijent}${lok}, dana ${input.datum}. ` +
        `Tokom provjere pregledani su relevantni elementi u skladu sa važećim propisima zaštite na radu.`,
      zakljucak:
        `Na osnovu izvršene provjere utvrđeno je da stanje zadovoljava propisane uslove. ` +
        `Preporučuje se redovno održavanje i naredna provjera u zakonski propisanom intervalu.`,
      dryRun: true,
    }
  },
  en: (input) => {
    const loc = input.lokacija ? `, location ${input.lokacija}` : ""
    return {
      nalaz:
        `An inspection "${input.vrstaProvjere}" was carried out for client ${input.klijent}${loc}, on ${input.datum}. ` +
        `During the inspection, the relevant elements were reviewed in accordance with applicable occupational safety regulations.`,
      zakljucak:
        `Based on the inspection performed, it was determined that the condition meets the prescribed requirements. ` +
        `Regular maintenance and the next inspection within the legally prescribed interval are recommended.`,
      dryRun: true,
    }
  },
  de: (input) => {
    const ort = input.lokacija ? `, Standort ${input.lokacija}` : ""
    return {
      nalaz:
        `Die Prüfung "${input.vrstaProvjere}" wurde für den Kunden ${input.klijent}${ort} am ${input.datum} durchgeführt. ` +
        `Im Rahmen der Prüfung wurden die relevanten Elemente gemäß den geltenden Arbeitsschutzvorschriften überprüft.`,
      zakljucak:
        `Auf Grundlage der durchgeführten Prüfung wurde festgestellt, dass der Zustand die vorgeschriebenen Anforderungen erfüllt. ` +
        `Es wird eine regelmäßige Wartung sowie die nächste Prüfung innerhalb des gesetzlich vorgeschriebenen Intervalls empfohlen.`,
      dryRun: true,
    }
  },
}

/** Deterministični mock sadržaj — koristi se bez ANTHROPIC_API_KEY ili kad je ZAPISNIK_DRY_RUN=1. */
export function dryGenerateZapisnik(input: ZapisnikInput, locale: Locale = APP_LOCALE): ZapisnikContent {
  return MOCK_SABLONI[locale](input)
}

// Jezička instrukcija modelu — dio prompta, ne UI kopija, pa ostaje ovdje (ne u katalogu).
const PROMPT_JEZIK_INSTRUKCIJA: Record<Locale, string> = {
  sr: "na bosanskom jeziku",
  en: "in English",
  de: "auf Deutsch",
}

export function buildPrompt(input: ZapisnikInput, locale: Locale = APP_LOCALE): string {
  return (
    `Ti si stručnjak za zaštitu na radu u firmi ${APP_NAME} (Bosna i Hercegovina). ` +
    `Napiši profesionalan zapisnik o izvršenoj provjeri.\n` +
    `Klijent: ${input.klijent}\n` +
    `Lokacija: ${input.lokacija ?? "—"}\n` +
    `Vrsta provjere: ${input.vrstaProvjere}\n` +
    `Datum izvršenja: ${input.datum}\n` +
    `Zaduženi: ${input.zaduzeni ?? "—"}\n\n` +
    `Vrati ISKLJUČIVO validan JSON oblika {"nalaz": "...", "zakljucak": "..."} ${PROMPT_JEZIK_INSTRUKCIJA[locale]}, ` +
    `bez markdown ograda i bez dodatnog teksta. ` +
    `"nalaz" = 2-4 rečenice opisa izvršene provjere; "zakljucak" = 1-2 rečenice ocjene i preporuke.`
  )
}
