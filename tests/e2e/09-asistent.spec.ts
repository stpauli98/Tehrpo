import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.describe("Faza 8 — AI Asistent (mock)", () => {
  test("novi razgovor → poruka → streaming odgovor + tool indikator", async ({ page }) => {
    await page.goto("/asistent")
    await page.getByTestId("novi-razgovor").click()
    await expect(page).toHaveURL(/\/asistent\?k=/)
    await page.getByTestId("chat-input").fill("Koji termini kasne?")
    await page.getByTestId("chat-send").click()
    // user poruka
    await expect(page.getByTestId("msg-user").last()).toContainText("Koji termini kasne?")
    // assistant tekst (mock) + tool indikator
    await expect(page.getByTestId("msg-assistant").last()).toContainText("pregled", { timeout: 10000 })
    await expect(page.getByTestId("tool-indikator").last()).toBeVisible()
  })

  test("upit za zapisnik → prijedlog sa dugmetom 'Snimi zapisnik'", async ({ page }) => {
    await page.goto("/asistent")
    await page.getByTestId("novi-razgovor").click()
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
    await page.goto("/asistent")
    await page.getByTestId("novi-razgovor").click()
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
    await page.goto("/asistent")
    await page.getByTestId("novi-razgovor").click()
    await page.getByTestId("chat-input").fill("Prikaži firme")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("msg-assistant").last()).toContainText("pregled", { timeout: 10000 })
    await page.getByTestId("chat-input").fill("A koji kasne?")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("msg-user")).toHaveCount(2)
  })

  test("razgovor se pojavi u sidebar listi nakon poruke", async ({ page }) => {
    await page.goto("/asistent")
    await page.getByTestId("novi-razgovor").click()
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
