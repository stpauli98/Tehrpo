# `pregled` read-only UX — dizajn

**Datum:** 2026-07-10
**Grana:** nova `feat/pregled-readonly` (od `main`)
**Status:** dizajn odobren; izvršenje kroz SDD
**Kontekst:** pod-projekt #2 iz RBAC backloga; doc §11 „korisnik sa pravom pregleda … bez mogućnosti izmjene".

## Cilj

Uloga `pregled` treba da **ne vidi write-akcije** (Dodaj/Uredi/Obriši/Upload/AI-sačuvaj). RLS ih već
blokira na serveru; ovo je UX polish da pregled ne vidi dugmad koja padaju. Sakrivanje (`return null`),
ne „disabled".

Van obima (odluke korisnika): `chat_poruke` per-user scope (odloženo, tehnički dug); domet/RLS,
delegacija.

## Zatečeno

- **`KorisnikProvider`** (`providers/korisnik-provider.tsx`) VEĆ postoji, postavljen u
  `app/(dashboard)/layout.tsx` sa `uloga={korisnik?.uloga ?? null}`; izlaže `useUloga(): Uloga | null`.
- **`mozeUrediti(uloga)` = admin || operater** (`lib/auth/roles.ts`) — postoji, ali se **NIGDJE ne
  koristi** (grep prazan) → pregled trenutno vidi sve write-dugmad.
- `ObrisiDokumentButton` je već `jeAdmin`-gated (pa i pregled tu ne vidi) — ne dirati.
- Postavke sekcije su `jeAdminKor`-gated (pregled ih ne vidi); „Moj nalog" je za sve (pregled mijenja
  svoju lozinku) — NE gejtovati.

## Model

**Hook** `useMozeUrediti(): boolean` u `providers/korisnik-provider.tsx`:
```ts
import { mozeUrediti } from "@/lib/auth/roles"
export function useMozeUrediti(): boolean {
  const u = useUloga()
  return u ? mozeUrediti(u) : false   // null → najmanja privilegija
}
```

**Gating princip:** u svakoj write-**akcijskoj** komponenti (dugme/trigger/forma koja piše), na vrhu:
```tsx
const mozeUrediti = useMozeUrediti()
if (!mozeUrediti) return null
```
- Gejtuju se **write TRIGGERI/akcije** (dugmad koja otvaraju sheet ili rade mutaciju), NE read-prikaz.
  Ako je komponenta miješana (prikaz + akcija), gejtovati samo akciju unutar nje.
- `*Sheet` modali se ne moraju posebno gejtovati ako im je trigger-dugme gejtovano (pregled ih ne
  otvara) — ali radi robusnosti gejtovati i sam trigger.

## Write-površine za gejt

Klijent: `NoviKlijentButton`, `ObrisiKlijentButton`, „Uredi klijenta" trigger (`KlijentEditForm` /
njen trigger). Lokacije: `LokacijaSheet` trigger, `ObrisiLokacijuButton`. Termini: `NoviTerminButton`,
`TerminSheet` trigger. Kontakti: „novi kontakt" trigger (`novi-kontakt-btn`), `KontaktSheet` trigger.
Profil provjere: `DodajProvjeruButton`, `ObrisiProfilButton`. Ugovor: `UgovorSheet` trigger.
Dokumenti: `KlijentDokumentUpload`. Podsjetnici: `KlijentPodsjetniciForm` (toggle + combobox — inline
write; gejtovati cijelu formu). AI: „Sačuvaj zapisnik" akcija u `ChatMessage`/`AsistentChat`
(`ZapisnikProposal`) — **samo save**, ne sam chat.

**NE gejtovati:** `MojNalogForm` (pregled mijenja svoju lozinku), `NoviRazgovorButton` + slanje
pitanja AI-u (pregled sme koristiti asistenta za čitanje/pitanje), Postavke admin sekcije (već
skrivene), `ObrisiDokumentButton` (već admin-only).

> Napomena za plan/izvršioca: za SVAKU komponentu prvo potvrditi da je write-akcija (ne read-prikaz);
> gejtovati trigger. Ako neki „edit" nije zasebno dugme nego inline forma koja je JEDINI prikaz tih
> podataka, gejtovati samo write-kontrole unutar nje (ne sakriti čitanje).

## Testovi

- **Unit:** `useMozeUrediti` (mapiranje `admin/operater → true`, `pregled/null → false`) — testirati
  čistu logiku (npr. izdvojiti u testabilan helper ili testirati preko renderovanja; minimalno).
- **E2E** (`tests/e2e/26-pregled-readonly.spec.ts`, DEMO, `--workers=1`): kreiraj `pregled` korisnika
  (`ensureKorisnik(email, lozinka, ime, "pregled")` — dodati helper u `db.ts` ako `ensureOperater`
  ne pokriva ulogu) + dodijeli firmi (`assignKlijent`), `injectSessionFor`. Na kartici klijenta i
  termini/plan: write dugmad **SAKRIVENA** (`toHaveCount(0)` za ključne testid-e: `novi-termin`,
  `novi-kontakt-btn`, „Uredi klijenta", „Obriši"…), a **čitanje radi** (podaci vidljivi). Očisti
  throwaway (klijent cascade + `deleteKorisnikByEmail`).

## Van obima (YAGNI)

- Bez „disabled" varijante (sakrivanje je odluka).
- Bez diranja RLS (server već blokira).
- Bez chat scope (odloženo).

## Rizici

- **Miješane komponente** (prikaz+akcija) — ne sakriti čitanje; gejtovati samo akciju. Najveći rizik
  regresije; svaki gejt provjeriti.
- E2E traži `pregled` nalog sa dodjelom (RLS `ima_pristup_klijentu` = admin ili dodijeljen) da bi
  uopšte vidio firmu; bez dodjele ne vidi ništa (pa test ne bi bio smislen).

## Grana / rollout

Nova grana `feat/pregled-readonly` od `main`. Čist UI + hook, bez migracija. Zaseban PR.
