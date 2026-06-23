# Dizajn: Dorada Prikaz taba

**Datum:** 2026-06-23
**Status:** Odobren dizajn → spreman za plan implementacije
**Pristup:** A — mali izolovani zahvati po stavci, reuse-first

## Kontekst i cilj

Prikaz tab (`/prikaz`) prikazuje matricu vrste×mjeseci (po klijentu) ili vrste×firme (po mjesecu) + godišnji chart "Opterećenje". Iz analize iz ugla korisnika bez tehničkog znanja izašle su 4 stavke koje treba doraditi (sve odobrene):

1. **Legenda matrice** — simboli `✓ ! (+N) ·` i 5 status-boja nigdje nisu objašnjeni.
2. **(+N) ćelije** — ćelija s više termina otvara samo jedan; ostali nedostupni.
3. **Mjesec-mod default** — toolbar dropdown stoji prazan dok server prikazuje tekući mjesec.
4. **Klijent reset** — klijent dropdown nema "— svi —" opciju za povratak na prazno (+ legenda razjašnjava boje).

## Postojeća sredstva za reuse

- `MatrixGrid` (`components/domain/MatrixGrid.tsx`) — generalizovan: `{ columns, rows, currentSearch, emptyMessage }`; ćelija → `?selected=<terminId>` (TerminSheet); `cellLabel` (✓/!/(+N)), `CELL_CLASS` (5 boja), `MatrixCell { terminId, dan, status, brojUCeliji }`.
- `PrikazToolbar` (`components/domain/PrikazToolbar.tsx`) — client; mod toggle + dropdowni; `setParam`.
- `prikaz/page.tsx` — gradi kolone/redove po modu (klijent: vrste×mjeseci; mjesec: vrste×firme), čita `mode/klijent/godina/mjesec` iz searchParams.
- Termini lista (`/termini`) — filteri `klijent_id`, `vrsta_id`, `mjesec` (1..12), `godina` — AND-kombinovani (provjereno).
- `lib/date.ts`: `todayIso`, `currentYear`, `MONTHS_BS`. `lib/termini.ts`: `DerivedStatus`, `STATUS_LABEL`.

## Global Constraints (verbatim)

- Grana: `fix/prikaz-dorada` (NE `main`).
- App je na **cloud Supabase** — testovi idu protiv cloud-a (`tests/e2e/db.ts` helper), bez lokalnog Dockera.
- Desktop-only: zabranjen `sm:`/`md:` breakpoint (koristiti `lg:`/`xl:`/`2xl:` ili bez).
- Termini filter param imena (verbatim): `klijent_id`, `vrsta_id`, `mjesec` ("1".."12"), `godina`.
- Cell-link logika: jedan termin → `?selected=<terminId>` (TerminSheet, ostaje u Prikazu); više termina → filtrirani `/termini`.
- Boje statusa (matrica, verbatim): izvrseno `bg-green-100`, planirano `bg-blue-50`, zakazano `bg-cyan-50`, kasni `bg-red-100`, otkazano `bg-slate-100`.

---

## Sekcija 1 — Legenda matrice

**Komponenta:** nova `components/domain/MatrixLegenda.tsx` (čista, bez state-a).
Renderuje horizontalnu legendu:
- Simboli: `✓` izvršeno · `!` kasni · `(+N)` još termina u ćeliji · `·` nema termina.
- Status-boje: 5 obojenih kvadratića sa labelama (Izvršeno/Planirano/Zakazano/Kasni/Otkazano), boje iz `CELL_CLASS` (npr. `bg-green-100`…).

**Gdje:** u `prikaz/page.tsx`, **ispod** `MatrixGrid`-a, prikazuje se **samo kad je matrica vidljiva** (mode=mjesec ILI klijent+izabran). `data-testid="matrix-legenda"`.

**Time se rješava i "boje nejasne".** Chart zadržava svoju legendu (godišnji sažetak vs detalj — dva sloja, ne prebojavamo).

---

## Sekcija 2 — (+N) ćelije → filtrirani Termini

**`MatrixGrid`:** dodati opcioni prop `multiHref?: (rowId: string, colId: string) => string`.
- Ćelija sa `cell.brojUCeliji > 1` i prisutnim `multiHref` → `<Link href={multiHref(row.rowId, c.id)}>` (vodi na listu svih).
- Ćelija sa jednim terminom (ili bez `multiHref`) → postojeći `?selected=<terminId>` (TerminSheet).
- Vizuelno: multi-ćelija zadržava boju/`cellLabel` (već pokazuje `(+N)`); `title="Više termina — otvori listu"`.

**`prikaz/page.tsx`:** gradi `multiHref` po modu (godina iz aktivne godine):
- Po klijentu (`klijentId` izabran): `multiHref = (vrstaId, mjesecCol) => /termini?klijent_id=${klijentId}&vrsta_id=${vrstaId}&mjesec=${mjesecCol}&godina=${godina}`
- Po mjesecu: `multiHref = (vrstaId, klijentCol) => /termini?klijent_id=${klijentCol}&vrsta_id=${vrstaId}&mjesec=${mjesec}&godina=${godina}`

(`colId` je broj mjeseca u klijent-modu, `klijent_id` u mjesec-modu — isto kako se grade kolone.)

---

## Sekcija 3 — Mjesec-mod default

**`PrikazToolbar`:** novi handler za mod toggle (umjesto golog `setParam("mode", …)`):
```ts
function setMode(m: "klijent" | "mjesec") {
  const next = new URLSearchParams(params.toString())
  next.set("mode", m)
  next.delete("selected")
  if (m === "mjesec" && !next.get("mjesec")) {
    next.set("mjesec", String(Number(todayIso().slice(5, 7)))) // tekući mjesec
  }
  startTransition(() => router.push(`/prikaz?${next.toString()}`))
}
```
Oba mode dugmeta zovu `setMode`. Tako "Po mjesecu" odmah postavi `?mjesec=<tekući>` → dropdown odražava prikaz. (`todayIso` import iz `lib/date`.)

---

## Sekcija 4 — Klijent reset

**`PrikazToolbar`:** u klijent `Select` dodati prvu stavku `<SelectItem value="__svi__">— svi klijenti —</SelectItem>`.
- `onValueChange`: ako je vrijednost `"__svi__"` → `setParam("klijent", "")` (čisti param → prazno stanje "Izaberite klijenta…").
- `klijentItems` mapa dobija `{ __svi__: "— svi klijenti —", ...ostalo }` da zatvoreni trigger ne pokaže sirovi sentinel.

---

## Sažetak fajlova

- Create: `components/domain/MatrixLegenda.tsx`
- Modify: `components/domain/MatrixGrid.tsx` (multiHref)
- Modify: `app/(dashboard)/prikaz/page.tsx` (legenda render + multiHref closure)
- Modify: `components/domain/PrikazToolbar.tsx` (setMode + klijent reset)
- Test: `tests/e2e/11-prikaz-mjesec.spec.ts` (ili novi `13-prikaz-dorada.spec.ts`)

## Verifikacija (gate)

Playwright protiv cloud-a (`pnpm test:e2e`), + `pnpm lint && pnpm typecheck && pnpm build`:
- Legenda vidljiva kad je matrica (mjesec mod ili klijent izabran); nije vidljiva u praznom stanju.
- Toggle "Po mjesecu" iz default-a → URL ima `?mjesec=<tekući>`, dropdown popunjen.
- Klijent reset ("— svi —") → vraća na `prikaz-empty`.
- (+N) ćelija: gdje postoji multi-ćelija, klik vodi na `/termini?...vrsta_id=...&mjesec=...`; single-ćelija i dalje otvara `prikaz-matrix` TerminSheet. *(Ako u seed-u nema multi-ćelije, test gradi je: postavi dva termina isti klijent+vrsta+mjesec preko cloud helpera, pa provjeri (+N) link.)*
- Regresija: `05-matrix-plan` i `11-prikaz-mjesec` ostaju zeleni.

## Van opsega (YAGNI)
- Potpuno ujednačavanje boja matrica↔chart (legenda razjašnjava; chart je zaseban sloj).
- Spajanje tri pogleda na termine (Termini/Prikaz/Plan) — zaseban UX razgovor.
