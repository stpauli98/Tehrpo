# Podsjetnici poslije roka: jednokratna obavijest po ciklusu + sedmični digest

**Datum:** 2026-07-19
**Status:** Revizija 3 (nakon četiri nezavisne recenzije) — čeka još jedan krug recenzije prije plana implementacije
**Isporuke:** dva nezavisna PR-a (§2)
**Grane (prijedlog):** `fix/post-due-po-ciklusu`, zatim `feat/digest-isteklih`

---

## 1. Cilj / Motivacija

Post-due grana engine-a podsjetnika šalje **jedan mejl po terminu po danu, neograničeno**, i to na oba kanala.

Uzrok je u `supabase/migrations/20260629120000_podsjetnici_catchup_postdue.sql`. Post-due upit vraća jedan red dnevno za svaki termin sa `status in ('planirano','zakazano')` i `rok_dospijeca < current_date`. Ključ za deduplikaciju je `dana_prije = rok_dospijeca - current_date`, dakle negativan broj koji se **mijenja svaki dan**, pa jedinstveni indeks `uq_podsjetnici_termin_dana_kanal (termin_id, dana_prije, kanal)` nikad ne pogodi duplikat.

**Izmjereno stanje na PROD-u (`fqtqkehjidkzeasiegnq`, 2026-07-19):**

| Klijent | Vrsta | Rok | `datum_zakazan` | Status | Kašnjenje |
|---|---|---|---|---|---|
| CARMEUSE | Obilazak | 2026-07-13 | 2026-07-15 | zakazano | 6 dana |
| WAIKIKI | Ispitivanje hidranata | 2026-06-27 | 2026-06-27 | zakazano | 22 dana |
| NEW YORKER | Obilazak | 2026-06-08 | 2026-06-08 | zakazano | 41 dan |

Tri termina proizvode **pet mejlova dnevno** (tri interna + dva firmina). U tabeli `podsjetnici` je 63 post-due zapisa, i to za **šest** termina — pored ova tri, i `62cdd3a8`, `b77dc4b0`, `d8a9131f`, kojima je rok naknadno pomjeren ili je status zatvoren. `postavke`: `dana_prije = {30,14,7}`, `salji_klijentima = true`, `vrijeme_slanja_sat = 10`, `podsjetnici_aktivni = true`.

Dva odvojena problema:

1. **Šum.** Dnevno ponavljanje ne mijenja ishod — mijenja ga promjena statusa ili novi dogovor. Kadenca je per-item pa raste linearno sa brojem klijenata.
2. **Firmin kanal.** `salji_klijentima = true`, pa kontakt klijenta dnevno dobija obavijest da kasni.

**Rješenje.** Poslije roka: **jedna obavijest po ciklusu** na oba kanala (interni sa dugmadima, firmin sa pozivom na dogovor), pa sedmični interni digest kao trajni pregled stanja.

---

## 2. Ključni pojam: ciklus

Cijeli dizajn počiva na jednom pojmu, i sve tri prethodne verzije su padale zato što ga nisu imale.

> **Efektivni rok** termina je `coalesce(datum_zakazan, rok_dospijeca)`.
> **Ciklus** je jedan efektivni rok. Termin dobija **tačno jednu** obavijest po ciklusu i po kanalu.

Odatle slijedi sve:

- Rok prođe → ciklus je `rok_dospijeca` → jedna obavijest.
- Rok se pomjeri u budućnost → novi ciklus još nije istekao → tišina.
- Novi rok prođe → **novi** ciklus → nova obavijest, automatski.
- Termin se zakaže za 25.07. → efektivni rok postaje 25.07. → izlazi iz alarma.
- **25.07. prođe bez zatvaranja → ciklus je sad 25.07. → obavijest se okida sama.**

Posljednja stavka rješava ono što je recenzija nazvala najvećom operativnom rupom: propuštena *dogovorena* posjeta je jači signal od isteklog administrativnog roka — neko je dao obećanje i prekršio ga — a u ranijim verzijama je dobijala slabiji tretman. Ovdje ne traži nikakvu novu mašineriju; ispada iz definicije ciklusa.

> **Zašto je ovo bila kritična greška u reviziji 2.** Revizija 2 je guard pisala kao `(p.poslat_at::date + p.dana_prije) = t.rok_dospijeca`, dakle rok je *rekonstruisala* iz zapisa, dok je unique indeks i dalje stajao na `dana_prije`. Dvije nezavisne recenzije su, svaka za sebe, konstruisale isti protuprimjer na stvarnom PROD terminu `f1c285fe` (CARMEUSE, postojeći redovi `dana_prije −1..−6` na oba kanala): rok se pomjeri na 01.08., 02.08. je `dana_prije = −1`, guard prolazi jer stari red rekonstruiše rok 13.07., mejl **odlazi**, a `insert` puca na `uq_podsjetnici_termin_dana_kanal` sa starim redom od 14.07. `runReminders.ts:134` konflikt mapira u `skip "vec poslat"`, traga nema, guard ostaje otvoren — **šest dana × dva kanala = 12 mejlova** umjesto jedne obavijesti. Uzrok: dedup ključ nije nosio identitet ciklusa, i slanje se dešavalo prije upisa.

---

## 3. Podjela na dvije isporuke

### PR 1 — „zaustavi krvarenje"

Post-due put dobija ispravnu semantiku. **Ne dira pre-due put uopšte** — post-due grana se iz `get_due_podsjetnici` uklanja, a ne prepisuje, čime nestaje rizik od tihe regresije pri prekopiravanju pre-due grane (na koji je recenzija upozorila).

Efekat odmah po deployu: pet mejlova dnevno postaje nula, a prvo pomjeranje roka ne vraća krvarenje.

### PR 2 — digest

Sedmični pregled. Ne zavisi ni od čega osim od PR 1.

---

## 4. Ponašanje

### 4.1 Prije roka — nepromijenjeno

Pragovi iz `postavke.dana_prije` (PROD: `{30,14,7}`), jedan mejl po pragu po terminu, oba kanala. Pre-due grana `get_due_podsjetnici` i tabela `podsjetnici` ostaju netaknute.

### 4.2 Poslije roka

| Uslov | Interni kanal | Firmin kanal |
|---|---|---|
| Ciklus istekao, za taj ciklus nema traga na tom kanalu | pojedinačna obavijest (`reminderHtml`) | pojedinačna obavijest (`rokIstekaoFirmaHtml`) |
| Ponedjeljak (ili oporavak, §4.5) | digest svih isteklih termina primaoca | — |
| Ostalo | ništa | — |

Firmin kanal poštuje postojeće prekidače: `postavke.salji_klijentima`, `klijenti.salji_podsjetnik_klijentu`, adrese iz `kontakt_osobe.podsjetnik_primalac` **i `klijenti.podsjetnik_emails`** (`recipients.ts:91-102`). Nijedan novi prekidač.

Novi firmin šablon nije opomena nego poziv na dogovor. Bez internih dugmadi, **bez ICS priloga** (`runReminders.ts:154-157` ga danas kači bezuslovno — mora postati uslovno), i sa **vlastitim subject-om**; postojeći `reminderSubject` (`templates.ts:79-87`) za negativne dane daje „kasni N dana", što je ton koji ovaj šablon odbacuje.

### 4.3 Tekst obavijesti prati ciklus, ne rok

Kad je ciklus `datum_zakazan`, mejl govori o zakazanom datumu („zakazano za 25.07., izvršenje nije evidentirano"), a ne „kasni 32 dana" računato od roka. Inače sadržaj ne odgovara stvarnosti — na to je upozorila recenzija.

### 4.4 Kad prestaje

Termin izlazi iz alarma i digesta kad mu status pređe u `izvrseno`/`otkazano`, ili kad mu efektivni rok padne u budućnost (pomjeren rok ili novi `datum_zakazan`).

### 4.5 Kadenca digesta

Digest se šalje **ponedjeljkom**, po lokalnom vremenu `Europe/Vienna`. Dan je konstanta u kodu.

Primalac dobija digest kad je ispunjeno bilo koje od:

- danas je ponedjeljak, **ili**
- posljednji digest tom primaocu je stariji od 7 dana (oporavak).

> **Zašto ne čisto „7 dana od zadnjeg".** Recenzija je predložila da se dan u sedmici izbaci potpuno, jer pravilo „7 dana od zadnjeg" samo daje sedmičnu kadencu. Odbijeno zbog **drifta**: jedan zakašnjeli ciklus trajno pomjera kadencu, pa poslije nekoliko mjeseci digest stiže četvrtkom. Sedmični izvještaj koji stiže ponedjeljkom ujutro je ritual oko kojeg se planira sedmica; onaj koji klizi to nije.
>
> Argument recenzije o krhkosti (`Intl` + mapiranje ISO dana + pinovanje locale-a) je ipak prihvaćen, ali se rješava bez odricanja od ponedjeljka: `lokalniSatIDatum` (`gating.ts:14-29`) već vraća bečki datum kao `"2026-07-20"`, pa je dan u sedmici `new Date(datum + "T00:00:00Z").getUTCDay()` — obična aritmetika nad već ispravno izračunatim datumom. Nema `Intl` za dan u sedmici, nema locale-a, nema testne matrice od sedam dana.

### 4.6 Primaoci i opseg sadržaja digesta

Isti model kao postojeći interni kanal: radnik vidi istekle termine klijenata na koje je dodijeljen (`korisnik_klijent`), admin sve, `REMINDER_TO` adrese se ponašaju kao admin. Jedan mejl po osobi.

Digest je **gola lista sortirana po kašnjenju silazno**. Bez sekcija „novo / traje duže", bez gornje granice broja stavki.

> **Zašto bez toga.** Revizija 2 je uvodila obje stvari. Recenzija ih je nazvala kozmetikom preko dubljeg problema, i s pravom: pri tri zakašnjela termina to su rješenja za problem koji ne postoji, a nose 8-dnevni lookback upit i granu logike koja se na tri reda ne može smisleno testirati. Uz to je cap bio i pogrešno postavljen — rezao je po starosti, dakle odsjekao bi najsvježije stavke, jedine koje se još mogu spasiti. Kad lista naraste toliko da postane neupotrebljiva, to je dobar problem i rješava se tad, sa podacima o stvarnoj upotrebi. Isto vrijedi za eskalaciju („četvrti put u listi → admin").

### 4.7 Prazan digest

Primalac bez ijednog isteklog termina ne dobija mejl i ne dobija red u `digest_slanja`.

### 4.8 Termin koji je danas dobio pojedinačnu obavijest

Ne ulazi u današnji digest. Uslov nije vremenski („danas") nego po ciklusu: digest izostavlja termin čiji ciklus ima trag u `post_due_obavijesti` sa `poslat_at::date = current_date`.

> Recenzija je našla da §3.9 revizije 2 pretpostavlja serijalizaciju koje nema: dvije cron staze na istom `0 8 * * *` Vercel pali paralelno, pa digest čita trag prije nego ga post-due put upiše. Rješenje je u §5.3 — **razmaknut raspored**, digest u `30 8 * * *`. Uslov po ciklusu je druga brana, ne jedina.

### 4.9 Efekat na trenutne podatke

Po deployu PR 1: **nula mejlova umjesto pet**, odmah, jer migracija backfill-uje tragove za sve postojeće cikluse (§6.1). Po deployu PR 2, u prvi ponedjeljak: jedan interni digest sa tri reda po primaocu.

---

## 5. Arhitektura

### 5.1 Post-due dobija vlastiti ledger, `podsjetnici` ostaje pre-due

Nova tabela `post_due_obavijesti` sa unique `(termin_id, ciklus_rok, kanal)`.

Razmatrano i odbijeno: dodavanje kolone `ciklus_rok` u `podsjetnici` uz izmjenu postojećeg unique indeksa. Odbijeno jer bi novi unique indeks **pukao na postojećim podacima** — CARMEUSE ima šest redova (`−1..−6`) koji svi pripadaju istom ciklusu 13.07., pa bi migracija morala destruktivno obrisati ~50 redova istorije. Zasebna tabela to izbjegava: `podsjetnici` ostaje netaknut kao istorijski i pre-due ledger, a backfill u novu tabelu upisuje po jedan red po zatečenom ciklusu.

### 5.2 Claim-first: upiši, pa pošalji

Na oba mjesta (post-due obavijest i digest) redoslijed je:

```
insert claim (unique = brava)   →   pošalji   →   update resend_id + poslat_at
```

Send-first je bio uzrok kritične greške (§2) i trke između dva schedulera. Postoje **dva** schedulera: `vercel.json` `crons` i `.github/workflows/reminders.yml` na `0 * * * *`; u 08:00 UTC oba pale istu rutu. Sa send-first oba nađu prazan ledger, oba pošalju, a unique hvata tek drugi insert — kad su mejlovi već vani.

**Neuspjeh se ne rješava brisanjem claim-a.** Revizija 2 je predviđala `catch` → `delete`, što vraća duplikat koji claim-first treba da spriječi: ako Resend primi zahtjev a odgovor padne na timeoutu, brisanje brave znači da sljedeći run šalje ponovo. Umjesto toga, `resend_id is null` je stanje **„u toku / može se preuzeti"**:

- claim se upisuje sa `claimed_at = now()`, `resend_id = null`, `poslat_at = null`
- uspješno slanje popunjava `resend_id` i `poslat_at`
- claim sa `resend_id is null` **stariji od 15 minuta** smije se preuzeti atomskim `update ... set claimed_at = now() where ... and resend_id is null and claimed_at < now() - interval '15 minutes' returning id`

Time je pokrivena i smrt procesa (Vercel hard-kill / timeout), koju `catch` grana po definiciji ne hvata i koju je recenzija označila kao nepokrivenu.

**Kanal bez primalaca dobija claim sa razlogom.** Ako kanal nema nijednog eligibilnog primaoca, upisuje se claim sa `razlog = 'nema_primalaca'` umjesto slanja. Bez toga bi RPC taj termin vraćao svaki dan zauvijek — postojeće ponašanje koje danas zatrpava logove sa `skip "nema primalaca"`.

### 5.3 Digest ide u zasebnu rutu, u 08:30

`GET|POST /api/cron/digest`, `"schedule": "30 8 * * *"` u `vercel.json`.

Razlozi za odvajanje: `postavke` se u postojećoj ruti čita samo unutar `if (req.method === "GET")` (`route.ts:32-36`), pa ručni POST nema odakle pročitati stanje; i `zadnje_slanje_datum` ostaje netaknut, pa idempotencija digesta počiva isključivo na `digest_slanja`.

> Recenzija je s pravom srezala treći argument iz revizije 2: `maxDuration = 60` nije stvarni razlog, jer je digest ~6 mejlova sedmično i ne prilazi 50s. Ostaje kao **posljedica**: nova ruta mora sama deklarisati `maxDuration`, inače važi Vercel default koji je kraći, a §7 traži namjerno spor throttling.

Razmak od 30 minuta serijalizuje post-due put i digest (§4.8).

`proxy.ts:15` već ima `/api/cron` u `PUBLIC`, pa nova ruta ne traži izmjenu proxy-ja.

### 5.4 Tanak RPC, grupisanje u TypeScriptu

`get_post_due_termine()` i `get_istekli_termini()` vraćaju ravne liste i **ne znaju ništa o primaocima**. Grupisanje radi TS preko postojećeg `buildRecipientIndex` (`recipients.ts`). Alternativa — RPC koji vraća parove `(email, termini)` — značila bi dva izvora istine za pravila o primaocima.

### 5.5 Tok podataka

```
cron 08:00 → /api/cron/reminders
  → gating (nepromijenjen)
  → runReminders(): pre-due iz get_due_podsjetnici          [nepromijenjeno]
  → runPostDue():   get_post_due_termine()
        po terminu, po kanalu: claim → pošalji → update
cron 08:30 → /api/cron/digest
  → gating: CRON_SECRET, podsjetnici_aktivni, vrijeme_slanja_sat
  → get_istekli_termini() + loadRecipientIndex() → digestGroups()
  → po primaocu: trebaDigest()? → claim → pošalji → update
```

---

## 6. Šema baze

Sve migracije idempotentne, sve na **DEMO i PROD u istom koraku** (lockstep).

### 6.1 PR 1 — `20260719120000_post_due_obavijesti.sql`

```sql
create table if not exists post_due_obavijesti (
  id          uuid        primary key default gen_random_uuid(),
  termin_id   uuid        not null references termini(id) on delete cascade,
  ciklus_rok  date        not null,
  kanal       text        not null check (kanal in ('interni','firma')),
  claimed_at  timestamptz not null default now(),
  poslat_at   timestamptz,
  poslat_na   text[]      not null default '{}',
  resend_id   text,
  razlog      text,
  constraint uq_post_due unique (termin_id, ciklus_rok, kanal)
);

create index if not exists idx_post_due_termin on post_due_obavijesti (termin_id);

alter table post_due_obavijesti enable row level security;
```

Bez politika: piše i čita isključivo cron preko service-role klijenta, koji zaobilazi RLS. RLS je uključen da tabela ne bude otvorena kroz PostgREST.

> Napomena o grantovima: Supabase ima `alter default privileges ... grant all on tables to anon, authenticated, service_role` u shemi `public`, pa nova tabela **jeste** automatski grantovana. Jedino što je štiti je RLS bez politika. Revizija 2 je tvrdila suprotno („bez granta"); recenzija je to ispravila.

**Backfill iz postojećih podataka**, u istoj migraciji:

```sql
insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, claimed_at, poslat_at, poslat_na, resend_id)
select distinct on (p.termin_id, (p.poslat_at::date + p.dana_prije), p.kanal)
       p.termin_id, (p.poslat_at::date + p.dana_prije), p.kanal, p.poslat_at, p.poslat_at, p.poslat_na, p.resend_id
from podsjetnici p
where p.dana_prije < 0
order by p.termin_id, (p.poslat_at::date + p.dana_prije), p.kanal, p.poslat_at asc
on conflict do nothing;
```

`poslat_at::date + dana_prije` rekonstruiše ciklus zatečenog reda: red upisan na dan `D` sa `dana_prije = rok − D` daje `D + dana_prije = rok`. Rekonstrukcija se koristi **samo za backfill**, jednokratno; dalje se ciklus upisuje eksplicitno, pa nema oslanjanja na aritmetiku ni na vremensku zonu.

Na PROD-u ovo daje po jedan red po zatečenom ciklusu za šest termina — dakle sva tri aktivna termina imaju trag i **neće** dobiti obavijest po deployu.

### 6.2 PR 1 — `20260719121000_get_due_bez_post_due.sql`

`get_due_podsjetnici` se vraća na **samo pre-due granu**. Post-due grana se uklanja u cjelini; `union all` nestaje. Povratni tip nepromijenjen → `create or replace`.

Uklanjanjem, a ne prepisivanjem, nestaje rizik od tihe regresije pre-due grane pri ručnom prekopiravanju — na što je recenzija upozorila.

`chk_podsjetnici_dana_prije` (dozvoljava −3650) i postojeći negativni redovi ostaju netaknuti; nova post-due putanja u `podsjetnici` više ne piše.

### 6.3 PR 1 — `20260719122000_get_post_due_termine.sql`

```sql
create or replace function get_post_due_termine()
returns table (
  termin_id      uuid,
  klijent_id     uuid,
  klijent_naziv  text,
  vrsta_naziv    text,
  rok_dospijeca  date,
  datum_zakazan  date,
  ciklus_rok     date,
  lokacija_naziv text,
  treba_interni  boolean,
  treba_firma    boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with ef as (
    select t.*, coalesce(t.datum_zakazan, t.rok_dospijeca) as ciklus
    from termini t
    where t.status in ('planirano','zakazano')
      and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date
  )
  select
    ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus, l.naziv,
    not exists (select 1 from post_due_obavijesti o
                where o.termin_id = ef.id and o.ciklus_rok = ef.ciklus and o.kanal = 'interni'),
    not exists (select 1 from post_due_obavijesti o
                where o.termin_id = ef.id and o.ciklus_rok = ef.ciklus and o.kanal = 'firma')
  from ef
  join klijenti k        on k.id = ef.klijent_id
  join vrste_provjera vp on vp.id = ef.vrsta_provjere_id
  left join lokacije l   on l.id = ef.lokacija_id
  where (select count(*) from post_due_obavijesti o
         where o.termin_id = ef.id and o.ciklus_rok = ef.ciklus) < 2
  order by ef.ciklus, k.naziv;
$$;

revoke execute on function get_post_due_termine() from public, anon;
grant execute on function get_post_due_termine() to service_role;
```

`treba_interni` / `treba_firma` se vraćaju eksplicitno da TS ne pogađa koji kanal još nije obrađen. Uslov je **sargable** — poređenje po jednakosti nad indeksiranim kolonama, za razliku od izraza `poslat_at::date + dana_prije` iz revizije 2, koji nije mogao koristiti nijedan indeks.

`grant` samo `service_role`: nijedan UI ne zove ovu funkciju.

### 6.4 PR 1 — `20260719119000_mejl_tip_prosirenje.sql`

```sql
alter type mejl_tip add value if not exists 'podsjetnik_rok_istekao_firma';
alter type mejl_tip add value if not exists 'podsjetnik_digest';
```

**Obje vrijednosti odjednom, u PR 1**, iako se `podsjetnik_digest` koristi tek u PR 2 — da se `TIP_KEY` i `db:types` ne rade dva puta. Recenzija je s pravom primijetila da je uvođenje jedne bez druge nedosljedno: bez zasebnog tipa firmina post-due obavijest bi u dnevniku bila neodvojiva od pre-due podsjetnika.

**Broj `119000` je namjerno niži** od ostalih migracija PR-a 1, jer se `alter type ... add value` mora primijeniti i commit-ovati prije bilo čega što tu vrijednost koristi. Revizija 2 je imala migraciju koja se po imenu sortirala zadnja a po redoslijedu puštanja morala biti prva — zamka za `db:reset` i za svakoga ko migracije primjenjuje leksikografski.

### 6.5 PR 1 — `20260719123000_termini_view_efektivni_rok.sql`

`termini_view.status_izvedeni` (`20260710140000:15`) računa `kasni` isključivo iz `rok_dospijeca < current_date`, bez `datum_zakazan`. Prelazi na `coalesce(datum_zakazan, rok_dospijeca) < current_date`.

Bez ovoga bi Plan aktivnosti pokazivao `KASNI` za termin koji je zakazan za sljedeću sedmicu, dok bi mejlovi ćutali — dva brojača za istu stvar, i neko bi to prijavio kao grešku. Recenzija je nesklad našla; usklađuje se u smjeru efektivnog roka.

### 6.6 PR 2 — `20260720120000_digest_slanja.sql`

```sql
create table if not exists digest_slanja (
  id             uuid        primary key default gen_random_uuid(),
  primalac_email text        not null,
  datum          date        not null,
  claimed_at     timestamptz not null default now(),
  poslat_at      timestamptz,
  resend_id      text,
  termin_ids     uuid[]      not null default '{}',
  constraint uq_digest_slanja unique (primalac_email, datum)
);

create index if not exists idx_digest_slanja_datum on digest_slanja (datum desc);

alter table digest_slanja enable row level security;
```

`datum` je **lokalni bečki datum** iz `lokalniSatIDatum`, ne `current_date` (UTC). Isti izvor datuma koristi i `trebaDigest`. Recenzija je našla da bi razilaženje ta dva u periodu 23:00–00:00 dalo ključ i odluku koji pokazuju na različite dane — a PROD `vrijeme_slanja_sat = 10` znači da GH Actions okida rutu i u kasnim večernjim satima.

`termin_ids` se zadržava kao dokazni trag: `mejl_log` bilježi *da* je digest poslat, ali ne i *šta* je u njemu pisalo, a jedna kolona se upisuje bez ijednog dodatnog upita. Ne koristi se za razliku „novo/staro" — ta podjela je izbačena (§4.6).

### 6.7 PR 2 — `20260720121000_get_istekli_termini.sql`

Kao `get_post_due_termine`, ali bez kanalskih uslova i bez filtera na tragove — vraća **sve** termine sa isteklim efektivnim rokom, uz `dana_do_roka = ciklus_rok - current_date` (**negativan**; `danaTekst` u `templates.ts:70-75` očekuje negativan broj za kašnjenje, pa bi pozitivan dao „za 41 dan").

Izuzima termin čiji ciklus ima trag sa `poslat_at::date = current_date` (§4.8).

`set search_path = public`, `security invoker`, `revoke execute from public, anon`, `grant` samo `service_role`.

---

## 7. Moduli

### 7.1 PR 1

**`lib/reminders/runPostDue.ts`** (novo) — claim-first petlja po §5.2, po terminu i kanalu. Isti throttling obrazac i isti `Outcome` oblik kao `runReminders`.

**`lib/reminders/recipients.ts`** — izdvaja se `loadRecipientIndex(supabase)`, tj. blok `runReminders.ts:58-85` (četiri PostgREST upita + `parseEmailList(env.REMINDER_TO)` + `buildRecipientIndex`). Zovu ga `runReminders`, `runPostDue` i kasnije `runDigest`. Bez toga bi svaki novi put kopirao ~30 linija I/O i mogao vidjeti drugačiji snapshot dodjela.

**`lib/email/templates.ts`** — `rokIstekaoFirmaSubject()` i `rokIstekaoFirmaHtml()`. Tekst prati ciklus (§4.3).

**`lib/reminders/runReminders.ts`** — post-due grana se uklanja iz obrade (RPC je više ne vraća). Ostaje pre-due, nepromijenjen.

**`app/api/cron/reminders/route.ts`** — poziva `runPostDue` poslije `runReminders`.

**`lib/email/resend.ts` ili cron ruta** — **glasan pad kad `RESEND_API_KEY` nedostaje u cron kontekstu**, umjesto tihog prelaska na `drySend` (`resend.ts:25`). Recenzija je potvrdila da DEMO ima **0 redova** u `podsjetnici` uprkos četiri istekla termina — dry-run tiho guta tragove, pa bi na produkcijskoj instanci istekao ključ značio da dedup prestane raditi, a po vraćanju ključa bi prva noć poslala sve odjednom.

**`components/domain/PoslatiMejloviTabela.tsx`** — `TIP_KEY` dobija obje nove vrijednosti; bez toga je tvrdi `tsc` error (`:11-16`, `as const satisfies Record<MejlTip, string>`). Prateće labele u `messages/{sr,en,de}.json`.

**`scripts/preview-emails.ts`** — novi firmin šablon.

### 7.2 PR 2

**`lib/reminders/digestGroups.ts`** — čista funkcija, nula I/O: `(termini, index, base) → Map<email, red[]>`, preko `recipientsForKlijent`.

**`lib/reminders/digestCadence.ts`** — `jePonedjeljak(bečkiDatum)` (aritmetika nad ISO datumom, §4.5) i `trebaDigest(zadnjiDatum, bečkiDatum)`.

**`lib/reminders/runDigest.ts`** — claim-first po §5.2.

**`digestSubject()` / `digestHtml()`** — gola lista sortirana po kašnjenju, dugme „Otvori plan aktivnosti", bez ICS priloga.

**`app/api/cron/digest/route.ts`** — nova ruta sa vlastitim `maxDuration`.

**`scripts/send-reminders.ts`** — ručno okidanje i post-due puta i digesta.

**`vercel.json`** — drugi cron unos (`30 8 * * *`).

**`.github/workflows/reminders.yml`** — **dva** nova `curl` koraka, po jedan za PROD i DE instancu. Workflow već ima dva koraka sa različitim secretima; jedan novi korak bi ostavio DE instancu bez digesta.

---

## 8. Greške i rubni slučajevi

**Izolacija.** Greška kod jednog termina/kanala/primaoca ne obara ostale — `Outcome` obrazac iz `runReminders`.

**Trka dva schedulera** — zatvorena claim-first modelom (§5.2). Napomena: `trebaSlatiSada` (`gating.ts:35-43`) je i dalje read-then-write bez atomskog claim-a, i `zadnje_slanje_datum` se piše tek poslije `runReminders` (`route.ts:52-56`). To je **postojeće** ponašanje i nije regresija, ali znači da je jedina prava brana za pre-due i dalje unique indeks koji reaguje poslije slanja. Izvan opsega; zabilježeno da se ne izgubi.

**Smrt procesa** — claim sa `resend_id is null` stariji od 15 minuta se preuzima (§5.2). Cijena: ako je Resend stvarno poslao a proces umro prije upisa `resend_id`, primalac dobija drugi mejl poslije 15 minuta. Svjesno biran smjer: bolje jedan duplikat nego trajno progutana jedina obavijest klijentu.

**Kanal bez primalaca** — claim sa `razlog = 'nema_primalaca'` (§5.2).

**Naknadno uključen firmin prekidač** — ako je u trenutku obrade ciklusa firmin kanal bio isključen, upisuje se claim sa `razlog = 'kanal_iskljucen'`, pa naknadno uključivanje **neće** retroaktivno poslati obavijest za taj ciklus. Sljedeći ciklus je dobija normalno. Prihvaćeno ograničenje.

**Termin bez lokacije** — `left join`, red se izostavlja iz tabele.

**Vidljivost u dnevniku mejlova** — digest ide sa `termin_id = null` i `klijent_id = null`, pa ga po `mejl_log_sel` (`20260713120000:52-55`) vide samo admini, i onda kad je primalac radnik. Poznato ograničenje; rješenje bi bilo proširenje politike na `auth.email() = any(primaoci)`, van opsega.

**Preklapanje sa `zakazanoNakonRoka`** — `lib/reminders/zakazanoNakonRoka.ts` šalje internu obavijest kad se termin **zakaže** poslije roka (okida se pri upisu, ne pri proteku). Ne preklapa se sa ovim dizajnom: ta obavijest ide na akciju korisnika, ova na protek vremena. Zabilježeno jer je recenzija s pravom tražila da se cijela mapa email putanja uzme u obzir — svih šest je popisano u `claudedocs/` audit dokumentu.

**Rast `digest_slanja` i `post_due_obavijesti`** — bez retencije. Na trenutnoj skali (nekoliko redova sedmično) nebitno; zabilježeno kao poznato.

---

## 9. Testiranje

**Unit (bez baze i mreže):**

- `digestGroups`: opseg po ulozi; neaktivan i `prima_podsjetnike = false` se ne pojavljuju; primalac bez isteklih termina ne postoji u mapi.
- `trebaDigest` / `jePonedjeljak`: ponedjeljak šalje; utorak ne šalje ako je digest bio u ponedjeljak; utorak **šalje** ako je zadnji stariji od 7 dana; `null` šalje samo ponedjeljkom; datum se uzima kao bečki ISO string, bez `Intl` za dan u sedmici.
- `rokIstekaoFirmaHtml` / `Subject`: nema internih linkova; potpis iz `FirmBrand`; tekst prati ciklus — kad je ciklus `datum_zakazan`, mejl govori o zakazanom datumu, ne o roku (§4.3).
- `digestHtml`: escapovanje `<`, `&`, `'`; sortiranje po kašnjenju; `danaTekst` sa **negativnim** brojem.

**Sa lažnim `send` i mock klijentom:**

- `runPostDue`: claim se upisuje **prije** slanja; pad slanja ostavlja claim sa `resend_id is null`; stariji od 15 min se preuzima, mlađi ne; kanal bez primalaca dobija claim sa razlogom; greška na jednom kanalu ne sprječava drugi.
- `runDigest`: isto, plus primalac sa redom za današnji datum se preskače.

**Integracioni (protiv DEMO cloud baze):**

- `get_post_due_termine` vraća termin tačno jednom po ciklusu i kanalu.
- **Regresija na kritičnu grešku iz revizije 2:** termin dobije obavijest, rok mu se pomjeri, opet istekne → RPC ga **vrati ponovo**, claim **prođe** (jer je ciklus drugi), i to i kad je razlika u danima ista kao ranije. Ovaj test bi na dizajnu iz revizije 2 pao na `insert` — a test koji je revizija 2 propisivala (samo „RPC ga vraća ponovo") bi **prošao** i sakrio grešku.
- Termin zakazan za budućnost ne izlazi iz RPC-a; kad `datum_zakazan` prođe, izlazi sa `ciklus_rok = datum_zakazan`.
- `get_istekli_termini` izuzima termin sa današnjim tragom.
- unique na `digest_slanja` odbija drugi upis.

**Regresija:**

- Pre-due ponašanje (30/14/7, jedan mejl po pragu, oba kanala) bit-za-bit nepromijenjeno nakon uklanjanja post-due grane.
- Postojeća tri PROD termina ne dobijaju obavijest po deployu (pokriveno backfill-om).

**Verifikacija se radi na instanci sa pravim Resend ključem.** DEMO je konfiguraciono različit (`podsjetnici_aktivni = false`, `dana_prije = {30,10,1,0}`, 0 redova u `podsjetnici`) i u dry-run režimu ne upisuje ni `mejl_log` (`posaljiIzabiljezi.ts:16`), pa provjere sadržaja tamo ne dokazuju ništa.

---

## 10. Redoslijed puštanja

### PR 1

1. `20260719119000_mejl_tip_prosirenje.sql` **prvo i zasebno** (enum vrijednost mora biti commit-ovana prije upotrebe; `scripts/apply-cloud-migration.ts:13-17` šalje fajl kao jedan `query`, dakle jednu transakciju).
2. `20260719120000` (tabela + backfill), `20260719121000` (RPC bez post-due), `20260719122000` (novi RPC), `20260719123000` (view) — DEMO pa PROD.
3. `pnpm db:types`.
4. Deploy koda.
5. **Verifikacija na PROD-u:** prvi run poslije deploya šalje nula mejlova; `post_due_obavijesti` ima backfill-ovane redove za šest termina.
6. Kontrolna provjera nakon prvog pomjeranja roka na nekom terminu: tačno jedna obavijest po kanalu, i `insert` ne puca.

### PR 2

1. `20260720120000`, `20260720121000` — DEMO pa PROD.
2. `pnpm db:types`.
3. Deploy koda + drugi cron unos u `vercel.json` + dva nova koraka u GH workflow-u.
4. Ručno okidanje `/api/cron/digest` na instanci sa Resend ključem.
5. Verifikacija u prvi ponedjeljak: jedan digest po primaocu, po jedan red u `digest_slanja` sa popunjenim `resend_id`, `poslat_at` i `termin_ids`.

---

## 11. Donesene odluke

| Pitanje | Odluka | Zašto |
|---|---|---|
| Jedinica deduplikacije | **Ciklus** = `coalesce(datum_zakazan, rok_dospijeca)` | Dedup ključ mora nositi identitet ciklusa; bez toga se dnevni spam vraća pri prvom pomjeranju roka |
| Gdje živi post-due trag | Nova tabela `post_due_obavijesti` | Kolona u `podsjetnici` bi tražila unique koji puca na postojećim podacima i brisanje ~50 redova istorije |
| Redoslijed upis/slanje | Claim-first, na oba puta | Send-first je bio uzrok kritične greške i trke dva schedulera |
| Neuspjeh slanja | `resend_id is null` = „u toku", preuzimanje poslije 15 min | `catch` → `delete` vraća duplikat i ne hvata smrt procesa |
| Propuštena zakazana posjeta | Pokrivena definicijom ciklusa | Novi efektivni rok = novi ciklus = nova obavijest, bez ijednog novog mehanizma |
| Ritam poslije roka | Jedna obavijest po ciklusu + sedmični digest | Brza reakcija kad je najkorisnija, tišina poslije |
| Kadenca digesta | Ponedjeljak (konstanta) + oporavak na 7 dana | Čisto „7 dana od zadnjeg" drifta; ritual ima vrijednost. Krhkost `Intl`-a riješena aritmetikom nad bečkim ISO datumom |
| Sadržaj digesta | Gola lista po kašnjenju | Sekcije i cap su rješenja za problem koji na tri stavke ne postoji; cap je uz to rezao najsvježije |
| Firmin kanal poslije roka | Jedna obavijest po ciklusu, iza postojećih prekidača | Pisani trag štiti izvođača; šum je dolazio od ponavljanja, ne od obavijesti |
| Dan digesta u zasebnoj ruti, 08:30 | Da | Gating na GET, odvajanje od `zadnje_slanje_datum`, i serijalizacija sa post-due putem |
| Enum vrijednosti | Obje odjednom u PR 1 | Da se `TIP_KEY` i `db:types` ne rade dva puta |
| `termini_view` | Prelazi na efektivni rok | Plan aktivnosti i digest moraju brojati isto |
| Opseg | Dva PR-a | PR 1 gasi pet mejlova dnevno i stoji sam |

---

## 12. Trag recenzija

Dokument je prošao **četiri** nezavisne recenzije bez konteksta razgovora u kojem je nastao — dvije na reviziju 1, dvije na reviziju 2. Posljednji krug je imao read-only pristup živoj bazi.

**Kritični nalaz (obje recenzije revizije 2, nezavisno):** dedup ključ nije nosio identitet ciklusa, pa je pomjeranje roka vraćalo dnevni spam kroz koliziju sa `uq_podsjetnici_termin_dana_kanal`, uz mejl koji je već otišao prije neuspjelog `insert`-a. Cijela §2 i §5.1 su odgovor na to.

**Prihvaćeno i ugrađeno iz svih krugova:** claim-first umjesto send-first; `resend_id is null` kao stanje umjesto `catch`-delete; ciklus kao jedinica dedupa; efektivni rok umjesto golog `rok_dospijeca`; razmaknut raspored cron staza; uklanjanje post-due grane umjesto prepisivanja; glasan pad bez `RESEND_API_KEY`; firmin subject i uslovni ICS prilog; `klijenti.podsjetnik_emails` u modelu primalaca; dva `curl` koraka u GH workflow-u; `maxDuration` na novoj ruti; enum migracija imenovana tako da se sortira prva; usklađivanje `termini_view` sa efektivnim rokom; `revoke execute` i `set search_path`; sargable uslovi umjesto izraza nad kolonama; lokalni bečki datum kao ključ u `digest_slanja`; izbacivanje sekcija, cap-a i lookback upita; izbacivanje `Intl` mapiranja dana u sedmici; claim sa razlogom za kanal bez primalaca.

**Razmotreno i odbačeno:** tvrdnja da su tri PROD termina lažne uzbune — provjereno uživo, kod sva tri je i `datum_zakazan` u prošlosti. Prijedlog da se dan u sedmici izbaci u korist čistog „7 dana od zadnjeg" — odbijeno zbog drifta (§4.5). Prijedlog za eskalaciju i sekcije u digestu — odbijeno kao ceremonija na trenutnoj skali (§4.6).

**Poznata, svjesno neriješena ograničenja:** `trebaSlatiSada` je i dalje read-then-write bez atomskog claim-a za pre-due put (§8); claim sa razlogom blokira retroaktivno slanje po naknadno uključenom prekidaču (§8); digest zapisi u dnevniku mejlova vidljivi samo adminima (§8); tabele bez retencije (§8); duplikat moguć ako proces umre poslije stvarnog Resend slanja a prije upisa `resend_id` (§8).
