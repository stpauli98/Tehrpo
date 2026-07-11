# Dizajn: Aktivnost log (admin nadzor)

**Datum:** 2026-07-11
**Grana:** `feat/aktivnost-log`
**Status:** Dizajn odobren, čeka plan implementacije

## Cilj

Adminu dati zaseban ekran ("Aktivnost") na kojem prati šta se dešava u aplikaciji:
ko je šta promijenio u bazi, koji ekran je otvorio, koji zapis je pogledao, kad se
prijavio/odjavio i šta je filtrirao. Zamjenjuje "ručno nagađanje" jedinstvenom
vremenskom linijom događaja, vidljivom **samo adminu**.

## Odluke (iz brainstorminga)

- **Obim praćenja:** promjene u bazi **+** UI događaji (otvaranje ekrana, otvaranje
  zapisa, prijava/odjava, filteri/pretrage).
- **Retencija:** 90 dana (automatsko brisanje starijih zapisa).
- **Vidljivost:** samo `admin` (nasljeđuje postojeći `audit_log` RLS).
- **Arhitektura:** Pristup A — proširiti postojeći `audit_log` u jedinstveni tok,
  sa provizijama za skalu (batch upis, retencija, spremnost za particionisanje).
- **Smještaj:** nova stavka u sidebaru `Aktivnost` (ruta `app/(dashboard)/aktivnost`),
  skrivena za `operater`/`pregled` (kao što je `asistent` skriven za `pregled`).

## Zašto Pristup A (a ne zasebna tabela)

`audit_log` već bilježi svaki INSERT/UPDATE/DELETE na 7 tabela preko `tg_audit()`
trigera, i već ima admin-only SELECT RLS. Proširenje te tabele daje **jedan** tok
"šta se desilo" (tačno ono što admin ekran treba), jedan view/RPC za čitanje i jedan
mehanizam čišćenja. Zasebna tabela (Pristup B) bi dala čistiji model po cijenu `UNION`
paginacije i duple RLS/cleanup logike — estetska korist bez praktične vrijednosti za
ovaj slučaj. Na skali (~500 korisnika ≈ ~9M redova / 90 dana) razlika je zanemarljiva
jer oba pristupa čuvaju istu količinu; što stvarno drži skalu je batch upis + retencija
+ (kasnije) particionisanje — a to se u A radi jednako dobro.

## Model podataka (migracija)

Nova migracija u `supabase/migrations/` (aditivna):

```sql
-- 1) Nova kolona za UI kontekst (labela ekrana, parametri filtera, ruta)
alter table audit_log add column if not exists detalji jsonb;

-- 2) Novi indeksi za filtriranje na admin ekranu
create index if not exists idx_audit_korisnik on audit_log (korisnik_id);
create index if not exists idx_audit_akcija   on audit_log (akcija);
-- postoje već: idx_audit_vrijeme (vrijeme desc), idx_audit_entitet (entitet, entitet_id)
```

- `akcija` (već `text`, bez constrainta) proširuje se značenjem — pored
  `INSERT`/`UPDATE`/`DELETE` uvode se UI glagoli: `NAVIGATE`, `VIEW`, `LOGIN`,
  `LOGOUT`, `FILTER`. Tip kolone se ne mijenja.
- Za UI redove: `staro`/`novo` = null, kontekst ide u `detalji`.
- **Particionisanje po `vrijeme` se svjesno odlaže** (YAGNI). Dokumentovano kao
  drop-in upgrade kad volumen naraste; provizije koje radimo odmah su batch upis
  (dio 3) i retencija (dio 6).

## Upis UI događaja (RPC, bez admin klijenta u request putanji)

`security definer` RPC koji prima **grupu** događaja i upisuje ih kao trenutni korisnik:

```sql
create or replace function zabiljezi_dogadjaje(p_dogadjaji jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into audit_log (korisnik_id, akcija, entitet, entitet_id, detalji)
  select auth.uid(),
         e->>'akcija',
         e->>'entitet',
         e->>'entitet_id',
         e->'detalji'
  from jsonb_array_elements(coalesce(p_dogadjaji, '[]'::jsonb)) as e
  where e->>'akcija' is not null;
end; $$;

grant execute on function zabiljezi_dogadjaje(jsonb) to authenticated;
```

- Korisnik uvijek loguje kao svoj `auth.uid()` — ne može lažirati tuđi identitet.
- Ne diramo admin/service-role klijent u request putanji (poštuje CLAUDE.md).
- Ne otvaramo široku INSERT politiku na `audit_log` — upis ide isključivo kroz RPC.

API ruta `POST /api/aktivnost`:
- Prima batch niz događaja, zod validacija (dozvoljene `akcija` vrijednosti +
  ograničena veličina batcha, npr. ≤ 50).
- Poziva `zabiljezi_dogadjaje` preko **SSR** supabase klijenta (RLS/auth kontekst).
- Odgovara brzo (fire-and-forget sa klijenta); greške ne ruše UI.

## Klijentsko hvatanje — `<AktivnostTracker>`

Klijentska komponenta montirana u `app/(dashboard)/layout.tsx`:

- Koristi `usePathname()` + `useSearchParams()`.
- **Navigacija/pregled:** na promjenu rute mapira rutu → labela ekrana. Ako ruta
  sadrži id zapisa (`/klijenti/[id]`, `/zapisnici/[id]`, ...) → `VIEW` sa
  `entitet` + `entitet_id`; inače `NAVIGATE` sa labelom ekrana u `detalji`.
- **Baferovanje (provizija za skalu):** događaji se skupljaju u ref-u i šalju u
  grupama (~svakih 5s) i na `pagehide`/`visibilitychange` preko
  `navigator.sendBeacon('/api/aktivnost', ...)`. Fire-and-forget, ne blokira UI.
- **Dedup:** uzastopna ista ruta se ne loguje dvaput (gasi dupli-fire iz efekata /
  React strict-mode).
- **Filteri:** per-ekran allowlist ključeva iz `searchParams` → `FILTER` sa
  `detalji: {parametri}`, debounce (samo "smiren" izbor, ne svaki keystroke).

Čista logika (mapiranje rute→labela, ekstrakcija `entitet`/`entitet_id`, dedup i
batch-bafer stanje) izdvaja se u `lib/aktivnost/*.ts` radi unit testiranja.

## Prijava / odjava

- `app/prijava/actions.ts` → `prijaviSe`: nakon uspješnog `signInWithPassword`,
  prije redirecta, poziv RPC-a sa `akcija = 'LOGIN'` (session je već postavljen,
  `auth.uid()` dostupan).
- `app/(dashboard)/odjava/actions.ts` → `odjaviSe`: prije `signOut`, poziv RPC-a
  sa `akcija = 'LOGOUT'`.

## Čitanje + admin ekran

- View `aktivnost_view` (`security_invoker=on` — obavezno da poštuje RLS):
  `audit_log` + join na `korisnici` → `korisnik_ime`, `korisnik_email`, uz sve
  kolone loga u ujednačenom obliku.
- RPC `get_aktivnost(p_od, p_do, p_korisnik, p_akcija, p_entitet, p_pretraga,
  p_limit, p_offset)` — paginirano + filtrirano u jednom round-tripu; vraća redove
  (+ ukupan broj za paginaciju).
- Ekran `app/(dashboard)/aktivnost/page.tsx` (admin-only; ako nije admin → redirect
  ili prazan pristup, uz RLS koji ionako vraća 0 redova):
  - Tabela: **Vrijeme · Korisnik · Akcija (badge) · Cilj · Detalji**.
  - `UPDATE` → prikaz **staro→novo diff** (samo izmijenjena polja).
  - `NAVIGATE`/`VIEW`/`FILTER`/`LOGIN`/`LOGOUT` → čitljiv opis iz `detalji`.
  - Filter-traka: korisnik (dropdown), tip akcije, datumski raspon, tekst pretraga.
  - Paginacija.

## Retencija (90 dana)

- SQL funkcija `obrisi_stare_dogadjaje()`:
  `delete from audit_log where vrijeme < now() - interval '90 days';`
  (`security definer`).
- Cron ruta `app/api/cron/ciscenje-audita/route.ts` — Bearer `CRON_SECRET`, u
  `PUBLIC` allowlisti u `proxy.ts` (kao postojeći `/api/cron`). Poziva funkciju
  preko admin klijenta (dozvoljeno u cron handleru).
- **Napomena:** `vercel.json` još nema `crons` niz — zakačinjanje rasporeda je
  zaseban korak (isto stanje kao postojeći reminders cron). Ruta radi i kad se
  pozove ručno.

## RLS

- `audit_log` SELECT je već admin-only (`audit_sel` politika). Ekran nasljeđuje.
- `aktivnost_view` mora imati `security_invoker=on` da ne zaobiđe RLS.
- INSERT ide isključivo kroz `security definer` RPC — bez nove insert politike.

## i18n & branding

- Novi ključevi: labela sidebara (`shell.nav.aktivnost`), nazivi akcija
  (NAVIGATE/VIEW/LOGIN/LOGOUT/FILTER/INSERT/UPDATE/DELETE), tekst ekrana i filtera.
- Dodati u `messages/sr.json`, `en.json`, `de.json` na paritetu u istoj izmjeni.
- Bez ICU `one` plural kategorije za `sr`.
- Bez hard-kodiranih naziva firme — koristiti postojeće brand tokene gdje treba.

## Testovi

- **Unit (Vitest, `lib/aktivnost/*.test.ts`):** mapiranje rute→labela, ekstrakcija
  `entitet`/`entitet_id`, dedup uzastopnih ruta, batch-bafer (flush/spajanje).
- **E2E (Playwright):** admin vidi stavku "Aktivnost" i redove u tabeli; `operater`
  i `pregled` je ne vide / nemaju pristup. Radi protiv cloud DEMO baze.

## Van obima (YAGNI)

- Native particionisanje `audit_log` (odloženo dok volumen ne opravda).
- Logovanje filtera koji su čisto klijentsko stanje (ne u URL-u) — hvatamo samo one
  koji su u `searchParams`; ograničenje se dokumentuje.
- Realtime/streaming feed — ekran je paginirano čitanje, bez live push-a.
- Izvoz logova (CSV/PDF) — nije traženo.
