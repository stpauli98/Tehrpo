# Klijent → Podsjetnici: gate sekcije „Slanje firmi" na globalnu postavku — dizajn

**Datum:** 2026-07-09
**Grana:** `feat/podsjetnici-primaoci-iz-kontakata` (PR #22, nastavak)
**Status:** dizajn odobren; direktna implementacija (bez SDD)

## Cilj

U klijent → tab **Podsjetnici**, sekcija **„Slanje firmi"** (per-firma prekidač
`salji_podsjetnik_klijentu` + combobox picker primalaca) treba biti **uslovljena globalnom
postavkom** `postavke.salji_klijentima`:

- **global ON** → prikaži kao sad (prekidač + picker); korisnik slobodno pali/gasi per-firma.
- **global OFF** → sakrij prekidač + picker; prikaži jednu liniju „Globalno slanje firmama je
  isključeno u Postavkama." + link „Otvori Postavke →" **samo za admina** (samo admin može
  promijeniti — `postavke_wr = je_admin()`).

Rješava zbunjujuće stanje gdje korisnik konfiguriše primaoce/toggle koji ne mogu raditi, i ne vidi
da je globalno isključeno.

Sekcija **„Dodijeljeni radnici"** (interni Kanal 1, admin-only) — **netaknuta**, ne ovisi o ovome.

## Zatečeno

- `KlijentPodsjetniciTab.tsx` (server comp) čita `klijenti.salji_podsjetnik_klijentu,
  podsjetnik_emails` + kontakte; ima `jeAdmin`. **Ne čita** `postavke.salji_klijentima`. Uvijek
  renderuje `KlijentPodsjetniciForm` (prekidač `klijent-salji-toggle` + combobox).
- RLS: `postavke_sel` = `using (auth.uid() is not null)` → **svaka uloga smije čitati**;
  `postavke_wr` = `je_admin()`.
- Postavke ruta: `/postavke`. Globalni prekidač je `postavke.saljiKlijentima` („Šalji podsjetnike i
  firmama").
- **DEMO default: `salji_klijentima = false`** (izolacija — global true otvara živi Resend na DEMO;
  vidi `23-podsjetnici-v2.spec.ts:82-85` „MORA završiti na false").

## Promjene

1. **`components/domain/KlijentPodsjetniciTab.tsx`**
   - U `Promise.all` dodati: `supabase.from("postavke").select("salji_klijentima").eq("id", 1).maybeSingle()`.
   - `const saljiGlobalno = postRes.data?.salji_klijentima ?? false`.
   - U sekciji „Slanje firmi": `{saljiGlobalno ? <KlijentPodsjetniciForm .../> : <napomena>}`.
   - Napomena (inline, `import Link from "next/link"`): `data-testid="podsjetnici-global-off"`,
     tekst `t("globalnoIskljuceno")` + (ako `jeAdmin`) `<Link href="/postavke">{t("otvoriPostavke")}</Link>`.

2. **i18n** — novi ključevi u `klijenti.podsjetnici` (sr/en/de): `globalnoIskljuceno`, `otvoriPostavke`.

3. **E2E (bitna interakcija)** — gate sakriva `klijent-salji-toggle` i combobox kad je global OFF.
   Oba spec-a koja diraju formu MORAJU postaviti global ON pa vratiti FALSE (izolacija):
   - `tests/e2e/24-podsjetnici-primaoci.spec.ts` (combobox): `setPostavkeV2({ salji_klijentima: true })`
     na početku `try`; `setPostavkeV2({ salji_klijentima: false })` u `finally` (uz `deleteKlijentByNaziv`).
   - `tests/e2e/23-podsjetnici-v2.spec.ts` test „tab firme: per-firma toggle …" (L89-125): isto —
     set true na početku, force false u finally. (Import `getPostavkeV2/setPostavkeV2` već postoji.)
   - Force-false u finally (ne read-before-restore) — svjesno, isti obrazac kao postojeći
     23-spec (global true = opasnost živog slanja na DEMO).

## Van obima (YAGNI)

- Bez gate-ovanja combobox-a na per-firma toggle (global gate je dovoljan; combobox se vidi kad je
  global ON bez obzira na per-firma prekidač — pre-konfiguracija primalaca ostaje moguća).
- `saljiOpis` hint ostaje (bezopasan).
- Bez izmjene engine-a (`saljiKlijentima && firmaUkljucena` logika već tačna).

## Test / verifikacija

- `pnpm typecheck && pnpm lint && pnpm build`.
- E2E: `24-podsjetnici-primaoci` + `23-podsjetnici-v2` (chromium, cloud DEMO) — oba prolaze; DEMO
  ostaje `salji_klijentima=false` nakon runova.
- Ručno (opciono): global OFF → napomena (+ admin link); global ON → forma.

## Grana

Nastavak na `feat/podsjetnici-primaoci-iz-kontakata`; dodatni commit(i) + push → PR #22 se osvježi.
