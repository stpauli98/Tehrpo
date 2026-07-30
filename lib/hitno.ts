import { createTranslator } from "next-intl"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import { formatDatum } from "@/lib/date"

export type RokTon = "danger" | "warning"
export type RokOznaka = { text: string; tone: RokTon }

// Cijeli dani od a do b (b - a); ulazi su ISO "YYYY-MM-DD".
function danaIzmedju(aIso: string, bIso: string): number {
  const a = Date.UTC(+aIso.slice(0, 4), +aIso.slice(5, 7) - 1, +aIso.slice(8, 10))
  const b = Date.UTC(+bIso.slice(0, 4), +bIso.slice(5, 7) - 1, +bIso.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

// sr pravilo slaganja broja i imenice: jednina "dan" za brojeve koji završavaju na 1,
// osim *11 (11, 111...) — npr. "21 dan", "11 dana". ICU `{count, plural, =1 {...}}` ovo
// NE pokriva (samo bukvalno n===1), pa bi zamjena sr grane ICU-jem promijenila prikaz za
// 21/31/41... dana (precedent: Task 10, CLDR "one" kategorija pogrešno pogađa 21/31 u sr).
// Zato sr ostaje na ovoj hardkodiranoj funkciji (early-return ispod), a ICU plural
// (common.rok.* katalog) se koristi samo za en/de gdje množina zavisi isključivo od n===1.
function danRijec(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? "dan" : "dana"
}

/**
 * Datumski red uz „kasni N": rok sam, ili rok + zakazani datum kad se razlikuju.
 *
 * Zašto uopšte postoji: „kasni N" se UVIJEK mjeri prema `rok_dospijeca` (zakonska
 * obaveza), pa prezakazan termin ostaje crven i poslije dogovorenog izlaska. Ako red
 * uz to pokaže samo rok, izgleda kao da niko ništa nije poduzeo — a `/plan-aktivnosti`
 * isti termin pozicionira po `datum_prikaza` (= zakazani datum) i pokazuje drugi datum.
 * Zato ovdje idu oba: rok je rok, zakazano je zakazano.
 *
 * `datum_zakazan === rok_dospijeca` se tretira kao „nije prezakazan" — isti uslov koji
 * `runPostDue` koristi za `zakazanoZa`, da ekran i mejl ne odluče različito.
 */
export function rokDatumOznaka(
  rokIso: string,
  datumZakazanIso: string | null | undefined,
  locale: Locale = APP_LOCALE,
): string {
  const rok = formatDatum(rokIso, locale)
  if (!datumZakazanIso || datumZakazanIso === rokIso) return rok
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "common.rok" })
  return t("rokIZakazano", { rok, zakazano: formatDatum(datumZakazanIso, locale) })
}

export function rokRelativnaOznaka(rokIso: string, todayIso: string, locale: Locale = APP_LOCALE): RokOznaka {
  const dani = danaIzmedju(todayIso, rokIso) // rok - danas
  if (locale === "sr") {
    if (dani < 0) {
      const n = -dani
      return { text: `kasni ${n} ${danRijec(n)}`, tone: "danger" }
    }
    if (dani === 0) return { text: "danas", tone: "danger" }
    return { text: `za ${dani} ${danRijec(dani)}`, tone: "warning" }
  }
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "common.rok" })
  if (dani < 0) {
    const n = -dani
    return { text: t("kasni", { count: n }), tone: "danger" }
  }
  if (dani === 0) return { text: t("danas"), tone: "danger" }
  return { text: t("za", { count: dani }), tone: "warning" }
}
