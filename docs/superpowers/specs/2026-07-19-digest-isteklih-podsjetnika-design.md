# Podsjetnici poslije roka: jednokratna obavijest po ciklusu + sedmični digest

**Datum:** 2026-07-19 (posljednja revizija: 2026-07-20)
**Status:** Revizija 6 — PR 1 ISPORUČEN i verifikovan na produkciji 2026-07-20; PR 2 (digest) spreman za plan
**Isporuke:** dva nezavisna PR-a (§3)
**Grane (prijedlog):** `fix/post-due-po-ciklusu`, zatim `feat/digest-isteklih`

---

## 1. Cilj / Motivacija

Post-due grana engine-a podsjetnika šalje **jedan mejl po terminu po danu, neograničeno**, na oba kanala.

Uzrok je u `20260629120000_podsjetnici_catchup_postdue.sql`: post-due upit vraća jedan red dnevno za svaki termin sa `status in ('planirano','zakazano')` i `rok_dospijeca < current_date`, a dedup ključ je `dana_prije = rok_dospijeca - current_date` — negativan broj koji se **mijenja svaki dan**, pa unique indeks `uq_podsjetnici_termin_dana_kanal (termin_id, dana_prije, kanal)` nikad ne pogodi duplikat.

**Izmjereno na PROD-u (`fqtqkehjidkzeasiegnq`):**

| Klijent | Termin | Rok | `datum_zakazan` | Status |
|---|---|---|---|---|
| CARMEUSE | `f1c285fe` | 2026-07-13 | 2026-07-15 | zakazano |
| WAIKIKI | `f453328d` | 2026-06-27 | 2026-06-27 | zakazano |
| NEW YORKER | `5520a8d5` | 2026-06-08 | 2026-06-08 | zakazano |

Pet mejlova dnevno. 63 post-due zapisa u `podsjetnici`, za **šest** termina (pored ova tri i `62cdd3a8`, `b77dc4b0`, `d8a9131f`, kojima je rok naknadno pomjeren ili je status zatvoren). `postavke`: `dana_prije = {30,14,7}`, `salji_klijentima = true`, `vrijeme_slanja_sat = 10`, `podsjetnici_aktivni = true`.

Dva problema: **šum** (dnevno ponavljanje ne mijenja ishod, a kadenca raste linearno sa brojem klijenata) i **firmin kanal** (kontakt klijenta dnevno dobija obavijest da kasni).

**Rješenje:** jedna obavijest po ciklusu na oba kanala, pa sedmični interni digest kao trajni pregled.

---

## 2. Ključni pojmovi: alarm i ciklus

Cijeli dizajn počiva na dvije definicije. Sve prethodne verzije su padale zato što ih nisu imale precizno.

> **Termin je u alarmu** kad je `status in ('planirano','zakazano')` **i** `rok_dospijeca < current_date` **i** `coalesce(datum_zakazan, rok_dospijeca) < current_date`.
>
> **Ciklus** termina u alarmu je `coalesce(datum_zakazan, rok_dospijeca)`. Termin dobija **tačno jednu** obavijest po ciklusu i po kanalu.

**Oba uslova u definiciji alarma su nužna, i tu je revizija 3 pogriješila.** Revizija 3 je tražila samo `coalesce(...) < current_date`, čime bi termin sa rokom u budućnosti i propuštenim zakazanim datumom ušao u alarm. Recenzija je našla **dva stvarna reda na DEMO-u** u tom stanju — `Drina Komerc` (rok 2026-09-01, zakazano 2026-07-05) i `Next Pixel` (rok 2027-07-04, zakazano 2026-07-13). Slati alarm za termin čiji je zakonski rok šest sedmica u budućnosti je lažna uzbuna. Sa oba uslova, takav termin čeka svoj rok.

Iz definicije ciklusa slijedi ostalo:

- Rok prođe → ciklus je `rok_dospijeca` → jedna obavijest.
- Rok se pomjeri u budućnost → termin izlazi iz alarma → tišina.
- Novi rok prođe → **novi** ciklus → nova obavijest, automatski.
- Termin se zakaže za 25.07. → `coalesce` je u budućnosti → izlazi iz alarma.
- **25.07. prođe bez zatvaranja → ciklus je sad 25.07. → obavijest se okida sama.**

Posljednja stavka pokriva ono što je recenzija nazvala najvećom operativnom rupom: propuštena *dogovorena* posjeta je jači signal od isteklog administrativnog roka, a u ranijim verzijama je dobijala slabiji tretman. Ne traži nikakvu novu mašineriju.

> **Kritična greška revizije 2, zbog koje je uveden pojam ciklusa.** Guard je bio `(p.poslat_at::date + p.dana_prije) = t.rok_dospijeca`, dakle rok se *rekonstruisao* iz zapisa, dok je unique indeks stajao na `dana_prije`. Dvije nezavisne recenzije su konstruisale isti protuprimjer na `f1c285fe`: rok se pomjeri na 01.08., 02.08. je `dana_prije = −1`, guard prolazi jer stari red rekonstruiše 13.07., mejl **odlazi**, a `insert` puca na unique sa starim redom. `runReminders.ts:134` konflikt mapira u `skip "vec poslat"`, traga nema, guard ostaje otvoren — šest dana × dva kanala = 12 mejlova.

---

## 3. Podjela na dvije isporuke

**PR 1 — „zaustavi krvarenje".** Post-due put dobija ispravnu semantiku. Post-due grana se iz `get_due_podsjetnici` **uklanja**, ne prepisuje, čime nestaje rizik od tihe regresije pre-due grane pri prekopiravanju. Efekat odmah: pet mejlova dnevno postaje nula, a pomjeranje roka ne vraća krvarenje.

**PR 2 — digest.** Sedmični pregled. Zavisi samo od PR 1.

---

## 4. Ponašanje

### 4.1 Prije roka — nepromijenjeno

Pragovi iz `postavke.dana_prije`, jedan mejl po pragu po terminu, oba kanala. Pre-due grana i tabela `podsjetnici` ostaju netaknute.

### 4.2 U alarmu

| Uslov | Interni kanal | Firmin kanal |
|---|---|---|
| Ciklus u alarmu, za taj ciklus nema završenog traga na tom kanalu | pojedinačna obavijest | pojedinačna obavijest (`rokIstekaoFirmaHtml`) |
| Ponedjeljak (ili oporavak, §4.5) | digest svih termina u alarmu za tog primaoca | — |
| Ostalo | ništa | — |

Firmin kanal poštuje postojeće prekidače: `postavke.salji_klijentima`, `klijenti.salji_podsjetnik_klijentu`, adrese iz `kontakt_osobe.podsjetnik_primalac` **i `klijenti.podsjetnik_emails`** (`recipients.ts:91-102`).

Firmin šablon je poziv na dogovor, ne opomena: bez internih dugmadi, **bez ICS priloga**, i sa **novim subject-om** `rokIstekaoFirmaSubject()`. Postojeći `reminderSubject` (`templates.ts:79-87`) se ne koristi jer za negativne dane daje „kasni N dana", dakle ton opomene koji ovaj kanal odbacuje.

### 4.3 Oba šablona prate ciklus, ne rok

Kad ciklus dolazi iz `datum_zakazan`, mejl govori o zakazanom datumu, a ne „kasni N dana" računato od roka.

**Ovo pogađa i interni šablon**, što je revizija 3 propustila. `reminderHtml` ima fiksnu labelu `t("rokDospijeca")` (`templates.ts:158`); da mu se proslijedi ciklus, za CARMEUSE bi pisalo „Rok dospijeća: 15.07." — a to je zakazani datum. Rješenje: `reminderHtml` dobija opcioni `zakazanoZa?: string`; kad je prisutan, ispisuje se dodatni red „Zakazano za" i badge računa kašnjenje od njega, dok red „Rok dospijeća" zadržava stvarni rok. Nijedan podatak se ne krivotvori.

### 4.4 Kad prestaje

Termin izlazi iz alarma i digesta kad status pređe u `izvrseno`/`otkazano`, ili kad mu rok ili `datum_zakazan` padnu u budućnost.

### 4.5 Kadenca digesta

Ponedjeljkom, po lokalnom vremenu `Europe/Vienna`; dan je konstanta u kodu. Primalac dobija digest kad je: **danas ponedjeljak**, ili **posljednji digest tom primaocu stariji od 7 dana** (oporavak).

Uz to, `trebaDigest` vraća `false` ako taj primalac za **današnji bečki datum** već ima red u stanju `poslato`, **ili** red u stanju `u_toku` mlađi od 15 minuta. Bez ikakvog dnevnog uslova bi se, pošto digest ruta nema `zadnje_slanje_datum` ekvivalent, svaki od ~14 dnevnih GH Actions okidača radio pun posao i završavao na unique konfliktu.

> **Uslov mora biti po stanju, ne po postojanju reda.** Recenzija je našla da bi „već ima red za danas" poništilo 15-minutni oporavak upravo za digest: claim zaglavljen u `u_toku` (pad slanja, smrt procesa) trajno bi vetovao digest do kraja dana, a sljedeći okidač je tek za sedmicu — dakle ista greška zbog koje je pala revizija 3, samo na drugoj tabeli.

> **Zašto ne čisto „7 dana od zadnjeg".** Recenzija je predlagala izbacivanje dana u sedmici. Odbijeno zbog **drifta**: jedan zakašnjeli ciklus trajno pomjera kadencu, pa poslije nekoliko mjeseci digest stiže četvrtkom. Sedmični izvještaj koji stiže ponedjeljkom je ritual; onaj koji klizi to nije.
>
> Argument o krhkosti (`Intl` + mapiranje ISO dana + pinovanje locale-a) je prihvaćen i riješen bez odricanja od ponedjeljka: `lokalniSatIDatum` (`gating.ts:14-29`) već vraća bečki datum kao `"2026-07-20"`, pa je dan u sedmici `new Date(datum + "T00:00:00Z").getUTCDay()` — aritmetika nad već ispravno izračunatim datumom.

### 4.6 Primaoci i sadržaj digesta

Radnik vidi termine klijenata na koje je dodijeljen, admin sve, `REMINDER_TO` adrese kao admin. Jedan mejl po osobi. Digest je **gola lista sortirana po kašnjenju silazno**, bez sekcija i bez gornje granice.

> Revizija 2 je uvodila sekcije „novo / traje duže" i cap od 100. Recenzija ih je nazvala kozmetikom: pri tri termina u alarmu to su rješenja za nepostojeći problem, uz 8-dnevni lookback upit i granu koja se na tri reda ne može smisleno testirati. Cap je uz to rezao po starosti, dakle odsjekao bi najsvježije stavke — jedine koje se još mogu spasiti.

### 4.7 Prazan digest

Primalac bez ijednog termina u alarmu ne dobija mejl i ne dobija red u `digest_slanja`.

### 4.8 Termin koji je danas dobio pojedinačnu obavijest

Ne ulazi u današnji digest: digest izostavlja termin čiji ciklus ima trag sa `poslat_at::date = current_date`.

### 4.9 Odnos prema `KASNI` bedžu u Planu aktivnosti

`termini_view.status_izvedeni` (`20260710140000:15`) računa `kasni` iz `rok_dospijeca < current_date`. **Ostaje nepromijenjen.**

Skup termina u alarmu je **podskup** onoga što Plan prikazuje kao `KASNI`: izostaju oni kojima je posjeta zakazana za budućnost. Razlika je namjerna i objašnjiva — Plan prikazuje pravni status roka, alarm prikazuje da niko ništa ne radi. `StatusBadge` (`components/domain/StatusBadge.tsx:33-42`) već uz `kasni` ispisuje „zakazano za DD.MM.", pa korisnik u Planu vidi razliku bez dodatnog rada.

> **Revizija 3 je ovdje pogriješila** i predviđala migraciju koja `termini_view` prebacuje na efektivni rok. Recenzija je pokazala: slučaj naveden kao motivacija ima **0 redova** na obje baze, dakle hipotetičan je; a obrnuti slučaj ima **2 stvarna reda na DEMO-u** i dobio bi crveni `KASNI` uz rok šest sedmica u budućnosti. Uz to migracija dira osam nepopisanih pozivalaca `status_izvedeni` (`klijenti_view.broj_kasni`, `get_termini_stats().kasni`, `obilasci/page.tsx:38-39`, tri rute plana, `klijenti/[id]/page.tsx`, `tests/e2e/db.ts:78`). Migracija je **izbačena**.

### 4.10 Efekat na trenutne podatke

Po deployu PR 1 **na PROD-u**: nula mejlova, jer migracija upisuje supresione tragove za tekući ciklus svih termina koji su trenutno u alarmu i aktivno se spamuju (§6.1). Recenzija je to verifikovala izvršavanjem RPC-a protiv živih podataka: prazan ledger vraća tri reda, sa backfillom nula. Na DEMO-u vrijedi ograda iz §6.1. Po deployu PR 2, u prvi ponedjeljak: jedan interni digest po primaocu.

---

## 5. Arhitektura

### 5.1 Post-due dobija vlastiti ledger

Nova tabela `post_due_obavijesti`, unique `(termin_id, ciklus_rok, kanal)`.

Razmatrano i odbijeno: kolona `ciklus_rok` u `podsjetnici` uz izmjenu postojećeg unique indeksa — novi indeks bi **pukao na postojećim podacima** (CARMEUSE ima 12 redova koji pripadaju istom ciklusu), pa bi migracija morala destruktivno brisati istoriju. Zasebna tabela to izbjegava; `podsjetnici` ostaje pre-due i istorijski ledger.

### 5.2 Eksplicitno stanje, ne preopterećen `resend_id`

Kolona `stanje text check (stanje in ('u_toku','poslato','preskoceno'))`.

> Revizija 3 je koristila `resend_id is null` i za „u toku" i za „namjerno nije poslato" (`razlog = 'nema_primalaca'`). Recenzija je s pravom pokazala da su ta dva značenja nespojiva: mehanizam koji recikliše zaglavljene claim-ove bi svakih 15 minuta reciklirao i one koji su namjerno preskočeni.

### 5.3 Claim-first, sa dostižnim oporavkom

Redoslijed na oba puta: **upiši claim → pošalji → označi poslato**.

Claim je jedan atomski upit koji istovremeno rezerviše i preuzima zaglavljeno. **Živi unutar SQL funkcije `claim_post_due()`, ne u TypeScriptu** (§6.7):

```sql
insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, claimed_at)
values ($1, $2, $3, 'u_toku', now())
on conflict (termin_id, ciklus_rok, kanal) do update
  set claimed_at = now()
  where post_due_obavijesti.stanje = 'u_toku'
    and post_due_obavijesti.claimed_at < now() - interval '15 minutes'
returning id;
```

Prazan `returning` znači da claim drži neko drugi (ili je posao završen) → preskoči bez slanja. Isti obrazac za `digest_slanja`, kroz `claim_digest()`.

> **Zašto funkcija, a ne upit iz TypeScripta.** Cron radi preko `createAdminSupabaseClient()`, dakle `supabase-js` → PostgREST; `pg` se u repozitoriju uvozi samo u skriptama i integracionim testovima. `.upsert()` **ne može** izraziti `on conflict do update ... where ... returning` — `ignoreDuplicates` je jedina opcija i ona bi vratila prazno i za zaglavljeni claim, čime bi oporavak opet postao nedostižan. Recenzija je to našla i provjerila da u bazi ne postoji nijedna generička `exec_sql` funkcija. Repozitorij ima presedan: `20260710120000_podsjetnik_email_atomic_rpc.sql` postoji upravo zato što se atomska operacija ne da izraziti kroz PostgREST.

**Zaglavljeni claim mora biti vidljiv RPC-u, inače je oporavak mrtvo slovo.** Ovo je bila druga kritična greška revizije 3: RPC je izbacivao svaki termin koji već ima red, pa `runPostDue` zaglavljeni claim nikad nije vidio i `update` se nikad nije izdavao — smrt procesa između upisa i slanja **trajno je gutala jedinu obavijest za taj ciklus**, bez mejla, bez traga i bez greške. Zato `treba_interni`/`treba_firma` u §6.3 nisu `not exists`, nego uključuju i „postoji red u stanju `u_toku` stariji od 15 minuta".

Cijena: ako je Resend stvarno poslao a proces umro prije upisa `poslato`, primalac dobija drugi mejl poslije 15 minuta. Svjesno biran smjer — bolje jedan duplikat nego trajno progutana jedina obavijest klijentu.

**Kanal bez primalaca dobija `stanje = 'preskoceno'`** sa razlogom, umjesto slanja. Bez toga bi RPC taj termin vraćao zauvijek — postojeće ponašanje koje danas zatrpava logove sa `skip "nema primalaca"`.

**Nemogućnost čitanja prekidača nije isto što i isključen prekidač.** Ako čitanje `postavke` padne, `runPostDue` **baca** umjesto da upiše `preskoceno`. Inače bi jedan transientni kvar trajno progutao firmin kanal za sve tekuće cikluse.

### 5.4 Tanak RPC, grupisanje u TypeScriptu

RPC-ovi vraćaju ravne liste i ne znaju ništa o primaocima; grupisanje radi TS preko `buildRecipientIndex`. Alternativa — RPC koji vraća parove `(email, termini)` — značila bi dva izvora istine za pravila o primaocima.

### 5.5 Raspored i gdje digest živi

Digest se izvršava **u postojećoj ruti `/api/cron/reminders`**, poslije `runPostDue`. Nema zasebne rute ni zasebnog cron unosa.

> **Revizija 6 — dvije pretpostavke revizije 5 su pale.** Tamo je digest dobijao vlastitu rutu `/api/cron/digest` sa vlastitim cron unosom, a serijalizaciju je trebao obezbijediti redoslijed koraka u `.github/workflows/reminders.yml`.
>
> - **Vercel plan dopušta samo dva cron posla po projektu**, i oba su zauzeta (`/api/cron/reminders` u `0 9 * * *` i `0 13 * * *` UTC). Za treći nema mjesta; pokušaj satnog crona je oborio sve buildove uz link na cron usage-and-pricing.
> - **GH workflow je obrisan 2026-07-20** jer nikad nije radio: secreti prazni, `curl` je dobijao prazan URL, a `|| true` je svaki run prijavljivao kao uspjeh.
>
> Sva tri razloga za odvajanje su u međuvremenu otpala: `postavke` se čita i za POST, gating je restrukturiran u PR-u 1, a `zadnje_slanje_datum` više ne gejtuje post-due. Ostao je samo `maxDuration` (120s), a digest je ~6 mejlova sedmično.
>
> **Dobitak:** redoslijed unutar jednog handlera je zagarantovan, pa termin koji je danas dobio pojedinačnu obavijest sigurno ne uđe u isti digest. Recenzija je to označila kao rupu upravo zato što su dvije cron staze paralelne. Uslov po ciklusu (§4.8) ostaje kao druga brana.
>
> **Cijena:** digest ima dvije prilike dnevno umjesto satnih. Za sedmični pregled nebitno — drugi run istog dana preskače jer `digest_slanja` već ima red u stanju `poslato`.

`proxy.ts:15` već ima `/api/cron` u `PUBLIC`; ruta se ne mijenja u tom pogledu.

### 5.6 Tok podataka

```
Vercel cron (0 9 i 0 13 UTC), po projektu → /api/cron/reminders, ovim redom u JEDNOM handleru:
  runReminders(): pre-due iz get_due_podsjetnici              [nepromijenjeno]
  runPostDue():   get_post_due_termine()
        po terminu i kanalu: claim → pošalji → 'poslato'
  runDigest():    get_istekli_termini(bečki danas) + loadRecipientIndex() → digestGroups()
        po primaocu: trebaDigest()? → claim → pošalji → 'poslato'
        izolovan u vlastiti try/catch — njegov pad ne smije obarati odgovor,
        jer su preDue i postDue do tada već poslali prave mejlove
```

Redoslijed nije kozmetika: `get_istekli_termini` izostavlja termin koji je danas dobio pojedinačnu obavijest, pa `runPostDue` mora prvo upisati svoje tragove.

---

## 6. Šema baze

Sve migracije idempotentne, sve na **DEMO i PROD u istom koraku** (lockstep).

### 6.1 PR 1 — `20260720120000_post_due_obavijesti.sql`

```sql
create table if not exists post_due_obavijesti (
  id          uuid        primary key default gen_random_uuid(),
  termin_id   uuid        not null references termini(id) on delete cascade,
  ciklus_rok  date        not null,
  kanal       text        not null check (kanal in ('interni','firma')),
  stanje      text        not null default 'u_toku'
                          check (stanje in ('u_toku','poslato','preskoceno')),
  razlog      text,
  claimed_at  timestamptz not null default now(),
  poslat_at   timestamptz,
  poslat_na   text[]      not null default '{}',
  resend_id   text,
  constraint uq_post_due unique (termin_id, ciklus_rok, kanal)
);

alter table post_due_obavijesti enable row level security;
```

Bez politika: piše i čita isključivo cron preko service-role klijenta, koji zaobilazi RLS. RLS je uključen da tabela ne bude otvorena kroz PostgREST. (Napomena: Supabase ima `alter default privileges ... grant all on tables to anon, authenticated, service_role` u shemi `public`, pa je nova tabela automatski grantovana — jedino je RLS bez politika štiti.)

Bez zasebnog indeksa: `uq_post_due (termin_id, ciklus_rok, kanal)` već ima prefiks `(termin_id, ciklus_rok)` i pokriva svaki upit iz §6.3 i §6.7.

**Supresioni backfill**, u istoj migraciji:

```sql
insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, razlog, poslat_at)
select t.id,
       coalesce(t.datum_zakazan, t.rok_dospijeca),
       k.kanal,
       'poslato',
       'backfill_migracija',
       max(p.poslat_at)
from termini t
cross join (values ('interni'),('firma')) as k(kanal)
join podsjetnici p on p.termin_id = t.id and p.dana_prije < 0
where t.status in ('planirano','zakazano')
  and t.rok_dospijeca < current_date
  and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date
  and p.kanal = k.kanal
  and p.poslat_at > now() - interval '14 days'
group by t.id, coalesce(t.datum_zakazan, t.rok_dospijeca), k.kanal
on conflict do nothing;
```

`p.kanal = k.kanal` je namjeran: ušutkuje se **samo kanal koji je stvarno slao**. Recenzija je našla da bi bez tog uslova NEW YORKER (`5520a8d5`, koji ima isključivo `interni` zapise) dobio i firmin supresioni trag. Danas je to benigno — tom klijentu je `salji_podsjetnik_klijentu = false`, nula flagovanih kontakata i nula ad-hoc adresa, pa bi firmin kanal ionako završio kao `preskoceno` — ali obrazac je krhak: klijent kojem je prekidač uključen juče izgubio bi svoju jedinu firminu obavijest za tekući ciklus.

> **Ovo je ispravka treće kritične greške.** Revizija 3 je backfill radila rekonstrukcijom `poslat_at::date + dana_prije`. Ta aritmetika daje **`rok_dospijeca`**, jer je stari upit upisivao `dana_prije = rok − danas` — a novi RPC traži ciklus `coalesce(datum_zakazan, rok_dospijeca)`. Recenzija je verifikovala na PROD-u: CARMEUSE (rok 13.07., zakazano 15.07.) dobio bi trag za 13.07. dok RPC traži 15.07. → **dva mejla na dan deploya**, i to na istom terminu i sa istom klasom greške (pogrešna jedinica u dedup ključu) koju §2 opisuje kao kritičan nalaz revizije 2.
>
> Nova verzija ne rekonstruiše ništa: upisuje **tekući ciklus** za termine koji su **sada u alarmu** i koji se **aktivno spamuju** (postoji post-due zapis u posljednjih 14 dana). Uslov od 14 dana je namjeran — termin koji ima samo stare tragove iz davno zatvorenog ciklusa legitimno zaslužuje svoju jednu obavijest i ne smije biti ušutkan.
>
> `on conflict do nothing` bez naziva ograničenja je validan PostgreSQL i pokriva sva unique ograničenja.

Na PROD-u ovo daje **pet** redova: tri termina × dva kanala, minus firmin kanal za NEW YORKER koji nikad nije slao. Mejlova je i dalje **nula** — NEW YORKER-ov firmin kanal ostaje otvoren, RPC ga vrati, `runPostDue` ne nađe nijednog primaoca i upiše `preskoceno` bez slanja.

**Na DEMO-u backfill daje nula redova**, jer `podsjetnici_aktivni = false` znači da tamo nema nijednog post-due zapisa, a četiri termina jesu u alarmu. GET je gejtovan prekidačem pa cron ništa neće poslati, ali prvi ručni `POST` / `pnpm reminders` bi upisao osam claim-ova i pokušao četiri interna slanja. Tvrdnja „nula mejlova" važi za PROD.

### 6.2 PR 1 — `20260720121000_get_due_bez_post_due.sql`

`get_due_podsjetnici` se vraća na **samo pre-due granu**; `union all` i post-due grana nestaju. Povratni tip nepromijenjen → `create or replace` (uspijeva jer je potpis identičan; originalna migracija je morala `drop` zbog promjene tipa).

Provjereno: pre-due dedup je `p.dana_prije >= 0 and p.dana_prije <= d.d`, dakle ignoriše negativne redove i ignoriše `kanal` — uklanjanje post-due grane ga ne dira. `chk_podsjetnici_dana_prije` (−3650..365) ostaje; 63 postojeća negativna reda ostaju validna. Jedini pozivalac funkcije je `runReminders.ts:53`.

**`tests/e2e/db.ts` i `lib/reminders/dueRpc.integration.test.ts:74`** — taj test pokriva post-due granu koju uklanjamo i **mora se obrisati**. Revizija 3 ga nije popisala.

### 6.3 PR 1 — `20260720122000_get_post_due_termine.sql`

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
  dana_do_ciklusa int,
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
      and t.rok_dospijeca < current_date
      and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date
  ),
  otvoren as (
    -- kanal je "otvoren" ako nema reda, ili je red zaglavljen u 'u_toku' > 15 min
    select ef.id as tid, ef.ciklus, kan.kanal,
           not exists (
             select 1 from post_due_obavijesti o
             where o.termin_id = ef.id and o.ciklus_rok = ef.ciklus and o.kanal = kan.kanal
               and (o.stanje in ('poslato','preskoceno')
                    or (o.stanje = 'u_toku' and o.claimed_at >= now() - interval '15 minutes'))
           ) as treba
    from ef cross join (values ('interni'),('firma')) as kan(kanal)
  )
  select ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus,
         (ef.ciklus - current_date), l.naziv,
         bool_or(o.treba) filter (where o.kanal = 'interni'),
         bool_or(o.treba) filter (where o.kanal = 'firma')
  from ef
  join klijenti k        on k.id = ef.klijent_id
  join vrste_provjera vp on vp.id = ef.vrsta_provjere_id
  left join lokacije l   on l.id = ef.lokacija_id
  join otvoren o         on o.tid = ef.id
  group by ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus, l.naziv
  having bool_or(o.treba)
  order by ef.ciklus, k.naziv;
$$;

revoke execute on function get_post_due_termine() from public, anon, authenticated;
grant  execute on function get_post_due_termine() to service_role;
```

Tri ispravke iz recenzije:

- **`revoke ... from authenticated`.** Supabase daje EXECUTE direktno roli `authenticated` kroz `alter default privileges` (potvrđeno u `pg_default_acl`, `defaclobjtype = 'f'`), pa `revoke from public, anon` ne skida ništa toj roli. Postojeća migracija `20260710140000` to zna i komentariše; revizija 3 je regresirala ispod onoga što repozitorij već zna.
- **`dana_do_ciklusa` je negativan** i vraća ga RPC, umjesto da ga TS računa iz `current_date`. SQL `current_date` je UTC, a `lokalniSatIDatum` daje bečki datum — računanje u TS-u bi u periodu 00:00–02:00 po Beču dalo off-by-one u tekstu mejla.
- **Zaglavljeni claim je uključen** u `treba_*` (§5.3), čime oporavak postaje dostižan.

`count(*) < 2` iz revizije 3 je zamijenjen `having bool_or(o.treba)` — isto značenje, ali radi i sa stanjima.

### 6.4 PR 1 — `20260720119000_mejl_tip_prosirenje.sql`

```sql
alter type mejl_tip add value if not exists 'podsjetnik_rok_istekao_interni';
alter type mejl_tip add value if not exists 'podsjetnik_rok_istekao_firma';
alter type mejl_tip add value if not exists 'podsjetnik_digest';
```

Sve tri vrijednosti odjednom u PR 1, iako se `podsjetnik_digest` koristi tek u PR 2 — da se `TIP_KEY` i `db:types` ne rade dva puta. Bez zasebnog tipa bi post-due obavijest u dnevniku bila neodvojiva od pre-due podsjetnika.

Interni post-due tip je dodat u ovoj reviziji: raniji obrazac je uvodio zaseban tip samo za firmin kanal, uz obrazloženje koje doslovno važi i za interni. Recenzija je tu asimetriju označila kao nedosljednost u vlastitom obrazloženju.

**Broj `119000` je namjerno niži** od ostalih migracija PR-a 1: `alter type ... add value` mora biti commit-ovan prije bilo čega što tu vrijednost koristi, a `scripts/apply-cloud-migration.ts:13-17` šalje fajl kao jedan `query`, dakle jednu transakciju. Revizija 2 je imala migraciju koja se po imenu sortirala zadnja a morala se primijeniti prva.

### 6.5 PR 2 — `20260721120000_digest_slanja.sql`

```sql
create table if not exists digest_slanja (
  id             uuid        primary key default gen_random_uuid(),
  primalac_email text        not null,
  datum          date        not null,
  stanje         text        not null default 'u_toku'
                             check (stanje in ('u_toku','poslato')),
  claimed_at     timestamptz not null default now(),
  poslat_at      timestamptz,
  resend_id      text,
  termin_ids     uuid[]      not null default '{}',
  constraint uq_digest_slanja unique (primalac_email, datum)
);

create index if not exists idx_digest_slanja_datum on digest_slanja (datum desc);

alter table digest_slanja enable row level security;
```

`datum` je **lokalni bečki datum** iz `lokalniSatIDatum`, ne `current_date` (UTC) — isti izvor koji koristi i `trebaDigest`. Razilaženje bi u kasnim večernjim satima dalo ključ i odluku koji pokazuju na različite dane, a PROD `vrijeme_slanja_sat = 10` znači da GH Actions okida rutu i tada.

`termin_ids` je dokazni trag: `mejl_log` bilježi *da* je digest poslat, ali ne i *šta* je u njemu pisalo, a kolona se upisuje bez ijednog dodatnog upita.

### 6.6 PR 2 — `20260721121000_get_istekli_termini.sql`

Isti `ef` filter kao §6.3 (oba uslova alarma), bez kanalskih uslova, uz `dana_do_ciklusa` negativan.

Potpis je `get_istekli_termini(p_danas date)`. Izuzima termin čiji ciklus ima trag sa `poslat_at::date = p_danas` (§4.8), gdje `p_danas` dolazi iz `lokalniSatIDatum`, dakle **bečki datum** — isti izvor koji je ključ u `digest_slanja`.

> Revizija 4 je ovdje koristila `current_date`, koji je UTC. Recenzija je našla da je to ista klasa greške koju §6.5 pažljivo izbjegava: GH Actions okida na svaki puni sat, pa bi run između 00:30 i 01:59 po Beču vidio jučerašnji UTC datum i izuzeće bi pokazivalo na pogrešan dan. Posljedica je blaga (stavka izostavljena iz jednog digesta), ali je nepotrebna.

`security invoker`, `set search_path = public`, `revoke execute from public, anon, authenticated`, `grant` samo `service_role`.

### 6.7 Claim funkcije — `20260720123000_claim_post_due.sql` (PR 1) i `20260721122000_claim_digest.sql` (PR 2)

Atomski claim iz §5.3 se ne može izraziti kroz PostgREST, pa živi u SQL funkcijama:

```sql
create or replace function claim_post_due(p_termin uuid, p_ciklus date, p_kanal text)
returns uuid
language sql
volatile
security invoker
set search_path = public
as $$
  insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, claimed_at)
  values (p_termin, p_ciklus, p_kanal, 'u_toku', now())
  on conflict (termin_id, ciklus_rok, kanal) do update
    set claimed_at = now()
    where post_due_obavijesti.stanje = 'u_toku'
      and post_due_obavijesti.claimed_at < now() - interval '15 minutes'
  returning id;
$$;

revoke execute on function claim_post_due(uuid, date, text) from public, anon, authenticated;
grant  execute on function claim_post_due(uuid, date, text) to service_role;
```

`claim_digest(p_email text, p_datum date)` je isti obrazac nad `digest_slanja`.

Funkcija vraća `null` (prazan rezultat) kad claim drži neko drugi ili je posao završen → pozivalac preskače bez slanja. Označavanje ishoda (`stanje = 'poslato'` uz `resend_id`, `poslat_at`, `poslat_na`; ili `'preskoceno'` uz `razlog`) je običan `update` po `id`-u koji je funkcija vratila, pa za to nije potrebna dodatna funkcija.

**Ponašanje pri trci**, potvrđeno u recenziji: gubitnik `insert`-a blokira na redu pobjednika, pa poslije commit-a re-evaluira `where` nad novom verzijom reda (`claimed_at = now()`) → uslov je `false` → prazan `returning`. Nema dvostrukog slanja, i nema `ON CONFLICT DO UPDATE cannot affect row a second time`, jer statement ubacuje tačno jedan red.

---

## 7. Moduli

### 7.1 PR 1

**`lib/reminders/recipients.ts`** — izdvaja se `loadRecipientIndex(supabase)`. Obuhvata **i čitanje `postavke.salji_klijentima`** (`runReminders.ts:45-51`), ne samo blok `58-85`.

> Revizija 3 je opseg opisala kao „blok `runReminders.ts:58-85`". `buildRecipientIndex` uzima peti ulaz — `saljiKlijentima` — koji dolazi iznad tog opsega. Izdvojeno doslovno kako je pisalo, `saljiKlijentima` bi ispao `false` i **firmin kanal bi bio tiho i trajno ugašen**, uz `preskoceno` claim koji po §5.3 blokira retroaktivno slanje. Jedna izostavljena linija = trajno progutan kanal.

**`lib/reminders/runPostDue.ts`** (novo) — claim-first petlja po §5.3, po terminu i kanalu; vlastita konstrukcija ICS-a i argumenata za slanje. Isti throttling obrazac i `Outcome` oblik kao `runReminders`. Baca ako `postavke` čitanje padne (§5.3).

**`lib/email/templates.ts`** — `rokIstekaoFirmaSubject()`, `rokIstekaoFirmaHtml()`, i opcioni `zakazanoZa` u `reminderHtml` (§4.3).

**`lib/reminders/runReminders.ts`** — **nepromijenjen**. Post-due grana nestaje time što je RPC više ne vraća; ICS uslovnost živi u `runPostDue`, ne ovdje. (Revizija 3 je ovdje sama sebi protivrječila: §4.2 je tražila izmjenu `runReminders.ts:154-157`, a §7.1 tvrdila da ostaje nepromijenjen.)

**`app/api/cron/reminders/route.ts`** — poziva `runPostDue` poslije `runReminders`, i **podiže `maxDuration`** sa 60 na 120 (`:12`). Postojećih 60s je dimenzionisano za `runReminders` pri punom cap-u (~50s uz throttling); dodavanje druge throttlovane petlje u isti zahtjev bi ga prekoračilo, a prekid usred slanja ostavlja zaglavljene claim-ove — oporavive, ali nepotrebno.

**`lib/email/resend.ts` / cron ruta** — **glasan pad kad `RESEND_API_KEY` nedostaje u cron kontekstu**, umjesto tihog prelaska na `drySend` (`resend.ts:25`). Na produkcijskoj instanci bi istekao ključ značio da dedup prestane raditi, a po vraćanju ključa bi prvi run poslao sve odjednom.

> Revizija 3 je kao dokaz navodila da DEMO ima 0 redova u `podsjetnici`. Recenzija je pokazala da je pravi razlog `podsjetnici_aktivni = false` (cron izlazi na `route.ts:37`). Zaključak stoji, dokaz je bio pogrešan.

**`components/domain/PoslatiMejloviTabela.tsx`** — `TIP_KEY` dobija obje nove vrijednosti; bez toga tvrdi `tsc` error (`:11-16`, `as const satisfies Record<MejlTip, string>`). Prateće labele u `messages/{sr,en,de}.json`.

**`scripts/send-reminders.ts`** — ručno okidanje post-due puta. **U PR 1**, ne u PR 2: bez toga poslije PR 1 `pnpm reminders` više ne pokriva post-due i jedini način provjere je čekanje crona.

**`lib/reminders/dueRpc.integration.test.ts`** — brisanje post-due testa (`:74`).

**`scripts/preview-emails.ts`** — novi firmin šablon i interni sa `zakazanoZa`.

### 7.2 PR 2

`digestGroups.ts` (čista funkcija), `digestCadence.ts` (`jePonedjeljak` + `trebaDigest` po §4.5), `runDigest.ts` (claim-first), `digestSubject`/`digestHtml`, poziv `runDigest` u `app/api/cron/reminders/route.ts` **poslije `runPostDue`** (§5.5), i digest u `scripts/send-reminders.ts`. **Bez** nove rute, bez novog cron unosa, bez GH workflow-a — vidi §5.5.

---

## 8. Greške i rubni slučajevi

**Izolacija** — greška kod jednog termina/kanala/primaoca ne obara ostale.

**Trka dva schedulera** — zatvorena claim-first modelom. Napomena: `trebaSlatiSada` (`gating.ts:35-43`) je i dalje read-then-write bez atomskog claim-a, a `zadnje_slanje_datum` se piše tek poslije `runReminders` (`route.ts:52-56`). To je **postojeće** ponašanje pre-due puta, nije regresija, ali znači da je tamo jedina brana unique indeks koji reaguje poslije slanja. Izvan opsega; zabilježeno.

**Smrt procesa** — pokrivena, jer zaglavljeni claim ostaje vidljiv RPC-u (§5.3, §6.3).

**Naknadno uključen firmin prekidač** — `preskoceno` claim blokira retroaktivno slanje za taj ciklus; sljedeći ciklus ga dobija normalno. Prihvaćeno ograničenje.

**Termin bez lokacije** — `left join`, red se izostavlja iz tabele.

**Vidljivost u dnevniku** — digest ide sa `termin_id = null` i `klijent_id = null`, pa ga po `mejl_log_sel` (`20260713120000:52-55`) vide samo admini, i onda kad je primalac radnik. Poznato ograničenje.

**Preklapanje sa `zakazanoNakonRoka`** — `lib/reminders/zakazanoNakonRoka.ts` šalje internu obavijest kad se termin **zakaže** poslije roka (okida se pri upisu, ne pri proteku). Ne preklapa se: ta obavijest reaguje na akciju korisnika, ova na protek vremena.

**Rast tabela** — bez retencije; na trenutnoj skali nebitno.

---

## 9. Testiranje

**Unit (bez baze i mreže):** `digestGroups` (opseg po ulozi; neaktivan i `prima_podsjetnike = false` izostaju; primalac bez termina ne postoji u mapi); `trebaDigest`/`jePonedjeljak` (ponedjeljak šalje; utorak ne ako je bio ponedjeljak; utorak šalje ako je zadnji stariji od 7 dana; drugi put istog dana ne šalje; bez `Intl` za dan u sedmici); `rokIstekaoFirmaHtml`/`Subject` (nema internih linkova, potpis iz `FirmBrand`, tekst prati ciklus); `reminderHtml` sa `zakazanoZa` (prikazuje i rok i zakazani datum, badge računa od zakazanog); `digestHtml` (escapovanje, sortiranje, negativan `danaTekst`).

**Sa lažnim `send` i mock klijentom:** claim se upisuje prije slanja; pad slanja ostavlja `u_toku`; kanal bez primalaca dobija `preskoceno`; pad čitanja `postavke` **baca** umjesto da upiše `preskoceno`; greška na jednom kanalu ne sprječava drugi.

**Integracioni (protiv DEMO cloud baze):**

- `get_post_due_termine` vraća termin tačno jednom po ciklusu i kanalu.
- **Regresija na kritičnu grešku revizije 2:** termin dobije obavijest, rok se pomjeri, opet istekne → RPC ga vrati ponovo i claim prođe, i to i kad je razlika u danima ista kao ranije.
- **Regresija na kritičnu grešku revizije 3 (oporavak):** claim u stanju `u_toku` star 20 minuta → RPC **vraća** termin i `on conflict do update` ga preuzima; isti claim star 5 minuta → RPC ga **ne vraća**. Ovaj test na dizajnu revizije 3 pada.
- **Regresija na backfill:** termin sa `datum_zakazan` različitim od roka (kao CARMEUSE) poslije migracije ima trag za **tekući ciklus** i RPC ga ne vraća.
- Termin sa rokom u budućnosti i propuštenim `datum_zakazan` (kao `Drina Komerc` na DEMO-u) **ne ulazi** u alarm.
- Termin zakazan za budućnost ne izlazi iz RPC-a; kad taj datum prođe, izlazi sa `ciklus_rok = datum_zakazan`.
- `get_istekli_termini` izuzima termin sa današnjim tragom.

**Regresija:** pre-due ponašanje bit-za-bit nepromijenjeno; tri PROD termina ne dobijaju obavijest po deployu.

**Verifikacija ide na instanci sa pravim Resend ključem.** DEMO je konfiguraciono različit (`podsjetnici_aktivni = false`, `vrijeme_slanja_sat = 23`, `dana_prije = {30,10,1,0}`) i u dry-run režimu ne upisuje ni `mejl_log` (`posaljiIzabiljezi.ts:16`).

---

## 10. Redoslijed puštanja

**PR 1:** `20260720119000` (enum) prvo i zasebno → `20260720120000` (tabela + backfill), `20260720121000` (RPC bez post-due), `20260720122000` (novi RPC), `20260720123000` (claim funkcija), DEMO pa PROD → **primjena istih migracija lokalno** → `pnpm db:types` → deploy → verifikacija na PROD-u: prvi run šalje **nula** mejlova, `post_due_obavijesti` ima pet backfill redova → kontrolna provjera poslije prvog pomjeranja roka: tačno jedna obavijest po kanalu.

**PR 2:** `20260721120000`, `20260721121000`, `20260721122000`, DEMO pa PROD → lokalna primjena → `pnpm db:types` → **E2E protiv DEMO-a tek poslije DEMO migracije** (prije nje dva testa padaju jer `get_istekli_termini` ne postoji) → deploy. **Bez novog cron unosa i bez GH workflow-a** — digest se izvršava u postojećoj ruti (§5.5). Verifikacija u prvi ponedjeljak: po jedan red u `digest_slanja` po primaocu, sa `stanje = 'poslato'`, popunjenim `resend_id` i `termin_ids`.

> **Lokalna primjena nije opcionalna.** `pnpm db:types` je `supabase gen types typescript --local` (`package.json:15`), dakle čita **lokalni** stack, ne cloud. Bez `pnpm db:reset` (ili ručne primjene istih fajlova lokalno), `db/types.ts` neće dobiti nove tabele, RPC-ove ni `mejl_tip` vrijednosti, pa `TIP_KEY ... satisfies Record<MejlTip, string>` (`PoslatiMejloviTabela.tsx:11-16`) puca u suprotnom smjeru od onog koji §7.1 opisuje. Recenzija je ovaj korak našla kao izostavljen.

---

## 11. Donesene odluke

| Pitanje | Odluka | Zašto |
|---|---|---|
| Kad je termin u alarmu | `rok < danas` **i** `coalesce(datum_zakazan, rok) < danas` | Samo drugi uslov bi slao alarm za termin čiji je rok šest sedmica u budućnosti (2 stvarna reda na DEMO-u) |
| Jedinica deduplikacije | Ciklus = `coalesce(datum_zakazan, rok)` | Dedup ključ mora nositi identitet ciklusa |
| Gdje živi post-due trag | Nova tabela `post_due_obavijesti` | Kolona u `podsjetnici` bi tražila unique koji puca na postojećim podacima |
| Stanje claim-a | Eksplicitna kolona `stanje` | `resend_id is null` ne može značiti i „u toku" i „namjerno preskočeno" |
| Oporavak zaglavljenog claim-a | RPC ga mora vidjeti | Inače je `update ... claimed_at < now() - 15 min` nedostižan i obavijest se trajno gubi |
| Backfill | Tekući ciklus za termine koji se aktivno spamuju | Rekonstrukcija `poslat_at + dana_prije` daje rok, ne ciklus → CARMEUSE bi poslao dva mejla |
| `termini_view` | **Ostaje nepromijenjen** | Izmjena bi uvela lažni `KASNI` za rok u budućnosti i dirala 8 pozivalaca |
| Serijalizacija dva puta | Redoslijed koraka u GH workflow-u | Zimi su oba Vercel crona mrtva zbog `vrijeme_slanja_sat = 10` |
| Kadenca digesta | Ponedjeljak + oporavak na 7 dana + „ne dvaput istog dana" | Čisto „7 dana od zadnjeg" drifta; ritual ima vrijednost |
| Sadržaj digesta | Gola lista po kašnjenju | Sekcije i cap su ceremonija na tri stavke; cap je rezao najsvježije |
| Firmin kanal poslije roka | Jedna obavijest po ciklusu, iza postojećih prekidača | Pisani trag štiti izvođača; šum je dolazio od ponavljanja |
| Grantovi na RPC | `revoke ... from public, anon, authenticated` | Supabase daje EXECUTE direktno `authenticated` roli |
| Opseg | Dva PR-a | PR 1 gasi pet mejlova dnevno i stoji sam |

---

## 12. Trag recenzija

Šest nezavisnih recenzija bez konteksta razgovora u kojem je dokument nastao: dvije na reviziju 1, dvije na reviziju 2, jedna na reviziju 3, jedna na reviziju 4. Posljednje tri su imale read-only pristup živoj bazi; posljednja je RPC iz §6.3 **izvršila** protiv PROD podataka (prazan ledger → tri reda, sa backfillom → nula) umjesto da ga samo pročita.

**Nalazi šeste recenzije, ugrađeni u ovu verziju:** claim se ne može izraziti kroz PostgREST → uvedene funkcije `claim_post_due` / `claim_digest` (§6.7); `trebaDigest` mora gledati stanje, ne postojanje reda, inače zaglavljeni claim guta digest cijelu sedmicu (§4.5); `pnpm db:types` traži prethodnu lokalnu primjenu migracija (§10); `maxDuration` podignut na 120 (§7.1); backfill ušutkuje samo kanal koji je stvarno slao (§6.1); `get_istekli_termini` prima bečki datum umjesto `current_date` (§6.6); zaseban `mejl_tip` i za interni post-due (§6.4); izbačen redundantan indeks (§6.1); razriješena protivrječnost oko firminog subject-a (§4.2); ograda da „nula mejlova" važi za PROD, ne za DEMO (§6.1).

**Tri kritična nalaza, svaki je oborio po jednu verziju:**

1. *(revizija 2, našle dvije recenzije nezavisno)* Dedup ključ nije nosio identitet ciklusa → pomjeranje roka vraća dnevni spam kroz koliziju sa `uq_podsjetnici_termin_dana_kanal`, uz mejl koji je otišao prije neuspjelog `insert`-a.
2. *(revizija 3)* Oporavak zaglavljenog claim-a je bio nedostižan, jer ga RPC nije vraćao → smrt procesa trajno guta jedinu obavijest za ciklus.
3. *(revizija 3)* Backfill je rekonstruisao rok umjesto ciklusa → CARMEUSE bi poslao dva mejla na dan deploya, na istom terminu i sa istom klasom greške kao nalaz 1.

**Prihvaćeno i ugrađeno iz svih krugova:** ciklus kao jedinica dedupa; oba uslova u definiciji alarma; claim-first umjesto send-first; eksplicitno `stanje`; zaglavljeni claim vidljiv RPC-u; supresioni backfill bez rekonstrukcije; `termini_view` netaknut; `revoke` i od `authenticated`; `dana_do_ciklusa` iz RPC-a a ne iz TS-a; `saljiKlijentima` u `loadRecipientIndex`; ciklus-svjestan interni šablon; `runReminders` netaknut; redoslijed koraka u GH workflow-u kao serijalizacija; `scripts/send-reminders.ts` u PR 1; brisanje post-due integracionog testa; glasan pad bez `RESEND_API_KEY`; „ne dvaput istog dana" u `trebaDigest`; uklanjanje post-due grane umjesto prepisivanja; enum migracija imenovana da se sortira prva; `set search_path`; sargable uslovi; lokalni bečki datum kao ključ; izbacivanje sekcija, cap-a i `Intl` mapiranja.

**Razmotreno i odbačeno:** tvrdnja da su tri PROD termina lažne uzbune (provjereno — kod sva tri je i `datum_zakazan` u prošlosti); čisto „7 dana od zadnjeg" umjesto ponedjeljka (drift); eskalacija i sekcije u digestu (ceremonija na trenutnoj skali).

**Poznata, svjesno neriješena ograničenja:** `trebaSlatiSada` je i dalje read-then-write za pre-due put; `preskoceno` claim blokira retroaktivno slanje po naknadno uključenom prekidaču; digest zapisi u dnevniku vidljivi samo adminima; tabele bez retencije; duplikat moguć ako proces umre poslije stvarnog Resend slanja a prije upisa `poslato`.
