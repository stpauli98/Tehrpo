import { test, expect, type Page } from "@playwright/test"
import {
  insertKlijent,
  insertLokacija,
  firstVrstaSaIntervalom,
  deleteTerminiByKlijent,
  deleteKlijentByNaziv,
} from "./db"
import { idiNa } from "./fixtures"

/** Godina roka: zadnji datum u januaru + interval mjeseci (mirror lib/date addMjeseci). */
function godinaRoka(godina: number, mjesecIdx: number, intervalMjeseci: number): number {
  return godina + Math.floor((mjesecIdx + intervalMjeseci) / 12)
}

/**
 * Barijera koja se MORA naoružati PRIJE klika na server akciju, a sačekati PRIJE
 * napuštanja stranice.
 *
 * Zašto postoji: createProfilProvjere / deleteProfilProvjere na kraju rade
 * revalidatePath, pa POST server akcije SAM vrati osvježen RSC payload i novo stanje
 * se iscrta odmah — asercije nad tabelom prolaze. Tek NAKON toga DodajProvjeruButton
 * i ObrisiProfilButton u useEffect-u dodatno zovu router.refresh(), koji ispali još
 * jedan `GET /klijenti/<id>?tab=profil&_rsc=…` (header `rsc: 1`, state tree sa
 * „refetch"). Taj fetch je i dalje u letu kad asercije prođu, pa ga `page.goto`
 * prekine. Ishod je jedan od dva — oba su viđena u e2e-finalni.txt, oba samo na
 * WebKitu (Chromium je brži pa mu refresh stigne da završi):
 *   (a) RSC payload ne stigne → Next uhvati „Failed to fetch RSC payload" i padne na
 *       punu browser navigaciju nazad na /klijenti/<id>?tab=profil, koja prekine naš
 *       goto → „Navigation to … is interrupted by another navigation";
 *   (b) prekine se sam POST server akcije (dev server loguje ECONNRESET) → brisanje
 *       se nikad ne izvrši i sljedeća stranica pokazuje STARO stanje.
 *
 * `page.waitForLoadState("networkidle")` ovdje NE pomaže (provjereno, pad se i dalje
 * reprodukuje): to stanje se vodi po zadnjoj NAVIGACIJI, a RSC refresh nije
 * navigacija — poziv se vrati odmah, bez ijednog milisekunde čekanja.
 *
 * Čeka se konkretno STANJE (taj tačno određeni zahtjev je završio), ne fiksno vrijeme,
 * i bez ijednog retry-a. `next-router-prefetch` zahtjevi se izuzimaju da barijera ne
 * bi „potrošila" neki prefetch umjesto pravog refresh-a.
 */
function naoruzajRefreshPosleAkcije(page: Page, putanja: string) {
  return page.waitForEvent("requestfinished", {
    predicate: (r) =>
      r.method() === "GET" &&
      r.url().includes(putanja) &&
      r.url().includes("_rsc=") &&
      !r.headers()["next-router-prefetch"],
    timeout: 30_000,
  })
}

/**
 * NAPOMENA za pokretanje POJEDINAČNO (`pnpm test:e2e tests/e2e/16-profil.spec.ts`):
 * `next dev --webpack` kompajlira rutu tek pri prvom zahtjevu za njom. Taj rebuild
 * mijenja module van React stabla, pa HMR klijent na trenutno otvorenoj stranici
 * odgovori sa „[Fast Refresh] performing full reload"; ako se to poklopi sa `page.goto`
 * u letu, goto bude otkazan i dobije se ista poruka „interrupted by another navigation".
 * To NIJE greška ovog testa niti aplikacije — u punom paketu /termini (i njegov
 * redirect na /plan-aktivnosti) su odavno kompajlirani jer ih 01-smoke, 02-data i
 * 03-termini otvaraju prije 16. Dokazano: sam spec nad svježim dev serverom pada 4/4,
 * a `03-termini + 16-profil` u istom pokretanju prolazi 3/3 (webkit) i 2/2 (chromium).
 * Dakle: pri pojedinačnom pokretanju prvo zagrijati dev server (npr. pokrenuti spec
 * zajedno sa 03-termini), a ne krpiti test.
 */

test.describe("Faza Profil — tab", () => {
  test("Profil tab prikazuje prazno stanje za novog klijenta", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await expect(page.getByTestId("dodaj-provjeru-btn")).toBeVisible()
      // Terminologija je s PR #82/#83 prešla sa "provjera" na "usluga"
      // (klijenti.profil.prazno u messages) — spec je bio zaostao. Tvrdi se PUN tekst
      // poruke, ne prefiks: messages/sr.json ima DVIJE poruke koje počinju sa
      // „Nema definisanih usluga" (klijenti.profil.prazno i idKarta …prazno), pa bi
      // prefiks bio i slabija tvrdnja i kandidat za strict-mode koliziju.
      await expect(page.getByText("Nema definisanih usluga. Dodajte uslugu da generišete termine.")).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("klijent bez lokacija: dijalog upućuje na unos lokacije", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await expect(page.getByTestId("profil-bez-lokacija")).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Faza Profil — dodavanje i generisanje termina", () => {
  test("dodaj provjeru → stavka + generisan termin; duplikat odbijen", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    await insertLokacija(kid)
    const vrsta = await firstVrstaSaIntervalom()
    const listaTermina = `/termini?klijent_id=${kid}&mjesec=svi`
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      // interval je zaključan i povučen iz vrste
      await expect(page.getByTestId("profil-interval")).toHaveValue(String(vrsta.interval))
      await expect(page.getByTestId("profil-interval")).toBeDisabled()
      await page.getByTestId("profil-lokacija").click()
      await page.getByRole("option", { name: "E2E Lokacija", exact: true }).click()
      await page.getByTestId("profil-zadnji-datum").fill("2026-01-10")
      const refreshPosleUpisa = naoruzajRefreshPosleAkcije(page, `/klijenti/${kid}`)
      await page.getByTestId("profil-submit").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeHidden({ timeout: 5000 })
      // stavka u tabeli
      await expect(page.getByTestId("profil-row")).toHaveCount(1)
      // sljedeći rok = 2026-01-10 + interval vrste
      const ocekivanaGodina = godinaRoka(2026, 0, vrsta.interval)
      await expect(page.getByTestId("profil-row")).toContainText(String(ocekivanaGodina))
      // termin generisan → vidljiv na /termini filtriran po klijentu
      // Dvije odbrane, obje zadržane jer rješavaju istu trku s različitih strana:
      // (1) barijera na STANJE — sačekaj da router.refresh() iz DodajProvjeruButton-a
      //     stvarno završi prije napuštanja stranice (v. naoruzajRefreshPosleAkcije);
      // (2) idiNa — ako refresh ipak stigne kasnije i prekine goto, helper iz
      //     fixtures.ts ponovi navigaciju umjesto da test padne (PR #81).
      await refreshPosleUpisa
      await idiNa(page, listaTermina)
      await expect(page.getByTestId("termin-detalji").first()).toBeVisible()
      // duplikat profila odbijen (ista vrsta + ista lokacija)
      await idiNa(page, `/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      await page.getByTestId("profil-lokacija").click()
      await page.getByRole("option", { name: "E2E Lokacija", exact: true }).click()
      await page.getByTestId("profil-zadnji-datum").fill("2026-02-01")
      await page.getByTestId("profil-submit").click()
      // Ista poruka se prikazuje na DVA mjesta (yoink batch: useAkcijaToast toastuje
      // res.message povrh postojeće inline greške) — nescopovani getByText bi bio
      // strict-mode violation, zato svaki kanal asertujemo zasebno.
      // 1) inline greška u formi (<p role="alert"> unutar dodaj-provjeru-form)
      await expect(
        page.getByTestId("dodaj-provjeru-form").getByText("Ova usluga već postoji."),
      ).toBeVisible()
      // 2) toast (sonner) — dokazuje da je i toast kanal stvarno okinut
      await expect(
        page.locator("[data-sonner-toast]").getByText("Ova usluga već postoji."),
      ).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("prvi put: prvi rok ide direktno u termin, bez zadnjeg datuma", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    await insertLokacija(kid)
    const vrsta = await firstVrstaSaIntervalom()
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      await page.getByTestId("profil-lokacija").click()
      await page.getByRole("option", { name: "E2E Lokacija", exact: true }).click()
      await page.getByTestId("profil-rezim").click()
      await page.getByRole("option", { name: /prvi put/i }).click()
      await page.getByTestId("profil-prvi-rok").fill("2027-05-15")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeHidden({ timeout: 5000 })
      // stavka bez zadnjeg datuma, rok = uneseni prvi rok
      await expect(page.getByTestId("profil-row")).toHaveCount(1)
      await expect(page.getByTestId("profil-row")).toContainText("— (prvi put)")
      // negativni lookahead: dokazuje da UI renderuje BEZ završne tačke (standard dd.MM.yyyy)
      await expect(page.getByTestId("profil-row")).toContainText(/15\.05\.2027(?!\.)/)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("brisanje stavke ne briše generisani termin — ostaje vidljiv kao jednokratna usluga bez brisanja", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    await insertLokacija(kid)
    const vrsta = await firstVrstaSaIntervalom()
    const listaTermina = `/termini?klijent_id=${kid}&mjesec=svi`
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      await page.getByTestId("profil-lokacija").click()
      await page.getByRole("option", { name: "E2E Lokacija", exact: true }).click()
      await page.getByTestId("profil-zadnji-datum").fill("2026-03-01")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByTestId("profil-row")).toHaveCount(1)
      // obriši stavku (klijent_provjere red) — termin ostaje netaknut
      await page.getByTestId("obrisi-profil-btn").click()
      await page.getByTestId("obrisi-profil-potvrdi").click()
      // Barijere na STANJE, prije ijednog goto-a. Brisanje je stvarno stiglo do baze
      // tek kad isti red izgubi dugme „Obriši" i dobije oznaku jednokratne usluge —
      // to je izvedeni red (lib/termini-jednokratni.ts), koji postoji samo kad
      // klijent_provjere zapisa VIŠE nema. Ranije je test odmah radio goto i time
      // prekidao POST server akcije, pa se brisanje nikad nije izvršilo (snimak pada
      // je pokazivao netaknut red: interval 12 + dugme „Obriši").
      //
      // Ovdje se NE čeka RSC refresh kao kod upisa: ObrisiProfilButton se odjavi
      // (unmount) čim revalidiran payload pretvori red u izvedeni, pa se njegov
      // useEffect sa router.refresh() često nikad ne izvrši. Čekanje na taj zahtjev
      // bi zato znalo visjeti do isteka vremena. Ove dvije asercije su dovoljne:
      // dokazuju i da je akcija završila i da je novi payload već iscrtan.
      await expect(page.getByTestId("usluga-jednokratna")).toBeVisible()
      await expect(page.getByTestId("obrisi-profil-btn")).toHaveCount(0)
      //
      // ODBAČENO iz PR #81: `await expect(page.getByTestId("profil-row")).toHaveCount(0)`.
      // Ta tvrdnja je iz vremena prije izvedenih redova i sada je NETAČNA: ProfilTab
      // renderuje jednokratnu uslugu kao profil-row (v. ProfilTab.tsx — red se crta za
      // svaku stavku, samo bez ObrisiProfilButton-a kad je `jednokratna`). Ostatak
      // testa (linije ispod, tačka (b)) i sam tvrdi toHaveCount(1), pa bi zadržavanje
      // #81 verzije napravilo test koji sam sebi protivrječi. Namjera #81 — dokazati da
      // je brisanje stvarno završilo prije navigacije — sačuvana je jačim tvrdnjama
      // iznad (nestao „Obriši", pojavila se oznaka jednokratne usluge).
      //
      // (a) generisani termin i dalje postoji
      // idiNa (PR #81): revalidate refresh nakon brisanja može prekinuti goto — v. fixtures.ts
      await idiNa(page, listaTermina)
      await expect(page.getByTestId("termin-detalji").first()).toBeVisible()
      // (b) Usluge tab ga sada prikazuje kao izvedenu, jednokratnu stavku (ne nulu)
      await idiNa(page, `/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await expect(page.getByTestId("profil-row")).toHaveCount(1)
      await expect(page.getByTestId("usluga-jednokratna")).toBeVisible()
      // (c) izvedeni red nema klijent_provjere zapis pa nema ni dugme za brisanje
      await expect(page.getByTestId("obrisi-profil-btn")).toHaveCount(0)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})
