import { createTranslator } from "next-intl"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

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
 * Izvlači grad iz naziva lokacije (whitelist BiH gradova; market/negeo → null).
 * Zadržava već postavljeni postojeciGrad.
 */
export function izvediGrad(naziv: string | null, postojeciGrad?: string | null): string | null {
  const pg = postojeciGrad?.trim()
  if (pg) return pg
  if (!naziv?.trim()) return null
  let s = naziv.trim()
  if (s.includes(",")) s = s.split(",")[0]!.trim()        // višegradski → prvi
  if (s.includes(" - ")) s = s.split(" - ")[0]!.trim()    // "Grad - Objekat" → grad
  return GRADOVI_BIH[foldGrad(s)] ?? null
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
