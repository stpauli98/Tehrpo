# Scripts

## `pnpm seed`

Puni lokalnu dev bazu sa stvarnim Tehpro podacima iz Excel-a koji se nalazi u
parent direktoriju projekta:
```
../2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx
```

**Preduslovi:**
- `supabase start` mora biti pokrenut (lokalni Docker stack)
- Migracije primijenjene: `pnpm db:reset`
- `.env.local` postoji sa ispravnim `SUPABASE_SERVICE_ROLE_KEY`

**Pokretanje:**
```bash
pnpm seed
```

**Idempotentnost:**
- `klijenti` i `vrste_provjera` se upsert-uju po `naziv` (UNIQUE constraint)
  — ponavljanje ne pravi duplikate
- `termini` se brišu i ponovo insertuju svaki put (clean state)

**Batch insert:**
- Termini se insertuju u batch-ovima od 500 (Supabase REST limit)

**Skipped rows:**
- Excel ćelije koje nisu datum niti prazne se loguju kao skipped (normalno ~170)

---

## `pnpm db:reset`

Resetuje lokalnu bazu i ponovo primjenjuje sve migracije. Briše sve podatke.
Nakon toga, pokreni `pnpm seed` da napuniš bazu.

```bash
pnpm db:reset && pnpm seed
```

---

## `pnpm db:types`

Generiše `db/types.ts` iz trenutne sheme lokalne baze (zahtijeva pokrenut
`supabase start`).

```bash
pnpm db:types
```

---

## `pnpm preview:emails`

Testni harness za automatske (Resend) mejlove — pregled, dry-run primalaca, i
opciono kontrolisano slanje. Tri moda:

**1. RENDER (default)** — renderuje sve automatske mejlove kao samostalne `.html`
fajlove (interni podsjetnik ×2, firmin podsjetnik ×2, zakazano nakon roka, test
email = 6 fajlova) i ispiše putanje. Bez mreže i bez upisa u bazu.

```bash
pnpm preview:emails                 # zapiše u os.tmpdir()/tehpro-email-preview
# override izlaznog dir-a:
pnpm exec tsx --env-file=.env.local scripts/preview-emails.ts --out /tmp/moj-dir
```

Izlaz ide u `os.tmpdir()/tehpro-email-preview` (ne u repo). Na kraju ispiše
`Otvori: file://<dir>`.

**2. DRY-RUN PRIMAOCI (`--recipients`)** — pokreće stvarni reminder engine
(`runReminders`) sa `drySend` i ispiše TAČNE primaoce po terminu (interni + firma
BCC spojeni), plus skipped (sa razlogom) i errors. **Ništa se ne šalje, audit se
ne upisuje.** Čita bazu preko admin (service-role) klijenta.

```bash
pnpm preview:emails --recipients
```

**3. ŽIVO SLANJE (`--send-to <email>`)** — pošalje po jedan primjerak svakog tipa
na jednu test-adresu. **Guardovano:** radi samo ako je `EMAIL_TEST_OVERRIDE=1`
(inače `exit 1`). Bez `RESEND_API_KEY` ostaje dry-run (vidi `dryRun` flag u ispisu).

```bash
EMAIL_TEST_OVERRIDE=1 pnpm exec tsx --env-file=.env.local scripts/preview-emails.ts --send-to me@example.com
```

**Napomena o env-u:** `lib/env.ts` se učitava tranzitivno (preko
firmBrand/templates) i zod-om validira `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` na importu — pa **čak i RENDER mod treba env**.
`pnpm preview:emails` već prosljeđuje `--env-file=.env.local`; ako pokrećeš `tsx`
ručno, dodaj `--env-file=.env.local`.
