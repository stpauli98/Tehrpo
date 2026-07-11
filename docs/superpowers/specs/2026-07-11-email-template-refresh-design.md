# Osvježenje email template-a (kod + Supabase reset)

**Datum:** 2026-07-11
**Obim:** Vizuelno osvježenje svih odlaznih email-ova, konzistentno između aplikativnih (Resend, u kodu) i auth (Supabase reset-password) mejlova.

## Cilj

Sva četiri aplikativna mejla (`reminderHtml`, `reminderHtmlFirma`, `zakazanoNakonRokaHtml`, `testEmailHtml`) i Supabase reset-password mejl treba da dijele **identičan vizuelni okvir** (header, kartica, footer). Mijenja se samo sadržaj i akcenat boje po tipu poruke.

Ovo je **osvježenje**, ne redizajn: zadržavamo table-based ("bulletproof") HTML strukturu, plavu `#2563eb` kao akcenat, crvenu `#dc2626` za kašnjenje, tekstualni brend (bez logo slike), Arial (email-safe font).

## Odluke (potvrđene)

- **Obim:** osvježenje postojećeg (ne novi identitet).
- **Boja:** zadržati plavu `#2563eb`; crvena za kašnjenje ostaje.
- **Logo:** ostaje tekstualni naziv (`APP_NAME` / `FirmBrand.name`), bez `<img>`.
- **Supabase reset jezik:** samo srpski (latinica), jedan HTML za oba projekta.

## Vizuelni tokeni (osvježeno)

| Element | Sada | Osvježeno |
|---|---|---|
| Pozadina stranice | `#f1f5f9` | `#f1f5f9` (bez izmjene) |
| Kartica | radius 10px, border `#e2e8f0` | radius 12px, border `#e2e8f0` + suptilna sjenka |
| Header | pun blok akcenta, bold naziv | isto + `letter-spacing` na nazivu, konzistentna visina |
| Značka (badge) | pill, razne boje | ujednačen pill stil, veći kontrast teksta |
| Tipografija | Arial 14–16px | Arial, doćerane veličine/line-height |
| Dugmad | table-based | isto, dosljedan padding/radius |
| Footer | `naziv — tagline` | isto + tanka gornja linija, mekši sivi ton |

Boje/veličine ostaju **inline** u HTML-u (email klijenti ne podržavaju pouzdano `<style>`/klase).

## Izmjene po fajlu

### `lib/email/templates.ts` (glavni posao)

Uvesti male dijeljene helpere na vrhu fajla da se osvježeni okvir ne kopira 4 puta:

- `layoutOmot(...)` — jedan omot: `<!doctype>` → pozadina → kartica → header → `{telo}` → footer. Prima akcenat boju, naziv/label headera, telo (HTML string), footer HTML, i `locale` (za `htmlLang`).
- `badge(boja, tekst)` — ujednačen pill.
- `poljeRed(labela, vrijednost)` — jedan red tabele s poljem.

Sve četiri postojeće funkcije se refaktorišu da koriste ove helpere i prosljeđuju samo svoj *sadržaj*.

**Invarijante koje se NE mijenjaju:**

- Potpisi (argumenti) sve četiri funkcije ostaju identični → pozivaoci netaknuti.
- `escapeHtml`, `danaTekst`, `htmlLang`, `reminderSubject`, `testEmailSubject`, `zakazanoNakonRokaSubject` — bez izmjene.
- i18n ključevi (`email.*` u `messages/{sr,en,de}.json`) — **bez novih ključeva**; osvježenje je čisto vizuelno.
- Brend izvori: `APP_NAME`/`APP_TAGLINE` (interni mejlovi) i `FirmBrand` (klijentski) — bez izmjene.

### Pozivaoci (bez izmjene)

- `lib/reminders/runReminders.ts` (`reminderHtml`, `reminderHtmlFirma`)
- `lib/reminders/zakazanoNakonRoka.ts` (`zakazanoNakonRokaHtml`)
- `app/(dashboard)/postavke/actions.ts` (`testEmailHtml`)

### Testovi

- `lib/email/templates.test.ts`, `firmBrand.test.ts`, `zakazanoNakonRoka.test.ts`.
- Ako asertiraju na tačan HTML string → ažurirati očekivanja na osvježeni izlaz.
- Ako asertiraju na prisustvo ključnih vrijednosti (naziv, rok, badge tekst, dugmad URL) → prolaze bez izmjene; verifikovati.

### `docs/email/supabase-reset-password.html` (novi, izvor za copy-paste)

- Standalone HTML, srpski/latinica, isti header/kartica/footer kao kod-template-i (plavi akcenat).
- Supabase varijable: `{{ .ConfirmationURL }}` na dugmetu "Postavi novu lozinku", `{{ .Email }}` u tekstu.
- Bez i18n/env logike (Supabase ne izvršava app kod). Brend naziv je upisan kao tekst; komentar u fajlu napominje da se mijenja ručno po firmi.
- Aplikacija ne učitava ovaj fajl. Ručno se lijepi u Supabase → Authentication → Emails → Reset Password, **odvojeno za DEMO i PROD**.

## Verifikacija

- `pnpm test:unit` (email template testovi).
- `pnpm lint` + `pnpm typecheck`.
- Vizuelni pregled renderovanog HTML-a (svi tipovi + reset), uklj. tamnu/svijetlu pozadinu email klijenta.

## Van obima (YAGNI)

- Uvođenje loga / hostovanje slika.
- Boja iz env varijable po firmi.
- Višejezični Supabase auth template-i.
- Bilo kakav novi email tip ili nova poslovna logika.
