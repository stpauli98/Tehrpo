# Kontakt ↔ lokacija i podsjetnici po lokaciji — dizajn

**Datum:** 2026-07-28
**Status:** odobreno, čeka plan i izvedbu

## Problem

Firma sa više lokacija ima različite kontakt osobe po lokaciji, ali **svi dobijaju
podsjetnik za svaki termin te firme** — bez obzira na kojoj je lokaciji.

Korisnikov primjer: kontakt 1 je na lokaciji 1, kontakt 2 na lokaciji 2. Za termin
na lokaciji 1 podsjetnik treba samo kontaktu 1, a danas ga dobiju obojica.

## Trenutno stanje (izmjereno, ne po sjećanju)

```
klijenti ─┬─ lokacije      (kontakt_osoba / kontakt_email / kontakt_telefon = slobodan tekst)
          ├─ kontakt_osobe (ime, funkcija, telefon, email, podsjetnik_primalac)
          └─ termini       (lokacija_id, nullable)
```

Primaoci se biraju **isključivo po firmi**:
- `lib/reminders/runReminders.ts:116` → `firmaRecipientsForKlijent(recipientIndex, r.klijent_id)`
- `lib/reminders/runPostDue.ts:94` → isto

Red `r` ima `lokacija_naziv`, ali se koristi **samo kao tekst u tijelu mejla** — nikad
za odabir primalaca. `kontakt_osobe` uopšte nema pojam lokacije.

**Mjerenja na DEMO bazi:**
- 11 firmi ima lokacije; **3 firme imaju više lokacija**
- 18 kontakata, 9 označeno kao primaoci podsjetnika
- **2 firme imaju više od jednog primaoca** → tu se greška dešava na svakom slanju
- 57 termina, **2 (4%) bez lokacije** → rubni slučaj koji pravilo mora pokriti
- 14 lokacija ima popunjen slobodni kontakt; **13 (93%) se poklapa po imenu** sa
  postojećim `kontakt_osobe` → ista osoba unesena dvaput

**Zatečeni trag ranijeg pokušaja:** `get_due_podsjetnici` već vraća
`lokacija_kontakt_email`, a **nijedna linija koda ga ne čita**. Namjera je postojala,
nije dovršena.

**Lokacijski kontakt je slijepa ulica:** `lokacije.kontakt_*` se ne koristi ni u
podsjetnicima, ni u izvozu, ni u zapisnicima — samo se ispisuje. Osoba unesena samo
tamo ne može nikad primiti podsjetnik.

## Rješenje

### 1. Model — `kontakt_osobe.lokacija_id`

```sql
alter table kontakt_osobe
  add column lokacija_id uuid references lokacije(id) on delete set null;
```

- `null` → **kontakt firme**: prima za sve lokacije
- postavljen → **kontakt lokacije**: prima samo za tu lokaciju

Uz to:
- **brava na istu firmu** — lokacija mora pripadati istoj firmi kao kontakt; složeni
  strani ključ preko `lokacije(id, klijent_id)` (traži `unique (id, klijent_id)` na
  `lokacije`). Bez toga bi se kontakt jedne firme mogao vezati za tuđu lokaciju.
- indeks `(klijent_id, lokacija_id)`

**Ključna osobina: migracija ne mijenja ponašanje.** Svih 18 postojećih kontakata
dobija `null` → ponašaju se tačno kao danas.

**Odbačeno:** `lokacije.kontakt_osoba_id` (lokacija pokazuje na kontakt) — dozvoljava
tačno jednog primaoca po lokaciji, a gradilište realno ima i koordinatora i šefa.
**Odloženo:** spojna tabela `kontakt_lokacija` (kontakt pokriva N lokacija) — model
sa jednom kolonom je njen podskup, pa se prelazak kasnije radi bez bacanja posla.

### 2. Odabir primalaca

`firmaRecipientsForKlijent(index, klijentId)` → `firmaRecipientsZa(index, klijentId, lokacijaId)`:

**Lokacijski kontakti se DODAJU firminim, ne zamjenjuju ih.**

| slučaj | primaoci |
|---|---|
| termin **bez** lokacije | kontakti sa `lokacija_id = null` |
| termin **sa** lokacijom L | kontakti vezani za L **+** kontakti sa `null` |
| uvijek uz to | `klijenti.podsjetnik_emails` (opšte adrese firme) |

Zašto dodavanje a ne zamjena: „kontakt firme" doslovno znači „prati sve" — npr.
menadžer ZNR u centrali. Kod zamjene bi centrala **tiho** prestala da prima podsjetnike
za gradilište čim mu se dodijeli koordinator, i to bez ikakvog traga. Kod ZNR rokova
propušten rok se ne primijeti dok ne bude kasno.

Korisnikov zahtjev je i dalje ispunjen: kontakt lokacije 2 **ne** dobija podsjetnik za
lokaciju 1. Ko ne treba da prima sve — veže se za svoju lokaciju.

Posljedica: „lokacija bez vezanih kontakata" nije poseban slučaj nego prirodno pada na
kontakte firme.

### 3. RPC izmjene

`get_due_podsjetnici` i `get_post_due_termine` moraju vraćati **`lokacija_id`** — danas
vraćaju samo `lokacija_naziv`, pa motor fizički nema čime da razlikuje.

Mijenja se `returns table` potpis → `drop` + `create` funkcije. Lockstep: DEMO **i** PROD.

### 4. Prikaz

- **Forma kontakta** (ID karta): padajući spisak „Lokacija", podrazumijevano
  *Sve lokacije — kontakt firme*
- **Forma lokacije**: sekcija kontakta — izbor postojećeg kontakta te firme **ili**
  unos novog (koji se kreira u `kontakt_osobe` i odmah veže)
- **Tab Lokacije** i **ID karta**: prikaz veze u oba smjera

Kopija u sr/en/de.

### 5. Migracija podataka — namjerno NE automatski

13 od 14 lokacijskih kontakata poklapa se po imenu, pa je primamljivo auto-vezati ih.
**Ne radi se.** Auto-veza bi promijenila ponašanje uživo: kontakt koji danas prima sve
podsjetnike svoje firme tiho bi se sveo na jednu lokaciju. To je poslovna odluka
korisnika, ne posao migracije.

Svi ostaju `null`; korisnik veže svjesno kroz UI.

`lokacije.kontakt_*` kolone **ostaju** za sada (samo prikaz). Brišu se u zasebnom
zahvatu kad podaci pređu — ne u istom potezu.

## Šta ostaje netaknuto

- **Interni primaoci** (admini + dodijeljeni operateri iz `korisnik_klijent`) prate
  firmu i treba da vide sve → `recipientsForKlijent` se ne dira
- **Digest** — grupiše samo interne primaoce (`digestGroups.ts:31`), firmine ne
  uključuje uopšte
- **`podsjetnik_primalac`** — i dalje znači „prima li uopšte", nezavisno od „za šta"
- **`salji_podsjetnik_klijentu`** — per-firma prekidač ostaje iznad svega

## Testovi

Jezgro je čista funkcija (`firmaRecipientsZa`) pa ide unit testovima:
1. termin bez lokacije → samo kontakti firme
2. lokacija sa vezanim kontaktima → samo oni
3. lokacija bez vezanih → dobiju kontakti firme (prirodno, ne poseban slučaj)
4. **kontakt lokacije 2 NE dobija podsjetnik za lokaciju 1** — doslovno korisnikov primjer
5. kontakt firme prima i za lokaciju koja IMA svoje kontakte (dodavanje, ne zamjena)
6. `podsjetnik_emails` firme uvijek prisutne
7. isključen `podsjetnik_primalac` isključuje kontakt bez obzira na lokaciju

E2E: vezivanje kontakta za lokaciju kroz obje forme.

## Rizik — provjeren, razriješen

Proširenje RPC-a traži `drop`/`create` jer se mijenja `returns table` potpis. Provjereno
prije pisanja plana: **nijedna SQL funkcija ni pogled ih ne poziva** — jedini pozivaoci
su `lib/reminders/runReminders.ts`, `lib/reminders/runPostDue.ts` i `lib/rlsCoverage.ts`
(TypeScript). `drop`/`create` je dakle bezbjedan.

Najnovije definicije koje treba preuzeti kao osnovu:
- `get_due_podsjetnici` → `supabase/migrations/20260720121000_get_due_bez_post_due.sql`
- `get_post_due_termine` → `supabase/migrations/20260720122000_get_post_due_termine.sql`
