import { test, expect } from "@playwright/test"
import {
  db,
  insertKlijent,
  deleteKlijentByNaziv,
  setPostavkeV2,
  getPostavkeV2,
  ensureKorisnik,
  deleteKorisnikByEmail,
  assignKlijent,
} from "./db"

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
    const prije = (await getPostavkeV2()).podsjetnici_aktivni
    try {
      // Automatika mora biti uključena — inače bi najviši razlog bio „automatsko slanje
      // isključeno", a test provjerava upravo razliku globalno/per-firma ispod nje.
      await setPostavkeV2({ salji_klijentima: true, podsjetnici_aktivni: true })
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
      await setPostavkeV2({ salji_klijentima: false, podsjetnici_aktivni: prije })
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("globalni prekidač isključen → toggle disabled, razlog na hover, bez linka u ćorsokak", async ({ page }) => {
    const naziv = "E2E-TMP KSP OFF " + Date.now()
    const kid = await insertKlijent(naziv)
    const prije = (await getPostavkeV2()).podsjetnici_aktivni
    try {
      // Automatika mora biti uključena — inače bi razlog bio „automatsko slanje isključeno",
      // ne „globalni prekidač isključen" koji ovaj test provjerava.
      await setPostavkeV2({ salji_klijentima: false, podsjetnici_aktivni: true })

      await page.goto("/postavke")
      // Sekcija sa glavnim prekidačem se otvara PRIJE klika u banneru — samo tako je
      // ta komponenta montirana i test zaista provjerava sinhronizaciju sa novim
      // serverskim propom (zatvorena sekcija bi se ionako montirala svježa).
      await page.getByRole("button", { name: "Email podsjetnici" }).click()
      await expect(page.getByTestId("salji-klijentima-toggle")).not.toBeChecked()
      await page.getByRole("button", { name: "Ko šta prima" }).click()

      await expect(page.getByTestId("ksp-global-off-banner")).toBeVisible()
      await expect(page.getByTestId(`ksp-salji-${kid}`)).toBeDisabled()
      // Read-only dio ostaje čitljiv — sakriva se samo mogućnost upisa.
      await expect(page.getByTestId(`ksp-prima-${kid}`)).toHaveText("Ne")
      await expect(page.getByTestId(`ksp-razlog-${kid}`)).toHaveText("globalni prekidač isključen")

      // Razlog MORA biti vidljiv na hover — `title` na disabled elementu Chrome ne
      // prikazuje, pa ga nosi tooltip na omotaču.
      const razlog = page.getByTestId(`ksp-red-${kid}`).getByText(/Prvo uključi/).first()
      await expect(razlog).toBeHidden()
      await page.getByTestId(`ksp-salji-omotac-${kid}`).hover()
      await expect(razlog).toBeVisible()

      // „Adrese firme" ne smije voditi na karticu firme dok je globalno isključeno —
      // tamo forme nema, pa bi to bio ćorsokak.
      await expect(page.getByTestId(`ksp-adrese-link-${kid}`)).toHaveCount(0)

      // Umjesto toga: prekidač se uključuje iz banner-a (sekcija sa njim je zatvorena).
      await page.getByTestId("ksp-ukljuci-globalno").click()
      await expect(page.getByTestId("ksp-global-off-banner")).toBeHidden()
      await expect(page.getByTestId(`ksp-salji-${kid}`)).toBeEnabled()
      await expect(page.getByTestId(`ksp-adrese-link-${kid}`)).toBeVisible()
      // Već montirani glavni prekidač mora pokazati novo stanje, a ne ono iz mounta.
      await expect(page.getByTestId("salji-klijentima-toggle")).toBeChecked()
    } finally {
      await setPostavkeV2({ salji_klijentima: false, podsjetnici_aktivni: prije })
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("automatika isključena → badge „Ne“ sa razlogom, banner, i sažetak ne tvrdi da firme primaju", async ({ page }) => {
    const naziv = "E2E-TMP KSP AUTO " + Date.now()
    const kid = await insertKlijent(naziv)
    const prije = (await getPostavkeV2()).podsjetnici_aktivni
    try {
      // Firma je potpuno spremna za slanje — jedini razlog smije biti automatika.
      await setPostavkeV2({ salji_klijentima: true, podsjetnici_aktivni: false })
      const { error } = await db
        .from("klijenti")
        .update({ salji_podsjetnik_klijentu: true, podsjetnik_emails: ["ksp-auto@example.com"] })
        .eq("id", kid)
      if (error) throw new Error(`priprema firme: ${error.message}`)

      await page.goto("/postavke")
      await page.getByRole("button", { name: "Ko šta prima" }).click()

      await expect(page.getByTestId("ksp-automatika-off-banner")).toBeVisible()
      await expect(page.getByTestId(`ksp-prima-${kid}`)).toHaveText("Ne")
      await expect(page.getByTestId(`ksp-razlog-${kid}`)).toHaveText("automatsko slanje isključeno")
      await expect(page.getByTestId("ksp-sazetak")).toContainText("automatsko slanje je isključeno")

      // Per-firma kontrola OSTAJE omogućena: ručni „Pokreni sada" koristi taj flag.
      await expect(page.getByTestId(`ksp-salji-${kid}`)).toBeEnabled()

      // Uključena automatika → isti red odmah prelazi na „Da", bez ostalih izmjena.
      await setPostavkeV2({ podsjetnici_aktivni: true })
      await page.reload()
      await page.getByRole("button", { name: "Ko šta prima" }).click()
      await expect(page.getByTestId("ksp-automatika-off-banner")).toHaveCount(0)
      await expect(page.getByTestId(`ksp-prima-${kid}`)).toHaveText("Da")
    } finally {
      await setPostavkeV2({ salji_klijentima: false, podsjetnici_aktivni: prije })
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("kartica firme: kad je globalno isključeno admin ga uključi u mjestu, bez vraćanja u Postavke", async ({ page }) => {
    const naziv = "E2E-TMP KSP TAB " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await setPostavkeV2({ salji_klijentima: false })

      await page.goto(`/klijenti/${kid}?tab=podsjetnici`)
      await expect(page.getByTestId("podsjetnici-global-off")).toBeVisible()
      await expect(page.getByTestId("klijent-podsjetnici-form")).toHaveCount(0)

      await page.getByTestId("ksp-ukljuci-globalno").click()
      // router.refresh() — akcija revalidira samo /postavke, ne zna o kojoj je firmi riječ.
      await expect(page.getByTestId("klijent-podsjetnici-form")).toBeVisible()
      await expect(page.getByTestId("podsjetnici-global-off")).toHaveCount(0)
    } finally {
      await setPostavkeV2({ salji_klijentima: false })
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("kolona radnika razlikuje „nema dodijeljenih“ od „dodijeljeni ne primaju“", async ({ page }) => {
    const naziv = "E2E-TMP KSP RAD " + Date.now()
    const email = `e2e-optout-${Date.now()}@example.com`
    const kid = await insertKlijent(naziv)
    let uid: string | null = null
    try {
      // Prvo bez dodjele → „nema dodijeljenih".
      await page.goto("/postavke")
      await page.getByRole("button", { name: "Ko šta prima" }).click()
      await expect(page.getByTestId(`ksp-radnici-razlog-${kid}`)).toHaveText("nema dodijeljenih")

      // Dodijeli operatera koji NE prima podsjetnike → „dodijeljeni su, ali ne primaju".
      uid = await ensureKorisnik(email, "E2eLozinka!23", "E2E OptOut", "operater")
      const { error } = await db.from("korisnici").update({ prima_podsjetnike: false }).eq("id", uid)
      if (error) throw new Error(`opt-out: ${error.message}`)
      await assignKlijent(uid, kid)

      await page.reload()
      await page.getByRole("button", { name: "Ko šta prima" }).click()
      await expect(page.getByTestId(`ksp-radnici-razlog-${kid}`)).toHaveText(
        "dodijeljeni su, ali ne primaju podsjetnike",
      )

      // Uključi mu podsjetnike → ime se pojavi, razloga više nema.
      const { error: e2 } = await db.from("korisnici").update({ prima_podsjetnike: true }).eq("id", uid)
      if (e2) throw new Error(`opt-in: ${e2.message}`)
      await page.reload()
      await page.getByRole("button", { name: "Ko šta prima" }).click()
      await expect(page.getByTestId(`ksp-radnici-razlog-${kid}`)).toHaveCount(0)
      await expect(page.getByTestId(`ksp-red-${kid}`)).toContainText("E2E OptOut")
    } finally {
      if (uid) await deleteKorisnikByEmail(email)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("iznad tabele piše ko uvijek prima (admini + REMINDER_TO)", async ({ page }) => {
    await page.goto("/postavke")
    await page.getByRole("button", { name: "Ko šta prima" }).click()
    const red = page.getByTestId("ksp-uvijek-primaju")
    await expect(red).toBeVisible()
    // E2E se prijavljuje kao admin koji prima podsjetnike, pa spisak ne smije biti prazan.
    await expect(red).toContainText("Uvijek primaju")
    await expect(red).toContainText("@")
  })

  test("Korisnici: toggle podsjetnika je disabled za deaktiviranog, sa razlogom na hover", async ({ page }) => {
    const email = `e2e-deakt-${Date.now()}@example.com`
    const uid = await ensureKorisnik(email, "E2eLozinka!23", "E2E Deaktivirani", "operater")
    try {
      const { error } = await db.from("korisnici").update({ aktivan: false }).eq("id", uid)
      if (error) throw new Error(`deaktivacija: ${error.message}`)

      await page.goto("/postavke")
      await page.getByRole("button", { name: "Korisnici" }).click()
      const toggle = page.getByTestId(`prima-podsjetnike-${uid}`)
      await expect(toggle).toBeDisabled()
      // Tooltip je display:none do hovera, a disabled checkbox ne može dobiti fokus —
      // tastatura/čitač ekrana idu isključivo preko pristupačnog imena.
      await expect(toggle).toHaveAccessibleName(/Deaktiviran korisnik ne prima/)

      const razlog = page.getByTestId(`prima-omotac-${uid}`).getByText(/Deaktiviran korisnik ne prima/)
      await expect(razlog).toBeHidden()
      await page.getByTestId(`prima-omotac-${uid}`).hover()
      await expect(razlog).toBeVisible()
    } finally {
      await deleteKorisnikByEmail(email)
    }
  })
})
