import { test, expect } from "@playwright/test"

test.describe("Obilasci dorada — status filter", () => {
  test("default je Aktivni (bez izvršenih); Svi vraća izvršene", async ({ page }) => {
    await page.goto("/obilasci?period=godina&godina=2026")
    // default Aktivni → nijedna kartica nema status badge "Izvršen"
    await expect(page.getByTestId("obilasci-status")).toBeVisible()
    // čekaj da se sadržaj renderuje (hidracija) prije count(0) i interakcije sa Select-om —
    // toHaveCount(0) bi prošao vakuumski na još-praznoj stranici i klik bi se izgubio
    await expect(page.getByTestId("obilasci-grupa").first()).toBeVisible()
    // čekaj da mreža stane (hidracija JS završena) — bez ovoga prvi klik može biti zagubljen
    await page.waitForLoadState("networkidle")
    const izvrseniDefault = page.getByTestId("obilasci-card").locator('[data-status="izvrseno"]')
    await expect(izvrseniDefault).toHaveCount(0)
    // prebaci na Svi → pojave se izvršeni
    const statusTrigger = page.getByTestId("obilasci-status")
    await statusTrigger.click()
    const sviOpcija = page.getByRole("option", { name: "Svi" })
    await expect(sviOpcija).toBeVisible()
    await sviOpcija.click()
    await page.waitForURL(/status=svi/)
    await expect(page.getByTestId("obilasci-card").locator('[data-status="izvrseno"]').first()).toBeVisible()
  })
})

test.describe("Obilasci dorada — grupisanje po gradu", () => {
  test("ima više grupa gradova (ne samo 'Bez grada') i broj u zaglavlju", async ({ page }) => {
    await page.goto("/obilasci?period=godina&godina=2026&status=svi")
    const grupe = page.getByTestId("obilasci-grupa")
    expect(await grupe.count()).toBeGreaterThan(1)
    // bar jedno zaglavlje sadrži grad Banja Luka ili Prijedor
    await expect(page.getByRole("heading", { name: /Banja Luka|Prijedor|Zvornik/ }).first()).toBeVisible()
    // zaglavlje prikazuje broj u zagradama, npr. "(3)"
    await expect(page.getByTestId("obilasci-grupa").first().getByText(/\(\d+\)/).first()).toBeVisible()
  })
})
