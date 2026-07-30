// tests/e2e/27-uloge-ovlastenja.spec.ts
// Potvrđeni model uloga (30.07.2026.): operaterov centralni plan je filtriran na dodijeljene
// firme, a `pregled` ne smije preuzimati dokumente ni izvoziti plan (pregled na ekranu ostaje).
//
// Napomena o broju fajla: plan je predvidio "26", ali 26-pregled-readonly.spec.ts je u
// međuvremenu zauzeo taj broj (Task 5 verifikacija) — ovaj spec zato nosi 27.
import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import {
  db,
  ensureKorisnik,
  assignKlijent,
  clearDodjele,
  insertKlijent,
  insertTermin,
  deleteTermin,
  firstActiveVrstaId,
  deleteKlijentByNaziv,
  deleteKorisnikByEmail,
} from "./db"

const OP_LOZINKA = "E2eUloge2026!"
const PREGLED_LOZINKA = "E2eUlogePregled2026!"
// Isto ime kao `DOKUMENTI_BUCKET` u lib/supabase/storage.ts — ne uvozimo taj modul ovdje
// jer je označen `server-only` (rizično van Next server konteksta).
const DOKUMENTI_BUCKET = "tehpro-dokumenti"

// Strukturno validan minimalni jednostranični PDF (a ne samo string sa "%PDF-1.4" prefiksom)
// — da eventualni budući test koji ga stvarno renderuje ne padne misteriozno.
const MINIMALNI_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 9]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
)

test.use({ storageState: { cookies: [], origins: [] } })

// `test.describe.serial` + per-project sufiks na svim jedinstvenim identifikatorima:
// fullyParallel:true bi inače fan-out-ovao 4 testa ovog describe-a preko VIŠE workera
// (potvrđeno empirijski — i unutar JEDNOG projekta), a chromium/webkit projekti se
// izvršavaju paralelno kao odvojeni procesi. Bez serial+sufiksa, dva (ili više) konkurentna
// poziva na neidempotentni insertKlijent() nad istim nazivom padaju na unique constraint,
// a dijeljeni korisnik_klijent red za operatera/pregled bi se međusobno prepisivao.
test.describe.serial("Uloge i ovlaštenja", () => {
  let opId = ""
  let pregledId = ""
  let mojaId = ""
  let dokumentId = ""
  let dokumentStoragePath = ""
  let terminId = ""
  let OP_EMAIL = ""
  let PREGLED_EMAIL = ""
  let FIRMA_MOJA = ""
  let FIRMA_TUDJA = ""

  test.beforeAll(async ({}, testInfo) => {
    const sufiks = testInfo.project.name
    OP_EMAIL = `e2e-uloge-operater-${sufiks}@tehpro.test`
    PREGLED_EMAIL = `e2e-uloge-pregled-${sufiks}@tehpro.test`
    FIRMA_MOJA = `E2E Uloge Moja DOO ${sufiks}`
    FIRMA_TUDJA = `E2E Uloge Tudja DOO ${sufiks}`

    opId = await ensureKorisnik(OP_EMAIL, OP_LOZINKA, "E2E Uloge Operater", "operater")
    pregledId = await ensureKorisnik(PREGLED_EMAIL, PREGLED_LOZINKA, "E2E Uloge Pregled", "pregled")
    await deleteKlijentByNaziv(FIRMA_MOJA).catch(() => {})
    await deleteKlijentByNaziv(FIRMA_TUDJA).catch(() => {})
    mojaId = await insertKlijent(FIRMA_MOJA)
    await insertKlijent(FIRMA_TUDJA)

    // Termin na svakoj firmi da obje imaju red u centralnom planu. Rok pada u tekući+naredni
    // mjesec (default "lista" filter kad mjesec nije naveden u URL-u — vidi parsePlanFilteri),
    // tako da se ne oslanjamo na to koji je dan tačno "danas" kad se test pokrene.
    const vrstaId = await firstActiveVrstaId()
    terminId = await insertTermin({ klijentId: mojaId, vrstaId, rok: "2026-08-15" })

    // Dokument na terminu — meta za test preuzimanja/pregleda. Storage objekat JE potreban:
    // `createSignedUrl` na Supabase Storage-u provjerava postojanje objekta prije izdavanja
    // potpisanog URL-a (empirijski potvrđeno — bez upload-a `/pregled` ruta puca na 500
    // "Object not found" umjesto 200, i za operatera i za pregled kad prođe 403-gate).
    dokumentStoragePath = `termini/${terminId}/e2e-uloge-nalaz-${sufiks}.pdf`
    const { error: uploadErr } = await db.storage
      .from(DOKUMENTI_BUCKET)
      .upload(dokumentStoragePath, MINIMALNI_PDF, {
        contentType: "application/pdf",
        upsert: true,
      })
    if (uploadErr) throw new Error(`upload dokumenta u storage: ${uploadErr.message}`)

    const { data, error } = await db
      .from("dokumenti")
      .insert({
        klijent_id: mojaId,
        termin_id: terminId,
        naziv: "e2e-uloge-nalaz.pdf",
        storage_path: dokumentStoragePath,
      })
      .select("id")
      .single()
    if (error) throw new Error(`insert dokumenta: ${error.message}`)
    dokumentId = data.id as string

    await clearDodjele(opId)
    await clearDodjele(pregledId)
    await assignKlijent(opId, mojaId) // NAMJERNO bez FIRMA_TUDJA
    await assignKlijent(pregledId, mojaId)
  })

  test.afterAll(async () => {
    if (dokumentStoragePath) {
      await db.storage.from(DOKUMENTI_BUCKET).remove([dokumentStoragePath]).catch(() => {})
    }
    // `termini.klijent_id` je `on delete restrict` — klijent se MORA obrisati istog termina
    // prvo, inače deleteKlijentByNaziv tiho puca (swallowed by .catch) i ostavi orphan fixture
    // u DEMO bazi. `dokumenti.termin_id` je `on delete cascade` pa se dokument red obriše
    // zajedno sa terminom.
    if (terminId) await deleteTermin(terminId).catch(() => {})
    await clearDodjele(opId).catch(() => {})
    await clearDodjele(pregledId).catch(() => {})
    await deleteKlijentByNaziv(FIRMA_MOJA).catch(() => {})
    await deleteKlijentByNaziv(FIRMA_TUDJA).catch(() => {})
    await deleteKorisnikByEmail(OP_EMAIL).catch(() => {})
    await deleteKorisnikByEmail(PREGLED_EMAIL).catch(() => {})
  })

  // Redoslijed je namjeran: u `serial` describe-u pad jednog testa PRESKAČE sve iza njega.
  // Tri API provjere (brze, bez rendera) idu prve da ih UI hiccup u testu punog plana —
  // koji učitava cijelu stranicu i čeka do 30 s — ne može oboriti zajedno sa sobom.
  test("pregled ne smije izvesti plan (403)", async ({ context }) => {
    await injectSessionFor(context, PREGLED_EMAIL, PREGLED_LOZINKA)
    const res = await context.request.get("/api/plan-aktivnosti/izvoz?format=xlsx&opseg=sve&period=tekuci")
    expect(res.status()).toBe(403)
  })

  test("pregled ne smije preuzeti dokument (403), ali ga smije pogledati (200)", async ({ context }) => {
    await injectSessionFor(context, PREGLED_EMAIL, PREGLED_LOZINKA)
    const preuzimanje = await context.request.get(`/api/dokumenti/${dokumentId}`)
    expect(preuzimanje.status()).toBe(403)
    const pregledOdgovor = await context.request.get(`/api/dokumenti/${dokumentId}/pregled`)
    expect(pregledOdgovor.status()).toBe(200)
  })

  test("operater i dalje smije preuzeti dokument (200)", async ({ context }) => {
    await injectSessionFor(context, OP_EMAIL, OP_LOZINKA)
    const res = await context.request.get(`/api/dokumenti/${dokumentId}`)
    expect(res.status()).toBe(200)
  })

  test("operaterov centralni plan prikazuje samo dodijeljene firme", async ({ page, context }) => {
    await injectSessionFor(context, OP_EMAIL, OP_LOZINKA)
    // Default view (bez ?view=) je "kalendar", koji filtrira striktno na TEKUĆI mjesec
    // (godina/mjesec iz URL-a, default = danas) — termin zakazan za 2026-08-15 ne bi se
    // vidio u kalendaru za tekući mjesec ako se test pokrene prije avgusta. "lista" view
    // default filtrira na tekući+naredni mjesec (parsePlanFilteri: mjesec || "tn"), što
    // pouzdano pokriva naš rok bez obzira na tačan dan pokretanja.
    await page.goto("/plan-aktivnosti?view=lista")
    // Prvo potvrdi da je STRANICA STVARNO UČITALA PODATKE (ne prazan/pao ekran) —
    // ako ovo ne prođe, odsustvo FIRMA_TUDJA ispod ne bi dokazivalo scoping nego pad učitavanja.
    await expect(page.getByText(FIRMA_MOJA).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(FIRMA_TUDJA)).toHaveCount(0)
  })
})
