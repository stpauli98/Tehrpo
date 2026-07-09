# Atomske RPC za `klijenti.podsjetnik_emails` — dizajn

**Datum:** 2026-07-10
**Grana:** `feat/podsjetnici-primaoci-iz-kontakata` (PR #22, nastavak)
**Status:** dizajn odobren; izvršenje kroz SDD
**Adresira:** GitHub issue #23 (🟡 read-modify-write race)

## Cilj

Zamijeniti read-modify-write nad `klijenti.podsjetnik_emails` u server akcijama
`dodajPodsjetnikEmail` / `ukloniPodsjetnikEmail` **atomskim Postgres operacijama**
(`array_append` / `array_remove`) kroz RPC funkcije. Time se eliminiše gubitak izmjene pri
konkurentnim editovanjima iste firme (dva taba / admin+operater istovremeno).

Zašto RPC: PostgREST `.update()` ne podržava kolonske izraze (`set col = array_append(col, x)`),
pa atomska operacija zahtijeva SQL funkciju. `update set col = array_append(col, x)` re-čita
`col` pod row-lock-om, za razliku od app-level read-modify-write → nema izgubljene izmjene ni
duplikata.

## Zatečeno (grana `feat/podsjetnici-primaoci-iz-kontakata`)

- `app/(dashboard)/klijenti/[id]/actions.ts` — `dodajPodsjetnikEmail` (čita `podsjetnik_emails` +
  kontakte, JS `dodajAdHoc`, piše nazad) i `ukloniPodsjetnikEmail` (čita, JS `ukloniAdHoc`, piše).
- `lib/podsjetnici/primaociPicker.ts` — `dodajAdHoc` / `ukloniAdHoc` / `DodajRezultat` koriste se
  **isključivo** u tim akcijama (grep potvrđen). `mozeAdHoc` (client gate „ponudi ad-hoc"),
  `filtrirajKontakte`, `adHocZaPrikaz`, `norm` — koriste ih combobox/UI, ostaju.
- `klijenti.podsjetnik_emails` = `text[] not null default '{}'`.
- Konvencija funkcija u migracijama: `security definer set search_path = public`. **Ove funkcije
  odstupaju → `security invoker`** (obrazloženje u § Migracija). Bez eksplicitnih `grant execute`
  (oslanja se na default PUBLIC, kao postojeće RPC).
- RLS: `klijenti_upd` key-uje na `ima_pristup_klijentu` (operater sa pristupom + admin smiju upd;
  `pregled` ne). Trenutna JS akcija se oslanja na taj RLS za tenant-scoping.

## Model / Migracija

Novi fajl `supabase/migrations/20260710120000_podsjetnik_email_atomic_rpc.sql`, 2 funkcije
**`security invoker`** + `set search_path = public`.

**Zašto `security invoker` (ne `definer` kako je konvencija):** ovo su tenant-scoped MUTACIJE.
`security definer` bi se izvršavao kao vlasnik i **zaobišao `klijenti_upd` RLS** → bilo koji
prijavljeni korisnik bi mogao mijenjati tuđu firmu. `invoker` izvršava kao pozivalac, pa
`klijenti_upd` (`ima_pristup_klijentu`) i `kontakt_osobe` RLS vrijede — identično sadašnjoj JS
akciji. `authenticated` već ima UPDATE na `klijenti` i SELECT na `kontakt_osobe` (JS akcija radi).

```sql
-- Atomske ad-hoc primalac operacije nad klijenti.podsjetnik_emails (issue #23).
-- SECURITY INVOKER (NE definer): tenant-scoped mutacija mora poštovati klijenti_upd RLS.
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
  -- format (ekvivalent EMAIL_RE /^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return 'nevalidan';
  end if;
  -- mejl je već kontakt firme → ne dodaje se kao ad-hoc
  if exists (
    select 1 from kontakt_osobe
    where klijent_id = p_klijent_id
      and lower(btrim(coalesce(email, ''))) = v_email
  ) then
    return 'kontakt';
  end if;
  -- atomski guarded append (dedup u istom UPDATE-u; re-čita niz pod row-lock-om)
  update klijenti
    set podsjetnik_emails = array_append(podsjetnik_emails, v_email)
    where id = p_klijent_id
      and not (v_email = any(podsjetnik_emails));
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return 'ok';
  end if;
  -- 0 redova: ili već postoji, ili nema pristupa (RLS)/ne postoji red
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

**Konkurentnost (zašto je korektno):** `update set col = array_append(col, x)` uzima row-lock i
re-čita `col`; drugi konkurentni upis čeka pa dodaje na već-ažuriranu vrijednost → obje različite
adrese slijeću. Isti mejl dva puta: drugi poziv vidi `x = any(col)` → guard 0 redova → `'postoji'`,
bez duplikata.

## Akcije (`actions.ts`)

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

- Ukloniti import `{ dodajAdHoc, ukloniAdHoc }` iz `primaociPicker` (akcija ih više ne koristi).

## Čišćenje (dead code)

- `lib/podsjetnici/primaociPicker.ts` — ukloniti `dodajAdHoc`, `ukloniAdHoc`, tip `DodajRezultat`
  (single source of truth = SQL). Zadržati `norm`, `filtrirajKontakte`, `mozeAdHoc`, `adHocZaPrikaz`,
  `KontaktRed`/`KontaktOpcija`, import `EMAIL_RE`.
- `lib/podsjetnici/primaociPicker.test.ts` — ukloniti `describe("dodajAdHoc / ukloniAdHoc", …)`
  blok. Ostali testovi ostaju.

## Tipovi

Nakon apply na local: `supabase gen types typescript --local > db/types.ts` (na feature grani
`db:types` skript još cilja PROD — koristiti `--local` direktno, kao Task 1; PR #24 to trajno
popravlja). Regen dodaje `dodaj_podsjetnik_email` / `ukloni_podsjetnik_email` u `Functions` (tipovan
`.rpc()`). Diff mora biti SAMO te 2 funkcije (bez nepovezanog drift-a).

## Rollout (expand — funkcije prije deploya)

Redoslijed (funkcije su backward-compatible: stari kod ih ne zove):
1. **local** — apply (`db:reset` ili `db:apply-cloud` nije za local; koristiti `supabase migration up`
   / `db:reset`) + regen tipova.
2. **DEMO** — `pnpm db:apply-cloud supabase/migrations/20260710120000_podsjetnik_email_atomic_rpc.sql`
   sa DEMO ref-om (`DATABASE_URL_DEMO`). Provjeriti ref prije upisa ([[db-refs-tehpro-vs-demo]]).
3. **e2e** — `24-podsjetnici-primaoci` (chromium, `--workers=1`) na DEMO — dodaj+ukloni ad-hoc sad
   idu kroz RPC.
4. **PROD** — `db:apply-cloud` sa PROD ref-om. **Sensitivno — čeka izričitu potvrdu korisnika**;
   provjeriti da ref nije zamijenjen prije upisa.
- Ide na feature granu → **PR #22 sada IMA +1 cloud migraciju** (čista funkcija). Ažurirati opis PR-a.

## Testovi

- Unit: `primaociPicker.test.ts` ostaje zelen nakon uklanjanja dodaj/ukloni bloka; ostali `lib/**`
  netaknuti (288 → nešto manje testova).
- E2E `24-podsjetnici-primaoci` (na DEMO) pokriva happy-path add+remove kroz RPC + reload persist.
- Rubni slučajevi RPC-a (`nevalidan`/`kontakt`/`postoji`/`nedostupno`) su i client-side zaštićeni
  `mozeAdHoc`-om; nisu zasebno integraciono testirani (prihvaćeno — backstop logika).
- `typecheck` + `lint` clean.

## Van obima (YAGNI)

- Bez `grant execute` reda (default PUBLIC, kao postojeće RPC).
- Bez integracionog testa za svaku RPC granu (client gate + e2e happy-path dovoljni).
- Bez diranja engine-a, gate-a, ili `mozeAdHoc` client-validacije.

## Rizici

- **`security invoker` odstupa od konvencije** — namjerno i obrazloženo; provjeriti da `authenticated`
  smije EXECUTE (default) i da RLS i dalje scope-uje (e2e sa operater nalogom bi bio idealan, ali
  24-spec ide kao admin — RLS scoping je ista putanja kao dosad).
- **Cloud apply** — DB ref mora biti tačan (PROD vs DEMO), inače upis u pogrešnu bazu.
- **Regen tipova drift** — koristiti `--local`; potvrditi da je diff samo 2 nove funkcije.
