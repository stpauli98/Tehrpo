# Atomske RPC za podsjetnik_emails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamijeniti read-modify-write nad `klijenti.podsjetnik_emails` atomskim Postgres `array_append`/`array_remove` kroz 2 `security invoker` RPC funkcije, i akcije preusmjeriti na `.rpc()`.

**Architecture:** Nova migracija sa `dodaj_podsjetnik_email(uuid, text) → text` (validacija + atomski guarded append) i `ukloni_podsjetnik_email(uuid, text) → void` (atomski array_remove), obje `security invoker` (poštuju `klijenti_upd` RLS). Server akcije zovu `.rpc()`; JS `dodajAdHoc`/`ukloniAdHoc` postaju dead i brišu se. Cloud rollout expand-stil (funkcije prije deploya): local → DEMO → PROD.

**Tech Stack:** Next.js 16, Supabase (Postgres/PostgREST, RLS), TypeScript, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-10-podsjetnik-email-atomic-rpc-design.md`

## Global Constraints

- **Grana:** `feat/podsjetnici-primaoci-iz-kontakata` (PR #22). Ne otvarati novu granu.
- **Package manager:** `pnpm`.
- **`db/types.ts` je AUTO-GENERISAN.** Na OVOJ grani `pnpm db:types` skript još cilja PROD (PR #24 nije mergovan) — **regen ISKLJUČIVO sa `supabase gen types typescript --local > db/types.ts`** (kao Task 1 ranije). Nikad ručno editovati.
- **Funkcije:** `security invoker` + `set search_path = public` (namjerno odstupanje od `definer` konvencije — mutacija mora poštovati RLS).
- **Supabase klijent u akcijama:** SSR (`createServerSupabaseClient`), nikad admin.
- **Cloud apply — provjeri DB ref PRIJE upisa:** PROD ref = `fqtqkehjidkzeasiegnq`; DEMO = bilo koji DRUGI ref. DEMO apply override-uje `DATABASE_URL` iz `DATABASE_URL_DEMO` (`.env.development.local`). **PROD apply čeka izričitu potvrdu korisnika.**
- **Svaki commit** završava: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Bez `sm:`/`md:` Tailwind breakpointa.

---

## Task 1: Migracija (2 RPC) + apply na local + regen tipova

**Files:**
- Create: `supabase/migrations/20260710120000_podsjetnik_email_atomic_rpc.sql`
- Modify (regen): `db/types.ts`

**Interfaces:**
- Produces: RPC `dodaj_podsjetnik_email(p_klijent_id uuid, p_email text) → text` (status `'ok'|'nevalidan'|'kontakt'|'postoji'|'nedostupno'`) i `ukloni_podsjetnik_email(p_klijent_id uuid, p_email text) → void`; obje u `db/types.ts` `Functions` (Task 2 zove `.rpc()`).

- [ ] **Step 1: Kreiraj migraciju**

Kreiraj `supabase/migrations/20260710120000_podsjetnik_email_atomic_rpc.sql`:

```sql
-- Atomske ad-hoc primalac operacije nad klijenti.podsjetnik_emails (issue #23).
-- SECURITY INVOKER (NE definer): tenant-scoped mutacija mora poštovati klijenti_upd RLS
-- (ima_pristup_klijentu); definer bi zaobišao RLS.
create or replace function dodaj_podsjetnik_email(p_klijent_id uuid, p_email text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_updated int;
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return 'nevalidan';
  end if;
  if exists (
    select 1 from kontakt_osobe
    where klijent_id = p_klijent_id
      and lower(btrim(coalesce(email, ''))) = v_email
  ) then
    return 'kontakt';
  end if;
  update klijenti
    set podsjetnik_emails = array_append(podsjetnik_emails, v_email)
    where id = p_klijent_id
      and not (v_email = any(podsjetnik_emails));
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return 'ok';
  end if;
  if exists (
    select 1 from klijenti
    where id = p_klijent_id and v_email = any(podsjetnik_emails)
  ) then
    return 'postoji';
  end if;
  return 'nedostupno';
end;
$$;

create or replace function ukloni_podsjetnik_email(p_klijent_id uuid, p_email text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update klijenti
    set podsjetnik_emails = array_remove(podsjetnik_emails, lower(btrim(coalesce(p_email, ''))))
    where id = p_klijent_id;
end;
$$;
```

- [ ] **Step 2: Provjeri lokalni stack pa reapliciraj migracije**

Run: `pnpm exec supabase status` (ako je stopped → `pnpm exec supabase start`)
Run: `pnpm db:reset`
Expected: sve migracije se primijene uklj. `20260710120000_podsjetnik_email_atomic_rpc`, bez greške.

- [ ] **Step 3: Regeneriši tipove IZ LOKALNOG stacka (NE `pnpm db:types`)**

Run: `supabase gen types typescript --local > db/types.ts`
Expected: EXIT 0.

- [ ] **Step 4: Verifikuj funkcije u tipovima + da je diff SAMO te 2 funkcije**

Run: `grep -c "dodaj_podsjetnik_email\|ukloni_podsjetnik_email" db/types.ts`
Expected: ≥ 2 (obje funkcije prisutne u `Functions`).
Run: `git diff --stat db/types.ts`
Expected: izmijenjen samo `db/types.ts`. Pregledaj `git diff db/types.ts` — dodane linije se odnose ISKLJUČIVO na 2 nove funkcije (Args/Returns). Ako ima nepovezanog schema drift-a → **STANI i javi** (ne commituj drift).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: EXIT 0.
```bash
git add supabase/migrations/20260710120000_podsjetnik_email_atomic_rpc.sql db/types.ts
git commit -m "feat(db): atomske RPC dodaj/ukloni_podsjetnik_email (array_append/remove)"
```

---

## Task 2: Akcije → `.rpc()` + ukloni dead JS helpere + testovi

**Files:**
- Modify: `app/(dashboard)/klijenti/[id]/actions.ts` (`dodajPodsjetnikEmail`, `ukloniPodsjetnikEmail`, import)
- Modify: `lib/podsjetnici/primaociPicker.ts` (ukloni `dodajAdHoc`/`ukloniAdHoc`/`DodajRezultat`)
- Test: `lib/podsjetnici/primaociPicker.test.ts` (ukloni njihov describe blok)

**Interfaces:**
- Consumes: RPC `dodaj_podsjetnik_email`/`ukloni_podsjetnik_email` iz Task 1 (u `db/types.ts`).
- Produces: `dodajPodsjetnikEmail(klijentId, email)` / `ukloniPodsjetnikEmail(klijentId, email)` sada preko `.rpc()`.

- [ ] **Step 1: Prepiši obje akcije**

U `app/(dashboard)/klijenti/[id]/actions.ts`, zamijeni CIJELE `dodajPodsjetnikEmail` i `ukloniPodsjetnikEmail` sa:

```ts
export async function dodajPodsjetnikEmail(klijentId: string, email: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { data: status, error } = await supabase.rpc("dodaj_podsjetnik_email", {
    p_klijent_id: klijentId, p_email: email,
  })
  if (error) return { ok: false, message: error.message }
  if (status !== "ok") {
    const msg =
      status === "nevalidan" ? "Nevažeća email adresa."
      : status === "postoji" ? "Adresa je već dodata."
      : status === "kontakt" ? "Adresa je već primalac kao kontakt."
      : "Nije moguće dodati adresu."
    return { ok: false, message: msg }
  }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}

export async function ukloniPodsjetnikEmail(klijentId: string, email: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc("ukloni_podsjetnik_email", {
    p_klijent_id: klijentId, p_email: email,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}
```

- [ ] **Step 2: Ukloni sada-neiskorišten import**

U istom fajlu, ukloni red `import { dodajAdHoc, ukloniAdHoc } from "@/lib/podsjetnici/primaociPicker"` (akcije ga više ne koriste). Ostavi ostale importe.

- [ ] **Step 3: Ukloni dead funkcije iz `primaociPicker.ts`**

U `lib/podsjetnici/primaociPicker.ts` obriši: tip `DodajRezultat`, funkciju `dodajAdHoc(...)`, i funkciju `ukloniAdHoc(...)`. **Zadrži** `norm`, `KontaktRed`, `KontaktOpcija`, `filtrirajKontakte`, `mozeAdHoc`, `adHocZaPrikaz`, i import `EMAIL_RE`.

- [ ] **Step 4: Ukloni njihov test blok**

U `lib/podsjetnici/primaociPicker.test.ts` obriši cijeli `describe("dodajAdHoc / ukloniAdHoc", () => { … })` blok i uklони `dodajAdHoc, ukloniAdHoc` iz `import { … } from "./primaociPicker"` (zadrži `norm, filtrirajKontakte, mozeAdHoc, adHocZaPrikaz`).

- [ ] **Step 5: Pokreni unit + typecheck + lint**

Run: `pnpm vitest run lib/podsjetnici/primaociPicker.test.ts`
Expected: PASS (preostali testovi: filtrirajKontakte/mozeAdHoc/adHocZaPrikaz).
Run: `pnpm typecheck && pnpm lint`
Expected: EXIT 0, bez neiskorištenih importa/simbola (ako lint prijavi neiskorišten `EMAIL_RE` — znači nešto još treba; provjeri da `mozeAdHoc` i dalje koristi `EMAIL_RE`).

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/klijenti/[id]/actions.ts" lib/podsjetnici/primaociPicker.ts lib/podsjetnici/primaociPicker.test.ts
git commit -m "refactor(podsjetnici): akcije koriste atomske RPC; ukloni dead JS helpere"
```

---

## Task 3: Cloud rollout (DEMO) + e2e — [KONTROLER, ne subagent]

**Napomena:** operativni korak (bez diffa). Kontroler izvršava direktno uz ref-guard. PROD apply je zaseban, gated na korisnika.

- [ ] **Step 1: Apply migracije na DEMO (ref-guard)**

```bash
DEMO_URL="$(grep -E '^DATABASE_URL_DEMO=' .env.development.local | cut -d= -f2-)"
echo "$DEMO_URL" | grep -q "fqtqkehjidkzeasiegnq" && { echo "GRESKA: DEMO_URL sadrži PROD ref!"; exit 1; } || echo "ref OK (nije PROD)"
DATABASE_URL="$DEMO_URL" pnpm exec tsx scripts/apply-cloud-migration.ts supabase/migrations/20260710120000_podsjetnik_email_atomic_rpc.sql
```
Expected: `✅ Primijenjeno: …`.

- [ ] **Step 2: E2E na DEMO**

```bash
lsof -ti tcp:3000 | xargs kill -9 2>/dev/null
pnpm exec playwright test tests/e2e/24-podsjetnici-primaoci.spec.ts --project=chromium --workers=1
```
Expected: PASS (dodaj+ukloni ad-hoc sad idu kroz RPC; reload persist).

- [ ] **Step 3: PROD apply — ČEKA POTVRDU KORISNIKA**

Ne izvršavati bez izričitog „da". Kad korisnik potvrdi:
```bash
grep -E '^DATABASE_URL=' .env.local | grep -q "fqtqkehjidkzeasiegnq" && echo "ref = PROD, OK" || { echo "GRESKA: .env.local DATABASE_URL nije očekivani PROD ref"; exit 1; }
pnpm db:apply-cloud supabase/migrations/20260710120000_podsjetnik_email_atomic_rpc.sql
```

- [ ] **Step 4: Push + ažuriraj PR #22**

```bash
git push origin feat/podsjetnici-primaoci-iz-kontakata
```
Dopuni opis PR #22: dodata migracija `20260710120000` (atomske RPC), PR više nema „nula cloud migracija"; napomenu da su funkcije primijenjene na DEMO (+PROD kad korisnik potvrdi).

---

## Self-Review (autor plana)

- **Spec coverage:** migracija (Task 1), akcije `.rpc()` (Task 2), čišćenje dead helpera+test (Task 2), tipovi (Task 1), rollout DEMO/PROD (Task 3), e2e (Task 3). ✔
- **Placeholder scan:** nema TBD/TODO; SQL i TS kod je pun i verbatim. ✔
- **Type consistency:** RPC imena `dodaj_podsjetnik_email`/`ukloni_podsjetnik_email` + parametri `p_klijent_id`/`p_email` isti u migraciji (Task 1) i `.rpc()` pozivima (Task 2); status stringovi `'ok'|'nevalidan'|'kontakt'|'postoji'|'nedostupno'` isti u SQL-u i JS mapiranju. ✔
- **Rizik:** regen tipova mogao bi pokazati drift (Task 1 Step 4 to hvata → STANI); cloud ref-guard u Task 3; PROD gated.
