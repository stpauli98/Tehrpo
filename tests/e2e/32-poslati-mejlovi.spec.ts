// tests/e2e/32-poslati-mejlovi.spec.ts
// Task 12 — E2E za ekran "Poslati mejlovi" (dnevnik mejlova, mejl_log).
//
// ⚠️ Zavisi od migracije 20260713120000_mejl_log.sql PRIMIJENJENE na DEMO bazi.
// Do primjene na DEMO (kasniji, korisnikom-gejtovan cloud korak) ovaj spec će
// pasti na seed-u (tabela mejl_log ne postoji) — to je OČEKIVANO, ne app bug.
//
// DEMO je dijeljena baza i Resend je uživo → SVE asertacije su relativne
// (jedinstven "[E2E] "+nasumični sufiks subject marker po testu), nikad
// apsolutni brojevi/count-ovi cijele tabele/bedža.
import { test, expect, type Page } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import {
  db,
  ensureOperater,
  assignKlijent,
  clearDodjele,
  insertKlijent,
  deleteKlijentByNaziv,
  deleteKorisnikByEmail,
} from "./db"

const MARK = `[E2E] ${Date.now()}-${Math.random().toString(36).slice(2)}`

/** Locator za red tabele koji sadrži dati (jedinstveni) subject-marker.
 *  NAPOMENA: `new RegExp(subject)` NE radi ovdje — subject sadrži "[E2E]" a
 *  uglaste zagrade su regex-metakarakteri (character class), pa bi doslovni
 *  string bio pogrešno protumačen. `.filter({ hasText })` sa string argumentom
 *  radi doslovan (ne-regex) podstring-match, što je ono što nam treba. */
function redSaSubjektom(page: Page, subject: string) {
  return page.locator("tr").filter({ hasText: subject })
}

test.describe("admin — dnevnik poslatih mejlova (/poslati-mejlovi)", () => {
  const seededIds: string[] = []

  test.afterAll(async () => {
    if (seededIds.length) {
      await db.from("mejl_log").delete().in("id", seededIds)
    }
  })

  test("admin vidi grešku bez firme (crveni red), filter bedža i pregled je uklanja", async ({ page }, testInfo) => {
    // Subjekt jedinstven PO PROJEKTU (chromium/webkit) da se seed-ovi ne sudaraju.
    const subject = `${MARK} ${testInfo.project.name} greska-bez-firme`

    // Seed: greška bez firme (tip "test", bez klijent_id) — service-role klijent,
    // isti obrazac kao insertKlijent/insertTermin u db.ts (bypass RLS na insert).
    const { data, error } = await db
      .from("mejl_log")
      .insert({
        tip: "test",
        primaoci: ["e2e@example.com"],
        subject,
        status: "greska_slanja",
        greska: "boom",
      })
      .select("id")
    if (error) throw new Error(`seed mejl_log (bez firme): ${error.message}`)
    seededIds.push(...(data ?? []).map((r) => r.id as string))

    // 1) Admin vidi red na neisfiltriranom prikazu, obojen kao greška (crveni red).
    await page.goto("/poslati-mejlovi")
    const red = redSaSubjektom(page, subject)
    await expect(red).toBeVisible({ timeout: 30_000 })
    await expect(red).toHaveClass(/bg-destructive/)

    // 2) Filtrirani prikaz (isti query koji "bedž neriješenih grešaka" predstavlja:
    //    samo_greske=1&nepregledano=1) i dalje prikazuje red — nije još pregledan.
    await page.goto("/poslati-mejlovi?samo_greske=1&nepregledano=1")
    await expect(redSaSubjektom(page, subject)).toBeVisible({ timeout: 30_000 })

    // 3) Klik na "Označi pregledanim" u TOM redu → red nestaje iz filtra neriješenih
    //    (server action oznaciPregledanim → RPC oznaci_mejl_pregledan → revalidatePath).
    await redSaSubjektom(page, subject).getByRole("button", { name: /Označi/ }).click()
    await expect(page.getByText(subject)).toHaveCount(0)
  })
})

// ─── Operater scoping ────────────────────────────────────────────────────────
// Uzorak iz 18-auth-rls.spec.ts / 30-aktivnost.spec.ts: injectSessionFor +
// ensureOperater daju ne-admin sesiju bez zasebnog storageState fajla u
// playwright.config.ts (koji ima samo "chromium"/"webkit" projekte sa admin
// storageState-om). RLS (mejl_log_sel) skopira SELECT na je_admin() ili
// dodijeljenog klijenta — operater NE smije vidjeti red bez firme.
const OP_LOZINKA = "E2eOperaterMejlovi2026!"
const OP_IME = "E2E Operater Mejlovi"

test.describe("operater — RLS scoping na /poslati-mejlovi", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  let opId = ""
  let klijentId = ""
  // Identifikatori JEDINSTVENI PO PROJEKTU (chromium/webkit) — inače dijeljeni
  // operater/klijent/marker izazovu sudar beforeAll↔afterAll između projekata
  // (jedan projekat obriše dodjelu/klijent drugog → operater ne vidi svoj red).
  let opEmail = ""
  let klijentNaziv = ""
  let vidljivSubject = ""
  let skrivenSubject = ""
  const seededIds: string[] = []

  test.beforeAll(async ({}, testInfo) => {
    const proj = testInfo.project.name
    opEmail = `e2e-operater-mejlovi-${proj}@tehpro.test`
    klijentNaziv = `E2E-TMP Mejlovi ${proj} ${Date.now()}`
    vidljivSubject = `${MARK} ${proj} vidljiv-operateru`
    skrivenSubject = `${MARK} ${proj} skriven-operateru`

    opId = await ensureOperater(opEmail, OP_LOZINKA, OP_IME)
    await deleteKlijentByNaziv(klijentNaziv).catch(() => {})
    klijentId = await insertKlijent(klijentNaziv)
    await clearDodjele(opId)
    await assignKlijent(opId, klijentId)

    const { data: vidljiv, error: vErr } = await db
      .from("mejl_log")
      .insert({
        tip: "test",
        primaoci: ["e2e@example.com"],
        subject: vidljivSubject,
        status: "greska_slanja",
        greska: "boom",
        klijent_id: klijentId,
      })
      .select("id")
    if (vErr) throw new Error(`seed mejl_log (dodijeljena firma): ${vErr.message}`)

    const { data: skriven, error: sErr } = await db
      .from("mejl_log")
      .insert({
        tip: "test",
        primaoci: ["e2e@example.com"],
        subject: skrivenSubject,
        status: "greska_slanja",
        greska: "boom",
      })
      .select("id")
    if (sErr) throw new Error(`seed mejl_log (bez firme): ${sErr.message}`)

    seededIds.push(
      ...(vidljiv ?? []).map((r) => r.id as string),
      ...(skriven ?? []).map((r) => r.id as string),
    )
  })

  test.afterAll(async () => {
    if (seededIds.length) await db.from("mejl_log").delete().in("id", seededIds)
    if (opId) await clearDodjele(opId)
    if (klijentNaziv) await deleteKlijentByNaziv(klijentNaziv).catch(() => {})
    if (opEmail) await deleteKorisnikByEmail(opEmail).catch(() => {})
  })

  test("operater vidi samo mejl svoje dodijeljene firme, ne i red bez firme", async ({ context }) => {
    await injectSessionFor(context, opEmail, OP_LOZINKA)
    const page = await context.newPage()
    await page.goto("/poslati-mejlovi")
    await expect(page.getByText(vidljivSubject)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(skrivenSubject)).toHaveCount(0)
  })
})
