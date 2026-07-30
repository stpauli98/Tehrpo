import { test, expect } from "@playwright/test"
import {
  db, getPostavkeV2, setPostavkeV2, insertKlijent, insertLokacija, insertKontakt, deleteKlijentByNaziv,
  firstVrstaSaIntervalom, deleteTerminiByKlijent, insertVrsta, deleteVrsta, deleteUgovoriByKlijent,
} from "./db"

// Nazivi throwaway redova nose prefikse koje `scripts/cleanup-test-data.ts` zna
// obrisati (E2E Firma / E2E Kontakt / E2E Lokacija / E2E BezLok / E2E Vrsta) —
// `finally` je prva odbrana, cleanup skripta je druga kad prolaz bude ubijen.
test.describe("Yoink batch 2026-07-30", () => {
  test("tab se zove Usluge, ne Profil", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
    await expect(page.getByTestId("tab-profil")).toContainText("Usluge")
    await expect(page.getByTestId("tab-profil")).not.toContainText("Profil")
  })

  test("ugovor na neodredjeno se PERZISTIRA (na_neodredjeno=true, datum_isteka=null)", async ({ page }) => {
    // UI-only provjera (samo `toBeDisabled`) bi prošla i da server tiho odbija upis:
    // `na_neodredjeno` koristi `z.literal("on")`, uži parser od susjednih checkbox-a,
    // pa bi drugačija serijalizacija Base UI checkbox-a pala u field-grešku neprimijećeno.
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Firma Neodredjeno ${sufiks}`
    const klijentId = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${klijentId}?tab=id-karta`)
      await page.getByTestId("novi-ugovor-btn").click()
      await expect(page.getByTestId("ugovor-sheet")).toBeVisible()

      await page.getByTestId("ugovor-zavodni").fill(`UG-E2E-NEOD-${sufiks}`)
      await page.getByTestId("ugovor-potpis").fill("2026-02-01")
      await page.getByTestId("ugovor-neodredjeno").click()
      // Datum isteka postaje neaktivan — i objašnjava ZAŠTO (I2).
      await expect(page.getByTestId("ugovor-istek")).toBeDisabled()
      await expect(page.getByTestId("ugovor-istek-neodredjeno")).toBeVisible()

      await page.getByTestId("ugovor-submit").click()
      await expect(page.getByTestId("ugovor-sheet")).toBeHidden({ timeout: 5000 })

      const { data, error } = await db
        .from("ugovori")
        .select("na_neodredjeno, datum_isteka")
        .eq("klijent_id", klijentId)
        .eq("zavodni_broj", `UG-E2E-NEOD-${sufiks}`)
        .maybeSingle()
      if (error) throw new Error(`assert ugovor: ${error.message}`)
      expect(data).not.toBeNull()
      expect(data?.na_neodredjeno).toBe(true)
      expect(data?.datum_isteka).toBeNull()
    } finally {
      await deleteUgovoriByKlijent(klijentId).catch(() => {})
      await deleteKlijentByNaziv(naziv).catch(() => {})
    }
  })

  test("custom broj mjeseci se PERZISTIRA u vazenje_mjeseci", async ({ page }) => {
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Firma Vazenje ${sufiks}`
    const klijentId = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${klijentId}?tab=id-karta`)
      await page.getByTestId("novi-ugovor-btn").click()
      await expect(page.getByTestId("ugovor-sheet")).toBeVisible()

      await page.getByTestId("ugovor-zavodni").fill(`UG-E2E-VAZ-${sufiks}`)
      await page.getByTestId("ugovor-vazenje").click()
      await page.getByRole("option", { name: /Drugo/ }).click()
      await expect(page.getByTestId("ugovor-vazenje-custom")).toBeVisible()
      await page.getByTestId("ugovor-vazenje-custom").fill("18")
      await expect(page.getByTestId("ugovor-vazenje-custom")).toHaveValue("18")

      await page.getByTestId("ugovor-submit").click()
      await expect(page.getByTestId("ugovor-sheet")).toBeHidden({ timeout: 5000 })

      const { data, error } = await db
        .from("ugovori")
        .select("vazenje_mjeseci, na_neodredjeno")
        .eq("klijent_id", klijentId)
        .eq("zavodni_broj", `UG-E2E-VAZ-${sufiks}`)
        .maybeSingle()
      if (error) throw new Error(`assert ugovor: ${error.message}`)
      expect(data).not.toBeNull()
      expect(data?.vazenje_mjeseci).toBe(18)
      expect(data?.na_neodredjeno).toBe(false)
    } finally {
      await deleteUgovoriByKlijent(klijentId).catch(() => {})
      await deleteKlijentByNaziv(naziv).catch(() => {})
    }
  })

  test("kontakt firme je unosiv i za firmu BEZ ijedne lokacije", async ({ page }) => {
    // Regresija C1: fieldset „Lokacija" je za firmu bez lokacija nudio samo
    // „Nova lokacija" (i to sa required nazivom), pa kontakt firme
    // (lokacija_id = null) uopšte nije bio unosiv — korisnik je morao izmisliti
    // lokaciju. Test dokazuje da izbor postoji, da je podrazumijevan i da se
    // zaista upisuje kao NULL.
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E BezLok ${sufiks}`
    const ime = `E2E Kontakt Firme ${sufiks}`
    const klijentId = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${klijentId}?tab=kontakti`)
      await expect(page.getByTestId("tab-kontakti-content")).toBeVisible()
      await page.getByTestId("novi-kontakt-btn").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeVisible()

      // Podrazumijevani izbor je kontakt firme, ne „nova lokacija".
      await expect(page.getByTestId("kontakt-lokacija-firma")).toBeChecked()

      await page.getByTestId("kontakt-ime").fill(ime)
      await page.getByTestId("kontakt-funkcija").fill("Direktor")
      await page.getByTestId("kontakt-submit").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeHidden({ timeout: 5000 })

      const { data, error } = await db
        .from("kontakt_osobe")
        .select("lokacija_id")
        .eq("klijent_id", klijentId)
        .eq("ime", ime)
        .maybeSingle()
      if (error) throw new Error(`assert kontakt: ${error.message}`)
      expect(data).not.toBeNull()
      expect(data?.lokacija_id).toBeNull()

      // I nijedna lokacija nije usput izmišljena.
      const { count } = await db
        .from("lokacije")
        .select("id", { count: "exact", head: true })
        .eq("klijent_id", klijentId)
      expect(count ?? 0).toBe(0)
    } finally {
      await deleteKlijentByNaziv(naziv).catch(() => {})
    }
  })

  test("novi kontakt moze kreirati novu lokaciju", async ({ page }) => {
    // Vlastita throwaway firma umjesto `klijent-card.first()`: ranije je test
    // zauvijek dodavao kontakt i lokaciju PRAVOM demo klijentu, bez čišćenja.
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Kontakt Firma ${sufiks}`
    const klijentId = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${klijentId}?tab=kontakti`)
      await expect(page.getByTestId("tab-kontakti-content")).toBeVisible()
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
    } finally {
      // Kontakti i lokacije kaskadiraju sa klijentom (on delete cascade).
      await deleteKlijentByNaziv(naziv).catch(() => {})
    }
  })

  test("novi klijent ima puna polja i kreira prvu lokaciju", async ({ page }) => {
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Firma ${sufiks}`
    try {
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
    } finally {
      // Bez ovoga se `E2E Firma …` klijenti gomilaju u DEMO-u; lista je sortirana
      // po nazivu pa bi istisnuli prave firme iz prvih 6 kartica koje skenira
      // test „jednokratni termin je vidljiv u tabu Usluge".
      await deleteKlijentByNaziv(naziv).catch(() => {})
    }
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

  test("nova termin forma nudi izbor ponavljanja i podrazumijeva jednokratno", async ({ page }) => {
    // "novi-termin-btn" (NoviTerminButton) postoji samo u Lista prikazu — Kalendar
    // (podrazumijevani view) ima samo "Dodaj termin za <dan>" po ćeliji.
    await page.goto("/plan-aktivnosti?view=lista")
    await page.getByTestId("novi-termin-btn").click()
    await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()

    // Izbor postoji i podrazumijevano je jednokratno
    const izbor = page.getByTestId("novi-termin-ponavljanje")
    await expect(izbor).toBeVisible()
    await expect(izbor.getByRole("radio", { name: /Jednokratno/ })).toBeChecked()
    await expect(izbor.getByRole("radio", { name: /Ponavlja/ })).not.toBeChecked()
  })

  test("ponavljajuci termin upisuje i klijent_provjere red (profil-stavku)", async ({ page }) => {
    // Regresija za yoink stavku 11(b): createTermin je do sada pisao SAMO
    // termin. Ovaj test provjerava STVARNI upis u bazu (ne samo UI), inače bi
    // prošao identično i da je cijeli ponavljajući write path obrisan.
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Ponavlja ${sufiks}`
    const lokNaziv = `E2E Lokacija Ponavlja ${sufiks}`
    const klijentId = await insertKlijent(naziv)
    const lokacijaId = await insertLokacija(klijentId, lokNaziv)
    const vrsta = await firstVrstaSaIntervalom() // vrsta SA podrazumijevanim intervalom — uslov za ponavljajući unos

    try {
      await page.goto("/plan-aktivnosti?view=lista")
      await page.getByTestId("novi-termin-btn").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()

      await page.getByTestId("novi-klijent").click()
      await page.getByRole("option", { name: naziv }).click()
      await page.getByTestId("novi-lokacija").click()
      await page.getByRole("option", { name: lokNaziv }).click()
      await page.getByTestId("novi-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      await page.getByTestId("novi-rok").fill("2028-03-11")
      await page.getByTestId("novi-termin-ponavljanje").getByRole("radio", { name: /Ponavlja/ }).click()
      await page.getByTestId("novi-submit").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeHidden({ timeout: 5000 })

      // Termin je upisan
      const { data: termini, error: tErr } = await db
        .from("termini")
        .select("id")
        .eq("klijent_id", klijentId)
        .eq("vrsta_provjere_id", vrsta.id)
        .eq("lokacija_id", lokacijaId)
      if (tErr) throw new Error(`assert termini: ${tErr.message}`)
      expect(termini?.length).toBe(1)

      // I profil-stavka (klijent_provjere) — sa interval_mjeseci=null (prati podrazumijevani interval vrste)
      const { data: kp, error: kpErr } = await db
        .from("klijent_provjere")
        .select("id, interval_mjeseci")
        .eq("klijent_id", klijentId)
        .eq("vrsta_provjere_id", vrsta.id)
        .eq("lokacija_id", lokacijaId)
        .maybeSingle()
      if (kpErr) throw new Error(`assert klijent_provjere: ${kpErr.message}`)
      expect(kp).not.toBeNull()
      expect(kp?.interval_mjeseci).toBeNull()
    } finally {
      await db.from("klijent_provjere").delete().eq("klijent_id", klijentId)
      await deleteTerminiByKlijent(klijentId)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("jednokratni termin NE upisuje klijent_provjere red", async ({ page }) => {
    // Pinuje default: ad-hoc unos ne smije tiho postati trajna obaveza (profil-stavka).
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Jednokratno ${sufiks}`
    const lokNaziv = `E2E Lokacija Jednokratno ${sufiks}`
    const klijentId = await insertKlijent(naziv)
    const lokacijaId = await insertLokacija(klijentId, lokNaziv)
    const vrsta = await firstVrstaSaIntervalom()

    try {
      await page.goto("/plan-aktivnosti?view=lista")
      await page.getByTestId("novi-termin-btn").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()

      await page.getByTestId("novi-klijent").click()
      await page.getByRole("option", { name: naziv }).click()
      await page.getByTestId("novi-lokacija").click()
      await page.getByRole("option", { name: lokNaziv }).click()
      await page.getByTestId("novi-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      await page.getByTestId("novi-rok").fill("2028-04-12")
      // "Jednokratno" ostaje izabrano (default) — namjerno se NE dira izbor.
      await page.getByTestId("novi-submit").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeHidden({ timeout: 5000 })

      const { data: termini, error: tErr } = await db
        .from("termini")
        .select("id")
        .eq("klijent_id", klijentId)
        .eq("vrsta_provjere_id", vrsta.id)
        .eq("lokacija_id", lokacijaId)
      if (tErr) throw new Error(`assert termini: ${tErr.message}`)
      expect(termini?.length).toBe(1)

      const { data: kp, error: kpErr } = await db
        .from("klijent_provjere")
        .select("id")
        .eq("klijent_id", klijentId)
        .eq("vrsta_provjere_id", vrsta.id)
        .eq("lokacija_id", lokacijaId)
        .maybeSingle()
      if (kpErr) throw new Error(`assert klijent_provjere: ${kpErr.message}`)
      expect(kp).toBeNull()
    } finally {
      await db.from("klijent_provjere").delete().eq("klijent_id", klijentId)
      await deleteTerminiByKlijent(klijentId)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("ponavljajuci bez podrazumijevanog intervala vrste prijavljuje gresku i ne kreira termin", async ({ page }) => {
    // Guard: birajući "Ponavlja se" za vrstu BEZ podrazumijevanog intervala korisnik
    // ne smije ostati sa upisanim terminom i greškom (validacija je PRIJE upisa).
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Bez Intervala ${sufiks}`
    const lokNaziv = `E2E Lokacija Bez Intervala ${sufiks}`
    const klijentId = await insertKlijent(naziv)
    const lokacijaId = await insertLokacija(klijentId, lokNaziv)
    // Throwaway vrsta BEZ intervala umjesto privremenog nuliranja prave vrste:
    // ako prolaz bude ubijen prije `finally`, prava vrsta bi ostala bez svog
    // podrazumijevanog intervala i tiho onemogućila „Dodaj uslugu" za sebe.
    const vrsta = await insertVrsta(`E2E Vrsta Bez Intervala ${sufiks}`, null)

    try {
      await page.goto("/plan-aktivnosti?view=lista")
      await page.getByTestId("novi-termin-btn").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()

      await page.getByTestId("novi-klijent").click()
      await page.getByRole("option", { name: naziv }).click()
      await page.getByTestId("novi-lokacija").click()
      await page.getByRole("option", { name: lokNaziv }).click()
      await page.getByTestId("novi-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      await page.getByTestId("novi-rok").fill("2028-05-13")
      await page.getByTestId("novi-termin-ponavljanje").getByRole("radio", { name: /Ponavlja/ }).click()
      await page.getByTestId("novi-submit").click()

      await expect(page.getByText(/nema podrazumijevani interval/)).toBeVisible()
      // Sheet ostaje otvoren — akcija nije uspjela, forma se ne resetuje/zatvara.
      await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()

      const { data: termini, error: tErr } = await db
        .from("termini")
        .select("id")
        .eq("klijent_id", klijentId)
        .eq("lokacija_id", lokacijaId)
      if (tErr) throw new Error(`assert termini: ${tErr.message}`)
      expect(termini?.length ?? 0).toBe(0)
    } finally {
      await db.from("klijent_provjere").delete().eq("klijent_id", klijentId)
      await deleteTerminiByKlijent(klijentId)
      await deleteKlijentByNaziv(naziv)
      await deleteVrsta(vrsta.id).catch(() => {})
    }
  })

  test("jednokratni termin je vidljiv u tabu Usluge", async ({ page }) => {
    // DEMO baza ima 25+ termina bez profil-stavke; badge mora postojati bar negdje.
    await page.goto("/klijenti")
    const kartice = page.getByTestId("klijent-card")
    const broj = await kartice.count()
    let nadjen = false
    // Sekvencijalna navigacija je namjerna — Playwright vozi jednu stranicu, ne može paralelno.
    for (let i = 0; i < Math.min(broj, 6); i++) {
      // eslint-disable-next-line no-await-in-loop
      await page.goto("/klijenti")
      // eslint-disable-next-line no-await-in-loop
      await kartice.nth(i).click()
      // eslint-disable-next-line no-await-in-loop
      await page.getByTestId("tab-profil").click()
      // Sačekaj da se sadržaj taba stvarno učita (RSC navigacija) prije provjere bedža —
      // bez ovoga isVisible() zna pucati na starom (id-karta) sadržaju.
      // eslint-disable-next-line no-await-in-loop
      await page.getByTestId("tab-profil-content").waitFor({ state: "visible" }).catch(() => {})
      // eslint-disable-next-line no-await-in-loop
      if (await page.getByTestId("usluga-jednokratna").first().isVisible().catch(() => false)) {
        nadjen = true
        break
      }
    }
    expect(nadjen, "nijedan klijent nema jednokratnu uslugu — provjeri spojiJednokratne").toBe(true)
  })
})
