# Motor podsjetnika — Krug 1: funkcionalne ispravke

**Datum:** 2026-06-29
**Grana:** `fix/motor-podsjetnika-krug1`
**Status:** odobren dizajn → slijedi plan implementacije

## Kontekst i problem

Srž TEHPRO aplikacije je „ne propustiti zakonski rok". Adversarijalno-verifikovan review motora podsjetnika našao je da motor **trenutno ne radi automatski u produkciji** i da, čak i kad se pokrene ručno, šalje pogrešno:

1. **Cron nije zakazan** — `vercel.json` nema `crons`; ruta se nikad ne pokrene automatski. *(CRITICAL)*
2. **Ruta je samo `POST`** — Vercel Cron zove `GET` → 405 i nakon dodavanja `crons`. *(HIGH)*
3. **Šalje klijentu** — `recipients.ts` dodaje klijentske adrese (`lokacija.kontakt_email`, `klijenti.podsjetnik_emails`); krši brief §5.5/§11. Ako `REMINDER_TO` nije postavljen, klijent je **jedini** primalac, TEHPRO ne dobije ništa. *(HIGH)*
4. **Nema catch-up** — `get_due_podsjetnici` traži tačnu jednakost `rok = current_date + d`; propušten dan cron-a = taj prag **trajno preskočen**. *(HIGH)*
5. **Nema post-due + pogrešni default rokovi** — defaulti `{30,14,7,1}` umjesto `{60,30,15,7}`; nakon isteka roka nema eskalacije (negativni offset nemoguć zbog `chk_podsjetnici_dana_prije between 0 and 365`). *(HIGH)*

## Obim

**U obimu (Krug 1):** sve gornje funkcionalne greške (1–5), uz **privremeni** model primalaca (interno, nikad klijent).

**Van obima (zaseban spec/krug):**
- **Krug 2 — elegantno usmjeravanje po ulogama:** vlasnik klijenta (preko `korisnik_klijent`) dobija samo svoje termine; admin sve. Krug 1 koristi prelazno: svi admini + `REMINDER_TO`.
- In-app (app) kanal podsjetnika — ostaje samo email.
- Nepovezani nalazi iz reviewa: `createProfilProvjere` koji guta grešku upisa u `termini`; RLS rupe na `chat_poruke` i `storage.objects`.

## Relevantna šema (postojeća)

- `termini(id, klijent_id, lokacija_id, vrsta_provjere_id, rok_dospijeca date, status termini_status, zaduzeni text, ...)`; enum statusa `('planirano','zakazano','izvrseno','otkazano')` — `kasni` je samo izvedeni status u `termini_view`.
- `podsjetnici(id, termin_id, dana_prije int, poslat_na text[], poslat_at, resend_id)`, unique `uq_podsjetnici_termin_dana (termin_id, dana_prije)`, check `chk_podsjetnici_dana_prije (dana_prije between 0 and 365)`.
- `postavke(id=1 singleton, dana_prije int[] default '{30,14,7,1}')`.
- `korisnici(id, ime, email, uloga ('admin'|'operater'|'pregled'), aktivan)`; `korisnik_klijent(korisnik_id, klijent_id)` N:N dodjela.
- `klijenti` **nema** `zaduzeni_tehpro_id`; `termini.zaduzeni` je slobodan tekst (ne FK) → za usmjeravanje po vlasniku koristi se `korisnik_klijent` (Krug 2).
- Klijent (service-role/admin) u `runReminders` smije čitati `korisnici` (potrebno za primaoce).

## Rješenje po komponentama

### 1. Pokretanje crona + GET handler
- `vercel.json`: dodati
  ```json
  "crons": [{ "path": "/api/cron/reminders", "schedule": "0 6 * * *" }]
  ```
  (06:00 UTC ≈ 08:00 lokalno ljeti). Vercel automatski šalje `Authorization: Bearer $CRON_SECRET` kad je env postavljen; `proxy.ts` već propušta `/api/cron` (PUBLIC).
- `app/api/cron/reminders/route.ts`: izvući tijelo u `async function handle(req: Request)`, pa `export const GET = handle; export const POST = handle`. Vercel Cron poziva **GET**; POST ostaje za ručno/test. Bearer provjera ostaje (fail-closed ako `CRON_SECRET` prazan/nepostavljen). `handle` tolerantan na prazan body (GET nema body → `dryRun=false`).

### 2. + 3. (catch-up i post-due) — novi `get_due_podsjetnici`
Jedan RPC, dvije grane, **ista idempotencija** preko `(termin_id, dana_prije)`:

```sql
create or replace function get_due_podsjetnici(dana_prije_arr int[])
returns table (
  termin_id      uuid,
  dana_prije     int,        -- prag (pre-due >=0) ILI -dana_kašnjenja (post-due <0); idempotencijski ključ
  klijent_id     uuid,       -- za Krug 2 (usmjeravanje po vlasniku)
  klijent_naziv  text,
  vrsta_naziv    text,
  rok_dospijeca  date,       -- email tekst računa stvarne dane iz rok vs danas
  lokacija_naziv text
)
language sql stable
as $$
  -- PRE-DUE: najmanji JOŠ-neposlat prag čiji je prozor ušao, po terminu
  ( select distinct on (t.id)
      t.id, d.d, k.id, k.naziv, vp.naziv, t.rok_dospijeca, l.naziv
    from termini t
    join klijenti k        on k.id = t.klijent_id
    join vrste_provjera vp on vp.id = t.vrsta_provjere_id
    left join lokacije l   on l.id = t.lokacija_id
    cross join unnest(dana_prije_arr) as d(d)
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca >= current_date
      and d.d >= (t.rok_dospijeca - current_date)
      and not exists (select 1 from podsjetnici p
                      where p.termin_id = t.id and p.dana_prije = d.d)
    order by t.id, d.d asc )
  union all
  -- POST-DUE: jedan red dnevno dok status nije izvrseno/otkazano
  ( select
      t.id, (t.rok_dospijeca - current_date), k.id, k.naziv, vp.naziv, t.rok_dospijeca, l.naziv
    from termini t
    join klijenti k        on k.id = t.klijent_id
    join vrste_provjera vp on vp.id = t.vrsta_provjere_id
    left join lokacije l   on l.id = t.lokacija_id
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca < current_date
      and not exists (select 1 from podsjetnici p
                      where p.termin_id = t.id
                        and p.dana_prije = (t.rok_dospijeca - current_date)) )
  order by rok_dospijeca, klijent_naziv;
$$;
```

**Logika catch-up:** za termin koji dospijeva za `N` dana šalje se najmanji `d ∈ dana_prije` sa `d ≥ N` koji još nije poslat (`distinct on (t.id) order by d asc`). Propušten dan se nadoknadi na sljedećem pokretanju; nikad se ne šalje više pragova odjednom (npr. termin kreiran 5 dana prije roka dobije samo prag 7, ne i 60/30/15).

**Logika post-due:** `dana_prije = rok - current_date` (negativno) — svaki dan kašnjenja je različita vrijednost → postojeći unique indeks daje **tačno jedan mail po danu** dok se termin ne označi `izvrseno`/`otkazano`. Bez nove tabele.

### 4. Default rokovi 60/30/15/7 + olabavljen constraint (migracija)
- `alter table postavke alter column dana_prije set default '{60,30,15,7}';`
- `update postavke set dana_prije = '{60,30,15,7}' where id = 1 and dana_prije = '{30,14,7,1}';` (mijenja samo ako je još na starom defaultu — ne gazi admin-podešavanje).
- `alter table podsjetnici drop constraint chk_podsjetnici_dana_prije, add constraint chk_podsjetnici_dana_prije check (dana_prije between -3650 and 365);` (dozvoljava negativni post-due marker, gornji limit kašnjenja ~10 god).
- `lib/reminders/runReminders.ts`: `DEFAULT_DANA = [60,30,15,7]`.
- Admin validacija u `app/(dashboard)/postavke/actions.ts` (`n>=0 && n<=365`) **ostaje** — admin unosi samo pre-due pragove; post-due je sistemski.

Migracija ide kao **jedan fajl** `supabase/migrations/<ts>_podsjetnici_catchup_postdue.sql` (RPC + constraint + postavke default/update).

### 5. Primaoci — privremeno (Krug 1)
- RPC više ne vraća klijentske adrese; `runReminders` računa primaoce po pokretanju:
  `recipients = { email | korisnici.uloga='admin' AND aktivan } ∪ { REMINDER_TO ako postoji }`.
- Ako je lista prazna → **preskoči slanje uz `console.warn`/log** (nikad fallback na klijenta).
- `lib/reminders/recipients.ts` se pojednostavljuje na dedup+validaciju interne liste (uklanja `klijentEmails`/`lokacijaEmail`).
- `lib/email/templates.ts`: tekst računa stvarne dane iz `rok_dospijeca` vs današnji datum; grana za kašnjenje („Kasni X dana") kad je rok prošao, inače „Dospijeva za X dana".

## Tok podataka (po pokretanju crona)

```
Vercel Cron (GET, Bearer CRON_SECRET)
  → app/api/cron/reminders/route.ts handle()
    → lib/reminders/runReminders.ts
       1. čita postavke.dana_prije (ili DEFAULT_DANA)
       2. rpc get_due_podsjetnici(dana_prije)  →  redovi (pre-due + post-due)
       3. primaoci = adminEmails(korisnici) + REMINDER_TO   [ako prazno → skip+log]
       4. za svaki red: pošalji email (Resend ili drySend) i upiši podsjetnici (idempotentno)
```

## Testiranje / validacija

- **Lokalni Supabase (Docker):** `supabase start` → `pnpm db:reset` primjenjuje sve migracije uključujući novu.
- **Unit (vitest):**
  - `lib/reminders/recipients.test.ts` — ažuriran za interne primaoce (admini + REMINDER_TO, bez klijenta, prazna lista → prazno).
  - `lib/email/templates.test.ts` — pre-due i post-due varijanta teksta.
- **Integraciona provjera RPC-a (nad lokalnim DB, preko `pg`/`DATABASE_URL`):** seed termina na offsetima `{+61, +30, +7, +0, -1, -3}` i potvrdi:
  - `+61`: ništa (prozor 60 još nije ušao);
  - `+30`: prag 30; ponovni poziv istog dana → ništa (idempotentno);
  - `+7` sa već poslatim 30/15 → prag 7; sa ničim poslatim → samo prag 7 (ne 60/30/15);
  - `-1`, `-3`: po jedan post-due red dnevno; ponovni poziv istog dana → ništa;
  - `izvrseno`/`otkazano` termin → nikad.
- **E2E (`tests/e2e`)** ostaju zelene; cron putanja se ne pokriva E2E-om (manuelno preko `pnpm reminders`).
- **Cloud:** korisnik primjenjuje migraciju preko `pnpm db:apply-cloud <fajl>` kad bude spreman; `db/types.ts` se regeneriše (`pnpm db:types`).

## Kriterijumi prihvatanja

- [ ] `vercel.json` ima `crons` za `/api/cron/reminders`; ruta odgovara na `GET` (200) uz validan Bearer i `401` bez njega.
- [ ] Default pragovi su `{60,30,15,7}` (kod i `postavke` red koji je bio na starom defaultu).
- [ ] Propušten dan ne gubi prag: termin čiji je „tačan dan" prošao i dalje dobije najmanji neposlat prag na sljedećem pokretanju.
- [ ] Termin u kašnjenju dobija jedan email po danu dok nije `izvrseno`/`otkazano`; isti dan nema duplikata.
- [ ] Nijedan email ne ide na klijentsku adresu; pri praznoj internoj listi slanje se preskače (TEHPRO/klijent ne dobiju ništa, log upozorava).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` prolaze; integraciona provjera RPC-a potvrđuje gornje slučajeve.

## Rizici / napomene

- Vercel cron na Hobby planu je ograničen na dnevnu granularnost — dnevni `0 6 * * *` je u skladu.
- Negativni `dana_prije` u `podsjetnici` je namjeran (post-due marker); izvještaji/UI koji čitaju `podsjetnici.dana_prije` treba da tretiraju `<0` kao kašnjenje.
- Promjena povratnog tipa RPC-a zahtijeva ažuriranje maperisanja u `runReminders` i (ako se koristi u tipovima) `pnpm db:types`.
