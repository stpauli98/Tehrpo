# ⓘ info tooltipovi na klijent stranici — dizajn

**Datum:** 2026-07-04
**Grana:** `feat/info-tooltips` (stacked na `fix/bugovi-konzistentnost`)

## Cilj

Korisnik na hover preko male ⓘ ikone dobija objašnjenje čemu služi tab ili
sekcija i šta u njoj vidi. Pokriva svih 6 tabova klijent stranice
(`/klijenti/[id]`) i sekcije unutar ID karte i Kontakata.

## Odluke

- **Pozicija:** ⓘ stoji u samoj tab traci, pored labele taba (vidljivo prije
  klika). Sekcije unutar ID karte i Kontakata dobijaju ⓘ pored naslova sekcije.
- **Interakcija:** hover-only. App je desktop-only (`DesktopOnlyGate`), touch
  se ne podržava.
- **Mehanizam:** postojeći CSS-only tooltip obrazac iz
  `components/ui/ikona-tooltip.tsx` (`group/tt relative` +
  `group-hover/tt:block`). Bez novih biblioteka — Base UI/shadcn Tooltip bi bio
  novi pattern u codebase-u, a nativni `title` se ne može stilizovati.

## Nova komponenta: `components/ui/info-ikona.tsx`

- Server-safe (bez `"use client"`), čisti markup.
- Renderuje lucide `Info` ikonu (`size-3.5 text-slate-400`) unutar spana sa
  `group/tt relative`, plus tooltip sa `max-w-72 whitespace-normal text-left
  leading-relaxed` (postojeći `Tooltip` je `whitespace-nowrap`, neupotrebljiv
  za rečenice).
- Props: `tekst: string`, opciono `className`, opciono `testId`, opciono
  `strana?: "lijevo" | "desno"` (default „lijevo”). Wrapper je
  `aria-hidden` — `aria-label` bi zagadio accessible name TabsTrigger dugmeta
  na koji se oslanjaju e2e selektori (`getByRole("tab", { name })`).
- Tooltip se otvara ispod ikone (`top-full`), poravnat sa lijevom ivicom ikone
  (`left-0`; centriranje bi klipovalo uz lijevu ivicu `<main>` koji ima
  `overflow-auto`). Zadnji tab koristi `strana="desno"` (`right-0`) jer bi na
  minimalnoj desktop širini od 1024px njegov tooltip prešao desnu ivicu.

## Izmjene po fajlu

1. **`components/domain/KlijentTabs.tsx`** — `TABS` niz dobija `info` polje;
   `TabsTrigger` renderuje labelu + `<InfoIkona>`. Klik na ⓘ i dalje mijenja
   tab (ikona je unutar trigger dugmeta). `data-testid` i tekst labela se ne
   mijenjaju.
2. **`components/domain/IdKartaTab.tsx`** — ⓘ pored naslova sekcija „Osnovni
   podaci" i „Ugovorene usluge".
3. **`components/domain/UgovoriTab.tsx`** — opcioni `info?: string` prop; kad
   je zadat, ⓘ pored naslova „Ugovori". ID karta ga prosljeđuje.
4. **`components/domain/KontaktiKlijentList.tsx`** — opcioni `info?: string`
   prop; ⓘ pored naslova „Kontakt osobe (firma)". Prosljeđuju ga i ID karta
   (preview) i Kontakti tab (pun spisak) — tekst se može razlikovati.
5. **`app/(dashboard)/klijenti/[id]/page.tsx`** — ⓘ pored naslova „Kontakti
   lokacija" u Kontakti tabu; prosljeđivanje `info` propova.

## Tekstovi

### Tabovi

| Tab | Tekst |
|---|---|
| ID karta | Lična karta klijenta na jednom mjestu: osnovni podaci firme, ugovori, ključni kontakti i pregled ugovorenih usluga sa sljedećim rokovima. |
| Termini | Svi konkretni rokovi za ovog klijenta — prošli i budući. Svaki red je jedan termin sa datumom roka, statusom (planirano, zakazano, kasni, izvršeno) i zaduženom osobom. Termini se generišu iz provjera definisanih u Profilu. |
| Lokacije | Objekti i poslovne jedinice klijenta na kojima se vrše provjere i obilasci. Svaka lokacija može imati svoju adresu i kontakt osobu, a termini se mogu vezati za konkretnu lokaciju. |
| Kontakti | Sve kontakt osobe klijenta: kontakti firme (direktor, odgovorna lica…) i kontakti pojedinačnih lokacija. Kontakti lokacija se uređuju u tabu Lokacije. |
| Dokumenti | Svi dokumenti vezani za klijenta — ručno dodati fajlovi i AI-generisani zapisnici. Kolona Izvor pokazuje da li je dokument nastao uploadom ili ga je generisao AI. |
| Profil | Definicija ponavljajućih provjera za klijenta: koja vrsta provjere se radi, na kojoj lokaciji i kojim intervalom. Iz ovih stavki se automatski generišu termini. „Zadnji put" je posljednje stvarno izvršenje, „Sljedeći rok" je rok aktivnog termina. |

### Sekcije — ID karta

| Sekcija | Tekst |
|---|---|
| Osnovni podaci | Registracioni i kontakt podaci firme (adresa, PIB, matični broj…) i osoba zadužena za klijenta. Uređuje se preko dugmeta Uredi u zaglavlju. |
| Ugovori | Ugovori sklopljeni sa klijentom. Samo jedan ugovor može biti aktivan; stariji ostaju kao istorija. |
| Kontakt osobe (firma) | Skraćeni pregled kontakata firme (prvih nekoliko). Puni spisak i pretraga su u tabu Kontakti. |
| Ugovorene usluge | Sažetak provjera iz Profila sa sljedećim rokom za svaku — brzi uvid u to šta je ugovoreno i šta prvo dolazi na red. |

### Sekcije — Kontakti tab

| Sekcija | Tekst |
|---|---|
| Kontakt osobe (firma) | Puni spisak kontakata firme sa pretragom po imenu i funkciji. |
| Kontakti lokacija | Kontakt osobe pojedinačnih lokacija, izvedene iz podataka lokacije. Uređuju se u tabu Lokacije. |

## Testiranje

- `pnpm lint` + `pnpm typecheck`.
- Postojeći e2e testovi se oslanjaju na `data-testid={tab-...}` i tekst labela
  — ⓘ ne mijenja ni jedno ni drugo (ikona je grafika, tooltip skriven bez
  hovera), pa se lom ne očekuje. Pokrenuti relevantne klijent specove.
- Ručna provjera hovera u browseru (tabovi + sekcije).

## Van opsega

- Ostale stranice (Pregled, Plan aktivnosti, Termini lista…) — „idemo tab po
  tab", ovo je prvi korak; komponenta `InfoIkona` je reusable za sljedeće.
- Touch/klik ponašanje, i18n.
