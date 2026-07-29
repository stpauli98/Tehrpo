---
description: Integracioni gate — spoji spremne grane, provjeri sklop, izvijesti GO/NE-GO
---

Sprovedi integracioni gate po `docs/superpowers/specs/2026-07-28-integracioni-gate-design.md`.

Argument (opciono): spisak grana. Bez argumenta — sam sastavi spisak.

## Faza 0 — Prijem

- `git fetch origin --prune`
- Ako je argument komande dat, tretiraj ga kao gotov spisak grana i preskoči popis ispod. Bez argumenta, sastavi spisak sam: `gh pr list --state open` i `git branch --format='%(refname:short)'`.
- Za svaku granu: `git rev-list --left-right --count origin/main...<grana>` (desni broj = commiti grane ispred `origin/main`).
- **Izbaci iz serije svaku granu čiji je taj desni broj `0`** — nema nijedan commit ispred bazne grane pa nema šta da doprinese sklopu. Ne tretiraj je tiho: **navedi je vlasniku posebno u popisu iz ove faze, sa razlogom**, jer prazan rezultat znači jedno od dvoje i oba vrijedi vidjeti — (a) grana je već stopljena u `main` (npr. `fix/kartica-bez-zatvori` — desni broj `0`, potvrđeno pretkom `origin/main`-a preko `git merge-base --is-ancestor`; može se obrisati zajedno sa svojim worktree-om/branch-om), ili (b) je branchovana s pogrešne tačke pa joj stvarni rad nije ispred `origin/main` gdje se očekuje — rjeđi slučaj, bez poznatog primjera u ovom repou trenutno; prepoznaje se po tome što worktree/grana ima stvaran rad koji se ne vidi u brojevima iz `git rev-list`. Ne pogađaj koje je od dvoje — samo prijavi obje mogućnosti i pusti vlasnika da odluči.
- Odredi redoslijed **preostale** serije (poslije izbacivanja gornjih): grane sa otvorenim PR-om idu prve, sortirane po rastućem broju PR-a. Grane **bez** PR-a idu poslije njih, međusobno sortirane po datumu prvog commita koji nije na `origin/main` — najstariji prvi (`git log origin/main..<grana> --reverse --format=%aI | head -1`; pošto su grane bez ijednog takvog commita već izbačene gore, ovaj poziv ovdje uvijek vraća datum, nikad prazan string). Ovaj redoslijed nije kozmetički: to je mehanizam kojim Faza 2 hvata sudar timestampova migracija (dvije grane koje uvedu migraciju istog trenutka se spajaju u poznatom, ponovljivom redu) — drži ga se dosljedno kroz Fazu 1.
- Ispiši predloženu seriju sa određenim redoslijedom (i posebno izbačene grane s razlogom) i **sačekaj potvrdu vlasnika**. Ne nastavljaj bez nje.

## Faza 1 — Sklapanje

- Izračunaj datum **jednom** i drži ga u varijabli — koristi istu vrijednost u ovoj fazi i u Fazama 6, 7 i 8 umjesto ponovnog pozivanja `date`: `DATUM=$(date +%F)`. Gate sa punim E2E i build-om lako pređe ponoć; dvije nezavisne evaluacije `$(date +%F)` bi tada dale različite nazive grane.
- `git worktree add .claude/worktrees/integracija -b integracija/$DATUM origin/main`
- U tom worktree-u: `pnpm install --frozen-lockfile`
- Spajaj grane **serijski, tačno redoslijedom određenim u Fazi 0**: `git merge --no-ff <grana>`
- Konflikt zabilježi i **stani** — ne rješavaj napamet. Prijavi vlasniku čije su grane u sudaru.

## Faza 2 — Statičke provjere

- Pokreni `pnpm provjeri:integraciju` (podrazumijevana bazna grana: `origin/main`).
- **GO/NE-GO signal je isključivo podrazumijevani režim** (bez zastavica, ili sa `--baza`). Samo on gleda ono što serija stvarno donosi.
- Zastavice postoje. Radi sigurnosti dodaj `--` prije njih — prosljeđivanje bez `--` zavisi od verzije `pnpm`-a, ne oslanjaj se na to da će uvijek proći:
  - `pnpm provjeri:integraciju -- --baza <ref>` — eksplicitna bazna grana umjesto `origin/main`
  - `pnpm provjeri:integraciju -- --sve` — **dijagnostički režim, NIJE GO/NE-GO signal.** Čita sve fajlove migracija bez obzira na git stanje (ignoriše `--baza` ako je zadan uz njega) i zato ima **poznat nenulti pod**: na dan 2026-07-29 daje **18 nalaza i izlazni kod 1** nad netaknutim `main`-om. Svi su posljedica dokumentovanog ograničenja provjere po fajlu (tabela ili view kreiran u ranoj migraciji, a politika ili `security_invoker` dodat u nekoj kasnijoj; plus `klijent_provjere` kojoj je RLS ugašen u jednoj a vraćen u sljedećoj migraciji). **Ne pripisuj te nalaze granama i ne pokreći `git log -S` istragu iz koraka niže nad njima** — nijedan nije uveden serijom. `--sve` koristi samo kad hoćeš ručno da pregledaš cijelu istoriju; broj nalaza pod njim nikad ne odlučuje o GO/NE-GO.
- Izlazni kod: `0` čisto, `1` ima nalaza (svaki ispisan kao `putanja:linija — [pravilo] poruka`), `2` greška u upotrebi (nepoznata zastavica, `--baza` bez vrijednosti, ili bazna grana nije razrešiva lokalno — obično treba `git fetch origin` prvo, pa se vrati na **Fazu 0** ponoviti fetch; ne tretiraj kao "čisto"), `3` **alat je pukao** (neuhvaćena greška, stack trace u ispisu). Kod `3` NIJE "ima nalaza": provjera nije ni završena, pa se ne smije čitati kao rezultat — popravi uzrok pada i pokreni ponovo.
- Obuhvat migracija u podrazumijevanom/`--baza` režimu je **unija**: commitovane izmjene prema baznoj grani (`git diff <baza>...HEAD`) **i** necommitovane izmjene u radnom stablu (untracked/staged/modified). U integracionom worktree-u je sve već commitovano kroz merge-eve iz Faze 1, pa je ovo uglavnom bez efekta — ali ako u toku gate-a napraviš ručnu ispravku (Faza 4 rebase, paritet prevoda...) prije nego je komituješ, ona već ulazi u obuhvat sljedećeg pokretanja.
- Svaki nalaz nosi grana koja ga je uvela. Utvrdi je preko `git log -S "<karakterističan string iz nalaza>" -- <fajl>` (ili `git blame <fajl>` pa provjeri koji merge commit je unio liniju) — obavezno prije nego nalaz pripišeš nekoj grani u izvještaju.
- Ako ima nalaza: ne popravljaš ih ovdje u integracionoj grani. Ispravka ide u izvornu granu po pravilima iz odjeljka „Ovlaštenja" niže (mehaničko popravljaš sam, suštinsko vraćaš vlasniku), grana se ponovo spaja u integracionu (Faza 1), i Faza 2 se ponavlja.

## Faza 3 — Kvalitet

- `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build`
- `pnpm test:e2e` — **samo ovdje**, nikad paralelno iz više worktree-ova (E2E gađa cloud DEMO i specs dijele singleton `postavke` id=1, zato i sama komanda ide s `--workers=1`)
- `pnpm cleanup:test-data` poslije E2E, bez izuzetka — bez obzira da li je E2E prošao ili pao

## Faza 4 — Migracije

Ako serija donosi nove `supabase/migrations/*.sql`:

- `pnpm db:apply-cloud --demo <fajl>` — jedan po jedan, redom po prefiksu (timestampu)
- Regeneracija tipova — `pnpm db:types` čita **lokalnu** bazu (`supabase gen types typescript --local`), nikad cloud, pa prvo treba primijeniti migracije lokalno:
  `supabase start` → `pnpm db:reset` → `pnpm db:types`
- `db:reset` mora proći čisto — ako padne, serija je NE-GO bez obzira na ostalo (to je i provjera da se spojene migracije uopšte primjenjuju čiste i u ispravnom redoslijedu)
- Odmah poslije `db:reset`, dok lokalna baza već stoji sa primijenjenom serijom:
  `RLS_CHECK_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" pnpm rls:check`
  Ovo je jedina provjera koja gleda **stvarno stanje baze**, a ne tekst migracija: nabraja `public` tabele bez uključenog RLS-a i tabele sa RLS-om ali bez ijedne politike (uz allowlist namjerno policyless tabela iz `lib/rlsCoverage.ts`). Statička pravila iz Faze 2 gledaju **jedan fajl u jednom trenutku** i po prirodi ne vide neto stanje kroz cijelu istoriju — `rls:check` to hvata.
- **Ako `rls:check` padne (izlazni kod 1):** serija ostavlja tabelu bez zaštite u bazi. Svaki prijavljen `rls_disabled` znači da tabela curi svakom prijavljenom korisniku; `no_policy` znači da će upiti tiho vraćati nula redova (RLS uključen, nijedno pravilo ne propušta). Oboje je **NE-GO** dok se ne razriješi: ili nedostaje migracija koja vraća zaštitu, ili tabela pripada u allowlist pa to treba eksplicitno dodati u `RLS_INTENTIONAL_POLICYLESS` (odluka vlasnika, ne agenta). Izlazni kod `2` znači samo da `RLS_CHECK_URL` nije postavljen — nije nalaz.
- `git diff db/types.ts` mora biti prazan; razlika znači da je neka grana ručno dirala auto-generisani fajl ili ga generisala nad drugom šemom
- Ponovi Fazu 3

## Faza 5 — Recenzija

Pet pitanja iz spec-a §6:

1. Uklapanje u arhitekturu — tri Supabase klijenta, oblik server akcije (`safeParse` → `(_prev, formData)` → `ActionResult` → `revalidatePath`), čitanje kroz `*_view`/stabilne RPC-ove, RLS po dodjeli.
2. Semantički sudar među granama — mijenjaju li dvije grane isto ponašanje na nesaglasne načine, i kad se fajlovi ne preklapaju.
3. Mapa uticaja — šta još čita ili piše ono što je dirnuto (npr. izmjena u `podsjetnici` povlači cron rutu, `rasporedSlanja.ts`, `lib/email/`).
4. Dupliran rad — ponavlja li grana nešto već mergovano.
5. Obim naspram najave — radi li grana ono što PR tvrdi, i ništa preko toga.

Nalaz piši kao `fajl:linija — šta se lomi — čija je grana`. Ishod: **GO** ili **NE-GO po grani**.

## Faza 6 — Preview

- `git push -u origin integracija/$DATUM` (ista varijabla iz Faze 1, ne ponovno `$(date +%F)`)
- Sačekaj Vercel Preview i provjeri deployanu aplikaciju

## Faza 7 — Merge

- Izvijesti **GO / NE-GO po grani** i sačekaj odobrenje vlasnika
- Ako serija nosi migracije: PROD migracija ide **prije** merge-a, uz izričitu potvrdu vlasnika, kroz `POTVRDI_PROD=da pnpm db:apply-cloud --prod <fajl>`. Ovo agent **nikad ne izvršava sam** bez te potvrde.
- Mergaj PR-ove provjerenim redom
- **Invarijanta:** `git fetch origin && git diff integracija/$DATUM origin/main` mora biti prazan. Ako nije — stani i javi; deployano stanje nije ono koje je provjereno.

## Faza 8 — Čišćenje

- `git worktree remove .claude/worktrees/integracija`
- `git push origin --delete integracija/$DATUM` i `git branch -D integracija/$DATUM`

## Ovlaštenja

**Popravljaš sam** (mehaničko): rebase na main, paritet u `messages/*.json`, preimenovanje sudarenih timestampova migracija, regeneracija `db/types.ts`.

**Vraćaš vlasniku** (suštinsko): logički sudar dvije grane, sporna poslovna pravila, sporan dizajn. Ne mijenjaš tuđu logiku bez znanja vlasnika.

Svaka ispravka ide **u izvornu granu**, pa se grana ponovo spaja. Integraciona grana je uvijek izvedena, nikad izvor — briše se u Fazi 8, pa bi ispravka commitovana samo u nju nestala s njom, dok bi PR i dalje nosio pokvaren fajl u `main`.
