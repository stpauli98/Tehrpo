# Kontakt ↔ lokacija i podsjetnici po lokaciji — plan izvedbe

> **Za agentske izvršioce:** OBAVEZNA POD-VJEŠTINA: koristi superpowers:executing-plans
> (ili subagent-driven-development). Koraci koriste checkbox (`- [ ]`) sintaksu.

**Cilj:** Podsjetnik za termin na lokaciji L ide kontaktima vezanim za L **plus**
kontaktima firme — a ne svim kontaktima firme kao danas.

**Arhitektura:** Jedna nullable kolona `kontakt_osobe.lokacija_id` (`null` = kontakt
firme). Indeks primalaca se grupiše po firmi **pa po lokaciji**; ad-hoc adrese firme
idu pod ključ `null` jer su po definiciji firmi-široke. Dvije RPC-e prošire se da
vraćaju `lokacija_id`, koji motor prosljeđuje u odabir primalaca.

**Tehnologije:** Next.js 16, TypeScript, Vitest, Playwright, Supabase/Postgres, next-intl.

## Globalna ograničenja

- Desktop-only: eslint zabranjuje `sm:`/`md:` prefikse — koristi `lg:`/`xl:`/`2xl:` ili bez.
- Ništa hardkodirano; kopija ide u `messages/{sr,en,de}.json`.
- Paket menadžer **pnpm**.
- `pnpm typecheck` i `pnpm lint` čisti prije svakog commita.
- Migracije: DEMO **i** PROD (lockstep). **Cloud apply pokreće korisnik** — agent ne dira baze.
- `no-await-in-loop` je greška, ne upozorenje.
- Commit poruke na bosanskom.

## Struktura fajlova

| Fajl | Odgovornost |
|---|---|
| `supabase/migrations/20260728140000_kontakt_lokacija.sql` | kolona + brava iste firme + indeks |
| `supabase/migrations/20260728141000_rpc_lokacija_id.sql` | obje RPC-e vraćaju `lokacija_id` |
| `db/types.ts` | ručna dopuna (codegen traži lokalni Supabase) |
| `lib/reminders/recipients.ts` | indeks po lokaciji + `firmaRecipientsZa` |
| `lib/reminders/recipients.test.ts` | postojeći testovi + novi za lokaciju |
| `lib/reminders/runReminders.ts` | proslijedi `r.lokacija_id` |
| `lib/reminders/runPostDue.ts` | isto |
| `components/domain/KontaktSheet.tsx` | padajući spisak „Lokacija" |
| `components/domain/LokacijaSheet.tsx` | sekcija kontakta (postojeći / novi) |
| `app/(dashboard)/klijenti/actions.ts` | `lokacija_id` u kontakt akcijama |
| `messages/{sr,en,de}.json` | kopija |

---

### Zadatak 1: Migracija — `kontakt_osobe.lokacija_id`

**Fajlovi:**
- Kreirati: `supabase/migrations/20260728140000_kontakt_lokacija.sql`
- Izmijeniti: `db/types.ts`

- [ ] **Korak 1: Napiši migraciju**

```sql
-- Kontakt osoba može pripadati jednoj lokaciji firme.
--   lokacija_id IS NULL  → kontakt firme: prima podsjetnike za SVE lokacije
--   lokacija_id postavljen → kontakt lokacije: prima samo za tu lokaciju
--
-- Postojeći redovi dobijaju NULL, pa se ponašaju tačno kao dosad — migracija
-- NE mijenja kome šta stiže. Vezivanje je svjesna radnja korisnika kroz UI.

-- Brava: lokacija mora pripadati ISTOJ firmi kao kontakt. Bez složenog stranog
-- ključa moglo bi se vezati kontakt jedne firme za lokaciju druge.
alter table lokacije
  add constraint uq_lokacije_id_klijent unique (id, klijent_id);

alter table kontakt_osobe
  add column if not exists lokacija_id uuid,
  add constraint fk_kontakt_lokacija_ista_firma
    foreign key (lokacija_id, klijent_id)
    references lokacije (id, klijent_id)
    on delete set null;

create index if not exists idx_kontakt_osobe_lokacija
  on kontakt_osobe (klijent_id, lokacija_id);

comment on column kontakt_osobe.lokacija_id is
  'NULL = kontakt firme (prima za sve lokacije); postavljen = prima samo za tu lokaciju.';
```

- [ ] **Korak 2: Dopuni `db/types.ts` ručno**

U `kontakt_osobe` Row/Insert/Update dodaj `lokacija_id: string | null` (Row) odnosno
`lokacija_id?: string | null` (Insert/Update). Naći sa:
`grep -n "kontakt_osobe: {" db/types.ts`

- [ ] **Korak 3: Provjeri**

Pokreni: `pnpm typecheck`
Očekivano: prolazi (kolona je opciona svuda).

- [ ] **Korak 4: Commit**

```bash
git add supabase/migrations/20260728140000_kontakt_lokacija.sql db/types.ts
git commit -m "feat(kontakt): kolona lokacija_id sa bravom na istu firmu"
```

---

### Zadatak 2: Odabir primalaca po lokaciji (JEZGRO — TDD)

**Fajlovi:**
- Izmijeniti: `lib/reminders/recipients.ts`
- Test: `lib/reminders/recipients.test.ts`

**Interfejsi:**
- `KontaktPrimalacRow` dobija `lokacija_id: string | null`
- `RecipientIndex.klijentEmailsByKlijent` → `klijentEmailsByLokacija: Map<string, Map<string | null, string[]>>`
- `firmaRecipientsForKlijent(index, klijentId)` → **`firmaRecipientsZa(index, klijentId, lokacijaId: string | null)`**

- [ ] **Korak 1: Prebaci postojeće testove na novo ime**

13 postojećih poziva u `recipients.test.ts` testiraju ponašanje bez lokacije. Mehanička
zamjena čuva ih kao regresiju:

```bash
sed -i '' 's/firmaRecipientsForKlijent(idx, "K1")/firmaRecipientsZa(idx, "K1", null)/g' lib/reminders/recipients.test.ts
sed -i '' 's/firmaRecipientsForKlijent/firmaRecipientsZa/' lib/reminders/recipients.test.ts
```

Zatim u `buildRecipientIndex` pozivima u testu dodaj `lokacija_id: null` svakom kontaktu.

- [ ] **Korak 2: Dodaj nove testove (padaju)**

```ts
describe("firmaRecipientsZa — podsjetnici po lokaciji", () => {
  const klijenti = [{ id: "K1", salji_podsjetnik_klijentu: true }]
  const kontakti = [
    { klijent_id: "K1", email: "hq@firma.ba", podsjetnik_primalac: true, lokacija_id: null },
    { klijent_id: "K1", email: "lok1@firma.ba", podsjetnik_primalac: true, lokacija_id: "L1" },
    { klijent_id: "K1", email: "lok2@firma.ba", podsjetnik_primalac: true, lokacija_id: "L2" },
  ]
  const idx = buildRecipientIndex([], [], klijenti, kontakti, true)

  it("kontakt lokacije 2 NE dobija podsjetnik za lokaciju 1", () => {
    expect(firmaRecipientsZa(idx, "K1", "L1")).not.toContain("lok2@firma.ba")
  })

  it("termin na lokaciji ide vezanom kontaktu I kontaktu firme", () => {
    expect(firmaRecipientsZa(idx, "K1", "L1").sort()).toEqual(["hq@firma.ba", "lok1@firma.ba"])
  })

  it("termin bez lokacije ide samo kontaktima firme", () => {
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual(["hq@firma.ba"])
  })

  it("lokacija bez vezanih kontakata pada na kontakte firme", () => {
    expect(firmaRecipientsZa(idx, "K1", "L9")).toEqual(["hq@firma.ba"])
  })

  it("isključen podsjetnik_primalac isključuje kontakt bez obzira na lokaciju", () => {
    const i2 = buildRecipientIndex([], [], klijenti, [
      { klijent_id: "K1", email: "lok1@firma.ba", podsjetnik_primalac: false, lokacija_id: "L1" },
    ], true)
    expect(firmaRecipientsZa(i2, "K1", "L1")).toEqual([])
  })

  it("ad-hoc adrese firme stižu i za lokacijski termin", () => {
    const i3 = buildRecipientIndex([], [],
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["adhoc@firma.ba"] }],
      kontakti, true)
    expect(firmaRecipientsZa(i3, "K1", "L1")).toContain("adhoc@firma.ba")
  })
})
```

- [ ] **Korak 3: Pokreni i potvrdi pad**

`pnpm exec vitest run lib/reminders/recipients.test.ts` → FAIL (`firmaRecipientsZa` ne postoji).

- [ ] **Korak 4: Implementiraj**

`KontaktPrimalacRow` dobija `lokacija_id: string | null`.

`RecipientIndex`:
```ts
export type RecipientIndex = {
  adminEmails: string[]
  assignedByKlijent: Map<string, string[]>
  /**
   * Mejlovi flagovanih kontakata (Krug 2), grupisani po firmi pa po LOKACIJI.
   * Ključ `null` = kontakt firme — prima za sve lokacije. Ad-hoc adrese firme
   * (`klijenti.podsjetnik_emails`) idu pod isti `null` ključ jer su firmi-široke.
   */
  klijentEmailsByLokacija: Map<string, Map<string | null, string[]>>
}
```

U `buildRecipientIndex` zamijeni punjenje `klijentEmailsByKlijent`:
```ts
  const klijentEmailsByLokacija = new Map<string, Map<string | null, string[]>>()
  const dodaj = (klijentId: string, lokacijaId: string | null, email: string) => {
    const poLok = klijentEmailsByLokacija.get(klijentId) ?? new Map<string | null, string[]>()
    const arr = poLok.get(lokacijaId) ?? []
    arr.push(email)
    poLok.set(lokacijaId, arr)
    klijentEmailsByLokacija.set(klijentId, poLok)
  }
```
Kontakti → `dodaj(ko.klijent_id, ko.lokacija_id ?? null, email)`.
Ad-hoc adrese → `dodaj(k.id, null, email)`.

Nova funkcija (zamjenjuje `firmaRecipientsForKlijent`):
```ts
/**
 * Firmine (Krug 2) adrese za jedan termin. Lokacijski kontakti se DODAJU firminim,
 * ne zamjenjuju ih: „kontakt firme" znači „prati sve", pa centrala ne smije tiho
 * ispasti iz obavještenja čim lokacija dobije svog koordinatora.
 *
 * `lokacijaId === null` (termin bez lokacije) → samo kontakti firme; vezani kontakt
 * ne može znati tiče li ga se.
 */
export function firmaRecipientsZa(
  index: RecipientIndex,
  klijentId: string,
  lokacijaId: string | null,
): string[] {
  const poLok = index.klijentEmailsByLokacija.get(klijentId)
  if (!poLok) return []
  const firmini = poLok.get(null) ?? []
  const vezani = lokacijaId ? (poLok.get(lokacijaId) ?? []) : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...vezani, ...firmini]) {
    const e = raw.trim().toLowerCase()
    if (!EMAIL_RE.test(e) || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out
}
```

U `loadRecipientIndex` proširi select: `.select("klijent_id, email, podsjetnik_primalac, lokacija_id")`.

- [ ] **Korak 5: Testovi prolaze**

`pnpm exec vitest run lib/reminders/recipients.test.ts` → PASS.

- [ ] **Korak 6: Commit**

```bash
pnpm typecheck && pnpm lint
git add lib/reminders/recipients.ts lib/reminders/recipients.test.ts
git commit -m "feat(podsjetnici): primaoci se biraju po lokaciji termina"
```

---

### Zadatak 3: RPC-e vraćaju `lokacija_id`

**Fajlovi:**
- Kreirati: `supabase/migrations/20260728141000_rpc_lokacija_id.sql`
- Izmijeniti: `db/types.ts`

**Osnova za prepis** (potpisi se mijenjaju → `drop` + `create`; provjereno da ih
nijedna SQL funkcija ne poziva):
- `get_due_podsjetnici` → `supabase/migrations/20260720121000_get_due_bez_post_due.sql`
- `get_post_due_termine` → `supabase/migrations/20260720122000_get_post_due_termine.sql`

- [ ] **Korak 1: Prepiši obje funkcije**

Kopiraj najnovije definicije, dodaj `lokacija_id uuid` u `returns table` (odmah uz
`lokacija_naziv`) i `l.id as lokacija_id` u `select`. Ostatak tijela ne dirati.
Prije `create` staviti `drop function if exists <ime>(<tipovi argumenata>);`.

- [ ] **Korak 2: Dopuni `db/types.ts`**

U `Functions.get_due_podsjetnici.Returns` i `get_post_due_termine.Returns` dodaj
`lokacija_id: string | null`.

- [ ] **Korak 3: Provjeri**

`pnpm typecheck` → prolazi.

- [ ] **Korak 4: Commit**

```bash
git add supabase/migrations/20260728141000_rpc_lokacija_id.sql db/types.ts
git commit -m "feat(podsjetnici): RPC-e vraćaju lokacija_id"
```

---

### Zadatak 4: Motor prosljeđuje lokaciju

**Fajlovi:**
- Izmijeniti: `lib/reminders/runReminders.ts:116`, `lib/reminders/runPostDue.ts:94`

- [ ] **Korak 1: Zamijeni pozive**

`runReminders.ts`:
```ts
    const firma = firmaRecipientsZa(recipientIndex, r.klijent_id, r.lokacija_id ?? null)
```
`runPostDue.ts`:
```ts
      : firmaRecipientsZa(index, r.klijent_id!, r.lokacija_id ?? null)
```
Uskladi i `import` u oba fajla.

- [ ] **Korak 2: Puna regresija**

```bash
pnpm typecheck && pnpm lint && pnpm test:unit
```
Očekivano: sve prolazi. Postojeći testovi motora ne smiju pasti — svi njihovi kontakti
imaju `lokacija_id: null`, dakle ponašanje je nepromijenjeno.

- [ ] **Korak 3: Commit**

```bash
git add lib/reminders/runReminders.ts lib/reminders/runPostDue.ts
git commit -m "feat(podsjetnici): motor prosljeđuje lokaciju termina u odabir primalaca"
```

---

### Zadatak 5: Kopija (sr/en/de)

**Fajlovi:** `messages/{sr,en,de}.json`

| ključ | sr | en | de |
|---|---|---|---|
| `klijenti.kontakt.poljeLokacija` | `Lokacija` | `Location` | `Standort` |
| `klijenti.kontakt.lokacijaSve` | `Sve lokacije — kontakt firme` | `All locations — company contact` | `Alle Standorte — Firmenkontakt` |
| `klijenti.kontakt.lokacijaPomoc` | `Kontakt firme prima podsjetnike za sve lokacije. Vezan za lokaciju — samo za tu.` | `A company contact receives reminders for all locations. Bound to a location — only for that one.` | `Ein Firmenkontakt erhält Erinnerungen für alle Standorte. An einen Standort gebunden — nur für diesen.` |
| `klijenti.lokacija.kontaktNaslov` | `Kontakt za ovu lokaciju` | `Contact for this location` | `Kontakt für diesen Standort` |
| `klijenti.lokacija.kontaktPostojeci` | `Postojeći kontakt` | `Existing contact` | `Vorhandener Kontakt` |
| `klijenti.lokacija.kontaktNovi` | `Novi kontakt` | `New contact` | `Neuer Kontakt` |
| `klijenti.lokacija.kontaktBez` | `Bez kontakta` | `No contact` | `Kein Kontakt` |

Ubaciti čuvajući postojeći redoslijed (Python skriptom sa `object_pairs_hook=OrderedDict`,
kao u ranijim zadacima) — ne preuređivati fajl.

- [ ] **Korak 1: Dodaj ključeve**
- [ ] **Korak 2: `git diff messages/sr.json` — samo dodane linije**
- [ ] **Korak 3: Commit** `feat(kontakt): kopija za vezu kontakt↔lokacija (sr/en/de)`

---

### Zadatak 6: Forma kontakta — izbor lokacije

**Fajlovi:**
- Izmijeniti: `components/domain/KontaktSheet.tsx`
- Izmijeniti: `app/(dashboard)/klijenti/actions.ts` (kontakt create/update shema)

- [ ] **Korak 1: Proslijedi lokacije u sheet**

`KontaktSheet` dobija prop `lokacije: { id: string; naziv: string }[]` (pozivno mjesto
ih već ima — provjeri `IdKartaTab.tsx`).

- [ ] **Korak 2: Polje**

Ispod „Funkcija" dodaj `Select name="lokacija_id"` sa prvom stavkom
`value=""` → `t("lokacijaSve")`, pa lokacije. `defaultValue={kontakt?.lokacija_id ?? ""}`.
Ispod polja `<p className="text-xs text-muted-foreground">{t("lokacijaPomoc")}</p>`.

- [ ] **Korak 3: Akcija**

U zod shemu kontakta dodaj `lokacija_id: z.string().uuid().optional().or(z.literal(""))`,
a pri upisu `lokacija_id: f.lokacija_id || null`.

- [ ] **Korak 4: `pnpm typecheck && pnpm lint && pnpm test:unit`**
- [ ] **Korak 5: Commit** `feat(kontakt): izbor lokacije u formi kontakta`

---

### Zadatak 7: Forma lokacije — postojeći ili novi kontakt

**Fajlovi:**
- Izmijeniti: `components/domain/LokacijaSheet.tsx`
- Izmijeniti: `app/(dashboard)/klijenti/actions.ts` (`createLokacija`, `updateLokacija`)

- [ ] **Korak 1: Sekcija kontakta**

Ispod postojećih polja, sekcija `t("kontaktNaslov")` sa radio izborom:
`bez` (podrazumijevano) / `postojeci` (Select sa kontaktima firme koji još nisu vezani
za drugu lokaciju) / `novi` (ime, funkcija, mejl, telefon + checkbox „prima podsjetnike").

`LokacijaSheet` dobija prop `kontakti: { id: string; ime: string; lokacija_id: string | null }[]`.

- [ ] **Korak 2: Akcija**

Poslije uspješnog `insert`/`update` lokacije:
- `postojeci` → `update kontakt_osobe set lokacija_id = <novaLokacija> where id = <izabrani>`
- `novi` → `insert into kontakt_osobe (klijent_id, ime, funkcija, email, telefon, podsjetnik_primalac, lokacija_id)`

**Bitno:** kreiranje lokacije i vezivanje kontakta moraju biti u istoj server akciji, da
korisnik ne završi sa lokacijom bez kontakta kad drugi korak padne. Ako vezivanje padne,
vrati `ActionResult` sa porukom — lokacija ostaje kreirana (to je prihvatljivo i vidljivo).

- [ ] **Korak 3: `pnpm typecheck && pnpm lint && pnpm test:unit`**
- [ ] **Korak 4: Commit** `feat(lokacija): kontakt za lokaciju — postojeći ili novi`

---

### Zadatak 8: Prikaz veze

**Fajlovi:** `components/domain/LokacijeTab.tsx`, `components/domain/IdKartaTab.tsx`

- [ ] **Korak 1:** U tabu Lokacije uz svaku lokaciju ispiši vezane kontakte
  (ime + mejl), a u ID karti uz kontakt naziv lokacije ili `t("lokacijaSve")`.
- [ ] **Korak 2:** `pnpm typecheck && pnpm lint`
- [ ] **Korak 3: Commit** `feat(klijenti): prikaz veze kontakt↔lokacija u oba smjera`

---

### Zadatak 9: E2E

**Fajlovi:** Kreirati `tests/e2e/37-kontakt-lokacija.spec.ts`

Vlastita fikstura (`kreirajFirmuFiksturu` iz `tests/e2e/fixtures.ts` — pravi firmu sa
dvije lokacije), pa:
1. otvori ID kartu, uredi kontakt, veži ga za lokaciju A → sačuvano
2. tab Lokacije prikazuje taj kontakt uz lokaciju A, ne uz B
3. nova lokacija sa „novi kontakt" → kontakt se pojavi u ID karti vezan za tu lokaciju

- [ ] **Korak 1: Napiši spec**
- [ ] **Korak 2:** `pnpm exec playwright test tests/e2e/37-kontakt-lokacija.spec.ts --project=chromium --workers=1`
- [ ] **Korak 3: Commit** `test(kontakt): e2e za vezu kontakt↔lokacija`

---

## Nakon izvedbe (radi korisnik)

1. **Cloud apply obje migracije** na DEMO **i** PROD (lockstep):
   `pnpm db:apply-cloud --demo <fajl>` pa `POTVRDI_PROD=da pnpm db:apply-cloud --prod <fajl>`
2. Vezivanje postojećih kontakata za lokacije — **namjerno ručno**, jer bi auto-veza
   tiho svela ljude koji danas primaju sve na jednu lokaciju.
3. Kasnije, zaseban zahvat: ukloniti `lokacije.kontakt_osoba/email/telefon` kad podaci pređu.
