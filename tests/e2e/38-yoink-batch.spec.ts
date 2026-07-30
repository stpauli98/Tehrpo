import { test, expect } from "@playwright/test"
import { db, getPostavkeV2, setPostavkeV2, insertKlijent, insertLokacija, insertKontakt, deleteKlijentByNaziv } from "./db"

test.describe("Yoink batch 2026-07-30", () => {
  test("tab se zove Usluge, ne Profil", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
    await expect(page.getByTestId("tab-profil")).toContainText("Usluge")
    await expect(page.getByTestId("tab-profil")).not.toContainText("Profil")
  })

  test("ugovor se moze staviti na neodredjeno", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.getByTestId("tab-id-karta").click()
    await page.getByTestId("novi-ugovor-btn").click()

    await expect(page.getByTestId("ugovor-sheet")).toBeVisible()
    await page.getByTestId("ugovor-neodredjeno").click()
    // Datum isteka postaje neaktivan
    await expect(page.getByTestId("ugovor-istek")).toBeDisabled()
  })

  test("vazenje nudi custom broj mjeseci", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.getByTestId("tab-id-karta").click()
    await page.getByTestId("novi-ugovor-btn").click()

    await page.getByTestId("ugovor-vazenje").click()
    await page.getByRole("option", { name: /Drugo/ }).click()
    await expect(page.getByTestId("ugovor-vazenje-custom")).toBeVisible()
    await page.getByTestId("ugovor-vazenje-custom").fill("18")
    await expect(page.getByTestId("ugovor-vazenje-custom")).toHaveValue("18")
  })

  test("novi kontakt moze kreirati novu lokaciju", async ({ page }) => {
    const sufiks = String(Date.now()).slice(-6)
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.getByTestId("tab-kontakti").click()
    await page.getByTestId("novi-kontakt-btn").click()

    await page.getByTestId("kontakt-ime").fill(`E2E Kontakt ${sufiks}`)
    await page.getByTestId("kontakt-lokacija-izbor").getByRole("radio", { name: /Nova/ }).click()
    await page.getByTestId("kontakt-nova-lokacija-naziv").fill(`E2E Lokacija ${sufiks}`)
    await page.getByTestId("kontakt-nova-lokacija-grad").fill("Banja Luka")
    await page.getByTestId("kontakt-nova-lokacija-adresa").fill("Testna 1")
    await page.getByTestId("kontakt-submit").click()

    // Lokacija se pojavljuje u tabu Lokacije
    await page.getByTestId("tab-lokacije").click()
    await expect(page.getByTestId("lokacije-table")).toContainText(`E2E Lokacija ${sufiks}`)
  })

  test("novi klijent ima puna polja i kreira prvu lokaciju", async ({ page }) => {
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Firma ${sufiks}`
    await page.goto("/klijenti")
    await page.getByTestId("novi-klijent-btn").click()

    await page.getByTestId("novi-klijent-naziv").fill(naziv)
    await page.getByTestId("novi-klijent-adresa").fill("Kralja Petra 1")
    await page.getByTestId("novi-klijent-telefon").fill("051111222")
    await page.getByTestId("novi-klijent-email").fill(`e2e${sufiks}@tehpro.test`)
    // Polja koja su ranije postojala SAMO u edit formi
    await page.getByTestId("novi-klijent-pib").fill("4400000000001")
    await page.getByTestId("novi-klijent-maticni_broj").fill("11111111")
    await page.getByTestId("novi-klijent-sifra_djelatnosti").fill("4321")
    // Prva lokacija
    await page.getByTestId("novi-klijent-lokacija-naziv").fill("Centrala")
    await page.getByTestId("novi-klijent-lokacija-grad").fill("Banja Luka")
    await page.getByTestId("novi-klijent-submit").click()

    await page.getByTestId("klijenti-search").fill(naziv)
    await page.getByText(naziv).first().click()
    // Matični broj je sačuvan
    await page.getByTestId("uredi-klijent-btn").click()
    await expect(page.getByTestId("edit-klijent-maticni_broj")).toHaveValue("11111111")
    await page.keyboard.press("Escape")
    // Prva lokacija postoji
    await page.getByTestId("tab-lokacije").click()
    await expect(page.getByTestId("lokacije-table")).toContainText("Centrala")
  })

  test("checkbox podsjetnika je neaktivan uz objasnjenje kad je slanje ugaseno", async ({ page }) => {
    // Test sam postavlja preduslov umjesto da se oslanja na zatečeno stanje baze —
    // inače bi prolazio i kad funkcija uopšte nije implementirana.
    // Suite ionako ide sa --workers=1 jer specovi dijele globalni postavke id=1.
    // Pročitaj-pa-vrati: bez restore-a bi ovaj spec tiho mijenjao ponašanje
    // svih kasnijih specova (dijeljeni singleton red postavke id=1).
    const prije = await getPostavkeV2()
    await setPostavkeV2({ salji_klijentima: false })
    try {
      await page.goto("/klijenti")
      await page.getByTestId("klijent-card").first().click()
      await page.getByTestId("tab-lokacije").click()
      await page.getByTestId("nova-lokacija-btn").click()
      await page.getByTestId("lokacija-kontakt-izbor").getByRole("radio", { name: /Novi/ }).click()

      await expect(page.getByTestId("lokacija-kontakt-prima")).toBeDisabled()
      await expect(page.getByTestId("lokacija-kontakt-prima-ugaseno")).toContainText("Postavkama")
    } finally {
      await setPostavkeV2({ salji_klijentima: prije.salji_klijentima })
    }
  })

  test("uredjivanje lokacije uz zakljucan checkbox ne gasi vec upisan podsjetnik_primalac", async ({ page }) => {
    // Regresija iz code review-a: disabled input ne šalje vrijednost, pa je
    // `kontakt_prima` uvijek odsutan kad je slanje ugašeno. Bez hidden
    // "zakljucan" signala server ne zna da razlikuje "korisnik je isključio"
    // od "kontrola je zaključana" i tiho gasi tuđi već upisan true na false.
    // Test sam gradi presudak (kontakt sa podsjetnik_primalac=true dok je
    // slanje ON), pa tek onda gasi slanje i uređuje lokaciju preko iste
    // "Postojeći kontakt" grane koju review opisuje.
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Zakljucan ${sufiks}`
    const prije = await getPostavkeV2()

    const klijentId = await insertKlijent(naziv)
    // Per-firma prekidač (klijenti.salji_podsjetnik_klijentu) je default false
    // (migracija 20260708120000) — uključujemo ga eksplicitno da "slanje ON"
    // zaista znači oba prekidača uključena, ne samo globalni.
    const { error: kErr } = await db.from("klijenti").update({ salji_podsjetnik_klijentu: true }).eq("id", klijentId)
    if (kErr) throw new Error(`setup salji_podsjetnik_klijentu: ${kErr.message}`)
    const lokacijaId = await insertLokacija(klijentId, `E2E Lokacija Zakljucan ${sufiks}`)
    const kontaktId = await insertKontakt(klijentId, `E2E Kontakt Zakljucan ${sufiks}`)
    const { error: koErr } = await db
      .from("kontakt_osobe")
      .update({ lokacija_id: lokacijaId, podsjetnik_primalac: true })
      .eq("id", kontaktId)
    if (koErr) throw new Error(`setup podsjetnik_primalac: ${koErr.message}`)

    await setPostavkeV2({ salji_klijentima: false })
    try {
      await page.goto(`/klijenti/${klijentId}?tab=lokacije`)
      await page.getByTestId(`uredi-lokaciju-${lokacijaId}`).click()
      await page.getByTestId("lokacija-kontakt-izbor").getByRole("radio", { name: /Postoje/ }).click()

      // Isti asert kao u prethodnom testu — potvrđuje da je kontrola zaista zaključana
      // za ovaj kontakt, ne samo za "Novi kontakt" granu.
      await expect(page.getByTestId("lokacija-kontakt-prima")).toBeDisabled()
      await expect(page.getByTestId("lokacija-kontakt-prima-ugaseno")).toContainText("Postavkama")

      await page.getByTestId("lokacija-submit").click()
      await expect(page.getByTestId("lokacija-sheet")).toBeHidden()

      const { data, error } = await db
        .from("kontakt_osobe")
        .select("podsjetnik_primalac")
        .eq("id", kontaktId)
        .single()
      if (error) throw new Error(`assert podsjetnik_primalac: ${error.message}`)
      expect(data?.podsjetnik_primalac).toBe(true)
    } finally {
      await setPostavkeV2({ salji_klijentima: prije.salji_klijentima })
      await deleteKlijentByNaziv(naziv)
    }
  })
})
