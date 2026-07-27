import { z } from "zod"
import { createTranslator } from "next-intl"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import { todayIso } from "@/lib/date"
import { STATUS_FILTER_OPTIONS } from "@/lib/termini"

// Whitelist pravih BiH gradova (fold ključ → kanonski oblik za prikaz)
const GRADOVI_BIH: Record<string, string> = {
  "banja luka": "Banja Luka", "bijeljina": "Bijeljina", "brcko": "Brčko",
  "derventa": "Derventa", "doboj": "Doboj", "gradiska": "Gradiška",
  "istocno sarajevo": "Istočno Sarajevo", "prijedor": "Prijedor",
  "prnjavor": "Prnjavor", "trebinje": "Trebinje", "zvornik": "Zvornik",
  "laktasi": "Laktaši", "sarajevo": "Sarajevo", "mostar": "Mostar",
  "tuzla": "Tuzla", "zenica": "Zenica",
}

// lowercase + skini dijakritiku za poređenje s whitelistom
function foldGrad(s: string): string {
  return s
    .toLowerCase()
    .replace(/dž/g, "dz")
    .replace(/[čć]/g, "c")
    .replace(/š/g, "s")
    .replace(/ž/g, "z")
    .replace(/đ/g, "d")
    .trim()
}

/**
 * Gradi lookup mapu (fold ključ → kanonski naziv) iz liste naziva gradova — isti oblik
 * kao statična GRADOVI_BIH konstanta, ali iz kataloga `gradovi` u bazi (S8.2).
 * Prazni/whitespace nazivi se preskaču (ne prave ključ "").
 */
export function buildGradoviMapa(nazivi: string[]): Record<string, string> {
  const mapa: Record<string, string> = {}
  for (const naziv of nazivi) {
    const kanonski = naziv.trim()
    if (!kanonski) continue
    mapa[foldGrad(kanonski)] = kanonski
  }
  return mapa
}

/**
 * Izvlači grad iz naziva lokacije (whitelist BiH gradova; market/negeo → null).
 * Zadržava već postavljeni postojeciGrad.
 *
 * `gradoviMapa` (opciono) = katalog iz baze preko `buildGradoviMapa(await dohvatiGradove())`;
 * kad se ne proslijedi, koristi se statična GRADOVI_BIH whitelista — fallback koji NAMJERNO
 * ostaje za Excel import pipeline i backfill skriptu (rade offline / prije baze), pa svi
 * postojeći pozivaoci rade nepromijenjeno (parametar je opcioni, ne mijenja ponašanje).
 */
export function izvediGrad(
  naziv: string | null,
  postojeciGrad?: string | null,
  gradoviMapa?: Record<string, string>,
): string | null {
  const pg = postojeciGrad?.trim()
  if (pg) return pg
  if (!naziv?.trim()) return null
  let s = naziv.trim()
  if (s.includes(",")) s = s.split(",")[0]!.trim()        // višegradski → prvi
  if (s.includes(" - ")) s = s.split(" - ")[0]!.trim()    // "Grad - Objekat" → grad
  return (gradoviMapa ?? GRADOVI_BIH)[foldGrad(s)] ?? null
}

export type ObilazakItem = {
  id: string
  klijent_id: string
  klijent_naziv: string
  vrsta_naziv: string
  lokacija_naziv: string | null
  lokacija_grad: string | null
  rok_dospijeca: string
  status_izvedeni: string
  /** Sirovi `termini.status` — StatusBadge iz njega izvodi hint „kasni ali zakazan". */
  status: string | null
  datum_zakazan: string | null
}

/**
 * Definicija filtera „Aktivni" na tabu Obilasci: sve osim izvršenih i otkazanih.
 * Jedan izvor za `page.tsx` upit (`.not("status_izvedeni", "in", ...)`) i test.
 */
export const AKTIVNI_ISKLJUCENI = ["izvrseno", "otkazano"] as const

/** PostgREST `in`-lista za „Aktivni" filter, npr. `(izvrseno,otkazano)`. */
export const AKTIVNI_NOT_IN = `(${AKTIVNI_ISKLJUCENI.join(",")})`

export type ObilasciPeriod = "mjesec" | "kvartal" | "godina"

/** „aktivni" (obilasci-specifično) + zajedničke opcije status filtera. */
export type ObilasciStatus = "aktivni" | (typeof STATUS_FILTER_OPTIONS)[number]["value"]

const STATUS_VRIJEDNOSTI = [
  "aktivni",
  ...STATUS_FILTER_OPTIONS.map((o) => o.value),
] as [ObilasciStatus, ...ObilasciStatus[]]

export type ObilasciParams = {
  period: ObilasciPeriod
  godina: number
  mjesec: number
  kvartal: number
  status: ObilasciStatus
  /** Slobodan tekst: sentineli `svi`/`__bez__` ili naziv grada; upit je parametrizovan + pod RLS-om. */
  grad: string
  strana: number
}

/** Kvartal (1–4) kojem pripada ISO datum `yyyy-MM-dd`. */
export function kvartalIzDatuma(isoDatum: string): number {
  return Math.ceil(Number(isoDatum.slice(5, 7)) / 3)
}

/**
 * Normalizacija `searchParams` taba Obilasci — čista funkcija (bez baze i bez
 * Next konteksta), pa je unit-testabilna. Svaki nevaljan/nepostojeći parametar
 * tiho pada na default umjesto da obori render (zod `.catch()`).
 *
 * Defaultovi mjeseca, kvartala i godine izvode se iz `danas` (podrazumijevano
 * `todayIso()`) — tekući kvartal, ne fiksno Q1.
 */
export function parsirajObilasciParams(
  sp: Record<string, string | string[] | undefined>,
  danas: string = todayIso(),
): ObilasciParams {
  const sema = z.object({
    period: z.enum(["mjesec", "kvartal", "godina"]).catch("mjesec"),
    godina: z.coerce.number().int().min(2000).max(2100).catch(Number(danas.slice(0, 4))),
    mjesec: z.coerce.number().int().min(1).max(12).catch(Number(danas.slice(5, 7))),
    kvartal: z.coerce.number().int().min(1).max(4).catch(kvartalIzDatuma(danas)),
    status: z.enum(STATUS_VRIJEDNOSTI).catch("aktivni"),
    grad: z.string().catch(""),
    strana: z.coerce.number().int().min(1).catch(1),
  })
  return sema.parse(sp)
}

// Interni sentinel za grupu "bez grada" — NIJE prikazni tekst (taj dolazi iz
// obilasci.toolbar.gradBez, isti ključ koji ObilasciToolbar već koristi za "Bez grada"
// select opciju). Prikazna vrijednost i URL-filter sentinel ("__bez__" u toolbaru) su
// namjerno odvojeni — provjereno: g.grad se ovdje koristi samo za prikaz/React key,
// nikad za poređenje sa URL parametrom.
const BEZ_GRADA_KEY = "\0bez-grada"

export function groupByGrad(items: ObilazakItem[], locale: Locale = APP_LOCALE): { grad: string; items: ObilazakItem[] }[] {
  const map = new Map<string, ObilazakItem[]>()
  for (const it of items) {
    const key = it.lokacija_grad ?? BEZ_GRADA_KEY
    const arr = map.get(key) ?? []
    arr.push(it)
    map.set(key, arr)
  }
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "obilasci.toolbar" })
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === BEZ_GRADA_KEY) return 1
      if (b === BEZ_GRADA_KEY) return -1
      return a.localeCompare(b)
    })
    .map(([grad, items]) => ({ grad: grad === BEZ_GRADA_KEY ? t("gradBez") : grad, items }))
}
