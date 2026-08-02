import { randomUUID } from "node:crypto"
import { test, expect, type Page } from "@playwright/test"

// `/asistent` je jedina ruta koju nijedan raniji spec ne dotakne, pa prva navigacija
// ovdje plaća cijelu cijenu prvog webpack dev prevođenja rute (+ klijentskog bundle-a
// AsistentChat-a). Pod podrazumijevanih 30 s to prevođenje pojede cijeli budžet testa i
// `page.goto` bude prekinut (net::ERR_ABORTED) prije nego išta bude provjereno. Budžet se
// diže samo za ovaj fajl; nijedna tvrdnja se ne ublažava niti se dodaje retry.
test.describe.configure({ mode: "serial", timeout: 90_000 })

/**
 * Ulazi u PRAZAN, novi razgovor tvrdom navigacijom na `/asistent?k=<novi uuid>`.
 *
 * Sa stanovišta aplikacije je identično kliku na "Novi razgovor" — dugme radi tačno to
 * (`router.push("/asistent?k=" + crypto.randomUUID())`), a stranica razgovor čita isključivo
 * iz `searchParams.k`. Razlika je što ovdje NE ostaje meka (RSC) navigacija u letu.
 *
 * Zašto je to bitno: URL se na `router.push` promijeni PRIJE nego navigacija sjedne, pa
 * čekanje na `?k=` ne dokazuje da je gotova. Reprodukovano (~1 od 3 prolaza): dok su se
 * provjeravale poruke, Playwright je u call logu prijavio "navigated to …?k=…" — dakle puna
 * navigacija na taj isti URL koja stigne naknadno, ponovo montira `AsistentChat` i pobriše
 * sve što je došlo streamom (tekst, tool indikator, `zapisnik-proposal`) i svaki sonner
 * toast; na snimku ekrana ostane samo ono što server zna iz baze. Tvrda navigacija tu
 * mogućnost uklanja jer poslije nje nema meke navigacije u letu.
 *
 * Ugovor samog dugmeta i dalje se provjerava — u zasebnom testu ispod, gdje se poslije klika
 * ništa ne kuca pa zakašnjelo dosjedanje navigacije ne može ništa pokvariti.
 */
async function otvoriNoviRazgovor(page: Page): Promise<void> {
  await page.goto(`/asistent?k=${randomUUID()}`)
  await expect(page.getByTestId("chat-input")).toBeVisible()
  await cekajHidrataciju(page, "chat-input")
}

/**
 * Čeka da React STVARNO preuzme polje za unos, a ne samo da ono postoji u DOM-u.
 *
 * `chat-input` je kontrolisani `<textarea value={text}>`. Ako Playwright upiše tekst prije
 * nego se klijentski bundle hidratira, tekst ostane u DOM-u ali React-ovo `text` ostane
 * prazno — `submit()` tada odbaci prazan string i klik na "Pošalji" tiho ne uradi ništa.
 * Tako je izgledao pad na webkitu: unos pun teksta, nula poruka, nula mrežnih poziva
 * (3/3 prolaza; potvrđeno tako što je umetnuta pauza prije kucanja oborila pad na 0/2).
 * Vidljivost elementa taj trenutak ne hvata jer je markup serverski otpremljen.
 *
 * Provjerava se STANJE: React na hidratisane host-čvorove zakači `__reactProps$…` ključ
 * (to je isti ključ preko kojeg njegov sistem događaja pronalazi handlere), pa njegovo
 * prisustvo znači da su onChange/onSubmit stvarno spojeni. Nema čekanja na vrijeme.
 */
async function cekajHidrataciju(page: Page, testId: string): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`)
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"))
    },
    testId,
  )
}

test.describe("Faza 8 — AI Asistent (mock)", () => {
  test("dugme 'Novi razgovor' otvara prazan razgovor sa svojim ?k=", async ({ page }) => {
    await page.goto("/asistent")
    await expect(page.getByTestId("prazan-asistent")).toBeVisible()
    // Dugme radi `router.push` — prije hidratacije klik nigdje ne vodi i izgubi se.
    await cekajHidrataciju(page, "novi-razgovor")
    await page.getByTestId("novi-razgovor").click()
    await expect(page).toHaveURL(/\/asistent\?k=/)
    await expect(page.getByTestId("chat-input")).toBeVisible()
    await expect(page.getByTestId("prazan-asistent")).toBeHidden()
  })

  test("novi razgovor → poruka → streaming odgovor + tool indikator", async ({ page }) => {
    await otvoriNoviRazgovor(page)
    await page.getByTestId("chat-input").fill("Koji termini kasne?")
    await page.getByTestId("chat-send").click()
    // user poruka
    await expect(page.getByTestId("msg-user").last()).toContainText("Koji termini kasne?")
    // assistant tekst (mock) + tool indikator
    await expect(page.getByTestId("msg-assistant").last()).toContainText("pregled", { timeout: 10000 })
    await expect(page.getByTestId("tool-indikator").last()).toBeVisible()
  })

  test("upit za zapisnik → prijedlog sa dugmetom 'Snimi zapisnik'", async ({ page }) => {
    await otvoriNoviRazgovor(page)
    await page.getByTestId("chat-input").fill("Napravi zapisnik za prvi termin")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("zapisnik-proposal")).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId("snimi-zapisnik")).toBeVisible()
    // mock proposal koristi nepostojeći termin → klik vraća kontrolisanu grešku (bez upisa).
    // Greška se prikazuje kroz toast (jedan kanal feedbacka — inline span je uklonjen).
    await page.getByTestId("snimi-zapisnik").click()
    await expect(page.getByText(/Termin ne postoji/).first()).toBeVisible({ timeout: 10000 })
    // Na neuspjeh dugme OSTAJE omogućeno (retry mora ostati moguć; `snimljeno` ne smije
    // postati true na ok:false).
    await expect(page.getByTestId("snimi-zapisnik")).toBeEnabled()
  })

  test("HTTP greška API-ja se prikaže u assistant mjehuru", async ({ page }) => {
    await otvoriNoviRazgovor(page)
    // Rate-limit odgovor: JSON bez završnog newline-a — bez `res.ok` provjere ostao bi
    // u bufferu i mjehur bi zauvijek stajao na placeholderu.
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "Previše zahtjeva" }),
      }),
    )
    await page.getByTestId("chat-input").fill("Koji termini kasne?")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("msg-assistant").last()).toContainText("Previše zahtjeva", { timeout: 10000 })
    await page.unroute("**/api/chat")
  })

  test("follow-up poruka u istom razgovoru", async ({ page }) => {
    await otvoriNoviRazgovor(page)
    await page.getByTestId("chat-input").fill("Prikaži firme")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("msg-assistant").last()).toContainText("pregled", { timeout: 10000 })
    await page.getByTestId("chat-input").fill("A koji kasne?")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("msg-user")).toHaveCount(2)
  })

  test("razgovor se pojavi u sidebar listi nakon poruke", async ({ page }) => {
    await otvoriNoviRazgovor(page)
    await page.getByTestId("chat-input").fill("Test sidebar poruka")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("msg-assistant").last()).toBeVisible({ timeout: 10000 })
    await page.reload()
    await expect(page.getByTestId("razgovor-link").filter({ hasText: "Test sidebar poruka" }).first()).toBeVisible()
  })

  test("nema console grešaka na /asistent", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/asistent")
    await expect(page.getByRole("heading", { name: "Asistent" })).toBeVisible()
    expect(errors).toEqual([])
  })
})
