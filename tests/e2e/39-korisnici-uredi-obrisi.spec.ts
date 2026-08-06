import { test, expect } from "@playwright/test"
import { db, ensureOperater, deleteKorisnikByEmail } from "./db"

// Uredi podatke (ime+email) + trajno brisanje korisnika u /postavke → Korisnici.
// Throwaway operateri sa jedinstvenim @tehpro.test emailovima (isti obrazac kao
// 25-nalozi-lozinke; NE @example.com — Supabase Auth ga odbija) + čišćenje u finally.
// Admin je default storageState; sekcija "Korisnici" je collapsible (defaultOpen=false).
test.describe("Korisnici: uredi i obriši", () => {
  test("B1: uredi podatke — novo ime i email vidljivi u tabeli", async ({ page }) => {
    const ts = Date.now()
    const stariEmail = `e2e-uredi-${ts}@tehpro.test`
    const noviEmail = `e2e-uredjen-${ts}@tehpro.test`
    const staroIme = `E2E Uredi ${ts}`
    const novoIme = `E2E Uredjen ${ts}`
    const id = await ensureOperater(stariEmail, "Lozinka1!", staroIme)
    try {
      await page.goto("/postavke")
      await page.getByRole("button", { name: "Korisnici" }).click()
      await page.getByTestId("korisnici-pretraga").fill(staroIme)
      await page.getByTestId(`akcije-${id}`).click()
      await page.getByTestId(`uredi-${id}`).click()
      await page.getByTestId(`uredi-korisnik-ime-${id}`).fill(novoIme)
      await page.getByTestId(`uredi-korisnik-email-${id}`).fill(noviEmail)
      await page.getByTestId(`uredi-korisnik-submit-${id}`).click()
      await expect(page.getByText("Sačuvano")).toBeVisible({ timeout: 15_000 })
      // router.refresh() povlači svjež server-render — pretraži po NOVOM imenu.
      await page.getByTestId("korisnici-pretraga").fill(novoIme)
      await expect(page.getByText(noviEmail)).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteKorisnikByEmail(noviEmail)
      await deleteKorisnikByEmail(stariEmail)
    }
  })

  test("B2: obriši trajno — skriveno za aktivnog; deaktiviran se briše skupa sa auth nalogom", async ({ page }) => {
    const ts = Date.now()
    const email = `e2e-brisi-${ts}@tehpro.test`
    const ime = `E2E Brisi ${ts}`
    const id = await ensureOperater(email, "Lozinka1!", ime)
    try {
      await page.goto("/postavke")
      await page.getByRole("button", { name: "Korisnici" }).click()
      await page.getByTestId("korisnici-pretraga").fill(ime)

      // Aktivan korisnik: menija ima, "Obriši trajno" NEMA.
      await page.getByTestId(`akcije-${id}`).click()
      await expect(page.getByTestId(`deaktiviraj-${id}`)).toBeVisible()
      await expect(page.getByTestId(`obrisi-${id}`)).toHaveCount(0)

      // Deaktiviraj (potvrda u dijalogu; testId je na DialogContent, dugme po labeli).
      await page.getByTestId(`deaktiviraj-${id}`).click()
      await page
        .getByTestId(`deaktiviraj-potvrdi-${id}`)
        .getByRole("button", { name: "Deaktiviraj korisnika" })
        .click()
      await expect(page.getByText("Korisnik deaktiviran.")).toBeVisible({ timeout: 15_000 })

      // Obriši trajno.
      await page.getByTestId(`akcije-${id}`).click()
      await page.getByTestId(`obrisi-${id}`).click()
      await page
        .getByTestId(`obrisi-potvrdi-${id}`)
        .getByRole("button", { name: "Obriši trajno" })
        .click()
      await expect(page.getByText("Korisnik obrisan.")).toBeVisible({ timeout: 15_000 })

      // Red je nestao iz tabele (router.refresh poslije uspjeha).
      await expect(page.getByTestId(`akcije-${id}`)).toHaveCount(0, { timeout: 15_000 })

      // Auth nalog stvarno oslobođen (listUsers default strana pokriva mali DEMO skup —
      // isti oslonac kao deleteKorisnikByEmail).
      const { data: list } = await db.auth.admin.listUsers()
      expect(list?.users.some((u) => u.email?.toLowerCase() === email.toLowerCase())).toBe(false)
    } finally {
      await deleteKorisnikByEmail(email)
    }
  })
})
