import { createTranslator } from "next-intl"
import { env } from "@/lib/env"
import { getMessages } from "@/i18n/messages"
import { APP_NAME } from "../brand"
import { APP_LOCALE, type Locale } from "../locale"
import { formatDatum } from "../date"

export type ZapisnikInput = {
  klijent: string
  lokacija: string | null
  vrstaProvjere: string
  datum: string // YYYY-MM-DD
  zaduzeni: string | null
}

/**
 * Odakle tekst zapisnika STVARNO dolazi (N11).
 *  - "model"  = napisao ga je jezički model iz svog odgovora
 *  - "sablon" = deterministični lokalni šablon (dry-run / offline), nije ga niko generisao
 */
export type ZapisnikIzvor = "model" | "sablon"

export type ZapisnikContent = {
  nalaz: string
  zakljucak: string
  /** Jedini izvor istine o porijeklu teksta. */
  izvor: ZapisnikIzvor
  /** Izvedeno iz `izvor` — nikad se ne postavlja ručno, pa ne može lagati (N11). */
  dryRun: boolean
}

/**
 * Jedina dozvoljena konstrukcija `ZapisnikContent`-a: `dryRun` se RAČUNA iz `izvor`,
 * pa ne postoji način da šablonski tekst bude označen kao model-generisan.
 */
export function zapisnikContent(
  nalaz: string,
  zakljucak: string,
  izvor: ZapisnikIzvor,
): ZapisnikContent {
  return { nalaz, zakljucak, izvor, dryRun: izvor === "sablon" }
}

/** Zapisnik se u ovom okruženju uopšte ne može generisati modelom (nema ključa / gašen namjerno). */
export function zapisnikDryRun(): boolean {
  return env.ZAPISNIK_DRY_RUN === "1" || !env.ANTHROPIC_API_KEY
}

/** Vidljiva napomena koja putuje UZ tekst šablona (i u .docx, i u prijedlog asistenta). */
export function sablonNapomena(locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "izvoz.zapisnik" })
  return t("sablonNapomena")
}

// Mock šabloni interpoliraju više polja + opcionu lokaciju (uslovni fragment) —
// ICU/katalog bi ovdje bio nezgrapan (select po prisustvu vrijednosti), pa ostaje
// lokalno-ključana mapa u modulu (isti pristup kao PROMPT_JEZIK_INSTRUKCIJA ispod;
// precedent za "model instrukcija/generisani tekst u content.ts, ne katalog").
const MOCK_SABLONI: Record<Locale, (input: ZapisnikInput) => { nalaz: string; zakljucak: string }> = {
  sr: (input) => {
    const lok = input.lokacija ? `, lokacija ${input.lokacija}` : ""
    return {
      nalaz:
        `Izvršena je provjera "${input.vrstaProvjere}" za klijenta ${input.klijent}${lok}, dana ${formatDatum(input.datum)}. ` +
        `Tokom provjere pregledani su relevantni elementi u skladu sa važećim propisima zaštite na radu.`,
      zakljucak:
        `Na osnovu izvršene provjere utvrđeno je da stanje zadovoljava propisane uslove. ` +
        `Preporučuje se redovno održavanje i naredna provjera u zakonski propisanom intervalu.`,
    }
  },
  en: (input) => {
    const loc = input.lokacija ? `, location ${input.lokacija}` : ""
    return {
      nalaz:
        `An inspection "${input.vrstaProvjere}" was carried out for client ${input.klijent}${loc}, on ${formatDatum(input.datum)}. ` +
        `During the inspection, the relevant elements were reviewed in accordance with applicable occupational safety regulations.`,
      zakljucak:
        `Based on the inspection performed, it was determined that the condition meets the prescribed requirements. ` +
        `Regular maintenance and the next inspection within the legally prescribed interval are recommended.`,
    }
  },
  de: (input) => {
    const ort = input.lokacija ? `, Standort ${input.lokacija}` : ""
    return {
      nalaz:
        `Die Prüfung "${input.vrstaProvjere}" wurde für den Kunden ${input.klijent}${ort} am ${formatDatum(input.datum)} durchgeführt. ` +
        `Im Rahmen der Prüfung wurden die relevanten Elemente gemäß den geltenden Arbeitsschutzvorschriften überprüft.`,
      zakljucak:
        `Auf Grundlage der durchgeführten Prüfung wurde festgestellt, dass der Zustand die vorgeschriebenen Anforderungen erfüllt. ` +
        `Es wird eine regelmäßige Wartung sowie die nächste Prüfung innerhalb des gesetzlich vorgeschriebenen Intervalls empfohlen.`,
    }
  },
}

/**
 * Deterministični šablonski sadržaj — koristi se bez ANTHROPIC_API_KEY ili kad je ZAPISNIK_DRY_RUN=1.
 *
 * N11: napomena o porijeklu ide U SAM `nalaz`, a ne samo u povratni objekat. Pozivaoci
 * (dokumenti/actions.ts, claude/tools.ts, asistent) prosljeđuju dalje samo `nalaz`/`zakljucak`,
 * pa je tekst jedini kanal koji sigurno stiže i do .docx-a i do prijedloga u asistentu.
 */
export function dryGenerateZapisnik(input: ZapisnikInput, locale: Locale = APP_LOCALE): ZapisnikContent {
  const { nalaz, zakljucak } = MOCK_SABLONI[locale](input)
  return zapisnikContent(`${sablonNapomena(locale)}\n${nalaz}`, zakljucak, "sablon")
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
    // Modelu se datum daje već formatiran po standardu prikaza (dd.MM.yyyy, lib/date.ts),
    // uz eksplicitno pravilo ispod — da generisani tekst ne prepiše ISO oblik.
    `Datum izvršenja: ${formatDatum(input.datum)}\n` +
    `Zaduženi: ${input.zaduzeni ?? "—"}\n\n` +
    `Vrati ISKLJUČIVO validan JSON oblika {"nalaz": "...", "zakljucak": "..."} ${PROMPT_JEZIK_INSTRUKCIJA[locale]}, ` +
    `bez markdown ograda i bez dodatnog teksta. ` +
    `"nalaz" = 2-4 rečenice opisa izvršene provjere; "zakljucak" = 1-2 rečenice ocjene i preporuke. ` +
    `Datume u tekstu piši u formatu dd.MM.yyyy (npr. 30.07.2026).`
  )
}
