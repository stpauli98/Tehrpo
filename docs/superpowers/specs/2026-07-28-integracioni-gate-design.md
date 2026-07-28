# Integracioni gate: jedna kapija između worktree-ova i produkcije

**Datum:** 2026-07-28
**Status:** Odobren dizajn — spreman za plan implementacije
**Grana (prijedlog):** `feat/integracioni-gate`
**Migracija:** nema

---

## 1. Problem

Rad se odvija u deset paralelnih worktree-ova pod `.claude/worktrees/`, svaki sa svojom granom. Grana se otvori kao PR, PR se mergea u `main`, a merge u `main` **odmah deploya na tri produkciona Vercel projekta**. Između „agent kaže da je gotov" i „radi na produkciji" ne stoji ništa.

Konkretno, zatečeno stanje na dan pisanja:

| Nalaz | Posljedica |
|---|---|
| `.github/workflows` **ne postoji** | Nijedan PR ne prolazi `typecheck`, `lint`, `test:unit` ni `build` |
| 10 aktivnih worktree-ova, 8 grana bez PR-a | Sve ciljaju isti `main`, nijedna ne zna za ostale |
| Grane zaostaju za `main` 2–12 commita | „Zeleno u worktree-u" ne znači zeleno poslije merge-a |
| Merge u `main` = 3× produkcioni deploy | Poslije merge-a je kasno za bilo kakvu provjeru |

### 1.1 Klasa kvarova koju git ne vidi

Najopasniji kvarovi nisu tekstualni konflikti — git ih riješi ili prijavi. Opasni su oni koji daju **čist merge i pokvaren sistem**. Tri žive instance u trenutnom repozitoriju:

**Sudar timestampova migracija.** Dvije grane su nezavisno napravile migraciju s istim prefiksom:

```
perf/aktivnost-keyset-pretraga     → supabase/migrations/20260728120000_audit_pretraga_kolone.sql
feat/kontakt-lokacija-podsjetnici  → supabase/migrations/20260728120000_mejl_status_demo.sql
```

Imena fajlova se razlikuju, pa git spaja bez ijednog konflikta i oba PR-a prolaze. Ali redoslijed primjene postaje nedefinisan, a na cloud se migracije primjenjuju **ručno, jedna po jedna** (`pnpm db:apply-cloud`) — ništa ne garantuje da su obje stigle na DEMO i PROD prije koda koji ih očekuje. To je tačno scenario iz PR #59 (*„BLOKIRAN: čeka cloud migracije"*).

**Dvije grane preko istih fajlova.** `feat/ko-sta-prima-edit` (PR #66, otvoren) i `feat/podsjetnici-legibilnost` obje diraju `components/domain/KoStaPrimaTab.tsx`, `SaljiFirmiToggle.tsx`, `app/(dashboard)/klijenti/[id]/actions.ts` i sva tri `messages/*.json`. Svaka je zelena sama za sebe. Sudar postoji tek u spoju.

**Dupliran rad.** `feat/kontakt-lokacija-podsjetnici` ima diff identičan već mergovanoj `feat/demo-rezim-mejlovi` (PR #67) — worktree je ili branchovan s pogrešne tačke, ili ponavlja gotov posao.

Uz to, `messages/{sr,en,de}.json` dira više grana paralelno, a next-intl tipizira namespace/ključ prema literalnoj uniji iz JSON-a — neusklađen paritet `sr`/`en`/`de` je **tvrda `tsc` greška**, ne upozorenje.

### 1.2 Zašto po-grana provjera nije dovoljna

Sva tri gornja kvara su nevidljiva dok se grane gledaju pojedinačno. Provjera mora postojati nad **spojem**, u kontekstu svježeg `main`-a.

---

## 2. Odluka i zašto ne nešto drugo

**Dva sloja: mehanički CI koji blokira PR, i integraciona grana u kojoj se serija provjerava spojena — prije nego ijedan PR uđe u `main`.**

Razmatrane su tri mogućnosti:

**Samo CI.** Hvata pokvaren kod na svakom PR-u i radi bez ičije intervencije. Ali radi nad jednom granom u izolaciji, pa nijedan od tri kvara iz §1.1 ne vidi. Nedovoljno samo za sebe — zadržano kao donji sloj.

**Samo recenzija po grani, bez spajanja.** Rješava „ima li ovo smisla", ali i dalje gleda granu izolovano. Odbijeno iz istog razloga.

**Stalna `integracija` grana, PR-ovi ciljaju nju.** Daje jedan produkcioni deploy po seriji umjesto po grani. Odbijeno jer dugovječna grana divergira i postaje drugi izvor istine, a istorija `main`-a gubi pojedinačne PR-ove.

**Potrošna integraciona grana + CI.** Izabrano. Grana se reže iz svježeg `origin/main` na početku svake runde i briše na kraju, pa ne može divergirati. PR-ovi i dalje ciljaju `main`, pa istorija ostaje nepromijenjena.

### 2.1 Zašto E2E nije u CI-ju

E2E ide na **cloud DEMO** (ne na lokalni stack), sa `--workers=1`, jer specovi dijele globalni singleton `postavke` id=1. Dva PR-a koja bi E2E pustila paralelno gazila bi jedan drugom podatke u živoj DEMO bazi. Zato E2E ostaje isključivo u integracionom worktree-u, gdje se pušta serijski, jednom po seriji, i za sobom povlači `pnpm cleanup:test-data`.

To je i najjači argument za integracioni worktree uopšte: on je jedino mjesto gdje pun E2E smije da se izvrši.

---

## 3. Arhitektura

### Sloj A — CI (mehanički, blokira, radi bez agenta)

`.github/workflows/gate.yml`, okida se na PR prema `main` i na push na `integracija/**`:

```
pnpm typecheck  →  pnpm lint  →  pnpm test:unit  →  pnpm build
                        ↓
        pnpm exec tsx scripts/provjeri-integraciju.ts
```

Bez E2E (§2.1). Bez pristupa PROD tajnama — koristi DEMO vrijednosti gdje su potrebne.

### Sloj B — integracioni gate (agent)

Worktree `.claude/worktrees/integracija`, grana `integracija/<datum>`, uvijek svježe rezana iz `origin/main`, potrošna.

```
main ──┬──────────────────────────────► main (3× prod deploy)
       │                            ▲
       └──► integracija/2026-07-28 ─┘   (verifikacija, pa se briše)
              ▲     ▲     ▲
              A     B     C              (PR-ovi ciljaju main)
```

---

## 4. Procedura — 8 faza

| Faza | Šta se radi | Nosilac |
|---|---|---|
| **0 Prijem** | Popis grana s gotovim radom (otvoreni PR-ovi + grane s commitima ispred `main`), potvrda serije s vlasnikom | agent + vlasnik |
| **1 Sklapanje** | `git fetch` → grana iz `origin/main` → serijski merge svake grane po rastućem broju PR-a; konflikti se bilježe, ne rješavaju napamet | agent |
| **2 Statičke provjere** | `scripts/provjeri-integraciju.ts` (§5) | skripta |
| **3 Kvalitet** | `typecheck`, `lint`, `test:unit`, `build`, zatim `test:e2e`, zatim `cleanup:test-data` | skripta |
| **4 Migracije** | Nove migracije → `pnpm db:apply-cloud --demo <fajl>` → regeneracija tipova (§4.3) → ponovo faza 3 | agent |
| **5 Recenzija** | Sud o sadržaju (§6) | agent |
| **6 Preview** | Push `integracija/<datum>` → Vercel Preview → provjera stvarnog deploya | agent |
| **7 Merge** | GO grane → PR-ovi u `main` provjerenim redom → **invarijanta** (§4.1) | vlasnik odobrava |
| **8 Čišćenje** | Brisanje integracione grane i worktree-a | agent |

### 4.1 Invarijanta merge-a

Poslije svih merge-eva u `main`:

```
git fetch origin && git diff integracija/<datum> origin/main
```

**mora biti prazan.** Ako nije, nešto je ušlo u `main` mimo gate-a i procedura staje — deployano stanje tada nije ono koje je provjereno. Ovo je jedina tvrda garancija koju gate daje.

### 4.2 Redoslijed migracija prema PROD-u

Merge u `main` deploya na PROD odmah. Ako migracija stigne poslije merge-a, postoji prozor u kojem kod traži šemu koje nema. Obavezan redoslijed:

```
DEMO migracija  →  gate zelen  →  PROD migracija  →  merge PR-a
```

PROD korak agent **nikad ne izvršava sam**. Traži izričitu potvrdu vlasnika i ide kroz `POTVRDI_PROD=da pnpm db:apply-cloud --prod <fajl>`.

### 4.3 Regeneracija `db/types.ts`

`pnpm db:types` čita **lokalnu** bazu (`supabase gen types typescript --local`), ne cloud. Regeneracija u integracionom worktree-u zato traži pokrenut lokalni stack i primijenjene migracije:

```
supabase start  →  pnpm db:reset  →  pnpm db:types
```

`db:reset` ponovo primjenjuje sve migracije iz `supabase/migrations`, uključujući one iz spojenih grana — pa je istovremeno i provjera da se migracije spojene serije uopšte primjenjuju čiste i u ispravnom redoslijedu. Ako `db:reset` padne, serija je NE-GO bez obzira na ostalo.

Rezultat mora biti identičan `db/types.ts` iz spoja. Razlika znači da je neka grana ručno dirala auto-generisani fajl ili ga generisala nad drugom šemom.

---

## 5. `scripts/provjeri-integraciju.ts`

Statičke provjere koje ciljaju klase iz §1.1 — one koje daju čist merge i pokvaren sistem. Skripta izlazi nenultim kodom i ispisuje nalaze kao `putanja:linija — opis`.

1. **Sudar timestampova migracija** — dva fajla u `supabase/migrations` s istim `YYYYMMDDHHMMSS` prefiksom
2. **Paritet ključeva `messages/{sr,en,de}.json`** — identičan skup ključeva u sva tri; zabranjena ICU kategorija `one` u `sr`
3. **`db/types.ts`** — ručno diran ili nesaglasan sa `supabase/migrations`
4. **Admin klijent u zahtjevnoj putanji** — `createAdminSupabaseClient` uvezen iz `app/` ili `components/` (zaobilazi RLS)
5. **SQL bez zaštite** — novi `VIEW` bez `security_invoker=on`; nova tabela bez ijedne RLS politike (tiho vraća nula redova)
6. **Cron ↔ postavke** — raspored u `vercel.json` nesaglasan s `lib/reminders/rasporedSlanja.ts`
7. **Ref-guard** — nijedna izmjena ne prebacuje razriješeni cilj s DEMO na PROD

Skripta dobija vlastite unit testove (`scripts/provjeri-integraciju.test.ts`, sintetički ulazi, bez dodirivanja stvarnog repozitorija), po obrascu ostatka `lib/`.

---

## 6. Recenzija sadržaja (faza 5)

Ono što nijedna skripta ne može — sud o tome da li izmjena ima smisla. Pet pitanja po seriji:

1. **Uklapanje u arhitekturu.** Poštuje li izbor tri Supabase klijenta, oblik server akcije (`safeParse` → `(_prev, formData)` → `ActionResult` → `revalidatePath`), čitanje kroz `*_view` i stabilne RPC-ove, RLS po dodjeli?
2. **Semantički sudar među granama.** Mijenjaju li dvije grane isto ponašanje na nesaglasne načine — i kad se fajlovi ne preklapaju?
3. **Mapa uticaja.** Šta još čita ili piše ono što je dirnuto. Primjer: izmjena u `podsjetnici` povlači cron rutu, `rasporedSlanja.ts` i `lib/email/`.
4. **Dupliran rad.** Ponavlja li grana nešto već mergovano (slučaj `kontakt-lokacija-podsjetnici`).
5. **Obim naspram najave.** Radi li grana ono što PR tvrdi, i ništa preko toga.

Ishod je **GO** ili **NE-GO po grani**, sa nalazima u obliku `fajl:linija — šta se lomi — čija je grana`.

---

## 7. Ovlaštenja i ispravke

**Mehaničko agent popravlja sam:** rebase na `main`, konflikti u `messages/*.json` (paritet ključeva), preimenovanje sudarenih timestampova migracija, regeneracija `db/types.ts`.

**Suštinsko se vraća:** dvije grane koje se logički ne slažu, pogrešna poslovna pravila, sporan dizajn. Agent ne mijenja tuđu logiku bez znanja vlasnika.

### 7.1 Ispravke idu u izvornu granu, ne u integracionu

Integraciona grana se briše u fazi 8. Ispravka commitovana samo u nju nestaje s njom, a PR i dalje nosi pokvaren fajl u `main`.

Zato svaka mehanička ispravka ide **u granu kojoj pripada**, pa se grana ponovo spaja u integracionu. Integraciona grana je uvijek izvedena, nikad izvor.

---

## 8. Granice

Gate smanjuje rizik, ne ukida ga. Neće uhvatiti:

- regresije u ponašanju koje E2E ne pokriva
- stvarno stanje PROD šeme (moguće provjeriti upitom — zasebna odluka, van ovog obima)
- kvarove koji se pojave tek pod produkcionim opterećenjem ili stvarnim podacima

Gate takođe **ne mergea sam** — faza 7 traži odobrenje vlasnika.

---

## 9. Odgođeno svjesno

- **Automatsko okidanje gate-a** (git hook ili Claude Code hook kad grana bude spremna). Vrijedi tek kad se procedura pokaže stabilnom ručno; do tada dodaje pomične dijelove bez dobitka.
- **Provjera stvarne PROD šeme** prije merge-a. Korisno, ali traži živ upit prema PROD-u iz gate-a — širi obim i površinu rizika.
- **Više serija u letu istovremeno.** Jedna integraciona grana u jednom trenutku; E2E singleton to ionako nameće.
