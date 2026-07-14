# Dnevnik mejlova + status dostave + bedž na greške (email observability)

**Datum:** 2026-07-13
**Status:** Odobren dizajn — spreman za implementaciju (sve otvorene stavke razriješene, vidi §10)
**Grana (prijedlog):** `feat/mejl-log-nadzor`
**Migracija:** `supabase/migrations/20260713120000_mejl_log.sql`

---

## 1. Cilj / Motivacija

Trenutno slanje mejlova (`lib/email/resend.ts` → `sendEmail`) ima tri praznine u vidljivosti:

1. **Greške slanja su nevidljive.** `sendEmail` na Resend grešci baca (`resend.ts:35 → if (error) throw`). U `runReminders` taj throw se hvata i pretvara u `ErrItem` koji završi samo u HTTP odgovoru cron rute (`app/api/cron/reminders/route.ts:57 NextResponse.json(result)`) — a Vercel cron pozivač ignoriše tijelo odgovora. Greška time nestaje: niko je ne vidi, nema traga u bazi.
2. **Nema jedinstvenog dnevnika.** `podsjetnici` bilježi samo uspješne podsjetnike (i to kao dedup-ledger, ne kao log); `zakazano_nakon_roka` bilježi claim u `termin_zakazano_obavijest`; testni mejl (`postavke/actions.ts:268`) ne bilježi ništa. Ne postoji jedno mjesto koje odgovara na pitanje „koji su mejlovi otišli, kome, kada, sa kojim ishodom".
3. **Status dostave živi samo u Resend dashboardu.** Da li je mejl stvarno isporučen, odbijen (bounce), otvoren ili prijavljen kao spam (complaint) — vidljivo je isključivo ulogovanjem u Resend, van aplikacije.

**Rješenje (prioritet po odobrenju):**

- **(1) VIDLJIVOST** — nova tabela `mejl_log` kao jedinstveni read-model svakog mejla koji prođe kroz `sendEmail`; ekran „Poslati mejlovi" (svaki ulogovani, RLS-skopiran).
- **(2) UPOZORENJE NA GREŠKU** — crveni bedž u navigaciji sa brojem neriješenih problema dostave (bez mejla adminu — **samo bedž**).
- **(3) STATUS DOSTAVE** — stvarni status (delivered/bounced/opened/complained) preko **Resend webhooka** u realnom vremenu.

> **Odluka o obimu (revizija):** sve tri stavke ostaju u v1. Jedan recenzent je predložio fazno odvajanje webhooka u v2; **odbijeno** — (a) `delivery_status` precedenca i provjera webhook potpisa su eksplicitni zahtjevi ovog dizajna, (b) druga dva recenzenta odobravaju trostruki obim, (c) webhook podsistem je zatvoren iza jedne migracije + jedne rute i ne povećava površinu grešaka feature-a 1+2 (koji funkcionišu i bez ijednog webhook događaja — `delivery_status` naprosto ostaje `nepoznato`). Faznost bi značila drugu migraciju za `delivery_status` kasnije; forward-only shema je jeftinija odmah.

---

## 2. Opseg

**U opsegu (v1):**

- Nova tabela `mejl_log` + enumi + RLS (SELECT tri-nivo) + `security_invoker` view + čitni/pomoćni RPC-ovi + **SECURITY DEFINER upisni RPC** (jedna migracija, DEMO/PROD lockstep).
- Tanki wrapper `posaljiIzabiljezi` oko `sendEmail`, ubačen na 4 postojeća poziva slanja.
- Webhook `POST /api/webhooks/resend` sa provjerom potpisa i mapiranjem događaja na `delivery_status`.
- Ekran `app/(dashboard)/poslati-mejlovi/` (svi ulogovani, redovi RLS-skopirani), tabela + filteri + obojeni bedž dostave + crveni redovi grešaka.
- Nav bedž (broj neriješenih grešaka, RLS-skopiran po korisniku) + „označi pregledanim".
- Env `RESEND_WEBHOOK_SECRET`, `proxy.ts` PUBLIC izuzeće, i18n sr/en/de.

**Van opsega (v1) — dokumentovano ograničenje:**

- **Reset-lozinke mejlovi NISU obuhvaćeni.** Idu kroz `supabase.auth.resetPasswordForEmail` (`app/zaboravljena-lozinka/actions.ts:18` i `app/(dashboard)/postavke/actions.ts:531`), tj. kroz Supabase Auth SMTP — **ne** kroz naš `sendEmail`/Resend. Nemaju `resend_id`, ne prolaze kroz wrapper i Resend webhook ih ne prati. Svjesno se ne loguju; hvatanje bi zahtijevalo poseban Supabase Auth hook (odvojen feature).
- Retencija/arhiviranje `mejl_log` (može se dodati kasnije po uzoru na `obrisi_stare_dogadjaje()` iz `20260711130000`).
- Backfill istorijskih poslatih podsjetnika (`podsjetnici`) u `mejl_log` — forward-only; vidi §10.

---

## 3. Model podataka

Sve u jednoj idempotentnoj migraciji `20260713120000_mejl_log.sql` (enumi DO-guarded, `create table if not exists`, `create index if not exists`, `create or replace function|view`, `drop policy if exists` → `create policy`, `enable row level security` idempotentno, `grant`/`revoke` eksplicitni). Nakon primjene (lokalno i cloud, vidi §7.3): `pnpm db:types`.

### 3.1 Enumi

Vrijednosti `delivery_status` namjerno preslikavaju Resend event-imena (integraciona terminologija — isti izuzetak kao `resend_id`), ostalo je domaći jezik.

```sql
-- tip mejla (strože od text; novi put = migracija)
do $$ begin
  create type mejl_tip as enum
    ('podsjetnik_interni','podsjetnik_firma','zakazano_nakon_roka','test');
exception when duplicate_object then null; end $$;

-- ishod slanja (u trenutku send-a)
do $$ begin
  create type mejl_status as enum ('poslato','greska_slanja');
exception when duplicate_object then null; end $$;

-- status dostave (iz Resend webhooka)
do $$ begin
  create type mejl_dostava_status as enum
    ('nepoznato','delivered','opened','delivery_failed','bounced','complained');
exception when duplicate_object then null; end $$;
```

> **Odluka o `opened` (revizija):** vrijednost `opened` ostaje u enumu/rangu/UI-ju. Jedan recenzent je predložio da se izbaci kao YAGNI; **kompromis** — kôd je podržava (dodavanje enum vrijednosti kasnije je nova migracija; uklanjanje sada je nepotrebna izmjena), ali je **pretplata na `email.opened` opciona i podrazumijevano isključena** (§7.2, §10 #2). `opened` nikad ne ulazi u bedž grešaka, pa je bez rizika za signal.

### 3.2 Tabela `mejl_log`

```sql
create table if not exists mejl_log (
  id              uuid                primary key default gen_random_uuid(),
  created_at      timestamptz         not null    default now(),
  tip             mejl_tip            not null,
  primaoci        text[]              not null    default '{}',   -- [...to, ...bcc]
  subject         text                not null,
  termin_id       uuid                references termini(id)  on delete set null,
  klijent_id      uuid                references klijenti(id) on delete set null,
  resend_id       text,                                           -- data.id; 'unknown' moguće; NIJE unique
  status          mejl_status         not null,
  greska          text,                                           -- popunjeno kad status='greska_slanja'
  delivery_status mejl_dostava_status not null    default 'nepoznato',
  delivery_at     timestamptz,                                    -- vrijeme događaja koji je odredio delivery_status
  pregledano_at   timestamptz,                                    -- pregled greške → čisti bedž
  pregledano_od   uuid                references korisnici(id) on delete set null
);
```

Napomene:
- `klijent_id` je **nullable po dizajnu** — testni (`tip='test'`) i svaki mejl bez firme nemaju klijenta. `on delete set null` čuva istoriju (brisanje firme ne kaskadira log; red samo „padne" u tier-c = admin-only).
- `pregledano_od` je **dodatak na zaključanu shemu**, opravdan sa dvije strane: (a) `mejl_log_view` traži join na `korisnici` za ime — `korisnici.ime` je jedina realna veza; (b) revizija ko je označio grešku pregledanom.
- **Ne kačiti `tg_audit()` trigger** na `mejl_log` — to je log, ne poslovna tabela; upis ide preko definer RPC-a/service-role (revizija bi ionako izgubila aktera).

### 3.3 Indeksi

```sql
-- lista/paginacija (ORDER BY created_at desc)
create index if not exists idx_mejl_log_created  on mejl_log (created_at desc);
-- tier-b RLS + filter po firmi
create index if not exists idx_mejl_log_klijent  on mejl_log (klijent_id);
-- webhook lookup po resend_id
create index if not exists idx_mejl_log_resend   on mejl_log (resend_id);
-- BEDŽ/GREŠKE: parcijalni indeks tačno po predikatu bedža
create index if not exists idx_mejl_log_nepregledano on mejl_log (created_at desc)
  where pregledano_at is null
    and (status = 'greska_slanja'
         or delivery_status in ('bounced','complained','delivery_failed'));
```

### 3.4 RLS — tri nivoa vidljivosti (SELECT) + GRANT

Koristi **stvarne** helpere iz `20260626210000_auth_korisnici.sql` (verifikovano):
- `je_admin()` — `SECURITY DEFINER`, `korisnici.uloga='admin' AND aktivan` (linija 39-43).
- `ima_pristup_klijentu(p_klijent_id uuid)` — `SECURITY DEFINER`, `je_admin() OR EXISTS` u `korisnik_klijent` join `korisnici` uz `aktivan` (linija 51-59).
- Tabela dodjele: `korisnik_klijent (korisnik_id, klijent_id)` (linija 17-21).

**Ne izmišljati nove EXISTS niti čitati `korisnici.uloga` inline.**

```sql
alter table mejl_log enable row level security;

-- Supabase default-privilegije za nove public tabele daju SELECT authenticated roli,
-- ali GRANT navodimo eksplicitno da migracija bude samodovoljna (view/RPC su security_invoker).
grant select on mejl_log to authenticated;

drop policy if exists mejl_log_sel on mejl_log;
create policy mejl_log_sel on mejl_log for select using (
  je_admin()
  or ( klijent_id is not null and ima_pristup_klijentu(klijent_id) )
);
```

Semantika (trostruki nivo — verifikovan kao ispravan od sva tri recenzenta):
- **(a) admin** → `je_admin()` = true → vidi **sve** redove (uključujući `klijent_id IS NULL`).
- **(b) običan korisnik** → `ima_pristup_klijentu(klijent_id)` vidi **samo redove firmi dodijeljenih preko `korisnik_klijent`**; redovi druge firme se vrednuju `false` (nema cross-tenant curenja primalaca/subjecta).
- **(c) redovi bez firme** (`klijent_id IS NULL`, npr. `test`) → **samo admin**. Za ne-admina drugi disjunkt je `false` (jer `klijent_id is not null` = false), a `je_admin()` = false → red skriven.

> **`je_admin()` se NE smije izostaviti kao „redundantan".** Iako `ima_pristup_klijentu()` interno već vraća `true` za admina, `je_admin()` je jedini nosilac vidljivosti `klijent_id IS NULL` redova adminu (tier-c). Bez njega bi `(klijent_id IS NOT NULL AND …)` sakrio NULL redove i od admina.

### 3.5 Upis (INSERT) — service-role only + validirani SECURITY DEFINER RPC

> **Odluka (revizija).** Draft je imao široku `authenticated` INSERT politiku. **Zamijenjeno.** Zahtjev je „service-role insert only", a kod-baza pravilo (`CLAUDE.md`) **zabranjuje service-role klijent u `app/` request putanji** — pa dva SSR poziva (zakazano, test) ne smiju sami koristiti admin klijent. Rješenje koje zadovoljava oba: **nema `authenticated` INSERT politike** (direktan authenticated INSERT je default-denied), a jedini upisni put je **`SECURITY DEFINER` RPC `zabiljezi_mejl_log`** koji radi kao vlasnik tabele i validira pristup. Ovo je tačno preporuka sigurnosne recenzije („route the two SSR-user inserts through a SECURITY DEFINER RPC … drop the broad INSERT policy").

```sql
-- Jedini upisni put. Bez INSERT politike na tabeli → direktan authenticated INSERT je odbijen.
create or replace function zabiljezi_mejl_log(
  p_tip        mejl_tip,
  p_primaoci   text[],
  p_subject    text,
  p_termin_id  uuid,
  p_klijent_id uuid,
  p_resend_id  text,
  p_status     mejl_status,
  p_greska     text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Dozvoljeni pozivaoci:
  --   • service_role (cron)         → auth.uid() IS NULL → trusted server-context upis
  --   • authenticated s pristupom   → je_admin() (uklj. klijent-less 'test') ILI ima_pristup_klijentu()
  -- anon je revoke-ovan (ispod) i proxy ionako blokira neautentifikovane app rute,
  -- pa auth.uid() IS NULL unutar ovog RPC-a pouzdano znači service_role.
  if auth.uid() is not null
     and not ( je_admin()
               or ( p_klijent_id is not null and ima_pristup_klijentu(p_klijent_id) ) )
  then
    return;  -- best-effort: nema prava → tiho preskoči (wrapper ne baca)
  end if;

  insert into mejl_log
    (tip, primaoci, subject, termin_id, klijent_id, resend_id, status, greska, delivery_status)
  values
    (p_tip, p_primaoci, p_subject, p_termin_id, p_klijent_id, p_resend_id, p_status, p_greska, 'nepoznato');
end; $$;

revoke execute on function zabiljezi_mejl_log(mejl_tip,text[],text,uuid,uuid,text,mejl_status,text)
  from public, anon;
grant  execute on function zabiljezi_mejl_log(mejl_tip,text[],text,uuid,uuid,text,mejl_status,text)
  to authenticated, service_role;
```

Semantika po pozivnom mjestu:
- **Cron (mesta 1&2)** — service-role klijent → `auth.uid()` NULL → upis bez provjere (kontekst povjerenja).
- **zakazano (mesto 3, SSR user)** — user klijent → `ima_pristup_klijentu(klijent_id)` = true (korisnik uvijek ima pristup firmi termina koji uređuje) → upis.
- **test (mesto 4, SSR admin)** — user klijent → `je_admin()` = true → upis `klijent_id=NULL`.

> **Rezidualni rizik (svjesno prihvaćen, znatno manji od široke politike):** ovlašteni authenticated korisnik može RPC pozvati direktno i ubaciti red **samo za firmu kojoj već ima pristup** (ne cross-tenant). Nema UPDATE/DELETE puta (default-denied). Falsifikovanje `resend_id` je bez praktičnog efekta: `resend_id` je Resend UUID kojeg webhook UPDATE (§3.6) uparuje samo kad Resend zaista emituje događaj za taj id — pogađanje realnog budućeg `email_id` je neizvodljivo. Ako se traži veća otpornost, RPC se može dodatno ograničiti da non-admin smije samo `p_tip='zakazano_nakon_roka'` (izvan v1 obima; vidi §10 #4).

> **RLS coverage guard:** postojeći `lib/rlsCoverage.integration.test.ts` traži RLS uključen + **bar jednu** politiku po tabeli. `mejl_log` ima RLS + `mejl_log_sel` (SELECT) → zadovoljeno. Sve mutacije idu kroz definer RPC-ove; INSERT/UPDATE/DELETE politike ne postoje (default-denied), što je namjera.

### 3.6 Rang dostave + atomsko ažuriranje (webhook) + re-alarm na eskalaciju

Monotona precedenca da kasniji/van-reda događaj ne degradira status (`opened` ne pregazi `bounced`):

```sql
create or replace function mejl_dostava_rang(s mejl_dostava_status)
returns int language sql immutable as $$
  select case s
    when 'nepoznato'       then 0
    when 'delivered'       then 1
    when 'opened'          then 2   -- opened ⟹ delivered, pa je „viši" pozitivan status
    when 'delivery_failed' then 3
    when 'bounced'         then 4
    when 'complained'      then 5   -- najgore, uvijek pobjeđuje
  end;
$$;

-- Guarded UPDATE: samo napreduj rang (nikad nazad) — atomsko, idempotentno, bez race-a.
-- Eskalacija na GORI error status ponovo diže bedž: ako novi status uđe u error-skup,
-- resetuj pregledano_at/pregledano_od (npr. bounced→complained nakon što je admin
-- već označio bounce pregledanim — spam prijava je najozbiljniji signal i mora ponovo alarmirati).
create or replace function azuriraj_mejl_dostavu(
  p_resend_id text,
  p_status    mejl_dostava_status,
  p_at        timestamptz
) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update mejl_log
     set delivery_status = p_status,
         delivery_at     = p_at,
         pregledano_at   = case when p_status in ('bounced','complained','delivery_failed')
                                then null else pregledano_at end,
         pregledano_od   = case when p_status in ('bounced','complained','delivery_failed')
                                then null else pregledano_od end
   where resend_id = p_resend_id
     and mejl_dostava_rang(p_status) > mejl_dostava_rang(delivery_status);
  get diagnostics v = row_count;
  return v;  -- 0 = nepoznat id ILI niži/isti rang (oba OK → 200)
end; $$;
revoke execute on function azuriraj_mejl_dostavu(text,mejl_dostava_status,timestamptz) from public, anon, authenticated;
grant  execute on function azuriraj_mejl_dostavu(text,mejl_dostava_status,timestamptz) to service_role;
```

> Reset `pregledano_at` se dešava **samo** unutar rang-rastuće tranzicije **u error status** (`bounced`/`complained`/`delivery_failed`). Pozitivne tranzicije (`delivered`→`opened`) ne diraju pregled. Prvi ulazak u error (npr. `nepoznato`→`bounced`) reset je no-op jer `pregledano_at` ionako bješe NULL.

### 3.7 „Označi pregledanim" (čisti bedž) — SECURITY DEFINER RPC

`pregledano_at` je **jedna zajednička kolona**. Umjesto UPDATE politike (koja bi dala korisniku da mijenja bilo koju kolonu vidljivih redova), pregled ide kroz RPC koji provjerava isti troslojni pristup i postavlja samo `pregledano_at`/`pregledano_od`:

```sql
create or replace function oznaci_mejl_pregledan(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_klijent uuid;
begin
  if auth.uid() is null then return; end if;
  select klijent_id into v_klijent from mejl_log where id = p_id;
  if not ( je_admin() or ( v_klijent is not null and ima_pristup_klijentu(v_klijent) ) ) then
    return;  -- nema prava → tiho, nema izmjene
  end if;
  update mejl_log
     set pregledano_at = now(), pregledano_od = auth.uid()
   where id = p_id and pregledano_at is null;  -- idempotentno
end; $$;
revoke execute on function oznaci_mejl_pregledan(uuid) from public, anon;
grant  execute on function oznaci_mejl_pregledan(uuid) to authenticated;
```

**Ko smije i posljedica dijeljene kolone:** svaki ovlašteni gledalac reda (admin, ili korisnik dodijeljen toj firmi) smije ga označiti. Pošto su bedževi RLS-skopirani, običan korisnik **fizički može očistiti samo redove svojih firmi**. Kad korisnik firme X označi grešku firme X pregledanom, `pregledano_at` se postavlja za **taj zajednički red** → nestaje iz bedža i korisnika i admina (za tu firmu). Admin i dalje nezavisno vidi greške **bez firme** (`klijent_id IS NULL`) i **drugih firmi**, koje samo on može čistiti. To je prihvaćena semantika „jedne kolone" (§10 #3).

### 3.8 Bedž — brojač (RLS-skopiran)

```sql
create or replace function get_mejl_greske_broj()
returns int language sql stable security invoker set search_path = public as $$
  select count(*)::int from mejl_log
  where pregledano_at is null
    and ( status = 'greska_slanja'
          or delivery_status in ('bounced','complained','delivery_failed') );
$$;
grant execute on function get_mejl_greske_broj() to authenticated;
```

`security invoker` → izvršava se sa RLS pozivaoca → brojač automatski broji **samo vidljive** redove (admin=sve incl. NULL; korisnik=svoje firme). Parcijalni indeks `idx_mejl_log_nepregledano` pokriva predikat. Zove se preko SSR anon+cookie klijenta (§6.6) — **nikad service-role** — pa brojevi ne cure.

### 3.9 Read-model view + čitni RPC (po uzoru na `aktivnost_view` / `get_aktivnost`)

```sql
create or replace view mejl_log_view
with (security_invoker = on) as   -- OBAVEZNO: nasljeđuje RLS bazne tabele; bez ovoga curi sve redove
select m.id, m.created_at, m.tip, m.primaoci, m.subject,
       m.termin_id, m.klijent_id, kl.naziv as klijent_naziv,
       m.resend_id, m.status, m.greska,
       m.delivery_status, m.delivery_at,
       m.pregledano_at, m.pregledano_od, ko.ime as pregledao_ime
from mejl_log m
left join klijenti  kl on kl.id = m.klijent_id
left join korisnici ko on ko.id = m.pregledano_od;

grant select on mejl_log_view to authenticated;

create or replace function get_poslati_mejlovi(
  p_tip               mejl_tip    default null,
  p_status            mejl_status default null,
  p_od                timestamptz default null,
  p_do                timestamptz default null,
  p_samo_greske       boolean     default false,
  p_samo_nepregledane boolean     default false,   -- uskladi listu sa bedžom (vidi §6.6)
  p_limit             int         default 50,
  p_offset            int         default 0
) returns table (
  id uuid, created_at timestamptz, tip mejl_tip, primaoci text[], subject text,
  termin_id uuid, klijent_id uuid, klijent_naziv text, resend_id text,
  status mejl_status, greska text, delivery_status mejl_dostava_status,
  delivery_at timestamptz, pregledano_at timestamptz, pregledao_ime text,
  ukupno bigint
) language sql stable security invoker set search_path = public as $$
  with f as (
    select * from mejl_log_view v
    where (p_tip    is null or v.tip = p_tip)
      and (p_status is null or v.status = p_status)
      and (p_od     is null or v.created_at >= p_od)
      and (p_do     is null or v.created_at <  p_do)
      and (not p_samo_greske
           or v.status = 'greska_slanja'
           or v.delivery_status in ('bounced','complained','delivery_failed'))
      and (not p_samo_nepregledane or v.pregledano_at is null)
  )
  select f.id, f.created_at, f.tip, f.primaoci, f.subject, f.termin_id, f.klijent_id,
         f.klijent_naziv, f.resend_id, f.status, f.greska, f.delivery_status,
         f.delivery_at, f.pregledano_at, f.pregledao_ime,
         count(*) over () as ukupno
  from f
  order by f.created_at desc
  limit greatest(p_limit,0) offset greatest(p_offset,0);
$$;
grant execute on function
  get_poslati_mejlovi(mejl_tip,mejl_status,timestamptz,timestamptz,boolean,boolean,int,int)
  to authenticated;
```

> `korisnici` može imati restriktivan RLS pa `pregledao_ime` bude `null` za ne-admina (LEFT JOIN ne ispušta red) — prihvatljivo (ime pregledaoca nije kritično).

---

## 4. Tačka upisa — wrapper `posaljiIzabiljezi`

**Datoteka:** `lib/email/posaljiIzabiljezi.ts`

### 4.1 Uloga i granice

`posaljiIzabiljezi` **NE zamjenjuje** postojeće dedup-mehanizme i **ne ujedinjuje** ih:
- `podsjetnici` insert (poslije slanja) u `runReminders` — **ostaje netaknut**.
- `zabiljezi_zakazano_obavijest` RPC (claim **prije** slanja, konkurentna sigurnost) u `zakazanoNakonRoka` — **ostaje netaknut**.

Wrapper samo **dodaje** best-effort upis u `mejl_log` (preko RPC-a `zabiljezi_mejl_log`) oko `sendEmail`. Za podsjetnike se time **namjerno duplo piše** (`mejl_log` + `podsjetnici`) — da se ne dira nosivi dedup. `mejl_log` je sirovi log slanja (jedan red po slanju); `podsjetnici` je dedup-ledger (jedan red po `termin+dana_prije+kanal`).

### 4.2 Potpis i ponašanje

Zamjenjuje **seam `send`** (ne cijeli poziv), čuvajući injektabilnost (`deps.send ?? sendEmail`) koju koriste testovi i cron dry-run. Wrapper prima **klijentov `supabase`** (i service-role i SSR user) i upisuje **isključivo preko `zabiljezi_mejl_log` RPC-a** — nikad direktan `.from(...).insert(...)`, nikad admin klijent u app putanji.

```ts
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"

type MejlTip = Database["public"]["Enums"]["mejl_tip"]

export async function posaljiIzabiljezi(
  supabase: SupabaseClient<Database>,
  args: SendArgs & { tip: MejlTip; terminId?: string | null; klijentId?: string | null },
  send: (a: SendArgs) => Promise<SendResult> = sendEmail,
): Promise<SendResult> {
  const { tip, terminId = null, klijentId = null, ...sendArgs } = args
  const primaoci = [...(sendArgs.to ?? []), ...(sendArgs.bcc ?? [])]
  try {
    const res = await send(sendArgs)
    if (!res.dryRun) {
      await zabiljeziMejlLog(supabase, {
        tip, terminId, klijentId, primaoci, subject: sendArgs.subject,
        resendId: res.id, status: "poslato", greska: null,
      })
    }
    return res                                   // uspjeh → vrati SendResult (nizvodni podsjetnici insert i dalje radi)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await zabiljeziMejlLog(supabase, {
      tip, terminId, klijentId, primaoci, subject: sendArgs.subject,
      resendId: null, status: "greska_slanja", greska: message,
    })
    throw e                                      // RE-THROW: čuva postojeće rukovanje greškom na svim pozivnim mjestima
  }
}
```

`zabiljeziMejlLog` je **best-effort — nikad ne baca** — i zove definer RPC:

```ts
async function zabiljeziMejlLog(
  supabase: SupabaseClient<Database>,
  row: {
    tip: MejlTip; terminId: string | null; klijentId: string | null
    primaoci: string[]; subject: string; resendId: string | null
    status: "poslato" | "greska_slanja"; greska: string | null
  },
): Promise<void> {
  try {
    const { error } = await supabase.rpc("zabiljezi_mejl_log", {
      p_tip: row.tip, p_termin_id: row.terminId, p_klijent_id: row.klijentId,
      p_primaoci: row.primaoci, p_subject: row.subject, p_resend_id: row.resendId,
      p_status: row.status, p_greska: row.greska,
    })
    if (error) console.error("[mejl_log] upis nije uspio:", error.message)
  } catch (e) {
    console.error("[mejl_log] upis bacio:", e instanceof Error ? e.message : String(e))
  }
}
```

**Best-effort semantika:** ako RPC padne ili tiho preskoči (nema prava na SSR putu, transijentna DB greška), slanje se **NE prekida** — samo `console.error`. Cron ostaje stabilan.

### 4.3 Odluka o dry-run — **NE upisivati dry-run redove** (eksplicitno)

Kad je `res.dryRun === true`, **preskoči** `mejl_log` upis. Obrazloženje:
- Konzistentno sa postojećim ponašanjem: `runReminders` već preskače `podsjetnici` insert na dry-run (`runReminders.ts:119`).
- `resend_id` dry-run reda je sentinel `'dry-run'` koji nikad neće upariti webhook → `delivery_status` bi zauvijek ostao `'nepoznato'` (šum).
- Dry-run se koristi u testovima i lokalno (bez `RESEND_API_KEY`) — ne želimo da zaprljaju log ni bedž grešaka.
- Ne treba `dry_run` kolona → jednostavnija shema.

**Asimetrija (bez rizika):** neuspjeh se uvijek loguje. `drySend` nikad ne baca; `sendEmail` baca samo na stvarnoj Resend grešci (dakle samo kad je pravi ključ postavljen → pravi pokušaj slanja, `resend.ts:22-35`). Zato throw ⟹ pravo slanje ⟹ uvijek upisujemo `greska_slanja`. Preskaču se **samo uspješni dry-run** redovi.

### 4.4 Pozivna mjesta (4)

| # | Datoteka:linija | Kontekst / klijent | Izmjena | `tip` | `klijentId` |
|---|---|---|---|---|---|
| 1 | `lib/reminders/runReminders.ts:117` (helper `posalji`, kanal `interni`, poziv na `:136`) | cron, service-role | `send(args)` → `posaljiIzabiljezi(supabase, {...args, tip, terminId:r.termin_id, klijentId:r.klijent_id}, send)` | `podsjetnik_interni` | `r.klijent_id` |
| 2 | isti `posalji`, kanal `firma` (poziv na `:144`) | cron, service-role | isti poziv (tip izveden iz `kanal`) | `podsjetnik_firma` | `r.klijent_id` |
| 3 | `lib/reminders/zakazanoNakonRoka.ts:51` | **SSR user** (`termini/actions.ts:82,168`) | `send({...})` → `posaljiIzabiljezi(supabase, {to, subject, html, tip:'zakazano_nakon_roka', terminId:args.terminId, klijentId:<klijent_id>}, send)` | `zakazano_nakon_roka` | vidi ↓ |
| 4 | `app/(dashboard)/postavke/actions.ts:268` | **SSR admin** (`zahtijevajAdmina`) | `sendEmail({...})` → `posaljiIzabiljezi(supabase, {...istiArgs, tip:'test'})` | `test` | `null` |

Za sva 4 mjesta wrapper prima **klijentov `supabase`** (cron: service-role admin; SSR: user) i **upisuje samo preko `zabiljezi_mejl_log` RPC-a** (nema admin klijenta u app putanji; RPC validira pristup, §3.5).

**Mjesta 1&2:** unutar `posalji`, `const res = await send(args)` (linija 117) postaje poziv wrappera; `send` (=`deps.send ?? sendEmail`) prosljeđuje se kao 3. argument → čuva test/dry-run seam. Wrapper re-throw-uje na grešci → postojeći `catch (e)` u `posalji` (`:128`) i dalje daje `{kind:"err"}`; na uspjehu vraća `res` → nizvodni `podsjetnici` insert (`:120`) i dedup (`duplicate→skip`) rade nepromijenjeno. (Rijedak konkurentni dupli send sada daje 2 `mejl_log` reda — **tačno** za observability; `podsjetnici` i dalje dedup-ira na 1.)

**Mjesto 3 — potrebna sitna izmjena čitanja (verifikovano):** `zakazanoNakonRoka.ts:31-32` čita `termini_view` sa `.select("klijent_naziv, vrsta_naziv, lokacija_naziv, rok_dospijeca")` — **bez `klijent_id`**. **Dodati `klijent_id`** u taj select da se popuni `mejl_log.klijent_id` (nužno za tier-b vidljivost korisniku i za RPC access-check). Claim-before-send (`:41 zabiljezi_zakazano_obavijest`) ostaje ispred slanja — **ne** guraj zakazano u „send-then-record" oblik (to bi regresiralo idempotenciju).

**Mjesto 4:** postojeći `try/catch` + `objasniEmailGresku` (`postavke/actions.ts:267-277`, verifikovano) ostaje — wrapper re-throw-uje isti `Error`, pa admin i dalje dobija prijateljsku poruku, a greška je usput zabilježena kao `tip='test'` red (vidljiv samo adminu, tier-c).

---

## 5. Resend webhook

**Datoteka:** `app/api/webhooks/resend/route.ts`

```ts
export const runtime = "nodejs"          // node:crypto / standardwebhooks; NE edge
export const dynamic = "force-dynamic"
```

### 5.1 Provjera potpisa — ugrađeni Resend verifikator, **BEZ svix/standardwebhooks importa**

> **Odluka (revizija) — verifikovano protiv instaliranog SDK-a.** Dva recenzenta su prijavila „BLOKER: `verify()` traži WHATWG `Headers`". To je **pogrešno pročitan tip.** `resend@6.14.0` definiše **sopstveni** lokalni interfejs pod imenom `Headers` (`node_modules/resend/dist/index.d.mts:2239-2243` = `{ id: string; timestamp: string; signature: string }`), a `VerifyWebhookOptions.headers` je **taj** interfejs (`:2244-2248`), NE WHATWG `Headers`. Runtime to potvrđuje (`index.cjs:1120-1124`):
> ```js
> verify(payload) {
>   return new standardwebhooks.Webhook(payload.webhookSecret).verify(payload.payload, {
>     "webhook-id": payload.headers.id,
>     "webhook-timestamp": payload.headers.timestamp,
>     "webhook-signature": payload.headers.signature });
> }
> ```
> Dakle SDK prima **običan objekat** `{ id, timestamp, signature }` i **interno remapira** na `webhook-id/-timestamp/-signature` za `standardwebhooks`. Prosljeđivanje `req.headers` (WHATWG) bi bila stvarna tipska/runtime greška. **Zadržavamo pristup iz drafta** (objekat `{ id, timestamp, signature }`), uz robusno čitanje oba imena zaglavlja. Takođe: `verify()` **ne koristi API ključ** (`index.cjs:1121` čita samo `payload.webhookSecret`), a konstruktor u 6.14.0 ne baca na prazan ključ (`constructor(key?: string | undefined)`, `index.d.mts:2288`) — ali koristimo neprazan placeholder radi otpornosti na buduće verzije.

```ts
import { Resend } from "resend"
import { env } from "@/lib/env"
import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { mapirajDostavu } from "@/lib/email/webhookDostava"

export async function POST(req: Request) {
  // fail-closed: bez tajne → 401 (kao isCronAuthorized kad je secret undefined)
  if (!env.RESEND_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const rawBody = await req.text()   // SIROVO tijelo prije ikakvog JSON.parse (HMAC ulaz)

  // Resend trenutno šalje svix-* zaglavlja; čitamo i webhook-* alias radi otpornosti.
  const id        = req.headers.get("svix-id")        ?? req.headers.get("webhook-id")
  const timestamp = req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp")
  const signature = req.headers.get("svix-signature") ?? req.headers.get("webhook-signature")
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: "Missing headers" }, { status: 401 })
  }

  let event
  try {
    // API ključ irelevantan za verify(); placeholder garantuje da konstruktor nikad ne baca.
    event = new Resend(env.RESEND_API_KEY ?? "re_placeholder").webhooks.verify({
      payload: rawBody,
      headers: { id, timestamp, signature },     // Resend lokalni `Headers` interfejs (NE WHATWG)
      webhookSecret: env.RESEND_WEBHOOK_SECRET,   // cijeli 'whsec_…' string; lib skida prefiks
    })
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const status = mapirajDostavu(event.type)   // pura funkcija, vidi §5.3
  if (status) {
    const supabase = createAdminSupabaseClient()   // service-role: bypass RLS; ruta NIJE app request-path
    await supabase.rpc("azuriraj_mejl_dostavu", {
      p_resend_id: event.data.email_id,
      p_status: status,
      p_at: event.data.created_at ?? event.created_at ?? new Date().toISOString(),
    })
  }
  return NextResponse.json({ ok: true })   // uvijek 200 za validan potpis (uklj. nepoznat id / niži rang)
}
```

- Potpis (u `standardwebhooks`): HMAC-SHA256 nad `${id}.${timestamp}.${rawBody}`, base64, `v1,`-prefiks, `timingSafeEqual`, sa tolerancijom vremena (stari/budući timestamp → odbijen). Tajna je `whsec_<base64>`; lib skida `whsec_` prefiks i base64-dekodira ostatak kao HMAC ključ.
- **Uparivanje:** `event.data.email_id` === `mejl_log.resend_id` (isti id koji `resend.emails.send()` vrati, `resend.ts:36`).
- Webhook ruta smije koristiti `createAdminSupabaseClient()` — ona je route handler (cron-analogno), **nije** `app/`/`components/` korisnička request putanja; autentikacija je provjera potpisa, ne cookie.

### 5.2 Čista, unit-testabilna mapa

**Datoteka:** `lib/email/webhookDostava.ts` — izdvojena `mapirajDostavu(type: string): MejlDostavaStatus | undefined` da se testira bez HTTP-a.

### 5.3 Mapiranje događaj → `delivery_status`

| Resend event | `delivery_status` | rang | broji u bedž? |
|---|---|---|---|
| `email.delivered` | `delivered` | 1 | ne |
| `email.opened` | `opened` | 2 | ne |
| `email.delivery_delayed` | *(bez promjene → `undefined`)* | — | ne |
| `email.failed` | `delivery_failed` | 3 | **da** |
| `email.bounced` | `bounced` | 4 | **da** |
| `email.complained` | `complained` | 5 | **da** |
| ostali (`sent`, `scheduled`, `clicked`, `contact.*`, `domain.*`) | *(ignoriši → `undefined`)* | — | — |

`email.sent` se ignoriše (status `poslato` postavljamo već u trenutku slanja). `email.delivery_delayed` je tranzijentan i **nema enum vrijednost** → `mapirajDostavu` vraća `undefined` → bez izmjene statusa, `200` ack (Resend će naknadno poslati `delivered`/`bounced`). Vidi §10 #1.

### 5.4 Idempotencija, redoslijed, precedenca, statusni kodovi

- **Idempotencija:** `azuriraj_mejl_dostavu` koristi strogo `>` po rangu → isti/ponovljeni događaj = 0 redova = no-op.
- **Precedenca (definisano):** rang osigurava da `opened`(2) ne pregazi `bounced`(4); `delivered`(1) ne pregazi ranije stigli `opened`(2). Negativni statusi (`delivery_failed`<`bounced`<`complained`) su „ljepljivi" i uvijek pobjeđuju pozitivne.
- **Eskalacija nakon pregleda:** rang-rastuća tranzicija u error status resetuje `pregledano_at` (§3.6) → gori signal se ponovo pojavi u bedžu.
- **Nepoznat `resend_id`** (sentinel `'dry-run'`/`'unknown'`, mejlovi prije feature-a): UPDATE upari 0 redova → **200** (Resend ne retry-uje na 2xx).
- **Statusni kodovi:** `200` za sve validne potpise (uspjeh, nepoznat id, niži rang); `401` **samo** za loš/nedostajući potpis, nedostajuće headere, nedostajuću tajnu. Nikad 5xx za poslovnu „ne-uparenost" (izbjegava beskonačan retry).

### 5.5 Auth izuzeće (OBAVEZNO)

> `proxy.ts` matcher (`:104`) hvata `/api/webhooks/resend`, a ruta **nije** u `PUBLIC` (`:15`) → neautentifikovan Resend POST dobija `redirect → /prijava` i handler se nikad ne izvrši. Dodati rutu u `PUBLIC` **u istoj izmjeni**.

**Odluka (revizija):** koristi **tačnu putanju** `"/api/webhooks/resend"` (ne širi prefiks `"/api/webhooks"`) — matcher (`proxy.ts:60-61`) provjerava `pathname === p || pathname.startsWith(p + "/")`, pa `===` grana tačno hvata rutu bez otvaranja cijelog `/api/webhooks/*` namespace-a. Bez `href()` (`/api/*` se ne prevodi; kao postojeći `"/api/cron"`).

```ts
// proxy.ts:15
const PUBLIC = [href("/prijava"), href("/zaboravljena-lozinka"), "/auth", "/api/cron", "/api/webhooks/resend"]
```

Stvarna autentikacija rute je provjera potpisa (fail-closed 401), ne cookie.

---

## 6. UI — ekran „Poslati mejlovi" + nav bedž

### 6.1 Lokacija i gating

- **Ruta:** `app/(dashboard)/poslati-mejlovi/page.tsx` (async server komponenta).
- **Gating = SVAKI ulogovani korisnik. NIJE admin-only ekran.** Redovi su RLS-skopirani (admin=sve, korisnik=svoje firme). **NE** dodavati `if (uloga !== "admin") notFound()` (to je obrazac `aktivnost/page.tsx:17`, ne ovaj). Uzor je `klijenti/page.tsx:24` — SSR anon klijent, RLS radi posao; `proxy.ts` već blokira neautentifikovane.
- **Skeleton:** `app/(dashboard)/poslati-mejlovi/loading.tsx` (default export, `@/components/ui/skeleton`).
- **Query modul:** `lib/queries/poslati-mejlovi.ts` — `createServerSupabaseClient()` → `supabase.rpc("get_poslati_mejlovi", {...})` → `{ redovi, ukupno }` (uzor `lib/queries/aktivnost.ts` + RPC `get_aktivnost`).
- **Tabela:** `components/domain/PoslatiMejloviTabela.tsx` (server komponenta, `getTranslations` iz `next-intl/server` → bez potrebe za `CLIENT_NAMESPACES`).

### 6.2 Kolone + eksplicitna enum→i18n mapa

Kontejner `overflow-x-auto rounded-lg border border-border`; `table w-full text-sm`; `thead bg-muted/50 text-left`; `th/td px-3 py-2`; `tr border-t border-border` (tokeni iz `AktivnostTabela.tsx`).

| Kolona | Izvor | Napomena |
|---|---|---|
| Vrijeme | `created_at` | format kao aktivnost |
| Tip | `tip` | prevedena labela (`poslatiMejlovi.tip.*`) |
| Primaoci | `primaoci[]` | join `, ` (ista izloženost kao postojeći podsjetnici ekran) |
| Naslov | `subject` | |
| Slanje | `status` | `poslato` / `greška slanja` |
| Dostava | `delivery_status` | **obojeni bedž** (vidi 6.3) |
| Greška | `greska` | prikaži samo kad postoji |
| Klijent/Firma | `klijent_naziv` | prazno za `klijent_id IS NULL` (test) |

> **Odluka (revizija) — enum→ključ mapa.** DB enumi su `snake_case`, i18n ključevi `camelCase`. Prevod ide preko **eksplicitnih mapa** (tsc provjerava potpunost preko `satisfies Record<Enum,string>`), ne ad-hoc transformacije:
> ```ts
> const TIP_KEY = { podsjetnik_interni:"podsjetnikInterni", podsjetnik_firma:"podsjetnikFirma",
>   zakazano_nakon_roka:"zakazanoNakonRoka", test:"test" } as const satisfies Record<MejlTip,string>
> const STATUS_KEY = { poslato:"poslato", greska_slanja:"greskaSlanja" }
>   as const satisfies Record<MejlStatus,string>
> const DOSTAVA_KEY = { nepoznato:"nepoznato", delivered:"delivered", opened:"opened",
>   delivery_failed:"deliveryFailed", bounced:"bounced", complained:"complained" }
>   as const satisfies Record<MejlDostavaStatus,string>
> ```
> Tipovi: `Database["public"]["Enums"]["mejl_tip" | "mejl_status" | "mejl_dostava_status"]`. Labela = `t(\`poslatiMejlovi.tip.${TIP_KEY[red.tip]}\`)` itd. Dodavanje enum vrijednosti bez ključa = tvrda tsc greška.

**Crveni redovi grešaka:** kad `status='greska_slanja'` **ili** `delivery_status IN ('bounced','complained','delivery_failed')` → red dobija crvenu naznaku (npr. `bg-destructive/5` + `text-destructive` na Dostava ćeliji).

### 6.3 Obojeni bedž dostave

`delivered` → zelena; `opened` → plava; `bounced`/`complained`/`delivery_failed` → crvena; `nepoznato` → siva. Koristiti `components/ui/badge.tsx` varijante (mapiranje boja u tabeli komponente).

### 6.4 Filteri

`tip`, `status`, `datum` (od/do), prekidač **„samo greške"** i prekidač **„samo neriješene"** (`pregledano_at IS NULL`). Realizovati kao **server-rendered `<form method="get">`** (bez client JS) → `searchParams` (Promise, `await`-ovan u Next 16) → prosleđeni u `get_poslati_mejlovi` (`p_samo_greske`, `p_samo_nepregledane`). Time cijeli ekran ostaje server-komponenta i **izbjegava se `CLIENT_NAMESPACES`** izmjena. Paginacija: `components/domain/Pagination.tsx` (kao `klijenti`), `p_limit`/`p_offset`.

> Ako se ijedan filter/„označi pregledanim" naprave kao client komponente sa `useTranslations("poslatiMejlovi")` → tada dodati `"poslatiMejlovi"` u `i18n/client-namespaces.ts`. Preporuka: server-forme + Server Action za pregled → nije potrebno.

### 6.5 „Označi pregledanim"

Dugme po redu greške → Server Action koji zove `supabase.rpc("oznaci_mejl_pregledan", { p_id })` → `revalidatePath("/poslati-mejlovi")` i `revalidatePath` layout-a (za bedž). RPC (§3.7) sam provjerava pravo pristupa.

### 6.6 Nav bedž

- **Registracija stavke:** `components/shell/Sidebar.tsx` `NAV_ITEMS` → `{ href: href("/poslati-mejlovi"), labelKey: "poslatiMejlovi", icon: Mail }` (`Mail` iz `lucide-react`). Vidljivo svim ulogama (kao `klijenti`); RLS skopira sadržaj.
- **Tok podataka (bedž je net-new na navu):** `Sidebar.tsx` je `"use client"` i danas prima 0 props. Dohvatiti brojač u **server layoutu** `app/(dashboard)/layout.tsx` uz postojeći `getTrenutniKorisnik()`, **SSR anon klijentom** (`createServerSupabaseClient()`, RLS se primjenjuje — **nikad service-role**), i proslijediti kao **novi prop**: `<Sidebar mejlGreske={broj} />`.

```ts
// layout.tsx (uz const korisnik = await getTrenutniKorisnik())
const supabase = await createServerSupabaseClient()
const { data: mejlGreske } = await supabase.rpc("get_mejl_greske_broj")
// …
<Sidebar mejlGreske={mejlGreske ?? 0} />
```

- **Brojač** = `get_mejl_greske_broj()` (§3.8): `pregledano_at IS NULL AND (status='greska_slanja' OR delivery_status IN ('bounced','complained','delivery_failed'))`. `security invoker` → RLS skopira brojač po ulozi.
- **Usklađivanje bedža i liste (revizija):** klik na bedž vodi na `/poslati-mejlovi?samo_greske=1&nepregledano=1`, što mapira na `p_samo_greske=true, p_samo_nepregledane=true` → **lista prikazuje tačno one neriješene greške koje bedž broji** (isti predikat). Tako broj na bedžu i broj redova na ekranu odgovaraju, i odmah nakon „označi pregledanim" red nestaje iz oba.
- **Prikaz:** crveni pill sa brojem uz stavku „Poslati mejlovi" kad `mejlGreske > 0` (novi element u `renderItem`, `Sidebar.tsx:132-160`).
- **Čišćenje:** pregled reda (§6.5) postavlja `pregledano_at` → sljedeći render layouta ponovo računa bedž (`revalidatePath`). Korisnik čisti isključivo redove svojih firmi; admin i dalje vidi greške bez firme / drugih firmi (§3.7).

### 6.7 i18n (sr/en/de, isti PR, paritet ključeva)

Datoteke: `messages/sr.json`, `messages/en.json`, `messages/de.json`. Bez ICU `one` kategorije za `sr`. Nedostajući/nepariteni ključ = tvrda `tsc` greška.

- `shell.nav.poslatiMejlovi` (npr. sr „Poslati mejlovi", en „Sent emails", de „Gesendete Mails").
- Nova top-level sekcija (ključevi su `camelCase` i moraju pokriti sve enum vrijednosti iz §6.2 mapa):
```jsonc
"poslatiMejlovi": {
  "naslov": "…", "opis": "…", "prazno": "…",
  "kolone": { "vrijeme":"…","tip":"…","primaoci":"…","naslov":"…",
              "slanje":"…","dostava":"…","greska":"…","klijent":"…" },
  "tip":     { "podsjetnikInterni":"…","podsjetnikFirma":"…","zakazanoNakonRoka":"…","test":"…" },
  "status":  { "poslato":"…","greskaSlanja":"…" },
  "dostava": { "nepoznato":"…","delivered":"…","opened":"…","deliveryFailed":"…",
               "bounced":"…","complained":"…" },
  "filteri": { "tip":"…","status":"…","od":"…","do":"…","samoGreske":"…","samoNerijesene":"…","svi":"…" },
  "oznaciPregledanim": "…", "bedzGreske": "…"
}
```
- **Route localization:** `i18n/routes.ts` `ROUTE_MAP` → `"poslati-mejlovi": { en: "sent-emails", de: "gesendete-mails" }`.

---

## 7. Env & deploy

### 7.1 `RESEND_WEBHOOK_SECRET` u `lib/env.ts`

Server-only (bez `NEXT_PUBLIC_`). **Obavezno `optionalSecret`** (ne required) — `env` se importuje na module-level u `proxy.ts:4`, pa bi required-throw (`lib/env.ts:57`) oborio build i svaki request na okruženjima gdje tajna nije postavljena.

Dvije izmjene (mapping nije automatski):
```ts
// 1) schema objekat (uz CRON_SECRET, ~lin. 18):
RESEND_WEBHOOK_SECRET: optionalSecret,
// 2) process.env mapping u safeParse (~lin. 42):
RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
```
Dodati i komentarisanu liniju u `.env.local.example` uz `CRON_SECRET`. Prisustvo se forsira **u runtime-u** rute (fail-closed 401), ne na boot-u.

### 7.2 Resend dashboard (po okruženju — DEMO i PROD odvojeno)

1. Kreirati **dva** webhook endpointa (jedan po deploy domenu): DEMO domen(i) i PROD domen. Endpoint URL = `https://<domen>/api/webhooks/resend`.
2. **Pretplata na događaje (zaključano, §10 #2):** obavezni minimum `email.delivered`, `email.bounced`, `email.complained`, `email.failed`. `email.opened` je **opciono, podrazumijevano isključeno** (traži uključeno open-tracking; dodaje šum). `email.delivery_delayed` se ne pretplaćuje (tranzijentan, bez enum vrijednosti).
3. Kopirati `whsec_…` tajnu **svakog** endpointa u odgovarajući Vercel projekat kao `RESEND_WEBHOOK_SECRET`. **Ne dijeliti tajnu između okruženja.**

### 7.3 Migracija & lockstep + **lokalni apply prije `db:types`**

- **Fajl:** `supabase/migrations/20260713120000_mejl_log.sql` (14-cifreni timestamp; sortira poslije trenutno zadnjeg `20260711160000_get_admini_rpc.sql`).
- **Redoslijed (verifikovano — `db:types` je `--local`, `package.json:15`):**
  1. **Lokalno primijeni** migraciju na lokalni Supabase stack (Docker): `pnpm db:reset` (reappl‑uje sve migracije) — jer `pnpm db:types` generiše iz **lokalne** baze; bez ovog koraka `db/types.ts` ne bi sadržao `mejl_log`/enume/RPC i wrapper (`Database["public"]["Enums"]["mejl_tip"]`, `rpc(...)`) bi pao na tsc.
  2. `pnpm db:types` — regeneriši `db/types.ts` (nikad ručno).
  3. **Cloud apply, DEMO pa PROD** (lockstep — sheme uvijek identične): `pnpm db:apply-cloud supabase/migrations/20260713120000_mejl_log.sql`. Ref-guard prije PROD upisa (PROD=`fqtqkehjidkzeasiegnq` u `.env.local`; DEMO=`mtwwotmwrasozmcgqwhc` u `.env.development.local`). Cloud **nije** dostupan preko Supabase MCP.

### 7.4 Vercel

- Merge u `main` = deploy na **tri** Production projekta (git-integracija). `RESEND_WEBHOOK_SECRET` **nije** `NEXT_PUBLIC` → mora biti postavljen u env svakog relevantnog projekta (imena su invertovana od uloge!) — kod sam ga ne provizionira.
- `vercel.json` ima `regions:["dub1"]`; **webhook ne treba cron ni `headers` blok**. Migracija je jedina DB promjena; sam env/ruta ne mijenjaju bazu.

---

## 8. Rukovanje greškama (edge-slučajevi)

1. **`mejl_log` upis padne/preskoči** (nema prava na SSR putu, transijentna DB greška) → best-effort `console.error`, **slanje se ne prekida**, mejl ode ali nije zabilježen. Za `zakazano`/`test` (SSR user/admin) upis ide kroz validirani `zabiljezi_mejl_log` RPC (§3.5); ako korisnik nema pristup firmi, RPC tiho preskoči (u praksi ima — uređuje termin te firme).
2. **Neuspjeh slanja** (`sendEmail` baca) → `mejl_log` red `status='greska_slanja'`, `greska=poruka`, `resend_id=null`; wrapper **re-throw** → `runReminders` daje `err`, `zakazano` normalizuje na `razlog:'greska'`, `test` prikaže `objasniEmailGresku`. Prethodno **nevidljiva greška je sad u logu** (rješava prazninu #1).
3. **Duplikat webhook događaja** → `azuriraj_mejl_dostavu` strogo `>` po rangu → 0 redova → no-op (idempotentno).
4. **Van reda: `opened` prije `delivered`** → `opened`(2) upiše se; kasniji `delivered`(1) < 2 → no-op (`opened` ostaje, ispravno jer opened ⟹ delivered).
5. **`opened` ne pregazi `bounced`** → `bounced`(4); `opened`(2) < 4 → no-op.
6. **`delivered` pa `bounced`** (rijetko) → `bounced`(4) > 1 → bounce pobjeđuje (negativan status ljepljiv).
7. **Eskalacija nakon pregleda** (`bounced` pregledan → stigne `complained`) → `complained`(5) > `bounced`(4), error status → UPDATE resetuje `pregledano_at`/`pregledano_od` na NULL → red se **ponovo pojavi u bedžu** (spam prijava se ne guši).
8. **Nepoznat `resend_id`** (sentinel `'dry-run'`/`'unknown'`, ili mejlovi prije feature-a) → UPDATE 0 redova → **200**, bez retry-a.
9. **Loš/nedostajući potpis, stari timestamp, nedostajući svix/webhook headeri** → verifikacija baca / early-return → **401**.
10. **`RESEND_WEBHOOK_SECRET` nije postavljen** → **401** fail-closed (nikad tiho prihvatanje).
11. **`resend_id='unknown'` fallback** (`resend.ts:36`, `data.id` izostane) → red se ne može upariti webhookom; `delivery_status` ostaje `nepoznato`, ali `status='poslato'`. Rijetko; dokumentovano.
12. **Konkurentni webhook događaji za isti mejl** → jedan atomski guarded UPDATE (RPC) → bez read-modify-write race-a.
13. **`email.delivery_delayed`** → `mapirajDostavu` vraća `undefined` → bez izmjene statusa, 200 ack.
14. **Dupli send (konkurentni cron run)** → 2 `mejl_log` reda (tačno za observability), `podsjetnici` i dalje 1 (dedup). Nije regresija.
15. **Direktan authenticated INSERT/UPDATE na `mejl_log`** → default-denied (nema INSERT/UPDATE politike); jedini putevi su definer RPC-ovi. Pokriveno negativnim testom (§9.2).

---

## 9. Plan testiranja

> **Preduslov za integracione/RLS testove:** `TEST_DATABASE_URL` mora pokazivati na **lokalni Supabase (Docker) stack sa primijenjenom migracijom `20260713120000`** (`pnpm db:reset` prije suite-a). Ovo je u skladu s pravilom „backend testiranje ide preko Docker-a". Isti stack koji `db:types` čita.

### 9.1 Unit (Vitest, `lib/**/*.test.ts`, node env, pure logic)

**`lib/email/posaljiIzabiljezi.test.ts`** (fake `supabase` čiji `.rpc()` hvata pozive, fake `send`):
- **uspjeh (non-dry):** `send` → `{id:"abc",dryRun:false}` → jedan `rpc("zabiljezi_mejl_log", …)` sa `p_status='poslato'`, `p_resend_id='abc'`; vraća `res`.
- **neuspjeh:** `send` reject → `rpc(…)` sa `p_status='greska_slanja'`, `p_greska=poruka`, `p_resend_id=null`; **funkcija re-throw-uje** (assert `rejects`).
- **dry-run:** `send` → `{dryRun:true}` → **nula `rpc` poziva**; vraća `res`.
- **best-effort:** `rpc` vraća `{error}` ili baca → uspjeh i dalje vraća `res` / neuspjeh i dalje re-throw-uje originalni error; assert `console.error` pozvan, `send` se ne „poništava".

**`lib/email/webhookDostava.test.ts`**:
- `mapirajDostavu` za svih 6 mapiranih tipova + ignorisane (`sent`/`clicked`/`domain.*`/`delivery_delayed` → `undefined`).
- rang monotonost; scenariji precedence (JS-logika): opened-prije-delivered, opened-vs-bounced, delivered-vs-complained.
- **Provjera potpisa protiv STVARNOG verifikatora, bez importa `standardwebhooks`** (potvrđeno da nije hoist-ovan/nije projektna zavisnost): fixture se **ručno potpisuje** `node:crypto`-om u formatu koji `standardwebhooks` očekuje:
  ```ts
  import { createHmac } from "node:crypto"
  function potpisi(whsec: string, id: string, ts: string, body: string) {
    const key = Buffer.from(whsec.replace(/^whsec_/, ""), "base64")
    return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`
  }
  ```
  Zatim `new Resend("re_placeholder").webhooks.verify({ payload: body, headers: { id, timestamp: ts, signature }, webhookSecret: whsec })` sa **svježim** `ts=Math.floor(Date.now()/1000).toString()` (tolerancija vremena) → očekuj uspjeh; izmijeni tijelo → očekuj throw; pogrešna tajna → throw.

### 9.2 RLS / integracija (pg Client, gated na `TEST_DATABASE_URL` = lokalni Docker, uzor `lib/podsjetnici/podsjetnikEmailRpc.integration.test.ts` + `lib/reminders/dueRpc.integration.test.ts`, `withTx` rollback)

- **Pokrivenost (automatski):** postojeći `rlsCoverage.integration.test.ts` pada ako `mejl_log` nema RLS+politiku — tier-0 guard.
- **Tri nivoa SELECT-a** (postavi `request.jwt.claims`/`auth.uid()` kontekst, `set local role authenticated`):
  - **(a) admin** vidi **sve** redove, uključujući `klijent_id IS NULL` (test) red.
  - **(b) korisnik dodijeljen firmi A** vidi **samo** redove firme A; **NE** vidi redove firme B (nema cross-tenant curenja).
  - **(c)** taj korisnik **NE** vidi `klijent_id IS NULL` (test/bez firme) red.
- **Upisni RPC `zabiljezi_mejl_log`:**
  - service-role kontekst (`auth.uid()` NULL) → upis prolazi.
  - authenticated sa pristupom firmi A → upis za firmu A prolazi; za firmu B (bez pristupa) → **no-op** (nema reda).
  - admin → upis `klijent_id=NULL` (`tip='test'`) prolazi.
- **Negativni write testovi:** authenticated korisnik **ne može** direktan `insert into mejl_log …` (default-denied) niti `update mejl_log set pregledano_at=…` (nema UPDATE politike) — oba odbijena; jedini put je RPC.
- **Bedž skopiranost:** `get_mejl_greske_broj()` pod adminom broji i grešku bez firme; pod operaterom firme A broji samo greške firme A (ne firme B, ne bez-firme).
- **`oznaci_mejl_pregledan`:** ovlašteni gledalac postavlja `pregledano_at`; neovlašteni (druga firma) = no-op.
- **STVARNA SQL precedenca `azuriraj_mejl_dostavu` / `mejl_dostava_rang`** (ne JS-kopija): seed reda sa poznatim `resend_id`, pa redom pozivi RPC-a i provjere:
  - opened-prije-delivered → `opened` ostaje;
  - opened-vs-bounced → `bounced` pobjeđuje;
  - duplikat istog događaja → povrat 0, bez promjene;
  - `delivered`→`bounced` → `bounced` (ljepljiv);
  - **eskalacija:** postavi `bounced`, ručno `pregledano_at=now()`, pa `complained` → `delivery_status='complained'` **i `pregledano_at IS NULL`** (re-alarm).

### 9.3 E2E (Playwright, `--workers=1`, DEMO; uzor `18-auth-rls.spec.ts` / `30-aktivnost.spec.ts`)

Novi `tests/e2e/32-poslati-mejlovi.spec.ts`. Fixtures u `mejl_log` seed-ovati **service-role** klijentom (`tests/e2e/db.ts`, DEMO-first env), sa **jedinstvenim markerom u `subject`** (npr. prefiks `"[E2E] "` + nasumični sufiks), i **hvatati vraćene `id`-jeve**. E2E na DEMO baza je dijeljena i Resend je uživo — zato **nikad ne tvrdi apsolutan broj**:

- **Determinističke asertacije (relativne):** pročitaj bedž/broj prije seed-a; seed-uj N grešaka sa markerom; tvrdi `+N` (ili prisustvo reda po jedinstvenom `subject`). Označi jedan pregledanim → tvrdi `-1`. Isto za operater-skopiranu asertaciju.
- **admin:** ekran lista redove uključujući red bez firme (`test`); red greške renderovan crveno; klik na bedž → `?samo_greske=1&nepregledano=1` prikazuje **tačno** neriješene greške (broj = bedž); „Označi pregledanim" → taj red nestane, bedž `-1`.
- **običan dodijeljeni korisnik:** vidi **samo** redove svoje firme; **ne** vidi drugu firmu ni redove bez firme; bedž broji samo njegove neriješene.
- **Teardown (obavezno — `cleanup-test-data.ts` trenutno NE dira `mejl_log`):**
  1. **Primarno:** `afterAll` obriši seed-ovane redove po uhvaćenim `id`-jevima (service-role).
  2. **Sigurnosna mreža:** proširi `scripts/cleanup-test-data.ts` novom granom `mejl_log` po marker-regexu (npr. `const JUNK_MEJL = /^\[E2E\] /` nad `subject`, isti obrazac kao postojeći `JUNK_KLIJENT`/`JUNK_NAPOMENA`), da `pnpm cleanup:test-data` pokupi zaostatke ako spec padne prije `afterAll`.

---

## 10. Otvorena pitanja / rizici — **razriješeno**

Sva ranije „Potvrditi" pitanja zaključana na preporučeni default (dizajn je „spreman za implementaciju"):

1. **`email.delivery_delayed`** — **RIJEŠENO: van enuma.** Tranzijentan; `mapirajDostavu → undefined`, 200 ack; Resend naknadno šalje `delivered`/`bounced`.
2. **Skup pretplaćenih događaja** — **RIJEŠENO:** obavezni `delivered/bounced/complained/failed`; `opened` **opciono, isključeno po defaultu** (open-tracking + šum); `clicked`/`delivery_delayed` se ne pretplaćuju. Enum i dalje podržava `opened` (bez migracije ako se kasnije uključi).
3. **Dijeljena `pregledano_at` semantika** — **RIJEŠENO: prihvaćeno.** Korisnik koji očisti grešku svoje firme čisti je i iz admin bedža za tu firmu (admin i dalje vidi bez-firme/druge-firme). Eskalacija u gori error status resetuje pregled (§3.6/§8.7).
4. **Upisni put (INSERT)** — **RIJEŠENO:** nema `authenticated` INSERT politike (service-role insert only); jedini put je validirani `SECURITY DEFINER` RPC `zabiljezi_mejl_log`. Rezidual: ovlašteni korisnik može ubaciti red za **vlastitu** firmu (ne cross-tenant, bez UPDATE/DELETE); falsifikovanje `resend_id` bez praktičnog efekta (§3.5). Opciono dodatno stezanje po `tip` je van v1.
5. **`resend_id='unknown'`** (Resend vrati bez `data.id`) → nemapiran webhookom; rijetko, ostaje `nepoznato`. Prihvaćeno.
6. **Backfill** — istorijski poslati podsjetnici (`podsjetnici`) nisu u `mejl_log` (forward-only). Opcioni jednokratni import (`podsjetnici` ima `resend_id`, `poslat_na`, `poslat_at`, `kanal`, `termin_id`→`klijent_id`) moguć kasnije, bez `subject`/`greska`/`delivery_status` istorije. **Van v1.**
7. **Reset-lozinke van opsega** (Supabase Auth SMTP) — poznato ograničenje; hvatanje bi tražilo poseban Auth hook.
8. **PostgREST ~1000-red implicitni limit** — lista koristi `get_poslati_mejlovi` sa `p_limit`/`p_offset` (paginacija), pa nije pogođena; bedž je `count(*)` (nije pogođen).
9. **`korisnici` RLS** može nulirati `pregledao_ime` u view-u za ne-admina (LEFT JOIN ne ispušta red) — prihvatljivo.
