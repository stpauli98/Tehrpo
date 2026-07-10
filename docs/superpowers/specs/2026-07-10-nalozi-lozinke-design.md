# Nalozi i lozinke — „Promijeni lozinku" + admin „Pošalji reset" — dizajn

**Datum:** 2026-07-10
**Grana:** nova `feat/nalozi-lozinke` (od `main`)
**Status:** dizajn odobren; izvršenje kroz SDD
**Kontekst:** pod-projekt #1 iz RBAC backloga; doc §12 „mogućnost resetovanja lozinke".

## Cilj

Dvije samostalne mogućnosti oko lozinki (bez diranja RLS/domet/delegacije — svjesne odluke korisnika):

- **A1 — „Promijeni lozinku"** za bilo kog prijavljenog korisnika (admin/operater/pregled).
- **A2 — admin „Pošalji reset"** po korisniku (admin okine reset-email; ne postavlja/ne vidi lozinku).

Kreiranje naloga ostaje kako jest (admin postavlja početnu lozinku) — van obima.

## Zatečeno

- **Reset kanal radi:** `app/zaboravljena-lozinka/actions.ts::posaljiReset` → `supabase.auth.resetPasswordForEmail(email, {redirectTo: origin+"/auth/confirm"})` (uvijek vraća ok — bez email-enumeracije).
- **Set nove lozinke:** `app/auth/nova-lozinka/actions.ts::postaviLozinku` → `supabase.auth.updateUser({password})` (min 8). Radi za bilo koju prijavljenu sesiju, ne samo recovery.
- **Postavke stranica** (`app/(dashboard)/postavke/page.tsx`): SVE sekcije su `jeAdminKor`-gated → operater/pregled tamo vide praznu stranicu.
- **Admin user-mgmt:** `app/(dashboard)/postavke/actions.ts` — `zahtijevajAdmina()` (baca ako nije admin), `posaljiTestniEmail(korisnikId)` (precedent za po-red admin akciju). Po-red akcije u `components/domain/KorisnikAkcije.tsx` (props `korisnikId, aktivan, jeJa`); red ima `k.email` (`KorisniciTabela`).
- `getTrenutniKorisnik()` vraća `{id, ime, uloga}` — **bez emaila**. Email prijavljenog se čita iz `supabase.auth.getUser()`.

## A1 — „Promijeni lozinku" (svi prijavljeni)

**Mjesto:** nova sekcija **„Moj nalog"** u Postavkama, **vidljiva svim ulogama** (NE `jeAdminKor`-gated) — daje operateru/pregledu svrhu na stranici. Renderuje `MojNalogSekcija` (server) → `CollapsibleSection` → `MojNalogForm` (client).

**Forma (`MojNalogForm`):** tri password polja — `trenutna`, `nova`, `potvrda` — + dugme. Klijentska validacija minimalna; server je autoritet.

**Akcija** `promijeniLozinku(_prev, formData): Promise<ActionResult>` (u `app/(dashboard)/postavke/actions.ts`):
```ts
// 1) validacija: nova min 8; nova === potvrda (inače greška "Lozinke se ne poklapaju.")
// 2) email prijavljenog: const { data: { user } } = await supabase.auth.getUser()
// 3) re-auth (provjeri trenutnu): supabase.auth.signInWithPassword({ email: user.email, password: trenutna })
//    → error → { ok:false, message: "Trenutna lozinka nije tačna." }
// 4) supabase.auth.updateUser({ password: nova }) → error → generička poruka
// 5) { ok:true }  (forma prikaže toast "Lozinka je promijenjena.")
```
Napomena za plan: `signInWithPassword` u SSR akciji osvježava auth-cookie za ISTOG korisnika (bezopasno). Ako se pokaže da kloberuje sesiju, koristiti zaseban Supabase klijent za korak (3).

## A2 — admin „Pošalji reset" (po korisniku)

**Akcija** `posaljiResetKorisniku(email: string): Promise<ActionResult>` (u `postavke/actions.ts`):
```ts
// await zahtijevajAdmina()  (baca ako nije admin)
// origin = (await headers()).get("origin") ?? ""
// await supabase.auth.resetPasswordForEmail(email, { redirectTo: origin + "/auth/confirm" })
// { ok:true }
```
**UI:** `KorisnikAkcije` dobija `email` prop; dodaje dugme/stavku „Pošalji reset" → poziva akciju → toast „Reset link poslat na {email}". `KorisniciTabela` prosljeđuje `k.email`. (Mirror obrasca `posaljiTestniEmail`.)

## i18n (sr/en/de)

- `postavke.mojNalog`: `naslov` „Moj nalog", `opis`, `trenutna` „Trenutna lozinka", `nova` „Nova lozinka (min 8)", `potvrda` „Potvrdi novu lozinku", `dugme` „Promijeni lozinku", `uToku` „Mijenjam…", `uspjeh` „Lozinka je promijenjena.", `greske.nePoklapaju` „Lozinke se ne poklapaju.", `greske.trenutnaPogresna` „Trenutna lozinka nije tačna.", `greske.minDuzina` „Nova lozinka mora imati bar 8 znakova.".
- `postavke.korisnici`: `posaljiReset` „Pošalji reset", `resetPoslat` „Reset link poslat na {email}".

## Testovi

- **Unit:** pure helper `validirajNovuLozinku(nova, potvrda) → {ok}|{razlog:"min"|"nePoklapaju"}` (u `lib/auth/lozinka.ts`) + test. (Re-auth/updateUser su integracija — ne unit.)
- **E2E** (`tests/e2e/25-nalozi-lozinke.spec.ts`, cloud DEMO, `--workers=1`):
  - A1: kreiraj **jedinstven throwaway operater** (unikatan email + poznata lozinka), `injectSessionFor`, Postavke → „Moj nalog": (a) pogrešna trenutna → greška; (b) tačna trenutna + nova/potvrda → toast uspjeh. **U `finally` obriši korisnika** (da izmijenjena lozinka ne ostane). NE koristiti fiksni test-nalog (mijenjanje njegove lozinke bi razbilo druge testove).
  - A2: kao admin (postojeći storageState), Postavke → Korisnici → red throwaway korisnika → „Pošalji reset" → success toast. (`resetPasswordForEmail` uvijek vraća ok; ne verifikujemo dostavu.)

## Van obima (YAGNI / po odlukama)

- Bez pozivnice/set-password pri kreiranju (admin i dalje postavlja početnu).
- Bez RLS/domet i delegacije.
- Bez „prikaži jačinu lozinke" i sl.

## Rizici

- E2E koji mijenja lozinku MORA koristiti jedinstven throwaway nalog + brisanje u finally (inače razbija auth drugih testova).
- `signInWithPassword` u akciji — potvrditi da ne kvari tekuću sesiju (koristiti zaseban klijent ako treba).

## Grana / rollout

Nova grana `feat/nalozi-lozinke` od `main`. Bez migracija/cloud koraka (čisto app + i18n + test). Zaseban PR.
