import { test, expect, type Page } from "@playwright/test"
import { danasBg, kreirajFirmuFiksturu, type FirmaFikstura } from "./fixtures"
import { izvrsiTermin } from "./db"

/**
 * Pregled dokumenta bez preuzimanja (ikonica oka).
 *
 * Kartica se PREBACUJE na pregled umjesto da otvori dialog preko dialoga —
 * isti razlog zbog kojeg brisanje koristi dvostepenu potvrdu (v. `DokumentiSekcija`).
 *
 * Ugovor koji spec štiti:
 *  1. oko otvara pregled bez odlaska sa stranice i bez drugog dijaloga,
 *  2. DOCX se prikaže kao tekst (mammoth), ne kao ponuda za preuzimanje,
 *  3. PDF ide u `iframe` sa inline URL-om KOJI IDE KROZ SERVER pod sesijom korisnika
 *     (`object` ostaje prazan u Chrome-u; sirovi potpisani Storage URL je iznosio fajl),
 *  4. slika se prikaže kao slika,
 *  5. „nazad" vraća detalje termina, a X i dalje zatvara karticu.
 *
 * Vlastita fikstura: spec otprema fajlove, pa ne smije prljati dijeljeni DEMO
 * termin — svaki upload bi ostajao zauvijek i usporavao tuđe testove.
 */

test.describe.configure({ mode: "serial" })

let firma: FirmaFikstura
let terminId: string

test.beforeAll(async () => {
  firma = await kreirajFirmuFiksturu({ oznaka: "PREGLED", lokacije: ["E2E Lokacija"] })
  const prvi = firma.terminiTekuciIds[0]
  if (!prvi) throw new Error("fikstura nije napravila termin")
  terminId = prvi
  // Zapisnik (AI) je dostupan samo za izvršen termin. Danas po Europe/Belgrade —
  // UTC slice bi noću dao jučerašnji datum.
  await izvrsiTermin(terminId, danasBg())
})

test.afterAll(async () => {
  // `dokumenti` idu cascade preko `termin_id`/`klijent_id`, pa nema zaostataka.
  await firma?.obrisi().catch(() => {})
})

async function otvoriKarticu(page: Page) {
  await page.goto(`/plan-aktivnosti?view=lista&mjesec=svi&selected=${terminId}`)
  await expect(page.getByTestId("termin-sheet")).toBeVisible()
}

/** Red AI zapisnika (.docx); generiše ga ako ga još nema. */
async function redZapisnika(page: Page) {
  const zapisnik = page
    .getByTestId("dokument-red")
    .filter({ has: page.getByTestId("dokument-ai-badge") })
  if ((await zapisnik.count()) === 0) {
    await page.getByTestId("generisi-zapisnik").click()
    await expect(zapisnik.first()).toBeVisible()
  }
  return zapisnik.first()
}

/**
 * Otprema fajl i vraća njegov red — sa kartice koja NEMA akciju u letu.
 *
 * Poslije uspješnog uploada `DokumentiSekcija` okida `router.refresh()` i invalidaciju
 * `["termin-detail", id]` keša. Dok se to sleže, `lista.tsx` nakratko ostane bez
 * `selectedTermin` i cijeli `TerminSheet` se odmontira — a sa njim i `pregled` stanje
 * (useState u TerminSheet-u). Klik na oko odmah poslije uploada zato ume da završi nazad
 * na detaljima termina, potpuno zavisno od toga šta stigne prvo.
 *
 * Zato se kartica ponovo otvori: to je čekanje na STANJE (učitan sheet bez akcije u letu),
 * a ne na vrijeme, i nastavak testa je deterministički. Retry se NE dodaje — pregled mora
 * raditi iz prvog pokušaja.
 */
async function otpremi(page: Page, naziv: string, mimeType: string, buffer: Buffer) {
  await page.getByTestId("dokument-file").setInputFiles({ name: naziv, mimeType, buffer })
  await page.getByTestId("dokument-upload-submit").click()
  const red = page.getByTestId("dokument-red").filter({ hasText: naziv }).first()
  await expect(red).toBeVisible()
  await otvoriKarticu(page)
  await expect(red).toBeVisible()
  return red
}

test.describe("Dokumenti — pregled bez preuzimanja", () => {
  test("oko otvara sadržaj .docx zapisnika u kartici", async ({ page }) => {
    await otvoriKarticu(page)
    const zapisnik = await redZapisnika(page)

    const urlPrije = page.url()
    await zapisnik.getByTestId("dokument-pregled").click()

    await expect(page.getByTestId("termin-sheet-pregled")).toBeVisible()
    // Sadržaj zapisnika, ne poruka o preuzimanju.
    await expect(page.getByTestId("docx-preview")).toBeVisible()
    await expect(page.getByTestId("docx-preview")).toContainText("ZAPISNIK")
    // Pregled je unutar kartice — bez navigacije i bez drugog dijaloga.
    expect(page.url()).toBe(urlPrije)
    await expect(page.getByTestId("termin-sheet")).toHaveCount(1)
  })

  test("'nazad' vraća detalje termina, X zatvara karticu", async ({ page }) => {
    await otvoriKarticu(page)
    const zapisnik = await redZapisnika(page)
    await zapisnik.getByTestId("dokument-pregled").click()
    await expect(page.getByTestId("termin-sheet-pregled")).toBeVisible()

    await page.getByTestId("pregled-nazad").click()
    await expect(page.getByTestId("termin-sheet-pregled")).toBeHidden()
    await expect(page.getByTestId("sheet-dokumenti")).toBeVisible()
    await expect(page.getByTestId("termin-edit-form")).toBeVisible()

    await page.getByTestId("dialog-close").click()
    await page.waitForURL((u) => !u.search.includes("selected="))
    await expect(page.getByTestId("termin-sheet")).toBeHidden()
  })

  test("PDF ide u iframe sa inline URL-om i zadržava izlaz na preuzimanje", async ({
    page,
    playwright,
  }) => {
    await otvoriKarticu(page)
    const red = await otpremi(page, "pregled.pdf", "application/pdf", Buffer.from("%PDF-1.4\n%test\n"))
    await red.getByTestId("dokument-pregled").click()

    const okvir = page.getByTestId("pregled-pdf")
    await expect(okvir).toBeVisible()
    // `iframe`, ne `object` — `object` ostavlja praznu bijelu površinu u Chrome-u.
    expect(await okvir.evaluate((el) => el.tagName)).toBe("IFRAME")
    // Sadržaj ide KROZ SERVER (`?sadrzaj=1`), ne preko potpisanog Storage URL-a.
    // Ranije je ovdje stajao sirovi `/storage/v1/object/sign/…` link — a takav link je
    // upotrebljiv van aplikacije i 10 minuta javno dijeljiv, čime je uloga „pregled"
    // (koja ne smije preuzimati) zabranu zaobilazila prostim kopiranjem adrese iz iframe-a.
    const src = await okvir.getAttribute("src")
    expect(src).toContain("/api/dokumenti/")
    expect(src).toContain("sadrzaj=1")
    expect(src).not.toContain("/storage/v1/object/sign/")
    // Inline prikaz (bez `?download=`), inače bi preglednik snimio fajl umjesto da ga prikaže.
    expect(src).not.toContain("download=")

    // Provjera oblika `src`-a nije dovoljna — spec postoji da dokaže DVIJE stvari o sadržaju.
    // (a) Sadržaj se i dalje VIDI: ista adresa, tražena iz stranice (sa sesijskim kolačićima),
    //     vraća bajtove PDF-a i to `inline` (ne kao prilog za snimanje).
    const podSesijom = await page.request.get(src!)
    expect(podSesijom.status()).toBe(200)
    expect(podSesijom.headers()["content-type"]).toContain("application/pdf")
    expect(podSesijom.headers()["content-disposition"]).toContain("inline")

    // (b) …a van sesije ta adresa ne vrijedi ništa. To je cijeli razlog zamjene: potpisani
    //     `/storage/v1/object/sign/…` je bio bearer token u query stringu — radio je 10 minuta
    //     iz BILO KOG anonimnog preglednika, pa je uloga „pregled" (kojoj je preuzimanje
    //     zabranjeno) fajl iznosila prostim kopiranjem adrese iz `iframe`-a. Stream kroz server
    //     nema token: bez kolačića auth gate odvede na prijavu i PDF-a nema.
    //     `storageState` mora biti IZRIČITO prazan: novi request kontekst pokupi `use.storageState`
    //     iz projekta (admin sesija), pa bi bez ovoga „anonimni" zahtjev išao prijavljen i tvrdnja
    //     bi lažno prolazila.
    const anonimni = await playwright.request.newContext({
      baseURL: new URL(page.url()).origin,
      storageState: { cookies: [], origins: [] },
    })
    try {
      const bezSesije = await anonimni.get(src!)
      expect(bezSesije.headers()["content-type"] ?? "").not.toContain("application/pdf")
      expect((await bezSesije.body()).subarray(0, 4).toString("latin1")).not.toBe("%PDF")
    } finally {
      await anonimni.dispose()
    }

    // `iframe` nema fallback sadržaj → preuzimanje mora ostati ponuđeno.
    await expect(page.getByTestId("pregled-preuzmi")).toBeVisible()
  })

  test("slika se prikaže kao slika, ne kao preuzimanje", async ({ page }) => {
    await otvoriKarticu(page)
    // 1×1 PNG — dovoljan da Storage vrati validan image/png.
    const red = await otpremi(
      page,
      "pregled.png",
      "image/png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    )
    await red.getByTestId("dokument-pregled").click()

    const slika = page.getByTestId("pregled-slika")
    await expect(slika).toBeVisible()
    // Slika se stvarno učitala (naturalWidth > 0), nije samo <img> sa mrtvim src-om.
    await expect
      .poll(async () => slika.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
  })
})
