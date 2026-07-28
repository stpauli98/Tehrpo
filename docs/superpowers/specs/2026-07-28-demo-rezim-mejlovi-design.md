# Demo režim za mejlove — dizajn

**Datum:** 2026-07-28
**Status:** odobreno, čeka izvedbu

## Problem

Korisnik DEMO instance u tabu „Poslati mejlovi" vidi:

> Invalid `to` field. Please use our testing email address instead of domains like `example.com`.

To izgleda kao interni kvar softvera, a nije. Uzrok je `REMINDER_TO=tehpro-dev@example.com`
— placeholder prepisan iz `.env.local.example`. Resend odbija cijelo slanje jer je
`example.com` rezervisan domen (RFC 2606), pa ni ispravan primalac ne dobije mejl.

Dijagnostika (2026-07-28): DEMO baza `mtww` — 3 reda, sve 3 greške, tip
`zakazano_nakon_roka`, primaoci `["nmil32@icloud.com","tehpro-dev@example.com"]`.
PROD baza `fqtq` — 43 reda, 0 grešaka.

Nijedan sloj to ne hvata: `parseEmailList` ne validira, a validacija koja postoji
(`assembleRecipients`, RPC `zabiljezi_zakazano_obavijest`) provjerava samo sintaksu,
koju `tehpro-dev@example.com` zadovoljava.

## Cilj

Na DEMO instanci se **ne šalje nijedan stvarni mejl**, a korisniku se jasno objasni
da je to namjerno i da vidi kako bi mejlovi izgledali u stvarnom radu.

**Produkcija mora ostati potpuno funkcionalna** — demo režim nikad ne smije biti aktivan tamo.

## Ne rješava se ovim

- `REMINDER_TO` placeholder ostaje pogrešan; demo režim ga samo zaobilazi jer se ništa
  ne šalje. Ispravka te vrijednosti je korisnikova (njegov `.env.local` / Vercel env).
- Filtriranje rezervisanih domena (`example.com`, `.test`, `.invalid`) pri sastavljanju
  primalaca — zaseban zahvat, van ovog obima.

## Rješenje

### 1. Prekidač — `lib/demo.ts`

```ts
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE?.trim() === "1"
```

Isti obrazac kao `lib/brand.ts` i `lib/locale.ts` — po deployu, ništa hardkodirano
(v. pravilo „no hardcode — flag everything"). `NEXT_PUBLIC_` jer bedž treba i klijentu.

**Podrazumijevano isključen.** Pali se samo na DEMO Vercel projektu.

### 2. Blokada slanja — `lib/email/resend.ts`

`sendEmail` vraća demo rezultat **prije** provjere `RESEND_API_KEY`:

```ts
if (DEMO_MODE) return { id: "demo", dryRun: true, demo: true }
```

`SendResult` dobija `demo?: boolean`.

**Zašto baš tu:** svi pozivni putevi (podsjetnici, digest, post-due, zakazano-nakon-roka,
test mejl iz Postavki) prolaze kroz `sendEmail`. Blokada u pojedinim enginima bi
propustila svakog budućeg pozivaoca.

### 3. Dnevnik — nova vrijednost `demo` u `mejl_status`

Migracija: `alter type mejl_status add value if not exists 'demo';`

`posaljiIzabiljezi` danas preskače upis kad je `dryRun` — zbog toga bi tab u demo
režimu ostao prazan. Novo pravilo:

| ishod | upis u dnevnik |
|---|---|
| stvarno slanje uspjelo | `poslato` (kao i danas) |
| stvarno slanje palo | `greska_slanja` (kao i danas) |
| **demo režim** | **`demo`** |
| obični dry-run (test, nema ključa) | ništa (kao i danas) |

Obični dry-run MORA ostati tih — inače bi unit testovi počeli pisati u dnevnik.

Mejl se pritom sastavi do kraja (pravi primaoci, naslov, sadržaj). Zapis nije izmišljen
podatak nego tačan prikaz onoga što bi otišlo.

### 4. Prikaz

- **Tab „Poslati mejlovi":** objasnidbena traka na vrhu kad je `DEMO_MODE`
- **Redovi:** bedž `demo` umjesto „Poslato"
- **Filter po statusu:** puni se iz `Constants.public.Enums.mejl_status`, pa se nova
  vrijednost pojavljuje sama — dodaje se samo i18n labela
- **TopBar:** trajan bedž `DEMO` pored naziva, na svakom ekranu

Kopija u sr/en/de.

### 5. Zaštita produkcije

1. prekidač isključen po defaultu
2. unit test: `DEMO_MODE === false` bez env varijable
3. unit test: `sendEmail` u demo režimu ne dodirne mrežu **ni kad `RESEND_API_KEY` postoji**
4. globalni bedž — pogrešna konfiguracija produkcije vidi se odmah, a ne tek kad neko
   otvori tab sa mejlovima

Bez `NEXT_PUBLIC_DEMO_MODE` ponašanje je identično današnjem.

### 6. Migracija i lockstep

Enum vrijednost ide na DEMO **i** PROD (v. pravilo DEMO/PROD lockstep). Na PROD-u je
bezopasna — vrijednost postoji, ništa je ne koristi. Cloud apply pokreće korisnik.

Rizik: `alter type … add value` unutar transakcije Postgres dozvoljava od v12 samo ako
se vrijednost ne koristi u istoj transakciji. Kod nas se ne koristi, ali se potvrđuje tek
kad migracija stvarno prođe.

## Testovi

- unit: default isključen; `sendEmail` u demo režimu ne zove mrežu i vraća `demo: true`
- unit: `posaljiIzabiljezi` upisuje `status: "demo"` u demo režimu, a **ne upisuje** u
  običnom dry-runu
- e2e: sa uključenim demo režimom tab prikazuje objasnidbenu traku i bedž `demo`;
  TopBar prikazuje `DEMO`

## Naknadno čišćenje

Tri postojeća reda sa greškom u DEMO dnevniku ostaju vidljiva sa starom porukom —
brišu se zasebno, po dogovoru sa korisnikom.
