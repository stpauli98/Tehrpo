# Dizajn: MVP UI parnost sa demo prototipom

**Datum:** 2026-06-22
**Status:** Odobren dizajn → spreman za plan implementacije
**Pristup:** A — reuse-first, vertikalni slajsovi (redoslijed: Badge → Dashboard → Cross-klijent matrica → Obilasci)

## Kontekst i cilj

Demo prototip (`tehpro-demo-deploy`, statički React mockup) imao je nekoliko IA odluka bližih stvarnom radnom toku koje MVP (`tehpro-mvp`) nije prenio. Cilj ove implementacije je vratiti te vrijednosti u MVP, gradeći na postojećem backendu i komponentama, bez prepisivanja.

Četiri stavke u opsegu (sve odobrene):

1. **Dashboard** kao početni ekran (demo "Pregled" — KPI + "Hitno/kasni" lista + mjesečni chart).
2. **Cross-klijent mjesečna matrica** (demo "Mjesečni plan" / postojeći Excel — vrste × firme za jedan mjesec).
3. **Obilasci** ekran (grupisanje termina po gradu za planiranje izlazaka), filtrabilno po periodu.
4. **"po ugovoru / po ponudi"** badge na klijentu (poslovni tip odnosa).

Brend boja se **ne mijenja** (ostaje plava `#2563eb`). Promjena boje nije u opsegu.

## Donesene odluke (iz brainstorma)

- Badge: **puno** — migracija + uređivanje u formi + prikaz.
- Dashboard: **postaje početna ruta** (app se otvara na njemu).
- Obilasci: **filtrabilno po periodu** (Mjesec / Kvartal / Godina) + grupisanje po gradu.

## Postojeća sredstva za reuse

- RPC: `get_termini_stats()` → `ukupno, ovog_mjeseca, kasni, izvrseno_ovog_mjeseca`.
- RPC: `get_opterecenje(godina int)` → `mjesec, ukupno, izvrseno, kasni, u_planu`.
- View: `termini_view` već sadrži `klijent_id, klijent_naziv, lokacija_naziv, lokacija_grad, vrsta_provjere_id, vrsta_naziv, rok_dospijeca, status, status_izvedeni, datum_izvrsenja`.
- Komponente: `StatCard`, `OpterecenjeChart`, `StatusBadge`, `MatrixGrid`, `TerminSheet`, `TerminiTable`, `KlijentCard`, `KlijentEditForm`, `PrikazToolbar`, `Sidebar`, `Card`.
- Helperi: `lib/date.ts` (`MONTHS_BS`, `currentYear`, `todayIso`), `lib/termini.ts` (`toDerivedStatus`, `DerivedStatus`).

---

## Sekcija 1 — Navigacija, rute, redirect

Problem: `/pregled` trenutno = lista AI zapisnika; novi dashboard treba to ime.

Izmjene:
- Novi **dashboard** → ruta `/pregled`, nav label "Pregled" (ikona `LayoutDashboard`).
- Stari ekran (AI zapisnici) → ruta `/zapisnici`, nav label "Zapisnici" (ikona `FileText`).
  - Premjestiti `app/(dashboard)/pregled/` → `app/(dashboard)/zapisnici/`.
  - Grep + ažurirati sve interne linkove `/pregled?preview=…` → `/zapisnici?preview=…`.
- `app/(dashboard)/page.tsx`: redirect `"/termini"` → `"/pregled"`.
- `components/shell/Sidebar.tsx` — novi `NAV_ITEMS` (9 stavki):

| # | Label | Ruta | Ikona |
|---|---|---|---|
| 1 | Pregled | `/pregled` | LayoutDashboard |
| 2 | Termini | `/termini` | ClipboardList |
| 3 | Prikaz | `/prikaz` | Grid3x3 |
| 4 | Plan | `/plan` | Calendar |
| 5 | Obilasci | `/obilasci` | Map |
| 6 | Klijenti | `/klijenti` | Users |
| 7 | Asistent | `/asistent` | Bot |
| 8 | Zapisnici | `/zapisnici` | FileText |
| 9 | Postavke | `/postavke` | Settings |

Napomena: `active = pathname.startsWith(href)` ostaje ispravno jer nijedan href nije `/`.

---

## Sekcija 2 — Badge "po ugovoru / po ponudi"

### Baza (migracija `…_klijenti_tip_odnosa.sql`)
- `alter table klijenti add column tip_odnosa text check (tip_odnosa in ('ugovor','ponuda'));` — **nullable** (postojeći redovi ostaju prazni dok se ne postave kroz formu).
- Ažurirati view `klijenti_read_model` da izloži `tip_odnosa` (jer `KlijentCard` čita iz read modela).
- Regenerisati `db/types.ts` (`pnpm db:types`).

### UI
- Nova komponenta `components/domain/TipOdnosaBadge.tsx`:
  - `ugovor` → "po ugovoru" (plavi pill).
  - `ponuda` → "po ponudi" (neutralni sivi pill).
  - `null` → ne renderuje ništa.
- `components/domain/KlijentEditForm.tsx` — `Select` "Tip odnosa": Po ugovoru / Po ponudi / — (nije postavljeno).
- `app/(dashboard)/klijenti/actions.ts` — `tip_odnosa` u zod šemu create/update (enum `'ugovor'|'ponuda'` ili `null`).
- `components/domain/KlijentCard.tsx` — `TipOdnosaBadge` gore-desno pored naziva; postojeći "kasni" badge ostaje u redu metrika.
- `app/(dashboard)/klijenti/[id]/page.tsx` — `TipOdnosaBadge` pored naziva u headeru detalja.

---

## Sekcija 3 — Dashboard (`/pregled`)

Ruta/tip: `app/(dashboard)/pregled/page.tsx` — server component, read-only.

### Raspored
1. Heading "Pregled" + podnaslov "Rokovi i opterećenje".
2. 4 KPI kartice (`grid lg:grid-cols-4`, reuse `StatCard`):

| Kartica | Izvor | Ton | Klik |
|---|---|---|---|
| Termini ovog mjeseca | `stats.ovog_mjeseca` | neutral | `/termini?mjesec=<tekući>` |
| Kasni rokovi | `stats.kasni` | danger | `/termini?status=kasni` |
| Izvršeno ovog mjeseca | `stats.izvrseno_ovog_mjeseca` | success | `/termini?status=izvrseno` |
| Predstojeći (30 dana) | novi count | warning | `/termini` |

3. 2-kolonski grid (`lg:grid-cols-3`):
   - Lijevo (`col-span-2`): `OpterecenjeChart` za tekuću godinu (reuse `get_opterecenje`).
   - Desno (`col-span-1`): kartica "Hitno / kasni" — `components/domain/HitnoKasniList.tsx`.

### "Hitno / kasni" lista (nova)
- Upit `termini_view`: `status_izvedeni = 'kasni'` **ili** (`rok_dospijeca` ≤ danas+30 i `status_izvedeni` ≠ `izvrseno`), sort `rok_dospijeca` asc, limit 8. Selekt: `klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, rok_dospijeca, status_izvedeni`.
- Red: lijevo firma (bold) + vrsta (sub); desno datum (crveno ako kasni). Red je link → `/termini?klijent_id=<klijent_id>`.
- Footer: "+ N termina dospijeva u narednih 30 dana" ako ima više od limita.
- Prazno: "Nema hitnih ni kasnih termina."

### Novi lib upiti (`lib/termini.ts`)
- `getPredstojeciCount(dana = 30)` — count termina sa `rok_dospijeca` ∈ [danas, danas+dana] i `status_izvedeni ≠ izvrseno`.
- `getHitnoKasni(limit = 8)` — gornja lista.
- Obični `termini_view` upiti preko Supabase klijenta. **`get_termini_stats` se ne dira** (i dalje ga koristi Termini stranica).

---

## Sekcija 4 — Cross-klijent matrica u `/prikaz`

### Mod toggle (`PrikazToolbar`, param `?mode=`)
- "Po klijentu" (default, postojeći): Klijent + Godina → matrica **vrste × mjeseci**.
- "Po mjesecu" (novi): Mjesec + Godina → matrica **vrste × firme**.

### Generalizacija `MatrixGrid.tsx`
Novi prop oblik (kolone-agnostičan):
```ts
type MatrixColumn = { id: string; label: string; isCurrent?: boolean }
type MatrixRow = { rowId: string; rowLabel: string; cells: Record<string, MatrixCell | null> }
MatrixGrid({ columns, rows, currentSearch, emptyMessage })
```
- Po klijentu: `columns` = 12 mjeseci (`MONTHS_BS`, `isCurrent` = tekući), `cells` keyani po broju mjeseca (string).
- Po mjesecu: `columns` = svi klijenti (sortirano), `cells` keyani po `klijent_id`.
- Ćelijski stil ostaje (`CELL_CLASS`, `cellLabel` sa `✓`/`!`/`(+N)`, sticky lijeva kolona). Link ćelije → `?selected=<terminId>` (otvara postojeći `TerminSheet`) — u oba moda.
- `emptyMessage` prop zamjenjuje fiksnu poruku.

### `prikaz/page.tsx` logika
- `mode=klijent` (+ izabran klijent): postojeći pivot (vrste × mjeseci).
- `mode=mjesec`: upit `termini_view` za `godina + mjesec` preko svih klijenata (`id, vrsta_provjere_id, vrsta_naziv, klijent_id, rok_dospijeca, status_izvedeni`); JS pivot → redovi = vrste, kolone = klijenti. **Bez novog RPC-a** (isti pristup kao postojeći per-klijent pivot).
- Kolone = **svi** klijenti (prazne ćelije vidljive — smisao je uočiti firme bez zakazanog termina). Trade-off: može biti široko → horizontalni scroll već postoji. Mogući kasniji dodatak: "samo sa terminima" filter.

### Empty states
- Po klijentu bez izbora: "Izaberite klijenta za prikaz godišnje matrice."
- Po mjesecu bez termina: "Nema termina za izabrani mjesec."

`OpterecenjeChart` ostaje vidljiv u oba moda (godišnji pregled).

---

## Sekcija 5 — Obilasci (`/obilasci`)

Ruta/tip: `app/(dashboard)/obilasci/page.tsx` — server component.

### Toolbar (`components/domain/ObilasciToolbar.tsx`, client)
- Granularnost select (param `?period=`): Mjesec / Kvartal / Godina.
- Zavisni selektor:
  - `mjesec` → Mjesec (`MONTHS_BS`) + Godina.
  - `kvartal` → Kvartal (Q1–Q4) + Godina.
  - `godina` → Godina.
- Default: `mjesec` = tekući mjesec + tekuća godina.
- Novi helper `lib/date.ts`: `periodRange(period, godina, mjesec?, kvartal?)` → `{ od, do }` (ISO).

### Podaci
- Upit `termini_view` gdje `rok_dospijeca` ∈ `[od, do]`; selekt `id, klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, lokacija_grad, rok_dospijeca, status_izvedeni`; sort `lokacija_grad`, pa `rok_dospijeca`. **Bez novog RPC-a / joina** (`termini_view` već ima `lokacija_grad`).

### Grupisanje i render (JS)
- Grupisanje po `lokacija_grad`. Termini bez grada → grupa "Bez grada" na dnu.
- Heading "Obilasci" + podnaslov "Grupisano po gradu za efikasniji raspored izlazaka."
- Za svaki grad: sekcija sa `MapPin` + naziv grada; grid kartica (`lg:grid-cols-2`):
  - firma (bold) · vrsta (sub) · `lokacija_naziv`; desno datum + `StatusBadge`.
  - kartica = link → `/termini?klijent_id=<klijent_id>`.
- Prikaz svih statusa u periodu (kao demo).
- Prazno: "Nema termina u izabranom periodu."

---

## Sažetak novih/izmijenjenih fajlova

**Migracije/baza**
- `supabase/migrations/…_klijenti_tip_odnosa.sql` (nova: kolona + view update)
- `db/types.ts` (regen)

**Rute/stranice**
- `app/(dashboard)/page.tsx` (redirect izmjena)
- `app/(dashboard)/pregled/page.tsx` (nova: dashboard)
- `app/(dashboard)/zapisnici/` (premješteno iz `pregled/`)
- `app/(dashboard)/obilasci/page.tsx` (nova)
- `app/(dashboard)/prikaz/page.tsx` (mod grana)
- `app/(dashboard)/klijenti/actions.ts` (tip_odnosa)
- `app/(dashboard)/klijenti/[id]/page.tsx` (badge)

**Komponente**
- `components/shell/Sidebar.tsx` (nav)
- `components/domain/TipOdnosaBadge.tsx` (nova)
- `components/domain/HitnoKasniList.tsx` (nova)
- `components/domain/ObilasciToolbar.tsx` (nova)
- `components/domain/MatrixGrid.tsx` (generalizacija)
- `components/domain/PrikazToolbar.tsx` (mod toggle + Mjesec)
- `components/domain/KlijentEditForm.tsx` (Select tip odnosa)
- `components/domain/KlijentCard.tsx` (badge)

**Lib**
- `lib/termini.ts` (`getPredstojeciCount`, `getHitnoKasni`)
- `lib/date.ts` (`periodRange`)

## Verifikacija (gate na kraju svake faze)

Po projektnom pravilu: build + lint + Playwright E2E + vizualna provjera kao gate na kraju svake faze.

- **Badge:** klijent forma sprema tip; badge vidljiv na kartici i detalju.
- **Dashboard:** `/` → redirect `/pregled`; 4 KPI + chart + "Hitno/kasni"; klik "Kasni rokovi" → filtriran `/termini`; nav "Pregled" aktivan.
- **Matrica:** toggle "Po mjesecu" → izbor mjeseca → vrste×firme obojene ćelije; povratak "Po klijentu"; klik ćelije otvara `TerminSheet`.
- **Obilasci:** `/obilasci` default mjesec; grupe po gradu sa badge-vima; promjena perioda na "Godina" prikaže više; nav "Obilasci" aktivan.

## Van opsega (YAGNI)

- Promjena brend boje (crvena demo → plava MVP).
- Inline `TerminSheet` na dashboardu/obilascima (redovi samo navigiraju na filtriran `/termini`).
- "Samo sa terminima" filter kolona u cross-klijent matrici.
- Spajanje tri pogleda na termine (Termini/Prikaz/Plan) — zaseban UX razgovor.
