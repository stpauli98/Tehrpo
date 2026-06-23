# Dizajn: Čišćenje test-podataka + test-higijena (Klijenti)

**Datum:** 2026-06-23
**Status:** Odobren dizajn → spreman za plan
**Pristup:** Cleanup skripta (jednokratno) + refaktor mutacionih e2e da čiste za sobom i ne diraju prave klijente

## Kontekst i cilj

`tests/e2e/04-klijenti.spec.ts` ima mutacione testove koji rade protiv **cloud-a** (otkad je e2e prebačen na Supabase) i **ne čiste za sobom**:
- "Novi klijent" → kreira `E2E Test Klijent <ts>`, nikad ne briše (×6 u bazi).
- "Kontakti tab" → kreira `Kontakt Klijent <ts>` + lokaciju "Centrala", nikad ne briše (×6).
- "uređuje napomenu" → mijenja **WAIKIKI** napomenu na `E2E napomena <ts>`, nikad ne vraća.
- "tip odnosa" → mijenja **WAIKIKI** `tip_odnosa` na ugovor, nikad ne vraća.

Posljedica: **12 od 30 klijenata je junk** (40%), a pravi WAIKIKI ima test-napomenu. Samo 18 pravih klijenata.

Cilj: (1) očistiti postojeći junk + vratiti WAIKIKI napomenu; (2) refaktorisati mutacione testove da koriste throwaway klijent i čiste se u `finally`, tako da budući runovi ne zagađuju.

## Činjenice (provjereno)

- FK `lokacije.klijent_id references klijenti(id) on delete cascade` → brisanje klijenta automatski briše njegove lokacije.
- FK `termini.klijent_id references klijenti(id) on delete restrict` → klijent SA terminima se ne može obrisati (throwaway klijenti nemaju termine → OK).
- Trenutno: 30 klijenata; 12 junk (`E2E Test Klijent %`, `Kontakt Klijent %`); WAIKIKI napomena = `E2E napomena 1782123007772`.
- `tests/e2e/db.ts` već ima: `firstKlijentId`, `insertTermin`, `deleteTermin`, itd. (admin Supabase klijent).

## Global Constraints (verbatim)

- Grana: `fix/klijenti-test-higijena` (NE `main`). Već kreirana.
- Cloud Supabase — skripte/e2e protiv cloud-a (`.env.local`, `SUPABASE_SERVICE_ROLE_KEY`).
- ESLint zabranjuje `no-await-in-loop` (skripta: scoped disable na await u petlji) i `sm:`/`md:` (nije relevantno).
- Throwaway test-klijenti koriste prefiks `E2E-TMP ` (npr. `E2E-TMP <Date.now()>`); cleanup skripta to hvata kao backstop.
- Read-only testovi nad WAIKIKI ostaju (ne mutiraju); samo mutacioni prelaze na throwaway.
- AGENTS.md: NIJE standardni Next.js — ali ovo je TS lib/skripta/testovi.

---

## Sekcija 1 — Cleanup skripta (jednokratno)

`scripts/cleanup-test-data.ts` (`tsx --env-file=.env.local`, `createAdminSupabaseClient`):
- Obriši klijente gdje `naziv` matchuje test-pattern: `E2E Test Klijent %`, `Kontakt Klijent %`, `Brisivi Klijent %`, `E2E-TMP %`. Brisanje kaskadno uklanja njihove lokacije.
  - Implementacija: učitaj `klijenti` (`id, naziv`), filtriraj regexom `/^(E2E Test Klijent|Kontakt Klijent|Brisivi Klijent|E2E-TMP) /`, `delete().in("id", junkIds)` u batch-evima.
- Resetuj napomenu: `update({ napomena: null })` gdje `napomena` matchuje `^E2E napomena ` (vraća WAIKIKI). Učitaj `klijenti` (`id, napomena`), filtriraj, update po id.
- `tip_odnosa` se NE dira (original nepoznat; van opsega).
- Izvještaj: koliko klijenata obrisano, koliko napomena resetovano, finalni broj klijenata.
- npm script: `"cleanup:test-data": "tsx --env-file=.env.local scripts/cleanup-test-data.ts"`.
- Pokrenuti `pnpm cleanup:test-data` na cloud-u (očekivano 30 → 18).

---

## Sekcija 2 — Test higijena

### `tests/e2e/db.ts` — novi helper
```ts
export async function deleteKlijentByNaziv(naziv: string): Promise<void> {
  const { error } = await db.from("klijenti").delete().eq("naziv", naziv)
  if (error) throw new Error(`deleteKlijentByNaziv(${naziv}): ${error.message}`)
}
```
(Lokacije kaskadno; throwaway klijent nema termine pa restrict ne smeta.)

### `tests/e2e/04-klijenti.spec.ts` — refaktor mutacionih testova
Svaki mutacioni test koristi **throwaway klijent** (`const naziv = "E2E-TMP " + Date.now()`), radi sve na njemu, i briše ga u `finally` preko `deleteKlijentByNaziv(naziv)`. Import `deleteKlijentByNaziv` iz `./db`.

Konkretno:
- **"Novi klijent"** — kreira `E2E-TMP <ts>`, asertuje `after == before + 1`, `finally` obriše.
- **"Kontakti tab"** — kreira `E2E-TMP <ts>`, doda lokaciju "Centrala" + kontakt, asertuje kontakt; `finally` obriše klijent (cascade lokacija).
- **"uređuje napomenu"** — kreira `E2E-TMP <ts>`, navigira na njega, edituje NJEGOVU napomenu (`E2E napomena <ts>`), asertuje sheet zatvoren; `finally` obriše. **NE WAIKIKI.**
- **"tip odnosa"** — kreira `E2E-TMP <ts>`, navigira, postavi tip "Po ugovoru", asertuje badge; `finally` obriše. **NE WAIKIKI.**
- **"Lokacije CRUD"** — kreira `E2E-TMP <ts>`, CRUD lokacije na njemu; `finally` obriše klijent.
- **"Brisivi klijent se može obrisati"** — preimenovati u `E2E-TMP <ts>` prefiks; već briše kroz UI, dodati `finally` backstop `deleteKlijentByNaziv`.

Read-only testovi (lista, pretraga WAIK, detalj WAIKIKI termini/tabovi, **"delete disabled za klijenta sa terminima"** — read-only assertion nad WAIKIKI) ostaju nepromijenjeni.

Helper za kreiranje+navigaciju (DRY unutar fajla, ili inline po testu):
```ts
async function kreirajKlijent(page, naziv: string) {
  await page.goto("/klijenti")
  await page.getByTestId("novi-klijent-btn").click()
  await page.getByTestId("novi-klijent-naziv").fill(naziv)
  await page.getByTestId("novi-klijent-submit").click()
  await expect(page.getByTestId("novi-klijent-sheet")).toBeHidden({ timeout: 5000 })
}
async function otvoriKlijent(page, naziv: string) {
  await page.goto("/klijenti?q=" + encodeURIComponent(naziv))
  await page.getByTestId("klijent-card").filter({ hasText: naziv }).first().click()
  await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
}
```

---

## Verifikacija (gate)

- `pnpm lint && pnpm typecheck && pnpm build` — 0 grešaka.
- Nakon `pnpm cleanup:test-data`: 18 klijenata; WAIKIKI napomena prazna (nema `E2E napomena`).
- **Test-higijena dokaz:** zabilježi broj klijenata, pokreni `04-klijenti.spec.ts` (warm server, `--workers=1`), pa ponovo broj — **prije == poslije** (0 zaostalog junk-a). Plus cijeli set zelen.
- Regresija: ostali e2e (`12-obilasci`, `15-obilasci-dorada`, `10-pregled`) zeleni.

## Van opsega (YAGNI)

- UX dorada Klijenti taba (UI je dobar).
- Reset WAIKIKI `tip_odnosa` (original nepoznat).
- Izolacija cijelog e2e na zasebnu test-bazu/branch (veći infra zahvat — zaseban razgovor).
