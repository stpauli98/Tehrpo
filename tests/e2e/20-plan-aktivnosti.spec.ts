import { test, expect } from "@playwright/test"

test.describe("Plan aktivnosti — konsolidacija", () => {
  test("default view = kalendar; switcher mijenja prikaz", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await expect(page.getByTestId("plan-view-switcher")).toBeVisible()
    await expect(page.getByTestId("view-kalendar")).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("plan-grid")).toBeVisible()

    await page.getByTestId("view-lista").click()
    await page.waitForURL(/view=lista/)
    await expect(page.getByTestId("view-lista")).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("termini-filters")).toBeVisible()

    await page.getByTestId("view-matrica").click()
    await page.waitForURL(/view=matrica/)
    await expect(page.getByTestId("view-matrica")).toHaveAttribute("data-active", "true")
  })

  test("filter se zadrži pri promjeni view-a", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=lista&status=kasni")
    await page.getByTestId("view-kalendar").click()
    await page.waitForURL(/status=kasni/)
    await expect(page).toHaveURL(/view=kalendar/)
  })

  test("redirect: /termini?status=kasni -> /plan-aktivnosti?...view=lista", async ({ page }) => {
    await page.goto("/termini?status=kasni")
    await page.waitForURL(/\/plan-aktivnosti\?/)
    await expect(page).toHaveURL(/view=lista/)
    await expect(page).toHaveURL(/status=kasni/)
  })

  test("matrica NEMA grafikon; Pregled IMA grafikon", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=matrica")
    await expect(page.getByTestId("dashboard-chart")).toHaveCount(0)
    await page.goto("/pregled")
    await expect(page.getByTestId("dashboard-chart")).toBeVisible()
  })

  test("Sidebar: postoji 'Plan aktivnosti', nema Termini/Prikaz/Plan", async ({ page }) => {
    await page.goto("/pregled")
    const nav = page.getByRole("navigation", { name: "Glavna navigacija" })
    await expect(nav.getByRole("link", { name: "Plan aktivnosti" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Termini", exact: true })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: "Prikaz", exact: true })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: "Plan", exact: true })).toHaveCount(0)
  })
})

test.describe("Plan aktivnosti — izvoz modal", () => {
  test("otvara modal, default period, Prilagodi otkriva opcije", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("izvoz-trigger").click()
    await expect(page.getByTestId("izvoz-modal")).toBeVisible()
    // Prilagodi skriveno na početku
    await expect(page.getByTestId("izvoz-period")).toHaveCount(0)
    await page.getByTestId("izvoz-prilagodi").click()
    await expect(page.getByTestId("izvoz-period")).toBeVisible()
    await expect(page.getByTestId("izvoz-period-om")).toBeChecked()
    // Živi broj se prikaže (bilo koji tekst)
    await expect(page.getByTestId("izvoz-broj")).not.toHaveText("")
  })

  test("Preuzmi pokreće download (Excel)", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("izvoz-trigger").click()
    await page.getByTestId("izvoz-format-xlsx").click()
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("izvoz-preuzmi").click(),
    ])
    expect(download.suggestedFilename()).toMatch(/plan-aktivnosti-.*\.xlsx$/)
  })

  // Period iz modala zamjenjuje datumski filter stranice, pa modal koji se uvijek
  // otvarao na „Ovaj mjesec" tiho izvozi drugi mjesec od onog koji je na ekranu.
  test("modal se otvara na periodu koji je na ekranu", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=lista&mjesec=3&godina=2026")
    await page.getByTestId("izvoz-trigger").click()
    await page.getByTestId("izvoz-prilagodi").click()
    await expect(page.getByTestId("izvoz-period-mj")).toBeChecked()
    await expect(page.getByTestId("izvoz-mjesec")).toContainText("Mart")
    await expect(page.getByTestId("izvoz-mj-godina")).toContainText("2026")
  })

  // Matrica bira firmu kroz `klijent`, a izvoz je čitao samo `klijent_id` — filter je
  // ispadao, a modal je uz to tvrdio da filtera nema.
  test("filter firme sa Matrice se vidi u opsegu izvoza", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=matrica&mode=klijent")
    await page.getByTestId("prikaz-klijent").click()
    await page.getByRole("option").nth(1).click()
    await expect(page).toHaveURL(/[?&]klijent=/)

    await page.getByTestId("izvoz-trigger").click()
    await page.getByTestId("izvoz-prilagodi").click()
    await page.getByTestId("izvoz-opseg-filtrirano").click()
    await expect(page.getByTestId("izvoz-filteri-status")).toHaveText("Filteri sa stranice su primijenjeni")
  })

  // Carry-over je do sada bio bezuslovan: septembarski plan je uvijek vukao i sve
  // otvorene obaveze iz ranijih mjeseci, a isključiti se moglo samo ručnim `preneseno=0`.
  test("prekidač prenesenih obaveza smanjuje izvoz na sam period", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=lista&mjesec=9&godina=2026")
    await page.getByTestId("izvoz-trigger").click()
    await page.getByTestId("izvoz-prilagodi").click()

    const prekidac = page.getByTestId("izvoz-preneseno")
    await expect(prekidac).toBeChecked()

    const broj = async () => {
      await expect(page.getByTestId("izvoz-broj")).toContainText(/\d/)
      const tekst = await page.getByTestId("izvoz-broj").innerText()
      return Number(tekst.replace(/\D/g, ""))
    }
    const sa = await broj()

    await prekidac.click()
    await expect(prekidac).not.toBeChecked()
    await expect
      .poll(broj, { message: "broj se mora smanjiti kad se prenesene isključe" })
      .toBeLessThan(sa)
  })

  test("prekidač prenesenih je onemogućen kad period nema donju granicu", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("izvoz-trigger").click()
    await page.getByTestId("izvoz-prilagodi").click()
    await page.getByTestId("izvoz-period-svi").click()
    await expect(page.getByTestId("izvoz-preneseno")).toBeDisabled()
  })

  test("prilagođeni raspon: nevažeći datumi drže Preuzmi onemogućen", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("izvoz-trigger").click()
    await page.getByTestId("izvoz-prilagodi").click()
    // Radio je sada base-ui primitiv (`role="radio"` span + skriveni input), pa se
    // bira klikom — `.check()` cilja native input element.
    await page.getByTestId("izvoz-period-raspon").click()
    await expect(page.getByTestId("izvoz-period-raspon")).toBeChecked()
    await page.getByTestId("izvoz-od").fill("2026-07-31")
    await page.getByTestId("izvoz-do").fill("2026-07-01")
    await expect(page.getByTestId("izvoz-preuzmi")).toBeDisabled()
  })
})

test.describe("Kalendar — dodavanje termina sa dana", () => {
  test("hover na dan → '+' otvara Novi termin sa prefilovanim rokom", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=kalendar&godina=2026&mjesec=7")
    const cell = page.locator('[data-testid="plan-day-cell"][data-date="2026-07-15"]')
    await expect(cell).toBeVisible()
    // dugme je u istoj ćeliji (sibling content sloja) — hover po ćeliji ga otkriva
    await cell.hover()
    const plus = page.locator('[data-testid="cell-dodaj-termin"][data-date="2026-07-15"]')
    await plus.click()
    await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()
    await expect(page.getByTestId("novi-rok")).toHaveValue("2026-07-15")
    await page.getByTestId("novi-cancel").click()
    await expect(page.getByTestId("novi-termin-sheet")).not.toBeVisible()
  })
})
