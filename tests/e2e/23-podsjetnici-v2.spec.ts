import { test, expect, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  insertKlijent,
  deleteKlijentByNaziv,
  ensureOperater,
  clearDodjele,
  getPostavkeV2,
  setPostavkeV2,
} from "./db"

// Pročitaj CRON_SECRET iz .env.local apsolutnom putanjom (isti obrazac kao 06-podsjetnici.spec.ts).
function cronSecret(): string {
  const p = path.resolve(process.cwd(), ".env.local")
  const txt = readFileSync(p, "utf8")
  const line = txt.split("\n").find((l) => l.startsWith("CRON_SECRET="))
  const val = line ? line.slice("CRON_SECRET=".length).trim() : ""
  if (!val) throw new Error("CRON_SECRET nije u .env.local — vidi Task 2 Step 3")
  return val
}

// Sekcije na /postavke su collapsible (zatvorene po defaultu) — otvori prije interakcije
// (isti obrazac kao tests/e2e/06-podsjetnici.spec.ts).
const otvoriPodsjetnike = (page: Page) => page.getByRole("button", { name: "Email podsjetnici" }).click()
const otvoriKorisnici = (page: Page) => page.getByRole("button", { name: "Korisnici" }).click()

// Fiksni test-operater namijenjen SAMO ovoj datoteci (različit email od
// e2e-operater@tehpro.test koji koristi 18-auth-rls.spec.ts) — izbjegava
// kontaminaciju stanja između specova ako se ikad pokrenu izvan reda.
const RADNIK_EMAIL = "e2e-radnik-podsjetnici-v2@tehpro.test"
const RADNIK_LOZINKA = "E2eRadnikV2!2026"
const RADNIK_IME = "E2E Radnik Podsjetnici V2"

test.describe.configure({ mode: "serial" })

test.describe("Podsjetnici v2", () => {
  // Sigurnosna mreža uz try/finally u svakom testu: eksterni prekidač (živi Resend
  // + REMINDER_TO na DEMO) MORA ostati isključen bez obzira šta se desi u testovima.
  test.afterAll(async () => {
    await setPostavkeV2({ salji_klijentima: false })
  })

  test("vrijeme slanja se sačuva i prikaže", async ({ page }) => {
    const prije = (await getPostavkeV2()).vrijeme_slanja_sat
    try {
      await page.goto("/postavke")
      await otvoriPodsjetnike(page)
      const select = page.getByTestId("vrijeme-slanja-select")
      await expect(select).toBeVisible()

      await select.selectOption("9")
      // Select se disable-uje dok je server akcija pending (isti obrazac kao ostali
      // testovi u ovoj datoteci) — sačekaj da se vrati enabled prije reload-a.
      await expect(select).toBeEnabled()

      await page.reload()
      await otvoriPodsjetnike(page)
      await expect(page.getByTestId("vrijeme-slanja-select")).toHaveValue("9")
    } finally {
      // Restore direktno u DB (pouzdanije od ponovnog UI round-trip-a ako je gornji
      // blok pukao na pola) — vrati na vrijednost pročitanu PRIJE mutacije.
      await setPostavkeV2({ vrijeme_slanja_sat: prije })
    }
  })

  test("globalni prekidač slanja firmama se sačuva", async ({ page }) => {
    try {
      await page.goto("/postavke")
      await otvoriPodsjetnike(page)
      const toggle = page.getByTestId("salji-klijentima-toggle")
      await expect(toggle).toBeVisible()

      await toggle.click()
      await expect(toggle).toBeChecked()
      await expect(toggle).toBeEnabled()

      await page.reload()
      await otvoriPodsjetnike(page)
      await expect(page.getByTestId("salji-klijentima-toggle")).toBeChecked()
    } finally {
      // KRITIČNO — izolacija: ovaj prekidač otvara slanje pravim adresama firmi na
      // DEMO (živi Resend). MORA završiti na false, bez obzira na prethodno stanje
      // (ne "vrati na prije" — force false je namjeran, vidi task-12 brief).
      await setPostavkeV2({ salji_klijentima: false })
    }
  })

  test("tab firme: per-firma toggle + dodavanje/uklanjanje adrese", async ({ page }) => {
    const naziv = "E2E-TMP PODSJETNICI-V2 " + Date.now()
    const email = "e2e-firma-podsjetnici@example.com"
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=podsjetnici`)
      await expect(page.getByTestId("tab-podsjetnici-content")).toBeVisible()

      const saljiToggle = page.getByTestId("klijent-salji-toggle")
      await expect(saljiToggle).not.toBeChecked()
      await saljiToggle.click()
      await expect(saljiToggle).toBeChecked()
      await expect(saljiToggle).toBeEnabled()

      await page.getByTestId("klijent-email-input").fill(email)
      await page.getByTestId("klijent-email-add").click()
      await expect(page.getByTestId(`klijent-email-${email}`)).toBeVisible()
      await expect(page.getByTestId("klijent-email-add")).toBeEnabled()

      // Reload — potvrdi da je i toggle i adresa stvarno perzistirana u DB (SSR fetch), ne
      // samo lokalni React state.
      await page.reload()
      await expect(page.getByTestId("tab-podsjetnici-content")).toBeVisible()
      await expect(page.getByTestId("klijent-salji-toggle")).toBeChecked()
      await expect(page.getByTestId(`klijent-email-${email}`)).toBeVisible()

      // Ukloni adresu (chip → X dugme unutra)
      await page.getByTestId(`klijent-email-${email}`).getByRole("button").click()
      await expect(page.getByTestId(`klijent-email-${email}`)).toHaveCount(0)

      // Restore: isključi slanje (izolacija zahtijeva salji=false, prazna lista adresa)
      await saljiToggle.click()
      await expect(saljiToggle).not.toBeChecked()
      await expect(saljiToggle).toBeEnabled()

      await page.reload()
      await expect(page.getByTestId("tab-podsjetnici-content")).toBeVisible()
      await expect(page.getByTestId("klijent-salji-toggle")).not.toBeChecked()
      await expect(page.getByTestId(`klijent-email-${email}`)).toHaveCount(0)
    } finally {
      // Throwaway klijent — brisanje uklanja i eventualno zaostalo stanje ako je gornji blok pukao.
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("dodjela radnika sa strane firme se odrazi u Postavke → Korisnici", async ({ page }) => {
    const naziv = "E2E-TMP DODJELA-V2 " + Date.now()
    const kid = await insertKlijent(naziv)
    const radnikId = await ensureOperater(RADNIK_EMAIL, RADNIK_LOZINKA, RADNIK_IME)
    await clearDodjele(radnikId) // osiguraj čist početak (radnik nije već negdje dodijeljen)
    try {
      await page.goto(`/klijenti/${kid}?tab=podsjetnici`)
      await expect(page.getByTestId("tab-podsjetnici-content")).toBeVisible()

      const radnikCheckbox = page.getByTestId(`radnik-${radnikId}`).getByRole("checkbox")
      await expect(radnikCheckbox).toBeVisible()
      await expect(radnikCheckbox).not.toBeChecked()
      await radnikCheckbox.check()

      await page.getByTestId("dodjela-radnika-spasi").click()
      // Dugme se disable-uje dok traje snimanje ("Snimam…") — sačekaj povratak (snimljeno).
      await expect(page.getByTestId("dodjela-radnika-spasi")).toBeEnabled()

      // Dvosmjerna provjera: Postavke → Korisnici mora prikazati istu dodjelu.
      await page.goto("/postavke")
      await otvoriKorisnici(page)
      await page.getByTestId("korisnici-pretraga").fill(RADNIK_IME)
      await page.getByTestId(`dodjela-${radnikId}`).click()
      const dialog = page.getByRole("dialog")
      await expect(dialog.locator("label", { hasText: naziv }).getByRole("checkbox")).toBeChecked()
      await dialog.getByRole("button", { name: "Otkaži" }).click()
    } finally {
      // Restore: ukloni dodjelu (izolacija) prije brisanja throwaway klijenta; radnik
      // (fiksni test-nalog) ostaje aktivan i bez dodjela za sljedeći run (idempotentno).
      await clearDodjele(radnikId)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("Pokreni sada: dugme/dijalog su ispravno povezani (BEZ stvarnog pokretanja)", async ({ page }) => {
    // pokreniPodsjetnikeSada() (app/(dashboard)/postavke/actions.ts) hardkodira
    // { dryRun: false } prema POST /api/cron/reminders — a DEMO ima aktivan (živi)
    // RESEND_API_KEY + REMINDER_TO. Stvaran klik na "potvrdi" bi poslao pravi email.
    // Zato ovdje testiramo SAMO UI kablovanje (dugme → dijalog → testid potvrde
    // vidljiv) i zatvaramo dijalog Escape-om, bez klika na potvrdi. Sama "gate-bypass"
    // logika (POST radi bez obzira na sat/dan) se dokazuje sljedećim testom preko
    // direktnog dryRun:true API poziva.
    await page.goto("/postavke")
    await otvoriPodsjetnike(page)
    await page.getByTestId("pokreni-podsjetnike").click()
    await expect(page.getByTestId("pokreni-podsjetnike-potvrdi")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("pokreni-podsjetnike-potvrdi")).toHaveCount(0)
  })

  test("regresija: POST /api/cron/reminders zaobilazi sat/dnevni gate (dry)", async ({ request }) => {
    const prije = await getPostavkeV2()
    // Stanje koje bi GET (auto-cron) sigurno preskočio: sat u budućnosti (23) i
    // marker "već slato danas" (zadnje_slanje_datum = danas po Europe/Vienna).
    const danas = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(new Date())
    await setPostavkeV2({ vrijeme_slanja_sat: 23, zadnje_slanje_datum: danas })
    try {
      const secret = cronSecret()
      const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }
      const res = await request.post("/api/cron/reminders", { headers, data: { dryRun: true } })
      expect(res.status()).toBe(200)
      const body = await res.json()
      // route.ts: gate (sat/zadnje_slanje_datum) provjerava SAMO GET; da je POST greškom
      // počeo poštovati gate, odgovor bi bio { ok:true, skipped:"izvan_sata" | "vec_slato_danas" }
      // (skipped=string) — umjesto stvarnog rezultata runReminders (skipped=niz).
      expect(Array.isArray(body.sent)).toBe(true)
      expect(Array.isArray(body.skipped)).toBe(true)
      expect(Array.isArray(body.errors)).toBe(true)
    } finally {
      await setPostavkeV2({
        vrijeme_slanja_sat: prije.vrijeme_slanja_sat,
        zadnje_slanje_datum: prije.zadnje_slanje_datum,
      })
    }
  })
})
