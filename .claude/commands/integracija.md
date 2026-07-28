---
description: Integracioni gate — spoji spremne grane, provjeri sklop, izvijesti GO/NE-GO
---

Sprovedi integracioni gate po `docs/superpowers/specs/2026-07-28-integracioni-gate-design.md`.

Argument (opciono): spisak grana. Bez argumenta — sam sastavi spisak.

## Faza 0 — Prijem

- `git fetch origin --prune`
- `gh pr list --state open` i `git branch --format='%(refname:short)'`
- Za svaku granu: `git rev-list --left-right --count origin/main...<grana>`
- Ispiši predloženu seriju (grane, redoslijed po rastućem broju PR-a) i **sačekaj potvrdu vlasnika**. Ne nastavljaj bez nje.

## Faza 1 — Sklapanje

- `git worktree add .claude/worktrees/integracija -b integracija/$(date +%F) origin/main`
- U tom worktree-u: `pnpm install --frozen-lockfile`
- Spajaj grane **serijski, po rastućem broju PR-a**: `git merge --no-ff <grana>`
- Konflikt zabilježi i **stani** — ne rješavaj napamet. Prijavi vlasniku čije su grane u sudaru.

## Faza 2 — Statičke provjere

- Pokreni `pnpm provjeri:integraciju` (podrazumijevana bazna grana: `origin/main`).
- Zastavice postoje, ali `pnpm` traži `--` prije njih, inače ih pojede sam `pnpm`:
  - `pnpm provjeri:integraciju -- --baza <ref>` — eksplicitna bazna grana umjesto `origin/main`
  - `pnpm provjeri:integraciju -- --sve` — svi fajlovi migracija bez obzira na git stanje (ignoriše `--baza` ako je zadan uz njega)
- Izlazni kod: `0` čisto, `1` ima nalaza (svaki ispisan kao `putanja:linija — [pravilo] poruka`), `2` greška u opcijama ili bazna grana nije razrešiva lokalno (obično treba `git fetch origin` prvo — vrati se na Fazu 1 provjeriti fetch, ne tretiraj kao "čisto").
- Obuhvat migracija u podrazumijevanom/`--baza` režimu je **unija**: commitovane izmjene prema baznoj grani (`git diff <baza>...HEAD`) **i** necommitovane izmjene u radnom stablu (untracked/staged/modified). U integracionom worktree-u je sve već commitovano kroz merge-eve iz Faze 1, pa je ovo uglavnom bez efekta — ali ako u toku gate-a napraviš ručnu ispravku (Faza 4 rebase, paritet prevoda...) prije nego je komituješ, ona već ulazi u obuhvat sljedećeg pokretanja.
- Svaki nalaz nosi grana koja ga je uvela. Utvrdi je preko `git log -S "<karakterističan string iz nalaza>" -- <fajl>` (ili `git blame <fajl>` pa provjeri koji merge commit je unio liniju) — obavezno prije nego nalaz pripišeš nekoj grani u izvještaju.

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

- `git push -u origin integracija/$(date +%F)`
- Sačekaj Vercel Preview i provjeri deployanu aplikaciju

## Faza 7 — Merge

- Izvijesti **GO / NE-GO po grani** i sačekaj odobrenje vlasnika
- Ako serija nosi migracije: PROD migracija ide **prije** merge-a, uz izričitu potvrdu vlasnika, kroz `POTVRDI_PROD=da pnpm db:apply-cloud --prod <fajl>`. Ovo agent **nikad ne izvršava sam** bez te potvrde.
- Mergaj PR-ove provjerenim redom
- **Invarijanta:** `git fetch origin && git diff integracija/<datum> origin/main` mora biti prazan. Ako nije — stani i javi; deployano stanje nije ono koje je provjereno.

## Faza 8 — Čišćenje

- `git worktree remove .claude/worktrees/integracija`
- `git push origin --delete integracija/<datum>` i `git branch -D integracija/<datum>`

## Ovlaštenja

**Popravljaš sam** (mehaničko): rebase na main, paritet u `messages/*.json`, preimenovanje sudarenih timestampova migracija, regeneracija `db/types.ts`.

**Vraćaš vlasniku** (suštinsko): logički sudar dvije grane, sporna poslovna pravila, sporan dizajn. Ne mijenjaš tuđu logiku bez znanja vlasnika.

Svaka ispravka ide **u izvornu granu**, pa se grana ponovo spaja. Integraciona grana je uvijek izvedena, nikad izvor — briše se u Fazi 8, pa bi ispravka commitovana samo u nju nestala s njom, dok bi PR i dalje nosio pokvaren fajl u `main`.
