import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import { ensureOperater, deleteKorisnikByEmail } from "./db"

// A1: prijavljen korisnik mijenja svoju lozinku (traži trenutnu). A2: admin "Pošalji reset".
// Throwaway operater sa JEDINSTVENIM emailom + brisanje u finally — da izmijenjena lozinka
// ne ostane i ne razbije auth drugih testova (NE koristiti fiksni test-nalog).
// Domen @tehpro.test (RFC 2606 rezervisan TLD, isti obrazac kao 18-auth-rls/23-podsjetnici-v2) —
// NE @example.com: Supabase Auth resetPasswordForEmail (koristi A2) odbija example.com kao
// nevažeću adresu ("Email address ... is invalid"), dok .test domen prolazi.
test.describe("Nalozi i lozinke", () => {
  test("A1: promjena lozinke — pogrešna trenutna → greška; tačna → uspjeh", async ({ page, context }) => {
    const email = `e2e-loz-${Date.now()}@tehpro.test`
    const staraLoz = "StaraLoz1!"
    await ensureOperater(email, staraLoz, "E2E Lozinka Op")
    try {
      await injectSessionFor(context, email, staraLoz)
      await page.goto("/postavke")
      // "Moj nalog" je collapsible sekcija (defaultOpen=false) — otvori prije interakcije
      // (isti obrazac kao otvoriPodsjetnike u 23-podsjetnici-v2.spec.ts).
      await page.getByRole("button", { name: "Moj nalog" }).click()
      await expect(page.getByTestId("moj-nalog-form")).toBeVisible({ timeout: 30_000 })

      // pogrešna trenutna → greška (toast)
      await page.getByTestId("loz-trenutna").fill("PogresnaLoz9!")
      await page.getByTestId("loz-nova").fill("NovaLoz123!")
      await page.getByTestId("loz-potvrda").fill("NovaLoz123!")
      await page.getByTestId("loz-submit").click()
      await expect(page.getByText("Trenutna lozinka nije tačna.")).toBeVisible({ timeout: 15_000 })

      // tačna trenutna → uspjeh
      await page.getByTestId("loz-trenutna").fill(staraLoz)
      await page.getByTestId("loz-nova").fill("NovaLoz123!")
      await page.getByTestId("loz-potvrda").fill("NovaLoz123!")
      await page.getByTestId("loz-submit").click()
      await expect(page.getByText("Lozinka je promijenjena.")).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteKorisnikByEmail(email)
    }
  })

  // A2 zavisi od Supabase Auth reset-email slanja. DEMO nema custom SMTP → default sender ima
  // vrlo nizak rate limit ("email rate limit exceeded"). Kod (posaljiResetKorisniku + UI) je
  // verifikovan kroz task-review; test se re-enable-uje kad se konfiguriše custom SMTP za Auth.
  test.fixme("A2: admin Pošalji reset za korisnika → success toast", async ({ page }) => {
    const email = `e2e-reset-${Date.now()}@tehpro.test`
    await ensureOperater(email, "StaraLoz1!", "E2E Reset Op")
    try {
      // admin (default storageState) → Postavke → Korisnici
      await page.goto("/postavke")
      await page.getByRole("button", { name: "Korisnici" }).click()
      await page.getByTestId("korisnici-pretraga").fill("E2E Reset Op")
      // otvori akcije reda pa klikni Pošalji reset
      const red = page.locator('[data-testid^="akcije-"]').first()
      await red.click()
      await page.locator('[data-testid^="posalji-reset-"]').first().click()
      await expect(page.getByText(new RegExp(`Reset link poslat na ${email}`))).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteKorisnikByEmail(email)
    }
  })
})
