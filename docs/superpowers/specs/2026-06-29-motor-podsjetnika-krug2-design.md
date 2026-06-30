# Motor podsjetnika — Krug 2: podsjetnici po dodjeli + admin kontrola

**Datum:** 2026-06-29
**Status:** odobren dizajn → slijedi plan implementacije
**Prethodi:** Krug 1 (cron/catch-up/post-due/interni primaoci) + throttling (A) — već u produkciji.

## Kontekst i cilj

Krug 1 šalje sve podsjetnike **svim adminima + `REMINDER_TO`**, bez obzira na to ko je zadužen za firmu. Dodjela firmi radnicima **već postoji** (`Postavke→Korisnici` → `DodjelaKlijenata` → `postaviDodjele` → `korisnik_klijent`), ali se **ne koristi** za podsjetnike.

Cilj: podsjetnik za firmu ide **dodijeljenom radniku** te firme (preko postojeće dodjele), admin i dalje dobija sve, a **admin može po korisniku odlučiti** ko uopšte prima email-podsjetnike.

## Obim

**U obimu:** usmjeravanje primalaca po dodjeli; per-korisnik flag „prima podsjetnike" + toggle u postavkama.

**Van obima:** per-(radnik, firma) granularna pretplata (korisnik izričito izabrao „automatski preko dodjele"); in-app kanal; izmjene throttlinga/idempotencije (ostaju iz Krug 1 + A).

## Postojeće stanje (potvrđeno u kodu)

- `korisnik_klijent (korisnik_id, klijent_id)` N:N — admin uređuje preko `postaviDodjele(korisnikId, klijentIds)` (`postavke/actions.ts:200`); UI `DodjelaKlijenata` u `KorisniciTab` (admin-only, `postavke/page.tsx:76`).
- `korisnici (id, ime, email, uloga 'admin|operater|pregled', aktivan)`.
- `get_due_podsjetnici` već vraća **`klijent_id`** (dodato u Krug 1) — dovoljno za rezoluciju primalaca.
- `runReminders` trenutno: `internalRecipients()` = admini + `REMINDER_TO`, **jednom po pokretanju**, isto za sve termine.
- `KorisniciTab` već ima per-korisnik kontrole: `postaviUlogu`, `postaviAktivan`, `DodjelaKlijenata` — toggle „prima podsjetnike" se uklapa u isti obrazac.

## Rješenje

### 1. Podaci (migracija)
```sql
alter table korisnici add column prima_podsjetnike boolean not null default true;
```
Default `true` → postojeće ponašanje (admini primaju) ostaje; operateri se uključuju automatski kad Krug 2 krene.

### 2. Rezolucija primalaca (motor)
Primaoci za termin firme `K` =
> email-ovi korisnika gdje je `aktivan = true` **i** `prima_podsjetnike = true` **i** (`uloga = 'admin'` **ili** postoji `korisnik_klijent(korisnik_id, K)`).
> Plus opcioni globalni `REMINDER_TO`.

**Implementacija u `runReminders` (jednom po pokretanju, pa spoj po redu):**
- `adminEmails` = `select email from korisnici where uloga='admin' and aktivan and prima_podsjetnike` (proširuje postojeći upit za `prima_podsjetnike`).
- `assignedByKlijent: Map<klijent_id, string[]>` = iz `korisnik_klijent` join `korisnici` (`aktivan and prima_podsjetnike`), grupisano po `klijent_id`.
- `base` = `parseEmailList(env.REMINDER_TO)`.
- Po redu (unutar `processRow`, jer `to` sad zavisi od `klijent_id`): `to = dedupe([...(assignedByKlijent.get(r.klijent_id) ?? []), ...adminEmails, ...base])`.
- Ako je `to` prazan → `skip` „nema primalaca" (kao sad). Admin (default uključen) normalno pokriva sve firme.

`internalRecipients()` se zamjenjuje rezolverom koji vraća te dvije strukture; throttling petlja i idempotencija ostaju iste, samo se `to` računa unutar `processRow` umjesto jednom.

### 3. UI + akcija (Postavke→Korisnici)
- Nova server-akcija `postaviPrimaPodsjetnike(korisnikId: string, prima: boolean): Promise<ActionResult>` — admin-only (`zahtijevajAdmina()`), `update korisnici set prima_podsjetnike`, `revalidatePath("/postavke")`. Identičan obrazac kao `postaviAktivan`.
- `KorisniciTab`: uz „aktivan" dodati toggle/checkbox **„Prima podsjetnike"** po korisniku (uključujući admine — da admin može isključiti sebi). Učitati `prima_podsjetnike` u postojećem `korisnici` select-u.
- `db/types.ts` regenerisati nakon migracije.

## Tok podataka (po cron-run-u)
```
cron → runReminders
  rpc get_due_podsjetnici → redovi (svaki ima klijent_id)
  učitaj adminEmails (admin+aktivan+prima_podsjetnike)
  učitaj assignedByKlijent (korisnik_klijent ⨝ korisnici, aktivan+prima_podsjetnike)
  throttling petlja → processRow(red):
     to = dedupe(assignedByKlijent[klijent_id] ∪ adminEmails ∪ REMINDER_TO)
     ako prazno → skip; inače pošalji + (ako nije dry) upiši audit
```

## Testiranje / rollout
- **Unit (`runReminders.test.ts`):** proširiti fake za `korisnik_klijent` upit; testovi:
  - dodijeljeni operater firme A dobija A, ne dobija B;
  - admin (prima_podsjetnike) dobija sve firme;
  - korisnik `prima_podsjetnike=false` se isključuje (čak i ako je dodijeljen/admin);
  - firma bez dodjele → samo admini; bez ijednog primaoca → skip.
- **Unit (`postaviPrimaPodsjetnike`):** ostaje u domenu akcije; pokriveno e2e/ručno.
- **Integracioni:** opcioni nad lokalnim DB — mapa dodjela iz `korisnik_klijent`.
- **Migracija:** lokalno `db:reset` → `db:types` → cloud `db:apply-cloud` (korisnik/ja, kao A).
- **E2E:** postojeći `06-podsjetnici` + `18-auth-rls` ostaju zeleni; po potrebi dodati provjeru toggla.

## Kriterijumi prihvatanja
- [ ] Operater dobija podsjetnike samo za dodijeljene firme; nedodijeljene ne.
- [ ] Admin (default) dobija sve; isključivanjem „Prima podsjetnike" prestaje primati.
- [ ] `prima_podsjetnike=false` potpuno isključuje korisnika iz primalaca.
- [ ] Firma bez dodijeljenog radnika → ide adminima.
- [ ] Toggle „Prima podsjetnike" radi u Postavke→Korisnici (admin-only).
- [ ] `pnpm lint`/`typecheck`/`test:unit` prolaze; migracija + `db:types` čisti.

## Rizici / napomene
- Recipienti sad variraju po redu → `processRow` računa `to` (ranije jednom). Throttling i dalje radi (svaki red ima svoj `to`).
- Nakon deploya, svi dodijeljeni operateri (default `prima_podsjetnike=true`) **počinju primati** — očekivano; admin može fino podesiti.
- Idempotencija je po `(termin_id, dana_prije)`, neovisno o primaocima — promjena primalaca između run-ova ne duplira audit.
