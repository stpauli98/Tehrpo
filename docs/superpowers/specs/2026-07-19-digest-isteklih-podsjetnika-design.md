# Digest isteklih podsjetnika + gašenje firminog kanala poslije roka

**Datum:** 2026-07-19
**Status:** Odobren dizajn — spreman za plan implementacije
**Grana (prijedlog):** `feat/digest-isteklih-podsjetnika`
**Migracije:** `20260719120000` … `20260719123000` (četiri, vidi §5)

---

## 1. Cilj / Motivacija

Post-due grana engine-a podsjetnika šalje **jedan mejl po terminu po danu, neograničeno**, i to na oba kanala.

Uzrok je u `supabase/migrations/20260629120000_podsjetnici_catchup_postdue.sql`. Post-due upit vraća jedan red dnevno za svaki termin sa `status in ('planirano','zakazano')` i `rok_dospijeca < current_date`. Ključ za deduplikaciju je `dana_prije = rok_dospijeca - current_date`, dakle negativan broj koji se **mijenja svaki dan**, pa jedinstveni indeks `uq_podsjetnici_termin_dana_kanal (termin_id, dana_prije, kanal)` nikad ne pogodi duplikat. Zaustavlja ga samo promjena statusa u `izvrseno`/`otkazano`, pomjeranje roka, ili `chk_podsjetnici_dana_prije` na −3650 (deset godina).

**Izmjereno stanje na PROD-u (`fqtqkehjidkzeasiegnq`, 2026-07-19):**

| Klijent | Vrsta | Rok | Status | Kašnjenje |
|---|---|---|---|---|
| CARMEUSE | Obilazak | 2026-07-13 | zakazano | 6 dana |
| WAIKIKI | Ispitivanje hidranata | 2026-06-27 | zakazano | 22 dana |
| NEW YORKER | Obilazak | 2026-06-08 | zakazano | 41 dan |

Tri termina proizvode **pet mejlova dnevno** (tri interna + dva firmina; NEW YORKER nema kontakt sa `podsjetnik_primalac`). U tabeli `podsjetnici` je već 63 post-due zapisa.

Dva odvojena problema:

1. **Šum.** Dnevno ponavljanje ne mijenja ishod — mijenja ga promjena statusa ili novi dogovor. Ponavljanje samo uči primaoca da ignoriše pošiljaoca. Uz to je kadenca per-item, pa raste linearno sa brojem klijenata: 50 zakašnjelih termina = 50 mejlova dnevno.
2. **Firmin kanal.** `salji_klijentima = true` na PROD-u, pa kontakt klijenta (`dzonifu@gmail.com`) dnevno dobija obavijest da kasni. To je vanjska komunikacija bez ograničenja, šteti odnosu, a kod zakonski uslovljenih rokova pravi pisani trag da je pošiljalac 41 dan znao za propust i nije postupio.

**Rješenje:** poslije roka jedan hitni pojedinačni mejl (interni), pa sedmični digest po primaocu (interni). Firmin kanal poslije roka ne šalje ništa.

---

## 2. Opseg

**U opsegu:**

- Sužavanje post-due grane `get_due_podsjetnici` na „prvi put kad primijetimo da je istekao".
- Novi RPC `get_istekli_termini()`.
- Nova tabela `digest_slanja` + RLS.
- Nova kolona `postavke.digest_dan_u_sedmici` + forma u Postavkama.
- Nova enum vrijednost `mejl_tip.podsjetnik_digest`.
- Novi moduli `lib/reminders/digestGroups.ts`, `lib/reminders/runDigest.ts`; `jeDanZaDigest` u `lib/reminders/gating.ts`; `digestSubject`/`digestHtml` u `lib/email/templates.ts`.
- Gašenje firminog kanala za `dana_do_roka < 0` u `runReminders`.
- Poziv `runDigest` iz cron rute.
- i18n `sr`/`en`/`de` pod `email.digest`.
- Primjer digesta u `scripts/preview-emails.ts`.

**Van opsega:**

- Eskalacija primaoca (dodavanje admina u kopiju poslije N dana). Razmatrano, odbijeno kao YAGNI — mogu se dodati kasnije bez izmjene šeme.
- Digest za termine *prije* roka. Pre-due ponašanje ostaje netaknuto.
- Gornja granica broja slanja za jedan termin.
- Bilo kakav novi mejl prema klijentu.

---

## 3. Ponašanje

### 3.1 Prije roka — nepromijenjeno

Pragovi iz `postavke.dana_prije` (PROD: `{30,14,7}`), jedan mejl po pragu po terminu, oba kanala. Bit-za-bit isto ponašanje kao danas.

### 3.2 Na dan roka i poslije

| Uslov | Interni kanal | Firmin kanal |
|---|---|---|
| `rok_dospijeca = current_date` | pre-due prag `0` ako je konfigurisan | isto |
| Prvi run u kojem je termin istekao a nema nijedan post-due zapis | pojedinačni „hitni" mejl (postojeći `reminderHtml`) | — |
| Izabrani dan u sedmici | digest: jedan mejl po primaocu sa svim njegovim isteklim terminima | — |
| Svi ostali dani | ništa | — |

### 3.3 Uslov za hitni mejl

Namjerno **nije** `current_date - rok_dospijeca = 1`. Uslov je:

> termin je istekao **i** `not exists (select 1 from podsjetnici p where p.termin_id = t.id and p.dana_prije < 0)`

Razlog: vezivanje za tačno `−1` znači da jedan propušten run (ispad, ugašen `podsjetnici_aktivni` preko vikenda) trajno proguta hitni mejl. Ovako je pravilo „prvi put kad primijetimo", otporno na propuštene run-ove, a i dalje se pošalje tačno jednom.

**Posljedica na postojećim podacima, i to poželjna:** CARMEUSE, WAIKIKI i NEW YORKER već imaju negativne zapise u `podsjetnici`, pa po deployu **neće** dobiti hitni mejl — samo ulaze u prvi sedmični digest. Bez ovog uslova bi sva tri odmah okinula poštu.

### 3.4 Kad prestaje

Termin nestaje iz digesta kad mu status pređe u `izvrseno`/`otkazano` ili mu se rok pomjeri u budućnost. Nema gornje granice po broju slanja: termin koji stvarno visi šest mjeseci pojavljivaće se u sedmičnom digestu šest mjeseci. To je namjerno — digest je pregled stanja, a jedan red u listi ne troši pažnju kao zaseban mejl.

### 3.5 Prazan digest

Primalac bez ijednog isteklog termina ne dobija mejl i ne dobija red u `digest_slanja`.

### 3.6 Primaoci i opseg sadržaja

Isti model kao postojeći interni kanal: za svakog eligibilnog primaoca (`aktivan and prima_podsjetnike`) sastavlja se **njegova** lista.

- Radnik: istekli termini klijenata na koje je dodijeljen preko `korisnik_klijent`.
- Admin: svi istekli termini.
- `REMINDER_TO` adrese iz env-a: ponašaju se kao admin (svi termini), isto kao u `recipientsForKlijent` danas.

Jedan mejl po osobi. Sa današnjih ~6 primalaca to je ~6 mejlova sedmično naspram trenutnih ~35 sedmično.

### 3.7 Efekat na trenutne podatke

Digest ponedjeljkom: **danas nula mejlova umjesto pet**; u ponedjeljak jedan interni digest sa tri reda po primaocu. Kontakt klijenta prestaje dobijati bilo šta odmah po deployu.

---

## 4. Arhitektura

Odabran je pristup **tanak RPC + grupisanje u TypeScriptu**.

`get_istekli_termini()` vraća ravnu listu isteklih termina i **ne zna ništa o primaocima**. Grupisanje po primaocu radi TS, preko postojećeg `buildRecipientIndex` iz `lib/reminders/recipients.ts`.

Odbijena alternativa: RPC koji odmah vraća parove `(email, termini)`. Značila bi da pravila „ko je eligibilan primalac" (admin ∪ dodjele, `aktivan`, `prima_podsjetnike`, `REMINDER_TO` base) postoje i u TS-u i u SQL-u — dva izvora istine za pravilo koje se sigurno mijenja.

Odbijena alternativa: bez RPC-a, filtriranje kroz PostgREST u TS-u. Duplirala bi definiciju „istekao" (jednom u `get_due_podsjetnici`, jednom u TS filteru).

Tok podataka jednog digest run-a:

```
cron GET /api/cron/reminders
  → gating: podsjetnici_aktivni, vrijeme_slanja_sat, zadnje_slanje_datum
  → runReminders()                    (pre-due + hitni post-due)
  → jeDanZaDigest(digest_dan_u_sedmici, now, "Europe/Vienna")?
      → runDigest()
          → rpc get_istekli_termini()
          → buildRecipientIndex(korisnici, dodjele, …)   [postojeće]
          → digestGroups(termini, index, base) → Map<email, red[]>
          → po primaocu: digest_slanja lookup → posaljiIzabiljezi → insert digest_slanja
  → postavke.zadnje_slanje_datum = danas
```

---

## 5. Šema baze

Četiri migracije, sve idempotentne (`if not exists` / `or replace` / DO-guard), sve na **DEMO i PROD u istom koraku** po lockstep pravilu.

### 5.1 `20260719120000_postavke_digest_dan.sql`

```sql
alter table postavke
  add column if not exists digest_dan_u_sedmici smallint not null default 1;
alter table postavke drop constraint if exists chk_postavke_digest_dan;
alter table postavke add constraint chk_postavke_digest_dan
  check (digest_dan_u_sedmici between 1 and 7);
```

ISO numeracija: 1 = ponedjeljak … 7 = nedjelja, da se poklapa sa `extract(isodow …)` i sa `Intl` izračunom u TS-u.

### 5.2 `20260719121000_digest_slanja.sql`

```sql
create table if not exists digest_slanja (
  id             uuid        primary key default gen_random_uuid(),
  primalac_email text        not null,
  datum          date        not null,
  poslat_at      timestamptz not null default now(),
  resend_id      text,
  broj_stavki    int         not null,
  constraint uq_digest_slanja unique (primalac_email, datum)
);

alter table digest_slanja enable row level security;
grant select on digest_slanja to authenticated;

drop policy if exists digest_slanja_sel on digest_slanja;
create policy digest_slanja_sel on digest_slanja for select using (je_admin());
```

Bez INSERT politike: piše isključivo cron preko service-role klijenta (`createAdminSupabaseClient`), kao i `podsjetnici`.

`primalac_email` se upisuje u lowercase — `assembleRecipients` već vraća lowercase, pa je unique ključ stabilan.

### 5.3 `20260719122000_get_istekli_termini.sql`

```sql
create or replace function get_istekli_termini()
returns table (
  termin_id      uuid,
  klijent_id     uuid,
  klijent_naziv  text,
  vrsta_naziv    text,
  rok_dospijeca  date,
  lokacija_naziv text,
  dana_kasni     int
)
language sql
stable
as $$
  select
    t.id, k.id, k.naziv, vp.naziv, t.rok_dospijeca, l.naziv,
    (current_date - t.rok_dospijeca)
  from termini t
  join klijenti k        on k.id = t.klijent_id
  join vrste_provjera vp on vp.id = t.vrsta_provjere_id
  left join lokacije l   on l.id = t.lokacija_id
  where t.status in ('planirano','zakazano')
    and t.rok_dospijeca < current_date
  order by t.rok_dospijeca, k.naziv;
$$;
```

### 5.4 `20260719123000_post_due_prvi_put.sql`

Zamjenjuje post-due granu u `get_due_podsjetnici`. Pre-due grana ostaje **doslovno nepromijenjena**. Novi `where` u post-due grani:

```sql
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca < current_date
      and not exists (
        select 1 from podsjetnici p
        where p.termin_id = t.id and p.dana_prije < 0
      )
```

Povratni tip se ne mijenja, pa je `create or replace` dovoljan (bez `drop`).

### 5.5 Enum vrijednost

`mejl_tip` dobija `podsjetnik_digest`. **Zasebna migracija**, jer se nova enum vrijednost u Postgresu ne smije koristiti u istoj transakciji u kojoj je dodata:

```sql
alter type mejl_tip add value if not exists 'podsjetnik_digest';
```

---

## 6. Moduli

Podjela je vođena time da se sve što nosi logiku testira bez baze i bez mreže.

### 6.1 Novo

**`lib/reminders/digestGroups.ts`** — čista funkcija, nula I/O.

```ts
export type IstekliRed = {
  terminId: string; klijentId: string; klijentNaziv: string
  vrstaNaziv: string; rokDospijeca: string; lokacijaNaziv: string | null; danaKasni: number
}
export function digestGroups(
  termini: IstekliRed[], index: RecipientIndex, base: string[],
): Map<string, IstekliRed[]>
```

Implementacija se oslanja na `recipientsForKlijent(index, klijentId, base)` za svaki termin i dodaje red u listu svakog vraćenog primaoca. Time su pravila opsega **doslovno ista** kao za pojedinačni interni mejl — nema drugog izvora istine.

**`lib/reminders/runDigest.ts`** — orkestracija. Isti throttling obrazac kao `runReminders` (grupe od `REMINDER_BATCH_SIZE`, pauza `REMINDER_BATCH_DELAY_MS`), jer je isti Resend rate-limit. Vraća `{ sent, skipped, errors }` po istom `Outcome` obrascu.

**`digestSubject()` / `digestHtml()`** u `lib/email/templates.ts` — koriste postojeće `layoutOmot`, `badge`, `poljeRed`, `escapeHtml`, `danaTekst`. Tijelo je tabela (klijent, vrsta, rok, kašnjenje) plus dugme „Otvori plan aktivnosti". **Bez ICS priloga** — prilog ima smisla za jedan termin, ne za listu.

### 6.2 Izmjene

- **`lib/reminders/gating.ts`** — dodaje se `jeDanZaDigest(danUSedmici: number, now: Date, timeZone = "Europe/Vienna"): boolean`, u istom stilu čiste funkcije sa ubačenim `now` kao postojeći `lokalniSatIDatum`.
- **`lib/reminders/runReminders.ts`** — jedna izmjena: firmin kanal se preskače kad je `dana_do_roka < 0`. Interni kanal netaknut.
- **`app/api/cron/reminders/route.ts`** — poslije `runReminders`, unutar istog već-zaštićenog bloka, ako `jeDanZaDigest` vrati `true`, zove se `runDigest`. Rezultat se dodaje u JSON odgovor pod ključem `digest`.
- **`app/(dashboard)/postavke`** — `DigestDanForm` (select ponedjeljak–nedjelja) pored `VrijemeSlanjaForm`, server akcija po uzoru na `azurirajVrijemeSlanja` (`actions.ts:417`).
- **`messages/sr.json`, `en.json`, `de.json`** — poruke pod `email.digest`. Njemački ide sa napomenom da čeka native review, kao i ostatak projekta.
- **`scripts/preview-emails.ts`** — digest primjer.

---

## 7. Greške i rubni slučajevi

**Izolacija po primaocu.** Greška kod jednog primaoca ne obara ostale — `Outcome` obrazac (`sent`/`skip`/`err`) iz `runReminders`, sa zbirnim izvještajem u JSON odgovoru.

**Redoslijed: prvo pošalji, pa upiši trag.** Upis u `digest_slanja` koji padne na unique violation znači da je red već postojao → `skip`, ne greška. Upis koji padne iz drugog razloga: mejl je već otišao, ali duplikat nije moguć jer je sljedeća prilika za digest tek za sedam dana.

**Djelimičan neuspjeh se sam popravlja.** Ako `runDigest` baci, cron ruta vraća 500 i `zadnje_slanje_datum` se **ne** postavlja. GitHub Actions (`.github/workflows/reminders.yml`) kuca svaki puni sat, pa se run ponovi istog dana, a `unique (primalac_email, datum)` osigurava da već poslužen primalac ne dobije drugi mejl. Ovo je konkretna korist zasebne tabele naspram oslanjanja na globalni marker.

**Promjena dana u sedmici usred sedmice.** Prebacivanje sa ponedjeljka na četvrtak u srijedu znači dva digesta te sedmice. Svjesno neriješeno: unique je po datumu pa duplikat istog dana i dalje nije moguć, scenario je rijedak i bezopasan.

**Zona.** Dan u sedmici se računa u `Europe/Vienna` istim `Intl.DateTimeFormat` putem kao postojeći sat slanja, **ne** preko `current_date` u bazi (UTC). Da se pomiješa, digest bi ponedjeljkom u 00:30 po Beču mislio da je nedjelja.

**Termin bez lokacije** — `left join`, `lokacija_naziv` može biti `null`, red se izostavlja iz tabele kao u `reminderHtml`.

**Vidljivost u dnevniku mejlova.** Digest pokriva više klijenata, pa u `mejl_log` ide sa `termin_id = null` i `klijent_id = null`. RLS politika `mejl_log_sel` daje pristup preko `je_admin()` ili `ima_pristup_klijentu(klijent_id)`, pa **digest zapise u dnevniku vide samo admini**. Prihvaćeno kao ispravno: digest je više-klijentski artefakt i ne pripada nijednom pojedinačnom klijentu.

---

## 8. Testiranje

**Unit (bez baze i mreže) — tu je težina:**

- `digestGroups`: radnik dobija samo istekle termine svojih klijenata; admin sve; `REMINDER_TO` base se ponaša kao admin; neaktivan korisnik i `prima_podsjetnike = false` se ne pojavljuju; primalac bez isteklih termina ne postoji u mapi.
- `jeDanZaDigest`: svih sedam dana; ISO numeracija (nedjelja = 7, ne 0); ponoć po bečkom vremenu kad je u UTC-u još prethodni dan.
- `digestHtml`/`digestSubject`: escapovanje naziva sa `<`, `&`, `'`; tačan broj redova; tekst kašnjenja preko `danaTekst` (iste ICU množine kao ostatak).

**Sa lažnim `send` i mock klijentom** (obrazac iz `runReminders.test.ts`): jedan mejl po primaocu; primalac sa postojećim redom u `digest_slanja` za danas se preskače; greška kod jednog ne sprječava ostale.

**Integracioni (protiv DEMO cloud baze, obrazac `*.integration.test.ts`):** `get_istekli_termini` vraća samo `planirano`/`zakazano` sa rokom u prošlosti, nikad `izvrseno`/`otkazano`; unique na `digest_slanja` odbija drugi upis.

**Regresija — jednako važna kao novi testovi:**

- `runReminders` **ne** šalje firmin kanal kad je `dana_do_roka < 0`, a i dalje ga šalje kad je `>= 0`.
- Pre-due ponašanje (30/14/7, jedan mejl po pragu) nepromijenjeno.
- Termin koji već ima negativan zapis u `podsjetnici` ne dobija hitni mejl — test koji čuva da po deployu tri postojeća zakašnjela termina ne okinu poštu.

**E2E (Playwright):** promjena dana u sedmici u Postavkama se sačuva i preživi reload.

**Ručna provjera prije deploya:** `scripts/preview-emails.ts` → digest HTML u pregledaču. Šablonski mejlovi se ne validiraju testom nego okom.

---

## 9. Redoslijed puštanja

1. Migracije na DEMO, pa odmah na PROD (lockstep). Migracije su unazad kompatibilne: stari kod uz novu šemu i dalje radi (nova kolona ima default, nova tabela se ne čita).
2. Deploy koda.
3. Provjera: prvi cron run poslije deploya ne smije poslati nijedan mejl za tri postojeća zakašnjela termina (`get_due_podsjetnici` ih više ne vraća, digest nije ponedjeljak).
4. Provjera u ponedjeljak: jedan digest po primaocu, `digest_slanja` ima po jedan red po primaocu.

---

## 10. Donesene odluke

| Pitanje | Odluka | Zašto |
|---|---|---|
| Ritam poslije roka | Hitni mejl na prvo primjećivanje + sedmični digest | Brza reakcija kad je najkorisnija, tišina poslije |
| Kadenca digesta | Po primaocu, ne po terminu | Per-item kadenca bi se sa dovoljno termina različite starosti opet okidala skoro svaki dan |
| Ko dobija digest | Po primaocu, isti opseg kao postojeći interni kanal | Poštuje model dodjela; niko ne dobija tuđe klijente |
| Evidencija slanja | Nova tabela `digest_slanja` | Idempotencija po primaocu; istorija; `podsjetnici` je vezan za jedan termin |
| Podesivost | Samo dan u sedmici | Ostalo pokrivaju postojeći `vrijeme_slanja_sat` i `podsjetnici_aktivni`; svaki prekidač je novo stanje za testiranje |
| Firmin kanal poslije roka | Gasi se u kodu, bezuslovno | Ispravno ponašanje, ne stvar ukusa; prekidač bi samo omogućio da se greška vrati |
| Organizacija koda | Tanak RPC + grupisanje u TS-u | Pravila o primaocima ostaju na jednom mjestu |
