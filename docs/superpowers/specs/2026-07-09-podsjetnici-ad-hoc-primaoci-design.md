# Podsjetnici → ad-hoc primaoci uz sačuvane kontakte — dizajn

**Datum:** 2026-07-09
**Grana:** `feat/podsjetnici-primaoci-iz-kontakata` (nastavlja se; PR #22 se dorađuje)
**Status:** dizajn odobren u brainstormingu; čeka pregled speca

## Cilj

U tabu **Podsjetnici** (njem. *Erinnerungen*), sekcija „Versand an die Firma", korisnik bira
primaoce firminih podsjetnika (Kanal 2 / „Krug 2") na dva načina, kroz **jedan combobox**:

1. **izbor sačuvanog kontakta** firme (`kontakt_osobe`, mehanizam `podsjetnik_primalac` — već
   postoji na grani), i
2. **dodavanje ad-hoc „čiste" adrese** koja nije puni kontakt — koristi se samo za obavještavanje
   te firme, ne pojavljuje se u tabu Kontakti.

Primaoci firme = `{mejlovi flagovanih kontakata}` ∪ `{klijenti.podsjetnik_emails}`, lowercase+dedup
pri slanju.

**Ovaj dizajn dopunjava `2026-07-09-podsjetnici-primaoci-iz-kontakata-design.md`** i **djelimično
obrće** njegovu odluku „čist selektor, bez ad-hoca / jedan izvor istine". Odluka korisnika
(2026-07-09, ovaj brainstorming):

- ad-hoc primalac se **vraća**, ali kao **trajna adresa-primalac koja NIJE kontakt** (ne kreira se
  `kontakt_osobe` red); čita se svjež pri svakom slanju (nije efemerno-jednokratno);
- picker je **jedan combobox** (ukucaj mejl **ili** izaberi kontakt), a ne zaseban dropdown + „+".

## Kontekst (zatečeno stanje na grani `feat/podsjetnici-primaoci-iz-kontakata`, HEAD `06febe7`)

- **Kontakt-selektor (postoji):** `components/domain/KlijentPodsjetniciForm.tsx` — vertikalni
  **checklist** kontakata; svaki `kontakt_osobe` s mejlom ima checkbox; toggle →
  `updateKontaktPodsjetnikPrimalac` (`app/(dashboard)/klijenti/[id]/actions.ts:25`). Kontakt bez
  mejla je disabled uz link na tab Kontakti. Nema ručnog unosa mejla.
- **Fetch forme:** `components/domain/KlijentPodsjetniciTab.tsx:12–17` — `Promise.all` čita
  `klijenti.salji_podsjetnik_klijentu` (:13) i `kontakt_osobe (id, ime, funkcija, email,
  podsjetnik_primalac)` (:14); prosljeđuje `KlijentPodsjetniciForm`.
- **`klijenti.podsjetnik_emails text[]`:** i dalje postoji u cloud bazama (Migracija B nije
  primijenjena). Na grani je kod prestao da ga referencira, a **Migracija B (drop) je commitovana**
  ali NEprimijenjena: `supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql`.
- **Migracija A (primijenjena na DEMO+PROD):** `20260709120000_kontakt_podsjetnik_primalac.sql` —
  dodala kolonu `kontakt_osobe.podsjetnik_primalac` i **promovisala postojeće `podsjetnik_emails`
  u kontakte**. Na PROD-u je kreirala 2 kontakta (CARMEUSE→dzonifu@gmail.com, WAIKIKI→sef@firma.com);
  te 2 adrese ostaju i u `podsjetnik_emails`.
- **Engine (`lib/reminders/recipients.ts`):**
  - `buildRecipientIndex(korisnici, dodjele, klijenti, kontakti, saljiKlijentima)` (:52) —
    `KlijentReminderRow = {id, salji_podsjetnik_klijentu}` (:34); `KontaktPrimalacRow =
    {klijent_id, email, podsjetnik_primalac}` (:39). Kad je `saljiKlijentima && firmaUkljucena`,
    puni `klijentEmailsByKlijent` iz **flagovanih kontakata** (:82–89).
  - `firmaRecipientsForKlijent(index, klijentId)` (:101) — lowercase+dedup+`EMAIL_RE` filter.
  - Pozivaoci: `lib/reminders/runReminders.ts` (fetch klijenata/kontakata → `buildRecipientIndex`);
    `components/domain/KoStaPrimaTab.tsx` (admin pregled „ko šta prima" u Postavkama).
- **Akcije (`app/(dashboard)/klijenti/[id]/actions.ts`):** `updateKlijentSaljiPodsjetnik` (:10),
  `updateKontaktPodsjetnikPrimalac` (:25); obje SSR + `ActionResult` + `revalidatePath`.
- **Gate ostaje nepromijenjen:** globalni `postavke.salji_klijentima` + per-firma
  `klijenti.salji_podsjetnik_klijentu`.

## Model podataka

- Zadržati `kontakt_osobe.podsjetnik_primalac boolean` (kontakt-selektor).
- **Zadržati `klijenti.podsjetnik_emails text[]`** kao listu ad-hoc adresa → **obrisati fajl**
  `supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql` s grane. Kolona postoji
  na cloud-u; lokalno se vraća sa `pnpm db:reset`. **Nula novih cloud migracija.**
- Odbačena alternativa: nova tabela `podsjetnik_primaoci`. Kolona `podsjetnik_emails` već
  semantički znači „ad-hoc adrese firme" → nova tabela = više posla bez dobiti (YAGNI).

## UI / interakcija — `KlijentPodsjetniciForm.tsx`

Zamjena checklista **comboboxom**:

- **Ulaz:** polje „Ukucaj mejl ili izaberi kontakt". Dok korisnik kuca, filtrira kontakte firme
  koji **imaju mejl** i **nisu već izabrani** (po `ime`/`email`).
- Ako je ukucano validan mejl (`EMAIL_RE`) koji nije mejl nekog ponuđenog kontakta ni već-izabran
  → red akcije `+ Dodaj "x@y.com" kao jednokratni`.
- **Izabrani primaoci** ispod, kao chipovi (`components/ui/badge.tsx`):
  - kontakt: `ime · email`, ✕ → `updateKontaktPodsjetnikPrimalac(false)`;
  - ad-hoc: `email ⟨jednokratno⟩`, ✕ → nova akcija `ukloniPodsjetnikEmail`.
- **Dedup prikaza:** ad-hoc chipovi izuzimaju svaki `podsjetnik_emails` čiji se lowercase mejl
  poklapa s mejlom flagovanog kontakta iste firme. Time se 2 PROD orphan mejla (promovisana u
  kontakte Migracijom A, a i dalje u `podsjetnik_emails`) prikazuju **samo** kao kontakt-chip, bez
  dupliranja. → **usklađivanje bez ijedne data-migracije.**
- Kontakti **bez mejla** se ne nude u comboboxu (ne može im se slati).
- **Prazno stanje:** „Nema izabranih primalaca — izaberi kontakt ili dodaj mejl" + link na tab
  Kontakti (`?tab=kontakti`). (Za razliku od checklista, sad se primalac može dodati i bez ijednog
  kontakta.)
- **Primitiv comboboxa:** `components/ui` ima samo `select.tsx`, `dropdown-menu.tsx`, `badge.tsx`.
  Combobox se gradi na **Base UI (`@base-ui/react ^1.6.0`)** — provjeriti postoji li `Combobox`/
  `Autocomplete`; ako ne, lagani custom (kontrolisani `input` + filtrirana lista + Base UI `Popover`),
  po uzoru na postojeće `select.tsx`/`dropdown-menu.tsx`. Tačan primitiv se fiksira u planu.
- **Stanje:** optimističko kao sad (`useTransition` + `toast` + `router.refresh()`); rollback na
  grešci (vidi `toggleKontakt` :41–59). Nema breakpointa `sm:`/`md:` (lint pravilo).

## Engine + Postavke pregled

- `lib/reminders/recipients.ts`:
  - `KlijentReminderRow` dobija `podsjetnik_emails: string[]`.
  - u `buildRecipientIndex`, unutar `if (saljiKlijentima)` grane, za svaku `firmaUkljucena` firmu
    **dopuniti** `klijentEmailsByKlijent` i adresama iz `klijent.podsjetnik_emails` (uz postojeće
    flagovane kontakte). Postojeći `firmaRecipientsForKlijent` (lowercase+dedup+`EMAIL_RE`)
    automatski pokriva preklapanja → **nema duplog slanja.**
- `lib/reminders/runReminders.ts`: upit koji gradi `klijenti` redove mora selektovati i
  `podsjetnik_emails`.
- `components/domain/KoStaPrimaTab.tsx`: „ko šta prima" mora uračunati i `podsjetnik_emails`
  (isti union kao engine), da admin pregled bude tačan.

## Akcije + fetch

- `app/(dashboard)/klijenti/[id]/actions.ts` — nove SSR akcije (RLS `klijenti_upd`; ista
  `ActionResult` šema; `revalidatePath('/klijenti/${klijentId}')`):
  - `dodajPodsjetnikEmail(klijentId, email)`: validacija `EMAIL_RE`, `trim().toLowerCase()`, dedup
    protiv postojećih `podsjetnik_emails`; **preskoči/odbij** ako se mejl poklapa s mejlom
    flagovanog kontakta (poruka: „Već je primalac kao kontakt"); `update({ podsjetnik_emails: [...] })`.
  - `ukloniPodsjetnikEmail(klijentId, email)`: ukloni iz niza (case-insensitive), `update(...)`.
  - Zadržati `updateKontaktPodsjetnikPrimalac` i `updateKlijentSaljiPodsjetnik`.
  - (Napomena za plan: čitanje-pa-pisanje niza — dohvatiti tekući `podsjetnik_emails` prije update-a;
    dovoljno za single-user tempo, bez potrebe za atomarnim array-append.)
- `components/domain/KlijentPodsjetniciTab.tsx`: dodatno selektovati `klijenti.podsjetnik_emails`
  (:13) i proslijediti formi kao `adHocEmails: string[]`.

## Migracije / rollout

- **Obrisati** `supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql` (nikad na
  cloud-u; lokalno vraćeno sa `db:reset`).
- **Migracija A ostaje** (kolona `podsjetnik_primalac` + promocija — obje baze već imaju).
- **Cloud: ništa novo.** Obje cloud baze već imaju `podsjetnik_emails` (nikad dropana) i
  `podsjetnik_primalac` (Migracija A). Merge PR #22 = deploy koda na sve 3 instance (tehpro-de,
  tehpro-demo, demo-app) — vidi [[vercel-deploy-topology]].
- `pnpm db:types` (iz **LOKALNOG** stacka) nakon brisanja Migracije B — `podsjetnik_emails` se vraća
  u `db/types.ts`.
- **PR #22 se dorađuje** (opseg mu se mijenja: više ne dropa `podsjetnik_emails`, dodaje combobox +
  ad-hoc). Nastavak na istoj grani.

## i18n / testovi

- Novi ključevi u `messages/{sr,en,de}.json` pod `klijenti.podsjetnici`: placeholder comboboxa,
  „dodaj kao jednokratni", tag „jednokratno", novo prazno stanje, validacione poruke (nevalidan
  mejl / već primalac). Poštovati i18n pravila (`one` zabranjen za sr — vidi [[i18n-status]]).
- Unit: dopuniti `lib/reminders/recipients.test.ts` (union kontakti+`podsjetnik_emails`, dedup
  preklapanja) i `lib/reminders/runReminders.test.ts`.
- E2E: prilagoditi `tests/e2e/24-podsjetnici-primaoci.spec.ts` na combobox (izbor kontakta + dodaj
  ad-hoc + ukloni), uz `data-testid` kuke. E2E ide na cloud DEMO (obje baze već imaju kolone).

## Fajlovi koji se mijenjaju

| Fajl | Promjena |
|---|---|
| `supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql` | **obrisati** |
| `db/types.ts` | regen (`pnpm db:types`) |
| `components/domain/KlijentPodsjetniciForm.tsx` | checklist → combobox + chipovi |
| `components/domain/KlijentPodsjetniciTab.tsx` | fetch + prosljeđivanje `podsjetnik_emails` |
| `app/(dashboard)/klijenti/[id]/actions.ts` | `dodajPodsjetnikEmail` + `ukloniPodsjetnikEmail` |
| `lib/reminders/recipients.ts` | `KlijentReminderRow.podsjetnik_emails`; union u `buildRecipientIndex` |
| `lib/reminders/runReminders.ts` | select `podsjetnik_emails` |
| `components/domain/KoStaPrimaTab.tsx` | union u pregledu |
| `messages/{sr,en,de}.json` | novi ključevi |
| `lib/reminders/recipients.test.ts`, `runReminders.test.ts` | union testovi |
| `tests/e2e/24-podsjetnici-primaoci.spec.ts` | combobox scenariji |
| (možda) `components/ui/combobox.tsx` | novi primitiv na Base UI, ako ga gradimo |

## Van obima (YAGNI)

- Bez naziva/oznake uz ad-hoc mejl (samo adresa). Bez „recipient-only skriveni kontakt" flaga.
- Bez atomarnog array-append/PG funkcije za `podsjetnik_emails`.
- Bez čišćenja 2 PROD orphan mejla iz `podsjetnik_emails` (dedup prikaza + send-time dedup ih
  pokrivaju; opcioni cleanup kasnije, nije blokada).
- Bez izmjene gate-ova (`salji_klijentima`, `salji_podsjetnik_klijentu`) i internog Kruga 1.

## Rizici / rubni slučajevi

- **Dupliranje prikaza** (kontakt + ad-hoc isti mejl) — riješeno dedup filterom prikaza; **provjeriti
  na PROD 2 orphan slučaja** u E2E/ručno.
- **Dodavanje ad-hoc mejla koji je već kontakt** — akcija odbija uz poruku; sprječava zbunjujuće
  „duplo".
- **Combobox a11y** — labela, tastatura (↑/↓/Enter/Esc), fokus; ako custom primitiv, pokriti u planu.
- **Regresija Kruga 1** — union dira samo Krug 2 granu (`saljiKlijentima`); interni primaoci
  (`recipientsForKlijent`) netaknuti.
