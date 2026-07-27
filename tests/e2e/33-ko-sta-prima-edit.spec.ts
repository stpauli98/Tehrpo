import { test, expect } from "@playwright/test"
import { db, insertKlijent, deleteKlijentByNaziv, setPostavkeV2 } from "./db"

// Postavke → „Ko šta prima": sirovi per-firma prekidač je uređiv iz tabele, dok kolona
// „Firma prima?" ostaje IZVEDENA (globalno && firma && ima adrese) i read-only. Test brani
// upravo tu razliku — da toggle ne laže kad izvedeni ishod ostane „Ne".
//
// Izolacija: throwaway klijent (isti obrazac kao 24-podsjetnici-primaoci) + globalni
// prekidač se u finally vraća na false (DEMO default; true = živi Resend).
test.describe("Postavke → Ko šta prima (uređivanje)", () => {
  test("toggle upisuje per-firma flag, izvedeni badge se osvježi, link vodi na karticu firme", async ({ page }) => {
    const naziv = "E2E-TMP KSP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await setPostavkeV2({ salji_klijentima: true })
      // Firma mora imati validnu adresu da izvedeni badge UOPŠTE može postati „Da“ —
      // bez toga bi ovaj test dokazivao samo `nemaAdrese` putanju.
      const { error } = await db
        .from("klijenti")
        .update({ podsjetnik_emails: ["ksp-e2e@example.com"] })
        .eq("id", kid)
      if (error) throw new Error(`podsjetnik_emails: ${error.message}`)

      await page.goto("/postavke")
      await page.getByRole("button", { name: "Ko šta prima" }).click()

      const red = page.getByTestId(`ksp-red-${kid}`)
      await expect(red).toBeVisible()
      const toggle = page.getByTestId(`ksp-salji-${kid}`)
      const prima = page.getByTestId(`ksp-prima-${kid}`)

      // Početno: kolona default `salji_podsjetnik_klijentu = false` → izvedeno „Ne“ + razlog.
      await expect(toggle).not.toBeChecked()
      await expect(prima).toHaveText("Ne")
      await expect(page.getByTestId(`ksp-razlog-${kid}`)).toHaveText("firma isključena")

      // Uključi → server ponovo računa badge (router.refresh) → „Da“, razlog nestaje.
      await toggle.click()
      await expect(prima).toHaveText("Da")
      await expect(page.getByTestId(`ksp-razlog-${kid}`)).toHaveCount(0)

      // Reload → perzistiralo (SSR fetch, ne lokalni state).
      await page.reload()
      await page.getByRole("button", { name: "Ko šta prima" }).click()
      await expect(page.getByTestId(`ksp-salji-${kid}`)).toBeChecked()
      await expect(page.getByTestId(`ksp-prima-${kid}`)).toHaveText("Da")

      // Isključi → vraća se na „Ne“ + razlog „firma isključena“.
      await page.getByTestId(`ksp-salji-${kid}`).click()
      await expect(page.getByTestId(`ksp-prima-${kid}`)).toHaveText("Ne")
      await expect(page.getByTestId(`ksp-razlog-${kid}`)).toHaveText("firma isključena")

      // Primaoci se NE uređuju odavde — ćelija „Adrese firme“ vodi na klijentov tab.
      await page.getByTestId(`ksp-adrese-link-${kid}`).click()
      await expect(page).toHaveURL(new RegExp(`/klijenti/${kid}\\?tab=podsjetnici`))
      await expect(page.getByTestId("klijent-podsjetnici-form")).toBeVisible()
    } finally {
      await setPostavkeV2({ salji_klijentima: false })
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("globalni prekidač isključen → toggle je disabled i banner objašnjava zašto", async ({ page }) => {
    const naziv = "E2E-TMP KSP OFF " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await setPostavkeV2({ salji_klijentima: false })

      await page.goto("/postavke")
      await page.getByRole("button", { name: "Ko šta prima" }).click()

      await expect(page.getByTestId("ksp-global-off-banner")).toBeVisible()
      await expect(page.getByTestId(`ksp-salji-${kid}`)).toBeDisabled()
      // Read-only dio ostaje čitljiv — sakriva se samo mogućnost upisa.
      await expect(page.getByTestId(`ksp-prima-${kid}`)).toHaveText("Ne")
      await expect(page.getByTestId(`ksp-razlog-${kid}`)).toHaveText("globalni prekidač isključen")
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})
