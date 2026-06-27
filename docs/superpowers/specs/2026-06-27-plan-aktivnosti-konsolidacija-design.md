# Plan aktivnosti — konsolidacija tabova (Pregled/Termini/Plan/Prikaz) — Dizajn / Spec

Datum: 2026‑06‑27 · Status: odobren dizajn, čeka pisanje plana
Izvor: povratne informacije klijenta (sekcija 5 „Plan aktivnosti", sekcija 8 „nije jasna razlika između tabova Pregled/Termini/Plan/Prikaz") + analiza preklapanja.

---

## 1. Kontekst i problem

Četiri taba (Pregled, Termini, Plan, Prikaz) prikazuju **iste podatke** (`termini_view` — rokovi/aktivnosti) u različitim formama, sa realnim preklapanjem:
- `OpterecenjeChart` se renderuje na **Pregledu I Prikazu** (isti grafikon dva puta).
- `TerminSheet` i `TerminiTable` dijele Termini/Plan/Prikaz (isti detalj, isti red).
- Klijent je eksplicitno zbunjen razlikom; a ono što zove „Plan aktivnosti" (sekcija 5: centralna lista + filteri + izvoz) sadržajno je **Termini** ekran, ne „Plan" tab (koji je kalendar).

**Cilj:** svesti 4 taba na **1 dashboard (Pregled)** + **1 radni ekran „Plan aktivnosti"** sa prekidačem prikaza (Lista / Kalendar / Matrica), bez duplikata.

## 2. Obim

**U obimu:**
- Nova ruta `/plan-aktivnosti` sa `?view=lista|kalendar|matrica` (default `lista`).
- Tri view‑a reuseom postojećeg koda; `matrica` bez grafikona.
- `PlanViewSwitcher` (client) — mijenja `?view=` čuvajući ostale parametre.
- Redirecti sa `/termini`, `/plan`, `/prikaz` na nove view‑ove, **uz čuvanje query‑parametara**.
- Navigacija: 3 stavke → 1 „Plan aktivnosti"; Pregled ostaje.
- Pregled zadržava `OpterecenjeChart`; uklonjen iz matrice (nema duplikata).
- Ažuriranje internih linkova i E2E testova.

**Van obima (kasniji PP):**
- Izvoz plana u Excel/PDF (PP‑3).
- Bilo kakva promjena podataka/šeme, statusa, podsjetnika (PP‑2/PP‑4/PP‑5).

## 3. Odluke

1. **Pristup A** — ekstrakcija tijela postojećih strana u server‑komponente „view"; jedan ekran bira po `?view=`. Maksimalan reuse.
2. **Nova ruta `/plan-aktivnosti`** (ne preimenovanje `/termini`); stare rute → redirecti.
3. **Default view = `lista`.**
4. **Redirecti čuvaju query‑param** (npr. `/termini?status=kasni` → `/plan-aktivnosti?view=lista&status=kasni`).
5. **Grafikon ostaje na Pregledu**, izbačen iz matrice.
6. **Izvoz Excel/PDF van obima** (PP‑3).

## 4. Arhitektura

### 4.1 Nova ruta
`app/(dashboard)/plan-aktivnosti/page.tsx` — server komponenta:
- Čita `sp.view` (default `"lista"`); validira na skup `{lista,kalendar,matrica}`.
- Renderuje `<PlanViewSwitcher current={view} />` + aktivni view, prosljeđujući `searchParams`.

### 4.2 View‑ovi (kolocirano, privatni folder)
`app/(dashboard)/plan-aktivnosti/_views/`:
- `lista.tsx` ← tijelo `termini/page.tsx` (TerminiFilters + TerminiTable + NoviTerminButton + paginacija + TerminSheet). Glavni „Plan aktivnosti" prikaz.
- `kalendar.tsx` ← tijelo `plan/page.tsx` (MonthCalendar + dan‑sidebar + PlanNav + PlanLegenda + TerminSheet).
- `matrica.tsx` ← tijelo `prikaz/page.tsx` **bez `OpterecenjeChart`** (PrikazToolbar + MatrixGrid + MatrixLegenda + TerminSheet).
- Svaki je `async` server komponenta sa vlastitim dohvatom (kao i sad); prima `searchParams`.
- `TerminSheet` `closeHref`/`detailHref` u svakom view‑u ciljaju `/plan-aktivnosti?view=<view>&…` (umjesto starih ruta).

### 4.3 Switcher
`components/domain/PlanViewSwitcher.tsx` (client):
- 3 dugmeta (Lista/Kalendar/Matrica); aktivno istaknuto.
- `onValueChange` → `router.push("/plan-aktivnosti?" + params)` gdje se postavlja `view` a ostali parametri zadrže (filteri, `selected`, `godina`, `mjesec`, `dan`, `klijent`, `mode`).
- Pomoćnik `buildViewHref(current: URLSearchParams, view: string): string` (čista funkcija) — **unit‑testabilan**, čuva parametre, postavlja `view`.

### 4.4 Redirecti (stare rute)
`termini/page.tsx`, `plan/page.tsx`, `prikaz/page.tsx` → tanke server‑komponente koje čitaju `searchParams`, mapiraju na `?view=` i pozivaju `redirect()`:
- `/termini?<q>` → `/plan-aktivnosti?view=lista&<q>`
- `/plan?<q>` → `/plan-aktivnosti?view=kalendar&<q>`
- `/prikaz?<q>` → `/plan-aktivnosti?view=matrica&<q>`
- Pomoćnik `buildRedirectHref(view, sp)` — čuva sve postojeće parametre.

### 4.5 Navigacija
`components/shell/Sidebar.tsx` — ukloniti `Termini`, `Prikaz`, `Plan`; dodati jednu `{ href:"/plan-aktivnosti", label:"Plan aktivnosti", icon: Calendar }`. Pregled ostaje prvi. `active` highlight za `/plan-aktivnosti` (i da stare rute, ako se posjete prije redirecta, ne ostaju „aktivne").

### 4.6 Pregled
`pregled/page.tsx` — bez izmjene logike; zadržava `OpterecenjeChart`. Kartice koje linkuju na `"/termini?mjesec=…"` / `"/termini?status=kasni"` → `"/plan-aktivnosti?view=lista&…"`.

### 4.7 Interni linkovi
Sve reference `"/termini"`, `"/plan"`, `"/prikaz"` u `app/**` i `components/**` (npr. Pregled kartice, klijent stranica `obilasci` link, MatrixGrid `multiHref`, ObilasciPage link na `/termini?klijent_id=…`) → `"/plan-aktivnosti?view=…"`. (Redirecti su safety‑net, ali interne linkove ažuriramo da ne idu kroz redirect.)

## 5. Struktura fajlova

**Novo:**
- `app/(dashboard)/plan-aktivnosti/page.tsx`
- `app/(dashboard)/plan-aktivnosti/_views/lista.tsx`
- `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx`
- `app/(dashboard)/plan-aktivnosti/_views/matrica.tsx`
- `components/domain/PlanViewSwitcher.tsx`
- `lib/plan-view.ts` (`buildViewHref`, `buildRedirectHref`, `VIEW_OPCIJE`) + `lib/plan-view.test.ts`
- `tests/e2e/20-plan-aktivnosti.spec.ts`

**Izmjena:**
- `app/(dashboard)/termini/page.tsx` → redirect
- `app/(dashboard)/plan/page.tsx` → redirect
- `app/(dashboard)/prikaz/page.tsx` → redirect
- `components/shell/Sidebar.tsx` (nav)
- `app/(dashboard)/pregled/page.tsx` (link kartica)
- `components/domain/MatrixGrid.tsx` / `PrikazToolbar` (linkovi → `/plan-aktivnosti`) — ako referenciraju rute
- `app/(dashboard)/obilasci/page.tsx` (link `/termini?klijent_id=` → `/plan-aktivnosti?view=lista&klijent_id=`)
- Postojeći E2E specovi koji asertuju `/termini`, `/plan`, `/prikaz` URL/navigaciju.

## 6. Testiranje

- **Unit (vitest):** `buildViewHref` (postavlja view, čuva ostale parametre, default lista), `buildRedirectHref` (mapira rutu→view + čuva query).
- **E2E (Playwright, novi `20-plan-aktivnosti.spec.ts`):**
  - `/plan-aktivnosti` default prikazuje listu; switcher Lista→Kalendar→Matrica mijenja prikaz i `?view=`.
  - filter (npr. status=kasni) se zadrži pri promjeni view‑a.
  - redirecti: `/termini?status=kasni` → `/plan-aktivnosti?view=lista&status=kasni` (URL + sadržaj).
  - matrica **nema** grafikon; Pregled **ima** grafikon.
  - Sidebar: postoji „Plan aktivnosti", nema zasebnih Termini/Plan/Prikaz.
- **Ažuriranje postojećih E2E:** specovi 03‑termini, 05‑matrix‑plan, 10‑pregled, 11/13‑prikaz, 14‑plan, 01‑smoke (Sidebar 9→7 stavki) — preusmjeriti na nove rute/labele.
- **Build gate:** `pnpm typecheck` + `pnpm lint` + `pnpm test:unit` + `next build`.

## 7. Rizici

- **E2E regresija** — najveći rizik; mnogo specova dira ove rute. Mitigacija: redirecti čuvaju ponašanje + sistematsko ažuriranje asercija; pun E2E prije merge.
- **Gubitak parametara pri redirect/switch** — pokriveno unit testovima helpera + E2E.
- **Sidebar `active` highlight** — `startsWith` logika; provjeriti da `/plan-aktivnosti` ne koliduje.
- **Produkcija** — radi se na feature grani; merge tek nakon zelenog E2E (kao PP‑1).

## 8. Veza sa zahtjevom

Direktno rješava sekciju **8** (jasna namjena ekrana) i postavlja temelj za sekciju **5** (glavni „Plan aktivnosti" ekran); **izvoz Excel/PDF** iz sekcije 5 ostaje za PP‑3 nad ovim ekranom.
