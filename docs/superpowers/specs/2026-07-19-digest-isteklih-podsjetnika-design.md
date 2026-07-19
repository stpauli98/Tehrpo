# Podsjetnici poslije roka: jednokratna obavijest + sedmični digest

**Datum:** 2026-07-19
**Status:** Odobren dizajn, revizija 2 (nakon dvije nezavisne recenzije) — spreman za plan implementacije
**Isporuke:** dva nezavisna PR-a (§2)
**Grane (prijedlog):** `fix/post-due-jednokratno`, zatim `feat/digest-isteklih`

---

## 1. Cilj / Motivacija

Post-due grana engine-a podsjetnika šalje **jedan mejl po terminu po danu, neograničeno**, i to na oba kanala.

Uzrok je u `supabase/migrations/20260629120000_podsjetnici_catchup_postdue.sql`. Post-due upit vraća jedan red dnevno za svaki termin sa `status in ('planirano','zakazano')` i `rok_dospijeca < current_date`. Ključ za deduplikaciju je `dana_prije = rok_dospijeca - current_date`, dakle negativan broj koji se **mijenja svaki dan**, pa jedinstveni indeks `uq_podsjetnici_termin_dana_kanal (termin_id, dana_prije, kanal)` nikad ne pogodi duplikat. Zaustavlja ga samo promjena statusa u `izvrseno`/`otkazano`, pomjeranje roka, ili `chk_podsjetnici_dana_prije` na −3650 (deset godina).

**Izmjereno stanje na PROD-u (`fqtqkehjidkzeasiegnq`, 2026-07-19):**

| Klijent | Vrsta | Rok | `datum_zakazan` | Status | Kašnjenje |
|---|---|---|---|---|---|
| CARMEUSE | Obilazak | 2026-07-13 | 2026-07-15 | zakazano | 6 dana |
| WAIKIKI | Ispitivanje hidranata | 2026-06-27 | 2026-06-27 | zakazano | 22 dana |
| NEW YORKER | Obilazak | 2026-06-08 | 2026-06-08 | zakazano | 41 dan |

Tri termina proizvode **pet mejlova dnevno** (tri interna + dva firmina; NEW YORKER nema kontakt sa `podsjetnik_primalac`). U tabeli `podsjetnici` je već 63 post-due zapisa.

Bitno za dizajn: **kod sva tri termina je i `datum_zakazan` u prošlosti** — dakle nisu lažne uzbune, termin je bio zakazan i taj datum je prošao bez zatvaranja. Ali slučaj „rok prošao, a termin zakazan za sljedeću sedmicu" postoji u modelu podataka i mora se razlikovati (§3.4).

Dva odvojena problema:

1. **Šum.** Dnevno ponavljanje ne mijenja ishod — mijenja ga promjena statusa ili novi dogovor. Ponavljanje samo uči primaoca da ignoriše pošiljaoca. Kadenca je per-item pa raste linearno: 50 zakašnjelih termina = 50 mejlova dnevno.
2. **Firmin kanal.** `salji_klijentima = true` na PROD-u, pa kontakt klijenta dnevno dobija obavijest da kasni — vanjska komunikacija bez ograničenja.

**Rješenje.** Poslije roka: jedna obavijest po terminu, na oba kanala (interni sa dugmadima, firmin sa pozivom na dogovor), pa sedmični interni digest kao trajni pregled stanja.

> **Revizija 2, odluka o firminom kanalu.** Prva verzija ovog dizajna je firmin kanal poslije roka gasila potpuno, uz obrazloženje da dnevna opomena klijentu pravi pisani trag o propustu. Recenzija je pokazala da je argument **okrenut naopako**: kod ZNR/ZOP rokova zakonski obveznik je klijent, a TEHPRO je izvođač — pisani trag da je izvođač obavijestio klijenta štiti izvođača, dok ćutanje prebacuje odgovornost na njega („znali ste i niste nam rekli"). Šum nije dolazio od toga *što* je klijent obaviješten, nego što je obaviješten 41 put. Prihvaćeno: klijent dobija **tačno jednu** obavijest poslije roka, iza postojećih prekidača. Dodatni argument: uz PROD pragove `{30,14,7}` (bez praga 0), bez ove obavijesti posljednje što klijent ikad čuje jeste sedam dana **prije** roka.

---

## 2. Podjela na dvije isporuke

Recenzija je opseg ocijenila prevelikim za jedan PR, i §9 prve verzije je to sam pokazivao — dva koraka verifikacije sa različitim rizikom i različitim trenutkom. Podjela:

### PR 1 — „zaustavi krvarenje"

Jedna migracija (`create or replace` jedne funkcije), jedan novi šablon mejla, izmjena u `runReminders`, regresioni testovi. **Bez nove tabele, bez novog RPC-a, bez enum vrijednosti, bez regeneracije `db/types.ts`.**

Efekat odmah po deployu: pet mejlova dnevno postaje nula. Potpuno reverzibilno (`create or replace` nazad na staru definiciju).

### PR 2 — digest

Sve ostalo. Ne zavisi ni od čega osim od PR 1, i nema vremenskog pritiska.

Ovaj dokument opisuje obje isporuke; svaki PR dobija svoj plan implementacije.

---

## 3. Ponašanje

### 3.1 Prije roka — nepromijenjeno

Pragovi iz `postavke.dana_prije` (PROD: `{30,14,7}`), jedan mejl po pragu po terminu, oba kanala. Bit-za-bit isto ponašanje kao danas.

### 3.2 Poslije roka

| Uslov | Interni kanal | Firmin kanal |
|---|---|---|
| Prvi run u kojem je termin istekao za **tekući** rok | pojedinačni mejl (`reminderHtml`, postojeći) | pojedinačna obavijest (`rokIstekaoFirmaHtml`, novi šablon) |
| Ponedjeljak (ili oporavak, §3.6) | digest svih isteklih termina primaoca | — |
| Svi ostali dani | ništa | — |

Firmin kanal i dalje poštuje postojeća dva prekidača: `postavke.salji_klijentima` i `klijenti.salji_podsjetnik_klijentu`, plus `kontakt_osobe.podsjetnik_primalac` za izbor adresa. Nijedan novi prekidač se ne uvodi.

Novi firmin šablon nije opomena nego poziv na dogovor: rok je istekao, javite se da dogovorimo termin. Bez internih dugmadi, bez ICS priloga, brend iz `FirmBrand` — isto kao postojeći `reminderHtmlFirma`.

### 3.3 Uslov za jednokratnu obavijest

Namjerno **nije** `current_date - rok_dospijeca = 1`. Vezivanje za tačno `−1` znači da jedan propušten run (ispad, ugašen `podsjetnici_aktivni` preko vikenda) trajno proguta obavijest.

Uslov je „prvi put kad primijetimo da je istekao **za tekući rok**":

```sql
and not exists (
  select 1 from podsjetnici p
  where p.termin_id = t.id
    and p.dana_prije < 0
    and (p.poslat_at::date + p.dana_prije) = t.rok_dospijeca
)
```

Izraz `poslat_at::date + dana_prije` rekonstruiše rok za koji je taj post-due zapis poslat: red je upisan na dan `D` sa `dana_prije = rok − D`, pa je `D + dana_prije = rok`. Time se rješava scenario koji je recenzija našla: termin istekne → dobije obavijest → rok se pomjeri u budućnost → **opet** istekne. Sa naivnim uslovom (`p.dana_prije < 0` ikad) drugo isticanje nikad ne bi okinulo obavijest, a pomjeranje roka je uobičajena reakcija na prvu obavijest.

`poslat_at::date` se računa u sesijskoj zoni (UTC na Supabase-u). Slanje se dešava oko 08:00 UTC, daleko od ponoći, pa nema graničnog slučaja.

**Guard je na nivou termina, ne kanala.** Ako je u trenutku prve obavijesti firmin kanal bio isključen, naknadno uključivanje neće retroaktivno poslati obavijest za taj rok. Prihvaćeno ograničenje; alternativa bi tražila da RPC vraća redove po kanalu.

**Posljedica na postojećim podacima, i to poželjna:** sva tri PROD termina već imaju post-due zapise čiji rekonstruisani rok odgovara tekućem `rok_dospijeca`, pa po deployu **neće** dobiti obavijest — samo ulaze u prvi digest. Bez ovog uslova bi sva tri odmah okinula poštu na oba kanala.

> **Ograničenje u dry-run okruženjima.** `runReminders.ts:129` vraća **prije** upisa u `podsjetnici` kad je `res.dryRun`, a `sendEmail` postaje `drySend` kad nema `RESEND_API_KEY` (`lib/email/resend.ts:25`). Na takvoj instanci (DEMO) trag se nikad ne upisuje, pa je `not exists` vječito istinit i „jednokratna" obavijest se okida svaki dan. Mejl fizički ne odlazi, ali logovi to prikazuju kao slanje. **Verifikacija iz §8 mora se raditi na instanci sa pravim Resend ključem**, inače daje lažno negativan rezultat. Isto vrijedi za termin čije je slanje ikad puklo Resend greškom — on nema trag i dobiće obavijest.

### 3.4 Termin zakazan za budućnost

Termin sa `rok_dospijeca < current_date` ali `datum_zakazan >= current_date` **nije alarm** — rok je formalno prošao, ali je posjeta dogovorena. Takav termin:

- **ne dobija** jednokratnu obavijest ni na jednom kanalu,
- **ne ulazi** u digest.

Uslov u oba upita: `and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date`. Ovo je ista semantika kao postojeći `datum_prikaza` iz `20260710140000_datum_prikaza_i_zakazano_obavijest.sql`.

### 3.5 Kad prestaje

Termin nestaje iz digesta kad mu status pređe u `izvrseno`/`otkazano`, kad mu se rok pomjeri u budućnost, ili kad dobije `datum_zakazan` u budućnosti (§3.4). Nema gornje granice po broju slanja.

Da digest ne bi postao statičan — recenzija je s pravom primijetila da lista koja se sedmicama ne mijenja prestaje da se otvara — digest se dijeli u dvije sekcije: **„Novo ove sedmice"** (termini koji nisu bili u prethodnom digestu tom primaocu) i **„Traje duže"**, uz brojač u naslovu. Podatak za razliku dolazi iz `digest_slanja.termin_ids` prethodnog reda tog primaoca.

### 3.6 Kadenca digesta i oporavak

Digest se šalje **ponedjeljkom**, po lokalnom vremenu `Europe/Vienna`. Dan je konstanta u kodu, nije podesiv.

> **Revizija 2.** Prva verzija je uvodila `postavke.digest_dan_u_sedmici` + formu u Postavkama + server akciju + E2E test. Recenzija je to označila kao jedini pravi YAGNI prekršaj u dokumentu — oko 30% opsega, za podešavanje koje se vjerovatno nikad neće dirati. Prihvaćeno: konstanta. Migracija, kolona, forma i E2E test otpadaju.

Primalac dobija digest kad je ispunjeno **bilo koje** od:

- danas je ponedjeljak, **ili**
- posljednji digest tom primaocu je stariji od 7 dana (oporavak).

Drugi uslov postoji jer bi inače jedan propušten ponedjeljak (ispad Vercela, ugašen `podsjetnici_aktivni`, greška kod tog primaoca) progutao digest cijelu sedmicu. To je ista greška koju §3.3 svjesno izbjegava za jednokratnu obavijest, i recenzija je s pravom prigovorila što je prva verzija ponovo uvodi.

### 3.7 Primaoci i opseg sadržaja

Isti model kao postojeći interni kanal: za svakog eligibilnog primaoca (`aktivan and prima_podsjetnike`) sastavlja se njegova lista.

- Radnik: istekli termini klijenata na koje je dodijeljen preko `korisnik_klijent`.
- Admin: svi istekli termini.
- `REMINDER_TO` adrese iz env-a: ponašaju se kao admin, isto kao u `recipientsForKlijent` danas.

Jedan mejl po osobi. Sa današnjih ~6 primalaca to je ~6 mejlova sedmično naspram trenutnih ~35 sedmično.

### 3.8 Prazan digest

Primalac bez ijednog isteklog termina ne dobija mejl i ne dobija red u `digest_slanja`.

### 3.9 Termin koji je danas dobio jednokratnu obavijest

Ne ulazi u današnji digest — inače bi termin koji istekne baš u ponedjeljak dobio i pojedinačni mejl i red u digestu istog dana (vjerovatnoća 1/7 po terminu, dakle sigurno u prvom mjesecu). Uslov u `get_istekli_termini`:

```sql
and not exists (
  select 1 from podsjetnici p
  where p.termin_id = t.id and p.dana_prije < 0 and p.poslat_at::date = current_date
)
```

### 3.10 Gornja granica stavki u digestu

Digest nosi najviše **100** stavki, sortiranih po kašnjenju silazno. Ako ih ima više, na dnu stoji red „i još N termina — otvori Plan aktivnosti". `runReminders` već ima `REMINDER_MAX_PER_RUN`; digest bez ekvivalenta bi na 300 isteklih termina proizveo mejl koji niko ne otvara.

### 3.11 Efekat na trenutne podatke

Po deployu PR 1: **nula mejlova umjesto pet**, odmah. Po deployu PR 2, u prvi ponedjeljak: jedan interni digest sa tri reda po primaocu, svi u sekciji „Traje duže".

---

## 4. Arhitektura

Odabran je pristup **tanak RPC + grupisanje u TypeScriptu**.

`get_istekli_termini()` vraća ravnu listu isteklih termina i **ne zna ništa o primaocima**. Grupisanje po primaocu radi TS, preko postojećeg `buildRecipientIndex` iz `lib/reminders/recipients.ts`.

Odbijena alternativa: RPC koji odmah vraća parove `(email, termini)`. Značila bi da pravila „ko je eligibilan primalac" postoje i u TS-u i u SQL-u — dva izvora istine za pravilo koje se sigurno mijenja.

Odbijena alternativa: bez RPC-a, filtriranje kroz PostgREST u TS-u. Duplirala bi definiciju „istekao".

### 4.1 Digest ide u zasebnu rutu

`POST|GET /api/cron/digest`, odvojeno od `/api/cron/reminders`. Tri razloga, sva tri iz recenzije:

1. **`maxDuration = 60`** (`route.ts:12`) već je tijesan — komentar u kodu kaže da `runReminders` sam može trajati ~50s pri punom cap-u. Dodavanje digesta sa vlastitim batchingom u isti zahtjev gura ka 504, a prekid usred `runDigest` znači poslane mejlove bez traga.
2. **`postavke` se čita unutar `if (req.method === "GET")`** (`route.ts:32-36`), pa ručni POST nema odakle pročitati stanje. Zasebna ruta ima vlastiti, jednostavniji gating.
3. **`zadnje_slanje_datum` ostaje netaknut.** Idempotencija digesta počiva isključivo na `digest_slanja`, bez uplitanja u marker koji služi drugoj svrsi. Time nestaje kontradikcija koju je recenzija našla u §7 prve verzije.

Nova ruta se dodaje u `vercel.json` (`"schedule": "0 8 * * *"`) i kao korak u `.github/workflows/reminders.yml`, uz isti `CRON_SECRET`. Gating rute: `podsjetnici_aktivni` + `vrijeme_slanja_sat` (isti kao postojeći), bez `zadnje_slanje_datum`.

### 4.2 Tok podataka jednog digest run-a

```
cron → /api/cron/digest
  → gating: CRON_SECRET, podsjetnici_aktivni, vrijeme_slanja_sat
  → rpc get_istekli_termini()
  → loadRecipientIndex(supabase)                 [izdvojeno, dijeli se sa runReminders]
  → digestGroups(termini, index, base) → Map<email, red[]>
  → digest_slanja: jedan select za posljednjih 8 dana → tko je posluzen, i sta je bio prosli sadrzaj
  → po primaocu, ako treba slati (§3.6):
        insert digest_slanja (unique = brava)    ← PRVO
        posaljiIzabiljezi(...)                   ← PA SLANJE
        update digest_slanja set resend_id       ← PA TRAG
```

**Redoslijed „prvo upiši, pa pošalji" je obavezan.** Recenzija je našla konkretnu trku: postoje **dva** schedulera (`vercel.json` `crons` i `.github/workflows/reminders.yml` na `0 * * * *`), koji u 08:00 UTC pale istu rutu skoro istovremeno. Sa redoslijedom „pošalji pa upiši", oba run-a nađu prazan `digest_slanja`, oba pošalju, a unique hvata tek drugi INSERT — kad su mejlovi već vani. Sa insert-first, drugi run puca na unique **prije** slanja i uredno preskače.

Cijena: ako slanje padne poslije uspješnog inserta, red ostaje bez `resend_id`. Zato se pri padu slanja **red briše** u `catch` grani, čime se digest vraća u red za sljedeći pokušaj. Ako i brisanje padne, primalac gubi taj digest do sljedećeg ponedjeljka — prihvatljivo, jer je alternativa duplirani mejl.

---

## 5. Šema baze

Sve migracije su idempotentne (`if not exists` / `or replace` / DO-guard) i idu na **DEMO i PROD u istom koraku** po lockstep pravilu.

### 5.1 PR 1 — `20260719120000_post_due_jednokratno.sql`

Zamjenjuje `get_due_podsjetnici` u cjelini. Povratni tip je identičan, pa je `create or replace` dovoljan (bez `drop`).

> **Napomena za implementaciju:** migracija mora sadržavati **cijelo tijelo funkcije**, sa pre-due granom prekopiranom doslovno iz `20260629120000_podsjetnici_catchup_postdue.sql`. Recenzija je s pravom upozorila da davanje samo `where` fragmenta poziva na tihu regresiju pre-due grane.

Izmjene u odnosu na postojeću definiciju, isključivo u post-due grani:

```sql
    where t.status in ('planirano','zakazano')
      and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date   -- §3.4
      and not exists (
        select 1 from podsjetnici p
        where p.termin_id = t.id
          and p.dana_prije < 0
          and (p.poslat_at::date + p.dana_prije) = t.rok_dospijeca    -- §3.3
      )
```

Pre-due grana ostaje nepromijenjena, uključujući `t.rok_dospijeca >= current_date`.

### 5.2 PR 2 — `20260720120000_digest_slanja.sql`

```sql
create table if not exists digest_slanja (
  id             uuid        primary key default gen_random_uuid(),
  primalac_email text        not null,
  datum          date        not null,
  poslat_at      timestamptz not null default now(),
  resend_id      text,
  termin_ids     uuid[]      not null default '{}',
  constraint uq_digest_slanja unique (primalac_email, datum)
);

create index if not exists idx_digest_slanja_datum on digest_slanja (datum desc);

alter table digest_slanja enable row level security;
```

`termin_ids` umjesto pukog brojača: nosi *šta* je bilo u digestu, što je potrebno za razliku „novo ove sedmice" (§3.5) i za dokazni trag ko je o čemu obaviješten. Recenzija je oboje tražila.

Bez `grant select to authenticated` i bez SELECT politike — nijedan UI ne čita ovu tabelu, pa bi grant bio mrtav kod. Piše i čita isključivo cron preko service-role klijenta (`createAdminSupabaseClient`), koji zaobilazi RLS. RLS je uključen da tabela ne bude otvorena kroz PostgREST.

`primalac_email` se upisuje u lowercase — `assembleRecipients` već vraća lowercase, pa je unique ključ stabilan.

### 5.3 PR 2 — `20260720121000_get_istekli_termini.sql`

```sql
create or replace function get_istekli_termini()
returns table (
  termin_id      uuid,
  klijent_id     uuid,
  klijent_naziv  text,
  vrsta_naziv    text,
  rok_dospijeca  date,
  lokacija_naziv text,
  dana_do_roka   int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.id, k.id, k.naziv, vp.naziv, t.rok_dospijeca, l.naziv,
    (t.rok_dospijeca - current_date)
  from termini t
  join klijenti k        on k.id = t.klijent_id
  join vrste_provjera vp on vp.id = t.vrsta_provjere_id
  left join lokacije l   on l.id = t.lokacija_id
  where t.status in ('planirano','zakazano')
    and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date
    and not exists (
      select 1 from podsjetnici p
      where p.termin_id = t.id and p.dana_prije < 0 and p.poslat_at::date = current_date
    )
  order by t.rok_dospijeca, k.naziv;
$$;

revoke execute on function get_istekli_termini() from public, anon;
grant execute on function get_istekli_termini() to authenticated, service_role;
```

Tri ispravke koje je recenzija tražila:

- **`dana_do_roka` je negativan** (`rok − current_date`), ne pozitivan „dana_kasni". `danaTekst` (`lib/email/templates.ts:70-75`) očekuje negativan broj za kašnjenje; sa pozitivnim bi digest za termin koji kasni 41 dan ispisao „za 41 dan". Naziv kolone je usklađen sa `get_due_podsjetnici`.
- **`set search_path = public`** — bez toga Supabase advisor prijavljuje `function_search_path_mutable`, a sve novije funkcije u repou (`zabiljezi_mejl_log`, `get_poslati_mejlovi`, `get_mejl_greske_broj`) to imaju.
- **`revoke execute … from public`** — Postgres podrazumijevano izlaže funkciju kroz PostgREST i `anon`. RLS je štiti (security invoker), ali `20260713120000_mejl_log.sql:97-100` eksplicitno radi revoke i odstupanje bi bilo nedosljedno.

### 5.4 PR 2 — `20260720122000_mejl_tip_digest.sql`

```sql
alter type mejl_tip add value if not exists 'podsjetnik_digest';
```

**Zasebna migracija, i mora se primijeniti prije deploya koda.** `scripts/apply-cloud-migration.ts` šalje cijeli fajl kao jedan `client.query`, dakle implicitnu transakciju, a nova enum vrijednost se u Postgresu ne smije koristiti u istoj transakciji u kojoj je dodata.

---

## 6. Moduli

### 6.1 PR 1

**`lib/email/templates.ts`** — novi `rokIstekaoFirmaSubject()` i `rokIstekaoFirmaHtml()`. Koriste postojeće `layoutOmot`, `badge`, `poljeRed`, `escapeHtml`, `danaTekst` i `FirmBrand`, kao `reminderHtmlFirma`. Tekst je poziv na dogovor, ne opomena. Bez internih dugmadi.

**`lib/reminders/runReminders.ts`** — jedna izmjena: kad je `dana_do_roka < 0`, firmin kanal koristi novi šablon umjesto `reminderHtmlFirma`. Interni kanal netaknut. Nema izmjena u logici primalaca ni u dedup upisu.

**`messages/{sr,en,de}.json`** — poruke pod `email.rokIstekaoFirma`. Njemački sa napomenom da čeka native review, kao i ostatak projekta.

**`scripts/preview-emails.ts`** — primjer novog firminog šablona.

### 6.2 PR 2

**`lib/reminders/recipients.ts`** — izdvaja se `loadRecipientIndex(supabase): Promise<{ index: RecipientIndex; base: string[] }>`, tj. blok `runReminders.ts:58-85` (četiri PostgREST upita + `parseEmailList(env.REMINDER_TO)` + `buildRecipientIndex`). `runReminders` i `runDigest` ga oba zovu.

> Recenzija je našla da bi bez ovog koraka `runDigest` prekopirao ~30 linija I/O logike, udvostručio broj upita po run-u i otvorio mogućnost da dva modula vide različit snapshot dodjela. Ovo je jedina izmjena postojećeg koda koja nije striktno nužna za funkciju, i uključena je jer bez nje digest uvodi dupliranje koje §4 tvrdi da izbjegava.

**`lib/reminders/digestGroups.ts`** — čista funkcija, nula I/O:

```ts
export type IstekliRed = {
  terminId: string; klijentId: string; klijentNaziv: string
  vrstaNaziv: string; rokDospijeca: string; lokacijaNaziv: string | null; danaDoRoka: number
}
export function digestGroups(
  termini: IstekliRed[], index: RecipientIndex, base: string[],
): Map<string, IstekliRed[]>
```

Oslanja se na `recipientsForKlijent(index, klijentId, base)` za svaki termin, pa su pravila opsega doslovno ista kao za pojedinačni interni mejl.

**`lib/reminders/digestCadence.ts`** — dvije čiste funkcije: `jePonedjeljak(now, tz)` i `trebaDigest(zadnjiDatum: string | null, now: Date, tz): boolean`, koja implementira pravilo iz §3.6. Dan u sedmici se dobija preko `Intl.DateTimeFormat(..., { weekday: "short" })` sa **fiksnim locale-om `en-GB`** i mapom na ISO broj — ne preko lokalizovanog stringa, koji zavisi od jezika i očekivano je mjesto za bug.

**`lib/reminders/runDigest.ts`** — orkestracija po §4.2. Isti throttling obrazac kao `runReminders` (grupe, pauza), isti `Outcome` oblik rezultata.

**`digestSubject()` / `digestHtml()`** u `lib/email/templates.ts` — dvije sekcije („Novo ove sedmice", „Traje duže"), tabela po stavci, dugme „Otvori plan aktivnosti", cap od 100 stavki sa repom „i još N". Bez ICS priloga — prilog ima smisla za jedan termin, ne za listu.

**`app/api/cron/digest/route.ts`** — nova ruta (§4.1).

**`components/domain/PoslatiMejloviTabela.tsx`** — `TIP_KEY` dobija `podsjetnik_digest`. Bez ovoga je **tvrdi `tsc` error**, jer je objekat `as const satisfies Record<MejlTip, string>` (`:16`). Prateće labele u `messages/{sr,en,de}.json` za filter dnevnika.

**`scripts/send-reminders.ts`** — dodaje se ručno okidanje digesta, inače se verifikacija svodi na čekanje ponedjeljka.

**`vercel.json`, `.github/workflows/reminders.yml`** — nova cron staza.

---

## 7. Greške i rubni slučajevi

**Izolacija po primaocu.** Greška kod jednog primaoca ne obara ostale — `Outcome` obrazac (`sent`/`skip`/`err`) iz `runReminders`, sa zbirnim izvještajem u JSON odgovoru.

**Idempotencija digesta počiva isključivo na `digest_slanja`,** uz insert-first redoslijed (§4.2) koji zatvara trku između dva schedulera. Digest ne dira `postavke.zadnje_slanje_datum`.

**Neuspjeh slanja poslije uspješnog inserta** → red se briše u `catch` grani, digest se vraća u red. Ako i brisanje padne, primalac gubi taj digest do oporavka po §3.6 (najviše 7 dana).

**Propušten ponedjeljak** → oporavak po §3.6, po primaocu, bez ručne intervencije.

**Zona.** Dan u sedmici se računa u `Europe/Vienna` preko `Intl` sa fiksnim `en-GB` locale-om, **ne** preko `current_date` u bazi (UTC). Da se pomiješa, digest bi ponedjeljkom u 00:30 po Beču mislio da je nedjelja.

**Termin bez lokacije** — `left join`, `lokacija_naziv` može biti `null`, red se izostavlja iz tabele kao u `reminderHtml`.

**Termin bez eligibilnih primalaca** — `runReminders` vraća `skip "nema primalaca"` i **ne upisuje** red u `podsjetnici`, pa ga `get_due_podsjetnici` vraća svaki dan. Ne šalje se nijedan mejl, ali red se beskonačno pojavljuje u rezultatu run-a. Postojeće ponašanje, nije regresija; dokumentovano jer je zbunjujuće u logovima.

**Vidljivost u dnevniku mejlova.** Digest pokriva više klijenata, pa u `mejl_log` ide sa `termin_id = null` i `klijent_id = null`. RLS politika `mejl_log_sel` (`20260713120000_mejl_log.sql:52-55`) daje pristup preko `je_admin()` ili `ima_pristup_klijentu(klijent_id)`, pa **digest zapise u dnevniku vide samo admini** — i onda kad je primalac digesta radnik. Prihvaćeno kao poznato ograničenje: digest je više-klijentski artefakt i ne pripada nijednom pojedinačnom klijentu. Ako zasmeta, rješenje je proširenje `mejl_log_sel` na `auth.email() = any(primaoci)`, van opsega ovdje.

---

## 8. Testiranje

**Unit (bez baze i mreže) — tu je težina:**

- `digestGroups`: radnik dobija samo istekle termine svojih klijenata; admin sve; `REMINDER_TO` base se ponaša kao admin; neaktivan korisnik i `prima_podsjetnike = false` se ne pojavljuju; primalac bez isteklih termina ne postoji u mapi.
- `trebaDigest`: ponedjeljak šalje; utorak ne šalje ako je digest bio u ponedjeljak; utorak **šalje** ako je posljednji digest stariji od 7 dana; `null` (nikad slato) šalje samo ponedjeljkom.
- `jePonedjeljak`: svih sedam dana; ponoć po bečkom vremenu kad je u UTC-u još prethodni dan; neovisnost o `process.env.LANG`.
- `digestHtml`/`digestSubject`: escapovanje naziva sa `<`, `&`, `'`; podjela na „novo"/„traje duže" prema `termin_ids` prethodnog digesta; cap od 100 sa repom; tekst kašnjenja preko `danaTekst` sa **negativnim** `danaDoRoka`.
- `rokIstekaoFirmaHtml`: nema internih dugmadi ni linkova ka aplikaciji; potpis iz `FirmBrand`.

**Sa lažnim `send` i mock klijentom** (obrazac iz `runReminders.test.ts`):

- `runDigest`: jedan mejl po primaocu; primalac sa redom u `digest_slanja` za danas se preskače; greška kod jednog ne sprječava ostale; **pad slanja briše prethodno upisani red**.
- `runReminders`: firmin kanal za `dana_do_roka < 0` koristi novi šablon; za `>= 0` stari.

**Integracioni (protiv DEMO cloud baze, obrazac `*.integration.test.ts`):**

- `get_istekli_termini` vraća samo `planirano`/`zakazano` sa isteklim rokom; **ne** vraća termin sa `datum_zakazan` u budućnosti; **ne** vraća termin koji je danas dobio post-due zapis.
- `get_due_podsjetnici` post-due grana vraća termin tačno jednom po roku, a **ponovo** ga vraća kad se rok pomjeri pa opet istekne.
- unique na `digest_slanja` odbija drugi upis za isti dan.

**Regresija — jednako važna kao novi testovi:**

- Pre-due ponašanje (30/14/7, jedan mejl po pragu, oba kanala) bit-za-bit nepromijenjeno.
- Termin koji već ima post-due zapis za tekući rok ne dobija novu obavijest — test koji čuva da po deployu tri postojeća zakašnjela termina ne okinu poštu.

**Ručna provjera prije deploya:** `scripts/preview-emails.ts` → novi firmin šablon i digest u pregledaču. Šablonski mejlovi se ne validiraju testom nego okom.

---

## 9. Redoslijed puštanja

### PR 1

1. `20260719120000_post_due_jednokratno.sql` na DEMO, pa odmah na PROD (lockstep). Unazad kompatibilno: stari kod uz novu definiciju funkcije radi, samo dobija manje redova.
2. Deploy koda.
3. **Verifikacija na PROD-u** (ne na DEMO-u — vidi ogradu u §3.3): prvi cron run poslije deploya ne smije poslati nijedan mejl za tri postojeća zakašnjela termina.

### PR 2

1. `20260720122000_mejl_tip_digest.sql` **prvo i zasebno** (enum vrijednost mora biti commit-ovana prije upotrebe).
2. `20260720120000_digest_slanja.sql` i `20260720121000_get_istekli_termini.sql`, DEMO pa PROD.
3. **`pnpm db:types`** — `get_istekli_termini`, `digest_slanja` i nova enum vrijednost ne postoje u `db/types.ts`, pa su `supabase.rpc(...)` i `.from("digest_slanja")` TS greške dok se tipovi ne regenerišu. Traži lokalni Supabase stack.
4. Deploy koda + nova cron staza u `vercel.json` i GH workflow-u.
5. Ručno okidanje `/api/cron/digest` preko `scripts/send-reminders.ts` na DEMO-u, provjera sadržaja.
6. Verifikacija u prvi ponedjeljak: jedan digest po primaocu, po jedan red u `digest_slanja` sa popunjenim `termin_ids` i `resend_id`.

---

## 10. Donesene odluke

| Pitanje | Odluka | Zašto |
|---|---|---|
| Ritam poslije roka | Jednokratna obavijest + sedmični digest | Brza reakcija kad je najkorisnija, tišina poslije |
| Kadenca digesta | Po primaocu, ne po terminu | Per-item kadenca bi se sa dovoljno termina različite starosti opet okidala skoro svaki dan |
| Ko dobija digest | Po primaocu, isti opseg kao postojeći interni kanal | Poštuje model dodjela; niko ne dobija tuđe klijente |
| Evidencija slanja | Nova tabela `digest_slanja` sa `termin_ids` | Idempotencija po primaocu, razlika „novo/staro", dokazni trag |
| Redoslijed upis/slanje | Prvo upis (unique kao brava), pa slanje | Dva schedulera pale rutu istovremeno; send-first bi slao duplikate |
| Dan digesta | Ponedjeljak, konstanta u kodu | Prekidač koji niko neće dirati nosio je ~30% opsega |
| Firmin kanal poslije roka | Tačno jedna obavijest, iza postojećih prekidača | Pisani trag štiti izvođača; šum je dolazio od ponavljanja, ne od obavijesti |
| Termin zakazan za budućnost | Ne ulazi ni u obavijest ni u digest | Rok je prošao, ali posjeta je dogovorena — informacija, ne alarm |
| Digest u zasebnoj cron ruti | Da | `maxDuration` 60s, gating `postavke` samo na GET, i odvajanje od `zadnje_slanje_datum` |
| Organizacija koda | Tanak RPC + grupisanje u TS-u, uz izdvojen `loadRecipientIndex` | Pravila o primaocima ostaju na jednom mjestu |
| Opseg | Dva PR-a | PR 1 gasi pet mejlova dnevno odmah i ne zavisi od digest šablona |

---

## 11. Trag recenzija

Dokument je prošao dvije nezavisne recenzije bez konteksta razgovora u kojem je nastao.

**Prihvaćeno i ugrađeno:** insert-first redoslijed zbog trke dva schedulera; oporavak digesta po primaocu umjesto „danas == ponedjeljak"; guard vezan za tekući rok umjesto „ikad"; isključivanje termina sa `datum_zakazan` u budućnosti; isključivanje termina koji je danas dobio obavijest; negativan predznak `dana_do_roka`; `set search_path` i `revoke execute`; cijelo tijelo funkcije u migraciji umjesto fragmenta; peta migracija imenovana i pozicionirana; `TIP_KEY` i `pnpm db:types` u opsegu; izdvajanje `loadRecipientIndex`; `termin_ids` u `digest_slanja`; podjela „novo/traje duže"; cap od 100 stavki; zasebna cron ruta; ukidanje `digest_dan_u_sedmici`; jedna obavijest firmi poslije roka; podjela na dva PR-a.

**Razmotreno i odbačeno:** tvrdnja da su tri PROD termina lažne uzbune zbog statusa `zakazano` — provjereno uživo, kod sva tri je i `datum_zakazan` u prošlosti, pa su stvarno zapušteni. Strukturni dio te zamjerke je ipak prihvaćen kao §3.4.

**Poznata, svjesno neriješena ograničenja:** dry-run instance ne upisuju post-due trag (§3.3); guard je na nivou termina a ne kanala (§3.3); digest zapisi u dnevniku mejlova vidljivi samo adminima (§7); termin bez eligibilnih primalaca se beskonačno pojavljuje u rezultatu run-a (§7).
