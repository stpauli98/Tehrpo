# Dizajn: 03-termini test-higijena + čišćenje junk termina

**Datum:** 2026-06-23
**Status:** Odobren dizajn → spreman za plan
**Pristup:** Throwaway-klijent izolacija mutacija + proširenje cleanup skripte na termine

## Kontekst i cilj

`tests/e2e/03-termini.spec.ts` mutira pravu cloud bazu na 6 mjesta bez čišćenja (follow-up iz klijenti-higijene):
- "kreira novi termin" → kreira trajni termin (rok 2035+offset), nikad ne briše.
- "duplikat" → kreira trajni termin (rok 2045+offset), nikad ne briše.
- "uredi napomenu i spremi" → mijenja napomenu **prvog pravog termina** na "E2E test napomena", nikad ne vraća.
- "označi kao izvršeno" → postavlja interval na **pravu vrstu**, označava **pravi kasni termin** izvršenim (+ auto-cycle kreira novo dijete), bez čišćenja.
- "Otkaži termin" → mijenja **pravi kasni termin** u otkazano.
- "uređivanje Datum zakazan" → mijenja **pravi planirani termin** u zakazano.

Stanje u bazi: **12 termina sa rok ≥ 2030** (2046, 2055…; pravi su 2026) + **2 sa "E2E test napomena"**. Ukupno 451.

Cilj: (1) očistiti junk termine + test-napomene; (2) izolovati sve mutacione testove na **throwaway klijent** (insert termina za njega → operiši → `finally` obriši njegove termine + klijenta), tako da `03-termini` više ne dira prave podatke.

## Činjenice (provjereno)

- `db.ts` ima: `insertTermin({klijentId, vrstaId, rok})` (status uvijek "planirano"; rok u prošlosti → view izvodi `kasni`), `deleteTermin(id)`, `deleteKlijentByNaziv(naziv)`, `terminIdByStatus`, `firstActiveVrstaId`, `setVrstaInterval(vrstaId, mjeseci)`, `kasniTerminForVrsta`, `firstKlijentId`.
- Interval kolona vrste: `podrazumevani_interval_mjeseci`.
- FK: `lokacije.klijent_id` ON DELETE CASCADE; `termini.klijent_id` ON DELETE RESTRICT (zato throwaway klijent treba prvo obrisati svoje termine pa sebe).
- `scripts/cleanup-test-data.ts` već čisti junk klijente + napomene (`JUNK_KLIJENT`, `JUNK_NAPOMENA`).

## Global Constraints (verbatim)

- Grana: `fix/termini-test-higijena` (NE `main`). Već kreirana.
- Cloud Supabase — skripte/e2e protiv cloud-a (`.env.local`, `SUPABASE_SERVICE_ROLE_KEY`).
- ESLint zabranjuje `no-await-in-loop` (skripta: scoped disable) i `sm:`/`md:`.
- Throwaway klijent: prefiks `E2E-TMP ` (cleanup skripta to već hvata).
- Junk termin granica: `rok_dospijeca >= '2030-01-01'` (pravi su 2026; auto-cycle max ~par godina).
- Read-only testovi ostaju; samo mutacioni prelaze na throwaway.
- WEBKIT COLD-START: zagrijati server, Playwright `--workers=1`.
- AGENTS.md: NIJE standardni Next.js.

---

## Sekcija 1 — Cleanup junk termina (proširenje skripte)

`scripts/cleanup-test-data.ts` — dodati nakon postojećeg klijenti čišćenja:
- Obriši termine `rok_dospijeca >= '2030-01-01'`:
  ```ts
  const { data: far } = await sb.from("termini").select("id").gte("rok_dospijeca", "2030-01-01")
  const farIds = (far ?? []).map((t) => t.id)
  // batch delete .in("id", slice)
  ```
- Resetuj termin-napomenu: `update({ napomena: null })` gdje napomena matchuje `/E2E/i`:
  ```ts
  const { data: tn } = await sb.from("termini").select("id, napomena").not("napomena", "is", null)
  const tnIds = (tn ?? []).filter((t) => /E2E/i.test(t.napomena as string)).map((t) => t.id)
  // batch update napomena: null .in("id", slice)
  ```
- Proširi završni log: koliko termina obrisano + napomena resetovano.
- Pokrenuti `pnpm cleanup:test-data` (već postoji npm script) → ~439 termina, 0 junk.

---

## Sekcija 2 — Test higijena

### `tests/e2e/db.ts` — novi helperi
```ts
export async function insertKlijent(naziv: string): Promise<string> {
  const { data, error } = await db.from("klijenti").insert({ naziv }).select("id").single()
  if (error) throw new Error(`insertKlijent(${naziv}): ${error.message}`)
  return data.id as string
}

export async function deleteTerminiByKlijent(klijentId: string): Promise<void> {
  const { error } = await db.from("termini").delete().eq("klijent_id", klijentId)
  if (error) throw new Error(`deleteTerminiByKlijent(${klijentId}): ${error.message}`)
}

export async function getVrstaInterval(vrstaId: string): Promise<number | null> {
  const { data } = await db.from("vrste_provjera").select("podrazumevani_interval_mjeseci").eq("id", vrstaId).single()
  return (data?.podrazumevani_interval_mjeseci as number | null) ?? null
}
```

### `tests/e2e/03-termini.spec.ts` — refaktor mutacionih testova
Svaki mutacioni test kreira throwaway klijent (`const naziv = "E2E-TMP " + Date.now()`; `const kid = await insertKlijent(naziv)`), radi na njegovim terminima, i u `finally`:
```ts
finally {
  await deleteTerminiByKlijent(kid)   // briše termine (+ auto-cycle dijete)
  await deleteKlijentByNaziv(naziv)   // pa klijent (restrict OK jer su termini obrisani)
}
```

Konkretno:
- **"uredi napomenu i spremi"** — `kid`, `tid = insertTermin({klijentId: kid, vrstaId: await firstActiveVrstaId(), rok: <2026 budući>})`; otvori `/termini?selected=${tid}`, edit napomena → "E2E test napomena", assert nema alert; `finally` cleanup.
- **"Otkaži termin → Otkazano"** — `kid`, `tid = insertTermin(...)`; `?selected=${tid}`, otkaži, assert "Otkazano"; `finally` cleanup. (Više se ne koristi `terminIdByStatus("kasni")`.)
- **"uređivanje Datum zakazan → Zakazano"** — `kid`, `tid = insertTermin(...)` (planirano); `?selected=${tid}`, postavi `edit-datum-zakazan`, assert "Zakazano"; `finally` cleanup.
- **"označi kao izvršeno + auto-cycle"** — `kid`; `vrsta = await firstActiveVrstaId()`; `orig = await getVrstaInterval(vrsta)`; `setVrstaInterval(vrsta, 12)`; `tid = insertTermin({klijentId: kid, vrstaId: vrsta, rok: <prošli datum>})` (kasni); čitaj `before` (stat-ukupno), `?selected=${tid}`, mark-done, assert nema alert, `before+1`; `finally`: `setVrstaInterval(vrsta, orig ?? originalno)` (restore — ako orig null, postaviti nazad na null preko setVrstaInterval prilagođenog ili direktno), `deleteTerminiByKlijent(kid)`, `deleteKlijentByNaziv(naziv)`.
  - NAPOMENA za restore intervala: `setVrstaInterval` postavlja broj; za restore na `null` treba varijanta koja prima `number | null`. Proširiti `setVrstaInterval` da prima `number | null` (update prolazi null normalno).
- **"kreira novi termin (UI)"** — `kid` (naziv `E2E-TMP <ts>`); UI: `novi-termin-btn` → `novi-klijent` Select → izaberi opciju `{ name: naziv }` (throwaway) → `novi-vrsta` first → `novi-rok` jedinstven (npr. 2029-xx da bude < 2030 granice ali realan budući) → submit; assert `before+1`; `finally` cleanup.
- **"duplikat"** — `kid`; UI kreira dvaput isti (throwaway klijent + first vrsta + isti rok); drugi odbijen porukom; `finally` cleanup.

Read-only testovi (lista, KPI, filteri, pretraga, stats, "Detalji otvara sheet", "Zatvori sheet vraća na listu", vizuelni smoke) **ostaju nepromijenjeni**.

Import u test: `import { ..., insertTermin, deleteTermin, insertKlijent, deleteTerminiByKlijent, deleteKlijentByNaziv, getVrstaInterval } from "./db"` (uz postojeće).

---

## Verifikacija (gate)

- `pnpm lint && pnpm typecheck && pnpm build` — 0 grešaka.
- Nakon `pnpm cleanup:test-data`: 0 termina sa rok ≥ 2030; 0 termina sa E2E napomenom.
- **Higijena dokaz:** broj termina prije == poslije pokretanja `03-termini.spec.ts` (`--workers=1`, warm server). Plus cijeli set zelen.
- Regresija: `10-pregled`, `05-matrix-plan`, `04-klijenti` zeleni.

## Van opsega (YAGNI)

- Već-flipovani pravi termini iz ranijih runova (otkazano/zakazano) — originali nepoznati, ostaju.
- Izolacija cijelog e2e na zasebnu test-bazu (veći infra zahvat).
