# Vrijeme slanja: dvije opcije umjesto dvadeset četiri sata

**Datum:** 2026-07-21
**Status:** Odobren dizajn — spreman za plan implementacije
**Grana (prijedlog):** `fix/vrijeme-slanja-dvije-opcije`
**Migracija:** `20260721130000_vrijeme_slanja_dostizan_opseg.sql`

---

## 1. Problem

Forma „Vrijeme slanja" u Postavkama nudi svih 24 sata, a server akcija prihvata `0..23`. Cron ide u **09:00 i 13:00 UTC**, što je po Beču 10:00/14:00 zimi i 11:00/15:00 ljeti. Gate u cron ruti je `sat >= vrijeme_slanja_sat`.

Iz toga slijedi:

| Izabrana vrijednost | Stvarni ishod |
|---|---|
| 0–10 | **Sve identično** — šalje prvi dnevni run |
| 11–14 | Preskače prvi, šalje drugi |
| 15 | Radi ljeti, **ne radi zimi** |
| 16–23 | **Nikad ne šalje**, bez greške i bez traga |

Dakle od 24 ponuđene opcije, jedanaest daje isti rezultat, osam ne radi nikad, jedna radi pola godine.

Uz to, opis u formi glasi *„Podsjetnici se šalju u prvom satu na/nakon izabranog, jednom dnevno."* — to opisuje **satno provjeravanje**, model koji nikad nije postojao. Trebao ga je obezbijediti `.github/workflows/reminders.yml`, koji je od uvođenja bio mrtav (prazni secreti, `|| true` je svaki run prijavljivao kao uspjeh) i obrisan je 2026-07-20.

**Zatečeno stanje:** PROD je na `10` i radi ispravno. DEMO je na `23` — dakle pokvaren, ali maskiran ugašenim `podsjetnici_aktivni`.

**Zašto je ovo vrijedno popravke:** tiho gašenje cijelog sistema podsjetnika kroz naizgled bezazleno podešavanje u UI-u, bez ijedne greške i bez traga u logovima.

---

## 2. Odluka i zašto ne nešto drugo

**Podešavanje ostaje, ali se svodi na dvije opcije koje stvarno postoje: „ujutro" i „poslijepodne".**

Razmatrane su tri mogućnosti:

**Ograničiti izbor na 0–14.** Najmanja izmjena, ali zadržava lažnu preciznost — izbor između 3 i 9 i dalje ne mijenja ništa, a korisnik to ne može znati. Odbijeno.

**Ukinuti podešavanje potpuno** i uvijek slati na prvom dnevnom terminu. Privlačno: jedno stanje manje, a jedina stvarna instalacija (TEHPRO) ionako želi jutro. Odbijeno jer plaća punu cijenu sada — migracija koja uklanja kolonu, uklanjanje forme, izmjena gatinga i rute, dva E2E testa — za odluku koja se **ponovo otvara kad se projekti razdvoje**. Tada svaka instalacija dobija vlastiti `vercel.json`, pa cron izraz postaje prirodni regulator vremena i podešavanje u bazi postaje suvišno. Odgođeno svjesno, vidi §7.

**Dvije opcije.** Rješava oba problema — nedostižne vrijednosti i lažnu preciznost — bez migracije koja uklanja kolonu i bez diranja gating logike.

> **Napomena o kontekstu:** ranije razmatranje je zadržavanje podešavanja branilo argumentom „isti kod služi više firmi, pa je ovo jedini regulator koji se razlikuje po instalaciji". Vlasnik je (2026-07-21) pojasnio da je trenutna topologija — jedan repozitorij, tri URL-a, dvije baze — **privremena**, i da će se svaki projekat kasnije potpuno odvojiti. Danas dakle postoji **jedna** stvarna firma; demo i de.demo su testne instance istog projekta. Taj argument više ne stoji, i odluka se oslanja isključivo na odnos cijene i trenutka.

---

## 3. Ponašanje

U Postavkama stoje dvije opcije:

- **Ujutro** — prvi dnevni termin: 10:00 zimi, 11:00 ljeti
- **Poslijepodne** — drugi: 14:00 zimi, 15:00 ljeti

Opis ispod govori šta sistem stvarno radi: dva termina dnevno, biraš koji, vremena po lokalnom vremenu (Beč).

### 3.1 Preslikavanje u bazu

Kolona `vrijeme_slanja_sat` ostaje `int`, gate `sat >= vrijeme_slanja_sat` ostaje **nepromijenjen**. „Ujutro" upisuje `8`, „poslijepodne" `13`.

| Opcija (vrijednost) | Sezona | Prvi run | Drugi run | Ishod |
|---|---|---|---|---|
| ujutro (8) | zima | 10 ≥ 8 ✓ | — | prvi |
| ujutro (8) | ljeto | 11 ≥ 8 ✓ | — | prvi |
| poslijepodne (13) | zima | 10 ≥ 13 ✗ | 14 ≥ 13 ✓ | drugi |
| poslijepodne (13) | ljeto | 11 ≥ 13 ✗ | 15 ≥ 13 ✓ | drugi |

Dnevni marker `zadnje_slanje_datum` spriječava da drugi run ponovi posao prvog, kao i dosad.

### 3.2 Prikaz zatečene vrijednosti

Forma mapira postojeći broj u opciju: **do 11 → ujutro**, **12 do 14 → poslijepodne**. Granica je na 11 jer je to sat prvog ljetnog run-a — vrijednost 12 je najmanja koja ga pouzdano preskače u obje sezone.

PROD-ovih `10` prikazuje se kao „ujutro", što je ponašanje koje već postoji — **nula promjene u onome što stiže korisnicima**.

---

## 4. Šema

`supabase/migrations/20260721130000_vrijeme_slanja_dostizan_opseg.sql`, i **redoslijed koraka je bitan**:

1. **Normalizuj zatečene vrijednosti:** `≤ 11 → 8`, `> 11 → 13`. Time DEMO-vih `23` postaje `13`.
2. **Tek onda dodaj ograničenje:** `check (vrijeme_slanja_sat between 0 and 14)`.

Obrnutim redom bi ograničenje odbilo postojeći DEMO red i migracija bi pukla.

Migracija je idempotentna (`drop constraint if exists` prije `add constraint`) i ide na **DEMO i PROD u lockstep-u**.

Dosad je jedina brana bila validacija u server akciji, koja štiti samo put kroz UI. `check` pokriva i direktan upis u bazu.

---

## 5. Kod

### 5.1 `lib/reminders/rasporedSlanja.ts` (novo)

Jedno mjesto koje zna vezu između cron rasporeda i podešavanja:

```ts
export const NAJKASNIJI_DOSTIZAN_SAT = 14
export const SAT_UJUTRO = 8
export const SAT_POSLIJEPODNE = 13
export type TerminSlanja = "ujutro" | "poslijepodne"
export function terminIzSata(sat: number): TerminSlanja
export function satIzTermina(termin: TerminSlanja): number
```

Konstanta nosi komentar koji je **izvodi** iz cron izraza u `vercel.json` (`0 9` i `0 13` UTC → 10/14h zimi, 11/15h ljeti). To je jedina tačka gdje se raspored i podešavanje dodiruju; ako se raspored promijeni, postoji jedno mjesto koje treba pratiti umjesto da veza živi samo u nečijoj glavi.

Čista funkcija, bez I/O, bez zavisnosti na `lib/env.ts`.

### 5.2 Izmjene

- **`components/domain/VrijemeSlanjaForm.tsx`** — dvije opcije umjesto 24 sata; prikaz zatečene vrijednosti preko `terminIzSata`.
- **`app/(dashboard)/postavke/actions.ts`** — `updateVrijemeSlanja` prima `TerminSlanja` i upisuje `satIzTermina(...)`; validacija protiv `NAJKASNIJI_DOSTIZAN_SAT` umjesto `0..23`.
- **`messages/{sr,en,de}.json`** — labele dviju opcija i ispravljen opis.

**Ne diraju se:** `lib/reminders/gating.ts`, `app/api/cron/reminders/route.ts`, nijedan od tri puta slanja.

---

## 6. Testiranje

**Unit nad `rasporedSlanja`:**
- preslikavanje u oba smjera; granica na 11 i 12
- vrijednost izvan dostižnog opsega se u prikazu ne gubi (mapira se u poslijepodne)
- **test koji čuva vezu sa rasporedom:** `SAT_UJUTRO` mora biti ≤ jutarnjeg cron sata u obje sezone, a `SAT_POSLIJEPODNE` strogo veći od jutarnjeg i ≤ popodnevnog. Taj test pada ako neko promijeni cron raspored a zaboravi konstantu — jedini automatizovani čuvar te veze.

**Integracioni (lokalni stack, `TEST_DATABASE_URL`):** `check` odbija 15 i 23, prima 8 i 13; migracija normalizuje zatečenu vrijednost prije nego ograničenje stupi na snagu.

**E2E:** `23-podsjetnici-v2.spec.ts` („vrijeme slanja se sačuva i prikaže") i eventualni dodir u `06-podsjetnici.spec.ts` prilagođavaju se dvjema opcijama, uz zadržanu svrhu — da se izbor perzistira i preživi reload.

---

## 7. Svjesno odgođeno

**Ukidanje podešavanja u korist cron izraza.** Kad se projekti razdvoje i svaki dobije vlastiti `vercel.json`, promjena vremena slanja postaje promjena cron izraza — jedno mjesto, vidljivo u kodu, u istom fajlu gdje je i ostatak rasporeda. Tada vrijedi ponovo otvoriti pitanje treba li podešavanje u bazi uopšte postojati.

**Treći termin ili proizvoljan sat.** Traži scheduler koji trenutni Vercel plan ne dopušta (cron samo jednom dnevno, dva posla po projektu).

---

## 8. Poznata ograničenja

- Veza između `NAJKASNIJI_DOSTIZAN_SAT` i cron izraza u `vercel.json` je **konvencija čuvana testom**, ne izvedena automatski. Vercel raspored se ne može pročitati u runtime-u.
- `check` ograničenje dopušta cijeli opseg `0..14`, iako UI nudi samo dvije vrijednosti. Namjerno: ograničenje kodira **dostižnost** (šta scheduler može pogoditi), ne trenutni izbor u UI-u. Direktan upis `5` u bazu i dalje radi ispravno i prikazuje se kao „ujutro".
