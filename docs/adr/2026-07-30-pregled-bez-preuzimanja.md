# ADR: `pregled` bez preuzimanja dokumenata i izvoza plana

- Datum: 2026-07-30
- Status: Prihvaćeno

## Kontekst

Naručilac je 30.07.2026. potvrdio da je uloga `pregled` namjenski čisto čitanje na
ekranu: korisnik smije vidjeti podatke, ali ne smije iznositi fajlove iz sistema —
ni preuzeti dokument, ni izvesti plan aktivnosti u Excel/PDF.

## Odluka

Zabrana je implementirana u dvije request-path rute, ne u bazi:

- `GET /api/dokumenti/[id]` (preuzimanje dokumenta) — vraća `403` za `pregled`.
- `GET /api/plan-aktivnosti/izvoz` (Excel/PDF izvoz plana) — vraća `403` za `pregled`.

Obje rute pozivaju `getTrenutniKorisnik()` i provjeravaju `smijePreuzeti(uloga)`
(`lib/auth/roles.ts`) prije bilo kakvog čitanja podataka ili generisanja fajla.
Neautentifikovan zahtjev (`getTrenutniKorisnik()` vraća `null`) dobija isti `403` —
ne 500, jer nedostatak sesije nije neočekivana greška servera nego jednostavno
odsustvo dozvole.

U UI-ju, `useSmijePreuzeti()` (`providers/korisnik-provider.tsx`) sakriva dugmad
koja pokreću ove rute: `PreuzmiDokumentButton` (preuzimanje dokumenta, korišćeno u
`DokumentiSekcija`, `DokumentPregled`, `ZapisniciTabela`) i cijeli `PlanIzvozModal`
(izvoz plana — cijela komponenta je izvozni okidač, pa se sakriva u cjelini; susjedni
`PlanViewSwitcher` na istoj traci ostaje netaknut). Sakrivanje dugmadi je UX, ne
sigurnosna mjera — stvarna zabrana je u rutama.

**Pregled na ekranu (`GET /api/dokumenti/[id]/pregled`) namjerno ostaje otvoren** za
`pregled` — to je čitanje, tačno ono za šta uloga postoji. Ta ruta nije dirana.

## Zašto zabrana ne može biti RLS politika u Storage-u

`lib/supabase/storage.ts` potpisuje URL-ove preko **service-role** klijenta, koji
zaobilazi RLS u potpunosti. Storage politike dodane migracijom `20260703100000`
zato nikad ne okidaju na ovom putu — service-role klijent ih ne vidi. Da je zabrana
stavljena samo u bazu, `pregled` bi i dalje mogao preuzeti dokument jer aplikacija
sama potpisuje URL bez obzira na RLS. Provjera mora živjeti u TypeScript sloju, na
rutama koje pozivaju `signedUrl(...)`, prije nego što se potpisani URL uopšte
generiše.

## Preostali propust (namjerno prihvaćen)

Ruta za pregled (`/api/dokumenti/[id]/pregled`) šalje pregledaču potpisani URL za
PDF i slike, kako bi se fajl mogao prikazati inline. Taj isti URL vrijedi i za
direktno preuzimanje — odlučan korisnik sa ulogom `pregled` može ga otvoriti u
novom tabu ili "Save As" iz pregledača i time sačuvati fajl mimo `/api/dokumenti/[id]`
provjere. Ovo je poznat i prihvaćen propust, ne previd: zatvaranje te rupe
zahtijevalo bi da aplikacija sama propušta (proxy-uje) bajtove pregleda kroz server
umjesto da predaje potpisani URL pregledaču — što je van obima ovog zadatka. Ako
naručilac zatraži da se i ovo zatvori, rješenje je taj proxy (server strimuje fajl
sa `Content-Disposition: inline` i internom autorizacijom, bez ikad izlažućeg
potpisanog URL-a klijentu).

## Dodatak (30.07.2026.): storage politika brisanja zaostaje za DB politikom

Migracija `20260730151000` je, po potvrdi naručioca istog dana, ukinula staro pravilo
„dokumente briše ISKLJUČIVO administrator" i proširila `dokumenti_del` na
`smije_brisati_zapis(kreirao_id)` — operater sada briše po prekidačima svoje/tuđe.
Storage politika `storage_dok_del` iz `20260703100000_dokumenti_delete_admin_only.sql`
je **namjerno ostavljena na `je_admin()`**.

Posljedica je asimetrija koju treba znati:

- **Kroz aplikaciju je ispravno.** `deleteDokumentAction` prvo briše DB red pod RLS-om i
  potvrđuje broj obrisanih redova, pa tek onda zove `removeDokument`, koji ide
  **service-role** klijentom i storage politike ne vidi. Ovlašteni operater obriše i red
  i fajl; neovlaštenom RLS vrati 0 redova i fajl se nikad ne dira.
- **Direktnim PostgREST pozivom nastaje orphan.** Operater sa dozvolom može obrisati DB
  red mimo aplikacije (anon ključ je u browser bundle-u), ali mu `storage_dok_del` neće
  dati da obriše objekat — fajl ostaje u bucket-u bez reda koji na njega pokazuje.

To je curenje prostora, ne curenje podataka: objekat bez DB reda nije dohvatljiv kroz
aplikaciju jer svaki put do fajla kreće od `dokumenti.storage_path`. Politika se ne
proširuje u ovoj iteraciji jer bi ispravno preslikavanje `smije_brisati_zapis(kreirao_id)`
na `storage.objects` tražilo da politika iz putanje objekta rekonstruiše koji je red
dokumenta u pitanju (`storage_path` → `dokumenti`), što je skuplje i krhkije od koristi.
Ako se pojave orphan fajlovi, rješenje je periodično čišćenje koje poredi bucket sa
`dokumenti.storage_path`, ne labavija storage politika.
