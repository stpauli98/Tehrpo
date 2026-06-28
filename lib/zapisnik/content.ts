import { APP_NAME } from "../brand"

export type ZapisnikInput = {
  klijent: string
  lokacija: string | null
  vrstaProvjere: string
  datum: string // YYYY-MM-DD
  zaduzeni: string | null
}

export type ZapisnikContent = { nalaz: string; zakljucak: string; dryRun: boolean }

/** Deterministični mock sadržaj — koristi se bez ANTHROPIC_API_KEY ili kad je ZAPISNIK_DRY_RUN=1. */
export function dryGenerateZapisnik(input: ZapisnikInput): ZapisnikContent {
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
}

export function buildPrompt(input: ZapisnikInput): string {
  return (
    `Ti si stručnjak za zaštitu na radu u firmi ${APP_NAME} (Bosna i Hercegovina). ` +
    `Napiši profesionalan zapisnik o izvršenoj provjeri.\n` +
    `Klijent: ${input.klijent}\n` +
    `Lokacija: ${input.lokacija ?? "—"}\n` +
    `Vrsta provjere: ${input.vrstaProvjere}\n` +
    `Datum izvršenja: ${input.datum}\n` +
    `Zaduženi: ${input.zaduzeni ?? "—"}\n\n` +
    `Vrati ISKLJUČIVO validan JSON oblika {"nalaz": "...", "zakljucak": "..."} na bosanskom jeziku, ` +
    `bez markdown ograda i bez dodatnog teksta. ` +
    `"nalaz" = 2-4 rečenice opisa izvršene provjere; "zakljucak" = 1-2 rečenice ocjene i preporuke.`
  )
}
