// tests/e2e/26-pregled-readonly.spec.ts
// pregled — Task 5 verifikacija: RLS mu daje pristup samo dodijeljenim firmama (isto kao operater),
// ali write-akcije (Task 2-4 gate: useMozeUrediti) MORAJU biti sakrivene u UI-u, dok čitanje radi.
// Throwaway pregled korisnik + throwaway firma; brisanje u finally.
import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import {
  ensureKorisnik,
  deleteKorisnikByEmail,
  insertKlijent,
  assignKlijent,
  deleteKlijentByNaziv,
} from "./db"

const LOZINKA = "PregledLoz1!"

// Ovaj fajl NE koristi admin storageState — svaki test kreira svoj kontekst (isti obrazac kao 18-auth-rls.spec.ts).
test.use({ storageState: { cookies: [], origins: [] } })

test.describe("pregled — read-only UX", () => {
  test("pregled ne vidi write dugmad na kartici klijenta, ali vidi podatke", async ({ page, context }) => {
    const email = `e2e-pregled-${Date.now()}@tehpro.test`
    const naziv = "E2E-TMP PREGLED " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      const uid = await ensureKorisnik(email, LOZINKA, "E2E Pregled", "pregled")
      await assignKlijent(uid, kid)
      await injectSessionFor(context, email, LOZINKA)

      // Default tab (bez ?tab=) je "termini" — vidi app/(dashboard)/klijenti/[id]/page.tsx.
      await page.goto(`/klijenti/${kid}`)

      // čitanje radi: naziv firme vidljiv (h1, uvijek renderovan van tab-conditional bloka)
      await expect(page.getByTestId("klijent-naziv")).toHaveText(naziv, { timeout: 30_000 })

      // write-akcije SAKRIVENE (pure-trigger gate: useMozeUrediti() → return null za pregled):
      // 1) "Uredi klijenta" — header, van tab-conditional bloka, uvijek na ekranu.
      await expect(page.getByTestId("uredi-klijent-btn")).toHaveCount(0)
      // 2) "Dodaj provjeru" — na "termini" tabu (default), koji je aktivan bez navigacije.
      await expect(page.getByTestId("dodaj-provjeru-btn")).toHaveCount(0)

      // 3) "Novi kontakt" — na "kontakti" tabu, navigiraj tamo za dodatnu potvrdu.
      await page.goto(`/klijenti/${kid}?tab=kontakti`)
      await expect(page.getByTestId("tab-kontakti-content")).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId("novi-kontakt-btn")).toHaveCount(0)
      // Naziv (header) ostaje vidljiv i na ovom tabu — potvrda da čitanje i dalje radi.
      await expect(page.getByTestId("klijent-naziv")).toHaveText(naziv)
    } finally {
      await deleteKlijentByNaziv(naziv)
      await deleteKorisnikByEmail(email)
    }
  })
})
