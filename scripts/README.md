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
