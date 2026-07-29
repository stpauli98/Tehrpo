# Zaduženi prijedlozi po firmi — dizajn

**Datum:** 2026-07-29
**Status:** odobreno, spremno za plan implementacije

## Problem

Polje „Zaduženi" (`ZaduzeniPolje`, `data-testid="novi-zaduzeni"`, `name="zaduzeni"`) je slobodan
tekst sa `<datalist>` prijedlozima. Prijedlozi trenutno dolaze iz `dohvatiImenaAktivnihKorisnika()`
→ RPC `get_aktivni_korisnici()`, koja vraća **sve aktivne korisnike bez obzira na ulogu ili
izabranu firmu**. Rezultat: operater zadužen samo za par klijenata vidi u prijedlozima i imena
kolega koji tu firmu nikad nisu radili.

Cilj: prijedlozi za „Zaduženi" treba da budu ograničeni na firmu koja je izabrana u formi —
konkretno na korisnike koji trenutno **imaju pristup** toj firmi po istoj logici koju već
definiše `ima_pristup_klijentu()`:
- svi **admini** (nisu ograničeni ni na jednu firmu, rade sa svima), i
- **operateri/pregled** koji imaju eksplicitnu dodjelu toj firmi u `korisnik_klijent`
  (dodjelu uređuje admin u Postavke → Korisnici, `KorisniciTab`/`KorisniciTabela`).

Polje ostaje slobodan tekst (`termini.zaduzeni` nije FK) — ovo mijenja samo skup prijedloga,
ne validaciju.

## Van dosega

- `get_aktivni_korisnici()` RPC se ne dira — koriste je i `aktivnost/page.tsx` i
  `KlijentPodsjetniciTab.tsx` za nešto nepovezano (primaoci podsjetnika), ne za „Zaduženi".
- Nema promjene u `ZaduzeniPolje.tsx` samom — i dalje prima običan `prijedlozi: string[]`.
- Nema promjene u validaciji/server akciji za `zaduzeni` — i dalje slobodan tekst.

## Dizajn

### 1. DB sloj

Nova migracija dodaje `get_zaduzeni_dodjele()`, `security definer` (isti razlog kao
`get_aktivni_korisnici` — RLS na `korisnici` je self-select, definer probija to kontrolisano),
vraća `(klijent_id uuid, ime text)`:

```sql
create or replace function get_zaduzeni_dodjele()
returns table (klijent_id uuid, ime text)
language sql stable security definer set search_path = public as $$
  select kl.id, k.ime
  from klijenti kl
  cross join korisnici k
  where k.aktivan and k.uloga = 'admin'
  union
  select kk.klijent_id, k.ime
  from korisnik_klijent kk
  join korisnici k on k.id = kk.korisnik_id
  where k.aktivan;
$$;

revoke execute on function get_zaduzeni_dodjele() from public;
grant execute on function get_zaduzeni_dodjele() to authenticated;
```

Isti PII-minimizacija princip kao `get_aktivni_korisnici`: samo `klijent_id` + `ime`, nikad
`email`/`uloga`/`id`. Migracija ide DEMO pa PROD (lockstep, korisnik pokreće cloud apply).
`pnpm db:types` se pokreće nakon `git fetch origin main` (poznata zamka — zastario lokalni
main pravi lažni drift).

### 2. Čista funkcija za grupisanje

U `lib/queries/aktivni-korisnici.ts`, pored postojeće `imenaZaPrijedloge`:

```ts
export function grupisiPrijedlogeByFirma(
  redovi: { klijent_id?: string | null; ime?: string | null }[] | null | undefined,
): Record<string, string[]>
```

Grupiše po `klijent_id`, dedup + sort imena unutar svake firme (isti stil kao
`imenaZaPrijedloge`). Testabilna bez mreže — dobija unit test u `aktivni-korisnici.test.ts`
(prazan ulaz, duplikati, više firmi, korisnik bez firme se preskače).

### 3. Server query wrapper

```ts
export async function dohvatiZaduzeniPrijedlogeByFirma(): Promise<Record<string, string[]>>
```

Zove `get_zaduzeni_dodjele()` preko SSR klijenta; na grešku vraća `{}` (prijedlozi su sporedni
UX sloj, isti princip kao postojeći `dohvatiImenaAktivnihKorisnika` i `dohvatiGodineTermina`).

### 4. Provlačenje kroz komponente

`zaduzeniPrijedlozi: string[]` → `zaduzeniPrijedloziByFirma: Record<string, string[]>` u:

- `app/(dashboard)/plan-aktivnosti/page.tsx` — fetch umjesto `dohvatiImenaAktivnihKorisnika()`.
- `_views/lista.tsx`, `_views/kalendar.tsx`, `_views/matrica.tsx` — samo mijenjaju tip proslijeđenog propa (bez logike).
- `components/domain/TerminSheet.tsx` — izvlači `zaduzeniPrijedloziByFirma[termin.klijent_id] ?? []` (klijent je fiksan, termin već postoji) i to prosljeđuje u `ZaduzeniPolje`.
- `components/domain/NoviTerminButton.tsx` — izvlači `klijentId ? (zaduzeniPrijedloziByFirma[klijentId] ?? []) : []`. Dok korisnik ne izabere firmu, `ZaduzeniPolje` dobija prazan niz — bez `<datalist>`, polje ostaje slobodno za unos. Ovo je namjerno (potvrđeno) umjesto fallback-a na globalnu listu — najjasnije ponašanje.

`ZaduzeniPolje.tsx` se ne mijenja.

## Testiranje

- Unit test za `grupisiPrijedlogeByFirma` (nova funkcija).
- Postojeći e2e testovi koji koriste `novi-zaduzeni`/`zaduzeni-prijedlozi` testId-jeve treba
  provjeriti — ako neki test bira firmu bez dodjele i očekuje prijedloge, ponašanje se mijenja
  namjerno (sad prazno umjesto globalne liste). Provjeriti prije merge-a, ne dodavati nove
  e2e specove osim ako plan implementacije to zatraži.

## Napomene za implementaciju

- Slijedi postojeći obrazac `lokacijeByFirma: Record<string, Opt[]>` u `NoviTerminButton.tsx`
  — ista vrsta mape, isti stil.
- DEMO/PROD lockstep i cloud apply i dalje pokreće korisnik (nikad automatski iz agenta).
