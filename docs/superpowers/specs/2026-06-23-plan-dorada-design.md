# Dizajn: Dorada Plan taba

**Datum:** 2026-06-23
**Status:** Odobren dizajn → spreman za plan implementacije
**Pristup:** A — mali izolovani zahvati po stavci, reuse-first

## Kontekst i cilj

Plan tab (`/plan`) prikazuje mjesečni kalendar (7 kolona Pon–Ned × 6 redova) sa terminima po danu. Klik na dan otvara desni sidebar sa listom termina tog dana; "Detalji" otvara `TerminSheet`. Navigacija: ◀ ▶ strelice, "Danas", godina dropdown.

Iz analize iz ugla netehničkog korisnika izašle su 4 odobrene dorade (filteri #5 i izdvajanje vikenda #6 su van opsega):

1. **Legenda boja** — tačkice statusa (plava/zelena/crvena/cyan/siva) pored termina nigdje nisu objašnjene.
2. **Zbunjujući broj** — sivi broj u gornjem-desnom uglu ćelije (ukupan broj termina) liči na datum i redundantan je s "još N".
3. **Direktan klik na termin** — cijela ćelija je jedan link na `?dan=`; konkretan termin se otvara tek kroz dan → sidebar → Detalji (2 koraka).
4. **Mjesec dropdown** — navigacija ima samo strelice; skok Jul→Decembar = 5 klikova. Prikaz tab već ima mjesec dropdown (nekonzistentno).

## Postojeća sredstva za reuse

- `MonthCalendar` (`components/domain/MonthCalendar.tsx`) — gradi grid; lokalni `DOTS` (5 `bg-*-500` tačkica); ćelija je `<Link>` na `?dan=`; prikazuje prva 3 termina + "još N" + broj u uglu.
- `PlanNav` (`components/domain/PlanNav.tsx`) — client; ◀▶ + Danas + godina `Select`; `href(g, m)` gradi URL.
- `plan/page.tsx` — server; dohvat termina za mjesec, gradi `terminiByDan`, renderuje kalendar + opcioni `?dan` sidebar + `?selected` `TerminSheet`.
- `lib/termini.ts` — `DerivedStatus`, `STATUS_LABEL`, `STATUS_BADGE_CLASS`, `toDerivedStatus`.
- `lib/date.ts` — `MONTHS_BS`. `lib/calendar.ts` — `buildMonthGrid`, `monthLabel`, `prevMonth`, `nextMonth`.
- `MatrixLegenda` (Prikaz) — uzor za legendu, ali boje se razlikuju (matrica = `bg-*-100` ispune, kalendar = `bg-*-500` tačke), pa je `PlanLegenda` zasebna.

## Global Constraints (verbatim)

- Grana: `fix/plan-dorada` (NE `main`).
- App je na **cloud Supabase** — testovi idu protiv cloud-a (`tests/e2e/db.ts` helper), bez lokalnog Dockera.
- Desktop-only: zabranjen `sm:`/`md:` breakpoint (koristiti `lg:`/`xl:`/`2xl:` ili bez).
- Ćelija ne smije imati ugniježdene `<a>` (nevalidan HTML) — koristiti pozadinski link + sloj sadržaja s `pointer-events`.
- Status boje-tačke (kalendar, verbatim): izvrseno `bg-green-500`, planirano `bg-blue-500`, zakazano `bg-cyan-500`, kasni `bg-red-500`, otkazano `bg-slate-400`.
- `?selected=<id>` → `TerminSheet` (ostaje u Planu); `?dan=<date>` → dnevni sidebar.

---

## Sekcija 1 — Legenda + dijeljene dot-boje + uklanjanje broja (#1, #2)

**`lib/termini.ts`:** dodati izvor istine za tačke:
```ts
export const STATUS_DOT_CLASS: Record<DerivedStatus, string> = {
  planirano: "bg-blue-500",
  zakazano: "bg-cyan-500",
  izvrseno: "bg-green-500",
  kasni: "bg-red-500",
  otkazano: "bg-slate-400",
}
```

**`MonthCalendar`:** ukloniti lokalni `DOTS`, koristiti `STATUS_DOT_CLASS`. **Ukloniti** `<span>` s `termini.length` u gornjem-desnom uglu ćelije (redundantan; "još N" pokriva preljev).

**Nova `components/domain/PlanLegenda.tsx`** (čista, bez state-a): horizontalna legenda — 5 obojenih tačkica (`STATUS_DOT_CLASS`) + labele (`STATUS_LABEL`), redoslijed `izvrseno, planirano, zakazano, kasni, otkazano`. `data-testid="plan-legenda"`.

**`plan/page.tsx`:** renderovati `<PlanLegenda />` **ispod** kalendara (kalendar je uvijek vidljiv, pa je legenda uvijek prisutna). Unutar postojećeg `<div className={selectedDan ? grid... : ""}>` legenda ide ispod, izvan grid kolone (preko cijele širine).

---

## Sekcija 2 — Mjesec dropdown (#4)

**`PlanNav`:** dodati `Select` za mjesec pored godina dropdowna:
- Vrijednost `String(mjesec)`, opcije 1..12 sa labelama `MONTHS_BS[i]`.
- `onValueChange={(v) => { const m = Number(v); if (m) router.push(href(godina, m)) }}`.
- `href` već briše `dan`/`selected` — isto ponašanje kao godina.
- `data-testid="plan-nav-mjesec"`. Import `MONTHS_BS` iz `lib/date`.

Strelice ◀▶ i "Danas" ostaju nepromijenjeni.

---

## Sekcija 3 — Direktan klik na termin (#3)

**`MonthCalendar`** — restruktura ćelije (bez ugniježdenih `<a>`):

- Ćelija postaje `<div className="relative ...">` (više nije `<Link>`).
- **Pozadinski sloj:** `<Link href={dayHref(c.date)} data-testid="plan-day-cell" data-date={c.date} data-selected={isSelected} aria-label="..." className="absolute inset-0" />` — veliki klik-target za cijeli dan (→ `?dan` sidebar). Zadržati `data-testid="plan-day-cell"` (jedan po ćeliji → grid test i dalje broji 42).
- **Sloj sadržaja:** `<div className="relative pointer-events-none ...">` sadrži broj dana (+ today-krug) i listu termina.
  - Svaki termin: `<Link href={terminHref(t.id)} data-testid="cell-termin" data-status={t.status} className="pointer-events-auto ...">` sa tačkom (`STATUS_DOT_CLASS`) + `klijent · lokacija`. `terminHref` postavlja `?selected=<id>` (briše `dan`).
  - "još N": `<Link href={dayHref(c.date)} data-testid="cell-vise" className="pointer-events-auto ...">još N</Link>`.
- Vizuelni `selected`/`hover` highlight prelazi na ćeliju-`<div>` (`isSelected` ring, `hover:bg-slate-50`). Pozadinski link nema vidljiv okvir.

**Rezultat:** klik na termin → taj termin u `TerminSheet`; klik bilo gdje drugdje u ćeliji (broj, prazno) → dnevni sidebar. `plan/page.tsx` sidebar/`?dan`/`?selected` logika ostaje netaknuta (MonthCalendar već prima `currentSearch`; `terminHref` se gradi u komponenti analogno `dayHref`).

---

## Posljedice na testove

`tests/e2e/05-matrix-plan.spec.ts` (Plan sekcije):
- "klik dana sa terminima → sidebar → Detalji → sheet" — oslanja se na `plan-day-cell` koji sadrži `span.rounded-full`; nakon restrukture tačke su u sloju sadržaja, ne u pozadinskom linku. **Ažurirati** test da koristi novi model.
- Grid (42 ćelije), nav (prev/next), Danas, godina dropdown — ostaju zeleni (`plan-day-cell` i dalje 42, navigacija nepromijenjena).

Novi `tests/e2e/14-plan-dorada.spec.ts`:
- Legenda vidljiva (`plan-legenda`), sadrži 5 status labela.
- Broj u uglu ćelije uklonjen (nije vidljiv stari count-span; provjera kroz odsustvo).
- Mjesec dropdown: izbor mjeseca → URL `?mjesec=<n>`, `plan-nav-label` se mijenja.
- Direktan klik: `cell-termin` → `?selected=` → `TerminSheet` vidljiv (bez prolaska kroz sidebar).
- Pozadina dana: klik `plan-day-cell` (dan sa terminima) → `plan-sidebar` vidljiv.

## Verifikacija (gate)

`pnpm lint && pnpm typecheck && pnpm build` + Playwright protiv cloud-a:
- Legenda prisutna ispod kalendara; 5 boja+labela.
- Mjesec dropdown mijenja `?mjesec=` i label.
- `cell-termin` otvara `TerminSheet` direktno; pozadina dana otvara sidebar.
- Regresija: `05-matrix-plan` Plan i Prikaz sekcije zelene.

## Van opsega (YAGNI)

- Filteri po statusu/klijentu na kalendaru (#5) — zaseban zahvat.
- Izdvajanje vikend-kolona (#6) — sitno, namjerno preskočeno.
- Spajanje pogleda Termini/Prikaz/Plan — zaseban UX razgovor.
