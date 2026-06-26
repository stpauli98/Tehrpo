# EPIK A — Auth, uloge, RLS, audit (Design spec)

**Datum:** 2026-06-26
**Status:** Approved (brainstorming complete) — čeka korisnički pregled prije writing-plans
**Kontekst:** Prvi epik migracije postojećeg `tehpro-mvp` na puni brief
(vidi `claudedocs/2026-06-26-gap-plan-mvp-vs-brief.md`).
**Polazna tačka:** `tehpro-mvp` @ `main` — single-tenant, bez auth-a, RLS isključen.

---

## 1. Cilj i opseg

Uvesti sloj pristupa koji brief zahtijeva već u Fazi 1 (§3, §11, §14):

- Individualna prijava (email + lozinka), reset lozinke.
- Tri uloge: **admin**, **operater**, **pregled**.
- Pristup po dodjeli: operater/pregled vide **samo dodijeljene klijente**; admin sve.
- Operater može uređivati dodijeljene; pregled je read-only.
- **Audit log** svake izmjene (ko, šta, kada, staro→novo).

**Van opsega EPIK A** (kasniji epici): `Ugovor`, bogati `Klijent` (PIB itd.), Obuke/Oprema kao izvori
rokova, izvještaji, semantika `Aktivnost` (tip/nacin_izvrsenja). Ovdje je samo sloj pristupa + audit.

### Potvrđene odluke (brainstorming)

| # | Pitanje | Odluka |
|---|---|---|
| 1 | Auth provider | **Supabase Auth** (email+lozinka) |
| 2 | Kreiranje naloga | **Admin kreira** (nema javne registracije) |
| 3 | Prvi admin + demo podaci | **Seed admin**; admin po RLS-u vidi sve → demo ostaje vidljiv |
| 4 | Audit mehanizam | **DB trigeri, automatski** (staro→novo JSONB) |
| 5 | Provođenje pristupa | **Pristup 1 — RLS kao jedini izvor istine** (+ viewovi `security_invoker`) |

---

## 2. Arhitektura

```
Prijava (Supabase Auth)
   │  JWT u cookie-ju (@supabase/ssr)
   ▼
middleware.ts ──► nema sesije / deaktiviran? → redirect /prijava
   │ ima sesiju
   ▼
(dashboard) ekrani ──► createServerSupabaseClient (anon ključ + user JWT)
   │
   ▼
Postgres + RLS  ◄── auth.uid() iz JWT-a
   │  ima_pristup_klijentu(klijent_id): admin → true; inače KorisnikKlijent
   ▼
Postavke (admin): kreiranje korisnika (service role), dodjela klijenata
```

**Principi:**
- **RLS je jedini izvor istine** za vidljivost. App kod ne dodaje ručne filtere po klijentu.
- **Middleware = authentication gate** (prijavljen/nije + aktivan/nije). Ne radi authorization.
- **Authorization u bazi** (RLS + helperi).
- **Service role** (cron, seed) svjesno zaobilazi RLS — sistemski poslovi.
- **Audit** = DB trigger; akter iz `auth.uid()`; service-role → akter `null` (sistem).

---

## 3. Model podataka

```sql
create type korisnik_uloga as enum ('admin','operater','pregled');

-- profil 1:1 sa auth.users
create table korisnici (
  id          uuid primary key references auth.users(id) on delete cascade,
  ime         text not null,
  email       text not null unique,
  uloga       korisnik_uloga not null default 'pregled',
  aktivan     bool not null default true,
  created_at  timestamptz not null default now()
);

-- N:N dodjela (admin ne treba red — vidi sve)
create table korisnik_klijent (
  korisnik_id  uuid not null references korisnici(id) on delete cascade,
  klijent_id   uuid not null references klijenti(id)  on delete cascade,
  primary key (korisnik_id, klijent_id)
);
create index idx_kk_korisnik on korisnik_klijent (korisnik_id);
create index idx_kk_klijent  on korisnik_klijent (klijent_id);

-- audit (staro→novo)
create table audit_log (
  id          bigint generated always as identity primary key,
  korisnik_id uuid references korisnici(id) on delete set null,
  akcija      text not null,        -- INSERT | UPDATE | DELETE
  entitet     text not null,        -- naziv tabele
  entitet_id  text,
  staro       jsonb,
  novo        jsonb,
  vrijeme     timestamptz not null default now()
);
create index idx_audit_entitet on audit_log (entitet, entitet_id);
create index idx_audit_vrijeme on audit_log (vrijeme desc);
```

**Helperi (centralna tačka odluke o pristupu):**
```sql
create function je_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from korisnici k
    where k.id = auth.uid() and k.uloga='admin' and k.aktivan); $$;

create function je_pregled() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from korisnici k
    where k.id = auth.uid() and k.uloga='pregled' and k.aktivan); $$;

create function ima_pristup_klijentu(p_klijent_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select je_admin() or exists (
    select 1 from korisnik_klijent kk
    join korisnici k on k.id = kk.korisnik_id
    where kk.korisnik_id = auth.uid()
      and kk.klijent_id = p_klijent_id
      and k.aktivan ); $$;
```

Sve „dijete" tabele pristup nasljeđuju preko `klijent_id` (direktno ili `exists` na roditelja).

---

## 4. RLS politike

RLS se uključuje (`enable row level security`) na svim tabelama.

**A) Tabele vezane za klijenta** (`klijenti`, `lokacije`, `termini`, `dokumenti`, `obilasci`,
`klijent_provjere`, `podsjetnici`):
```sql
-- čitanje: admin sve, ostali dodijeljene
create policy sel on <t> for select using ( ima_pristup_klijentu(<klijent_id izraz>) );
-- pisanje: admin + operater (NE pregled), samo na dodijeljenom
create policy ins on <t> for insert with check ( ima_pristup_klijentu(...) and not je_pregled() );
create policy upd on <t> for update using ( ima_pristup_klijentu(...) and not je_pregled() )
                                  with check ( ima_pristup_klijentu(...) and not je_pregled() );
create policy del on <t> for delete using ( ima_pristup_klijentu(...) and not je_pregled() );
```
- Tabele bez direktnog `klijent_id` (npr. `dokumenti` preko `termin_id`→`termini.klijent_id`)
  koriste `exists` subquery na roditelja. Tačna mapa kolona po tabeli ide u implementacijski plan.

**B) Katalog / postavke** (`vrste_provjera`, `postavke`):
```sql
create policy sel on <t> for select using ( auth.uid() is not null );  -- svi prijavljeni
create policy wr  on <t> for all    using ( je_admin() ) with check ( je_admin() );
```

**C) Korisnici / dodjela:**
```sql
create policy sel_self  on korisnici for select using ( id = auth.uid() or je_admin() );
create policy adm_write on korisnici for all    using ( je_admin() ) with check ( je_admin() );
create policy sel_kk on korisnik_klijent for select using ( korisnik_id = auth.uid() or je_admin() );
create policy wr_kk  on korisnik_klijent for all    using ( je_admin() ) with check ( je_admin() );
```

**D) Audit log:** čita samo admin; upis ide samo kroz trigger (SECURITY DEFINER), bez insert-politike.
```sql
create policy sel_audit on audit_log for select using ( je_admin() );
```

**E) Viewovi → `security_invoker` (KRITIČNO):**
```sql
alter view termini_view  set (security_invoker = on);
alter view klijenti_view set (security_invoker = on);
```
Bez ovoga viewovi zaobilaze RLS (izvršavaju se s privilegijama vlasnika) → operater bi vidio sve.

**F) RPC funkcije:** `get_termini_stats`, `get_opterecenje` su `language sql` (SECURITY INVOKER po
defaultu) i čitaju iz `security_invoker` viewova → automatski poštuju pristup. `get_due_podsjetnici`
zove cron preko service role → svjesno zaobilazi RLS. Implementacija mora verifikovati da nijedan
app-RPC nije `SECURITY DEFINER`.

**G) `chat_poruke`** (AI istorija) nema vezu s klijentom (samo `konverzacija_id`). Za EPIK A:
RLS uključen, politika „samo prijavljeni" (`auth.uid() is not null`) za sve operacije — privremeno
dijeljeno među prijavljenima. Per-korisnik vlasništvo razgovora (dodati `korisnik_id` kolonu) je
naknadno poboljšanje, van opsega EPIK A; zabilježiti kao tehnički dug.

**H) Supabase Storage (`tehpro-dokumenti` bucket)** ima **odvojene** RLS politike (na `storage.objects`),
nezavisne od tabela. Bucket je privatan i app pristupa preko signed URL-ova iz server koda. Za EPIK A:
dodati storage politiku koja dozvoljava pristup objektu samo ako prijavljeni korisnik ima pristup
pripadajućem klijentu (path je `termini/{termin_id}/...` → join na `termini.klijent_id` →
`ima_pristup_klijentu`). Ako se to pokaže složeno za prvu iteraciju, minimum je „samo prijavljeni"
+ zadržati signed-URL pristup iz servera; puni per-klijent storage RLS zabilježiti kao stavku.

---

## 5. Auth flow

**Prijava** (`/prijava`): Server Action → `auth.signInWithPassword`. Aktivirati `setAll` u
`lib/supabase/server.ts` (sad no-op). Greška = generička poruka. Uspjeh → `/pregled`.

**Middleware** (`middleware.ts`, novi): matcher sve osim `/prijava`, `/auth/*`, `_next`, statike.
`auth.getUser()` → nema korisnika → redirect `/prijava`; `korisnici.aktivan=false` → signOut + redirect.
*Napomena:* provjeriti Next.js 16.2.9 middleware API u `node_modules/next/dist/docs/` (AGENTS.md).

**Reset lozinke** (Supabase ugrađeni): `/zaboravljena-lozinka` → `resetPasswordForEmail`;
`/auth/nova-lozinka` → `updateUser({password})`.

**Admin kreira korisnika** (Postavke, service role): provjera `je_admin()` →
`auth.admin.createUser({email,password,email_confirm:true})` → `insert into korisnici`.
Deaktivacija = `aktivan=false` (ne brišemo auth nalog).

**Audit trigger** (generički, AFTER INSERT/UPDATE/DELETE FOR EACH ROW):
```sql
create function tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce(NEW.id::text, OLD.id::text);
  insert into audit_log (korisnik_id, akcija, entitet, entitet_id, staro, novo)
  values (auth.uid(), TG_OP, TG_TABLE_NAME, v_id,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) end);
  return coalesce(NEW, OLD);
end; $$;
```
Kači se na: `klijenti, lokacije, termini, vrste_provjera, korisnici, korisnik_klijent, klijent_provjere`
(+ ostale klijent-vezane). Semantički kontekst akcije („označio izvršeno") NIJE u opsegu EPIK A.

---

## 6. UI izmjene

**Nove stranice (bez sidebar shell-a):** `/prijava`, `/zaboravljena-lozinka`, `/auth/nova-lozinka`
— prate postojeći brand/shadcn stil.

**Postavke → tab „Korisnici" (samo admin):** lista (ime, email, uloga, aktivan); `+ Novi korisnik`
(service-role action); po korisniku dodjela klijenata (multi-select → `korisnik_klijent`);
deaktivacija; promjena uloge. Postojeći tabovi „Usluge/Intervali" i „Podsjetnici" iza `je_admin()` gate-a.

**TopBar:** prijavljeni korisnik (ime + uloga) + „Odjava". Ukloniti „Mockup · demo podaci".

**„Svoje vs sve":** rješava RLS sam — bez ručnog filtera. (Admin filter „po zaduženom radniku" je EPIK B.)

**Role-gating (kozmetika povrh RLS-a):** `pregled` → sakriti akcije izmjene. Helper
`getTrenutniKorisnik()` (server) → `{id, ime, uloga}` za gating i TopBar.

Desktop-only gate, brand tokeni, shadcn primitivi — nepromijenjeni.

---

## 7. Error handling i edge case-ovi

- **Deaktiviran s aktivnom sesijom** → middleware signOut + redirect.
- **Korisnik bez dodjela** → prazne liste (ne greška) + poruka „Nemate dodijeljenih klijenata".
- **Service-role pozivi** → audit akter = sistem (null).
- **Brisanje korisnika s dodjelama** → `on delete cascade` na `korisnik_klijent`; preporuka: deaktivacija.
- **Email duplikat** → uhvatiti grešku iz `createUser` + `korisnici.email UNIQUE`.
- **Zaboravljen `security_invoker`** → operater vidi sve; pokriva E2E test.
- Greške korisniku kao `sonner` toast / inline; nikad sirovi DB error.

---

## 8. Testiranje i verifikacija

**Unit (Vitest):** role-gating helperi (`mozeUrediti(uloga)` itd.).

**E2E — novi `tests/e2e/17-auth-rls.spec.ts`:**
1. Neprijavljen → svaka ruta redirect `/prijava`.
2. Admin login → vidi sve + tab Korisnici.
3. Admin kreira operatera + dodijeli 1 klijenta.
4. Operater login → vidi samo tog klijenta (liste, `prikaz`, `termini`); nema tab Korisnici.
5. `pregled` → akcije izmjene skrivene; direktan write odbijen.
6. Reset lozinke (mock email).
7. Audit: izmjena termina → red u `audit_log` (staro/novo + korisnik_id).

**Migracija postojećih 16 E2E specova:** sad zahtijevaju prijavu → uvesti `loginAsAdmin(page)` helper
(`tests/e2e/db.ts` ili setup projekt) u `beforeEach`. **Značajan dio posla EPIK A.**

**Gate (faza done kad sve prolazi):**
- [ ] `pnpm build && pnpm lint && pnpm tsc --noEmit`
- [ ] `pnpm test:e2e` (uklj. novi auth spec)
- [ ] Ručno: operater ne vidi tuđeg klijenta ni direktnim URL-om (`/klijenti/[tuđi-id]`)

---

## 9. Reference

- Gap-plan: `claudedocs/2026-06-26-gap-plan-mvp-vs-brief.md`
- Brief: `../../../TEHPRO - Brief za agenta.md` (§3 uloge, §4 model, §11 zaštita, §14 prihvatanje)
- Stari MVP design: `2026-06-20-tehpro-mvp-design.md` (§4.6 RLS „odgođen do auth-a")
