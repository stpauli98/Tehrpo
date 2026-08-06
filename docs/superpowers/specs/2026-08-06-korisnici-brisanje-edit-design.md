# Korisnici u /postavke: trajno brisanje i editovanje (ime + email)

**Datum:** 06.08.2026. · **Status:** dizajn odobren (brainstorming sa korisnikom)

## Problem

U `/postavke` → sekcija „Korisnici" ne postoji način da se unesen korisnik obriše niti
da mu se izmijene ime i email. Danas su izmjenjivi samo: uloga, dodjele firmi, dozvole
brisanja i prekidač podsjetnika; za nalog postoji samo deaktivacija.

## Odluke (potvrđene sa korisnikom)

1. **Brisanje je trajno, ali dozvoljeno samo za deaktivirane korisnike** (dva koraka:
   deaktiviraj → obriši). Svjesna posljedica: istorijski audit zapisi obrisanog
   korisnika gube aktera (`audit_log.korisnik_id → NULL`, nema snapshota imena),
   a `kreirao_id` na klijentima/lokacijama/ugovorima/terminima/dokumentima postaje NULL.
2. **Editovanje = ime + email.** Lozinka i dalje ide isključivo preko postojećeg
   „Pošalji reset" emaila. Uloga/firme/dozvole/podsjetnici ostaju inline u tabeli.
3. **Pristup A:** sve u aplikacionom sloju (server akcije + Auth Admin API sa
   rollback-om), **bez migracije baze**. RPC varijanta odbačena (krhka, traži
   DEMO+PROD apply, audit bez aktera).

## Backend — `app/(dashboard)/postavke/actions.ts`

Obje akcije prate postojeći obrazac: `zahtijevajAdmina()` → zod → SSR (RLS) klijent za
upis u `korisnici` (da audit trigger zabilježi admina kao aktera) → `revalidatePath("/postavke")`
→ `ActionResult`.

### `obrisiKorisnika(korisnikId: string): Promise<ActionResult>`

1. `zahtijevajAdmina()`; `korisnikId === ja.id` → greška (vlastiti nalog se ne briše).
2. SSR klijentom pročitaj **cijeli** `korisnici` red mete (snapshot za rollback).
   Ne postoji → „korisnik ne postoji". `aktivan === true` → „prvo deaktiviraj korisnika".
   Zadnji admin je time automatski zaštićen: aktivan se ne može obrisati, a postojeća
   zaštita u `postaviAktivan` brani deaktivaciju zadnjeg aktivnog admina.
3. SSR klijent: `DELETE FROM korisnici WHERE id = ...`
   - audit trigger upiše brisanje **sa adminom kao akterom**;
   - cascade briše `korisnik_klijent` i `chat_poruke`; `set null` na `kreirao_id`,
     `audit_log.korisnik_id`, `mejl_log.pregledano_od`, `klijenti.idkarta_*`.
4. `createAdminSupabaseClient().auth.admin.deleteUser(korisnikId)` (jedino mjesto gdje
   je admin klijent nužan — Auth Admin API nema anon ekvivalent; komentar
   `integracija-dozvoli` kao kod `kreirajKorisnika`).
   **Pad → rollback:** ponovo upiši profil red iz snapshota **SSR klijentom**
   (`korisnici_wr = je_admin()` dozvoljava insert; `created_at` i sve kolone se upisuju
   eksplicitno iz snapshota, audit hvata admina) i vrati grešku. Ogledalo rollback-a iz
   `kreirajKorisnika`; pad rollback-a se loguje (`console.error`) kao i tamo.

### `urediKorisnika(_prev: ActionResult, formData): Promise<ActionResult>`

Zod: `id` (uuid), `ime` (trim, 1–120, poruka `imeObavezno`), `email` (poruka `emailNeispravan`).

1. `zahtijevajAdmina()`; pročitaj metu (treba stari email) — ne postoji → greška.
2. Ako se email promijenio: `admin.auth.admin.updateUserById(id, { email, email_confirm: true })`
   — login email važi odmah, bez potvrde (interni alat; isto povjerenje kao pri kreiranju).
   Poruka o zauzetom emailu → postojeći ključ `korisnikEmailPostoji`.
3. SSR klijent: `UPDATE korisnici SET ime, email WHERE id = ...` (audit hvata admina;
   unique constraint na `korisnici.email` → `korisnikEmailPostoji`).
   Pad nakon već promijenjenog auth emaila → rollback auth emaila na stari + greška.
4. Vlastiti nalog smije mijenjati ime/email (nije destruktivno) — bez posebne zabrane.

## UI — `components/domain/`

Sve u postojećem dropdown-u `KorisnikAkcije` (kolona ⋯ u `KorisniciTabela`):

- **„Uredi podatke"** (`Pencil`) — uvijek vidljivo. Otvara novu komponentu
  `UrediKorisnikaDialog`, kopiju obrasca `NoviKorisnikButton`: `Dialog` + pod-forma sa
  `useActionState(urediKorisnika)`, remount po otvaranju (`instanca` brojač), polja
  ime/email predpopunjena (`defaultValue`), `FieldError` po polju + fiksni
  `aria-describedby` id-jevi, inline `state.message`, toast na uspjeh, `router.refresh()`.
  Dijalog je sibling menija sa skrivenim trigger dugmetom i `otvoriDialog(ref)` odgodom
  (Base UI unmount ograničenje — isti obrazac kao reset/deaktivacija dijalozi).
- **„Obriši trajno"** (`Trash2`, `variant="destructive"`) — vidljivo **samo** kad je
  `!aktivan`. Potvrda kroz postojeći `PotvrdiBrisanjeDialog`; opis eksplicitno kaže:
  trajno i nepovratno, korisnik gubi pristup, istorijski zapisi ostaju ali bez imena
  aktera. `data-testid`: `obrisi-${korisnikId}` i `obrisi-potvrdi-${korisnikId}`.
- Redoslijed stavki za deaktiviranog: Test email · Pošalji reset · Uredi podatke ·
  Aktiviraj · **Obriši trajno** (destruktivno na dnu).
- `UrediKorisnikaDialog` prima `korisnikId`, `ime`, `email` — `KorisniciTabela` ih već
  ima u redu, `KorisnikAkcije` dobija `ime` kao novi prop.

## i18n

Novi ključevi u **sva tri** kataloga `messages/{sr,en,de}.json` u istoj izmjeni
(next-intl type-check prisiljava paritet; bez ICU `one` kategorije za sr):

- `postavke.korisnikAkcije`: `urediPodatke`, `obrisiTrajno`, `obrisiPotvrdaNaslov`,
  `obrisiPotvrdaOpis`, `korisnikObrisan`, `obrisiGreska`.
- `postavke.urediKorisnika`: `naslov`, `poljeIme`, `poljeEmail`, `submit`,
  `submitPending`.
- `postavke.actions`: `prvoDeaktiviraj`, `vlastitiNalogBrisanje` (+ reuse postojećih
  `korisnikNePostoji`, `korisnikEmailPostoji`, `imeObavezno`, `emailNeispravan`).

## Greške

Akcijske greške inline u dijalogu (dijalog ostaje otvoren), toast samo na uspjeh —
postojeća S2 konvencija. Sirove Supabase auth poruke se ne prosljeđuju korisniku
(mapiranje na domaće poruke, kao `posaljiResetKorisniku`).

## Testiranje

- **E2E** (dodaci u postojeći postavke/korisnici spec):
  1. Uredi ime + email → tabela pokazuje nove vrijednosti.
  2. „Obriši trajno" se **ne** nudi za aktivnog korisnika.
  3. Deaktiviraj → Obriši trajno → korisnik nestaje iz liste; ponovno kreiranje
     korisnika **istim emailom prolazi** (dokaz da je auth nalog stvarno oslobođen).
  - E2E ide na cloud DEMO (`--workers=1`); test korisnici se čiste postojećim
    `cleanup:test-data` tokom/nakon run-a.
- **Unit:** ništa novo — nema novog čistog domenskog koda; validacija je zod u akciji,
  pokrivena E2E-om.

## Van opsega

- Direktno postavljanje lozinke od strane admina (ostaje reset email).
- Potvrda promjene emaila od strane korisnika (email važi odmah).
- Prebacivanje/reasignacija istorijskih zapisa prije brisanja.
- Migracije baze — nema ih.

## Napomena za implementaciju

Raditi na svježoj grani sa `main` (trenutna `fix/brisanje-termina` je ahead/behind);
merge u `main` = produkcijski deploy, main je zaštićen → PR.
