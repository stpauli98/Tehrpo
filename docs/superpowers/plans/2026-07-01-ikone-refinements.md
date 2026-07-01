# Ikone & finese (tekst → ikonice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamijeniti ponavljajući/konvencionalni tekst ikonicama (lucide, u stilu sidebar-a) uz hover tooltip, bez gubitka pristupačnosti i test-hookova.

**Architecture:** Jedna reusable tooltip komponenta + dijeljene klase (`components/ui/ikona-tooltip.tsx`) koje svako mjesto koristi. Svaka ikona-akcija zadržava `aria-label` (accessible name) i postojeći `data-testid`, pa E2E testovi koji ciljaju po role/testid nastavljaju raditi. Native `title` se ne koristi (custom tooltip je instant + stilizovan).

**Tech Stack:** Next.js 16 (webpack), React, Tailwind, lucide-react, Playwright E2E.

## Global Constraints

- Ikone su `lucide-react`, veličina `h-[18px] w-[18px]` (ili `h-4 w-4` u gustim redovima), `aria-hidden` na `<svg>`.
- Svaka icon-only akcija MORA imati `aria-label` sa punim tekstom + `<Tooltip>` sa istim tekstom.
- NE mijenjati nijedan `data-testid`.
- NE konvertovati u icon-only: „Otkaži", „Sačuvaj/Spremi", „Pošalji", dialog „Zatvori" dugmad (jasnoća akcije). Primarne „Novi*" akcije ostaju icon+**tekst**.
- Bez `sm:`/`md:` Tailwind breakpointa (eslint pravilo); koristiti `lg:`+ ili bez breakpointa.
- Testiranje E2E ide protiv DEMO projekta (dev server + `tests/e2e/db.ts` čitaju `.env.development.local`).
- Nakon svake izmjene: `pnpm typecheck` čist, relevantni E2E spec prolazi, pa commit.

---

### Task 1: Reusable tooltip komponenta + refactor izvoz dugmadi

**Files:**
- Create: `components/ui/ikona-tooltip.tsx`
- Modify: `components/domain/PlanIzvozDugmad.tsx`
- Verify: `tests/e2e/20-plan-aktivnosti.spec.ts`

**Interfaces:**
- Produces: `Tooltip` (React komponenta, `{children}`), `IKONA_DUGME_KLASA` (string — kvadratno bordered icon dugme), `IKONA_INLINE_KLASA` (string — inline icon akcija u redu tabele). Sve kasnije task-ove koriste ove.

- [ ] **Step 1: Kreiraj komponentu**

```tsx
// components/ui/ikona-tooltip.tsx
import { cn } from "@/lib/utils"

/** Kvadratno icon-dugme u stilu sidebar-a (border + hover). Sadrži `group/tt relative`. */
export const IKONA_DUGME_KLASA =
  "group/tt relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"

/** Inline icon-akcija (npr. u redu tabele) — bez bordera, kompaktna. Sadrži `group/tt relative`. */
export const IKONA_INLINE_KLASA =
  "group/tt relative inline-flex items-center justify-center rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"

/** Hover tooltip (isti obrazac kao sidebar). Postavi kao dijete elementa koji ima `group/tt relative`. */
export function Tooltip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-md group-hover/tt:block",
        className,
      )}
    >
      {children}
    </span>
  )
}
```

- [ ] **Step 2: Refactoruj `PlanIzvozDugmad.tsx` da koristi komponentu (DRY)**

Zamijeni tijelo `return` tako da koristi `Tooltip` (klase ostaju kao sada, boje zeleno/crveno):

```tsx
"use client"
import { useSearchParams } from "next/navigation"
import { FileSpreadsheet, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/ikona-tooltip"

export function PlanIzvozDugmad() {
  const params = useSearchParams()
  const href = (format: string) => {
    const next = new URLSearchParams(params.toString())
    next.delete("view"); next.delete("page"); next.delete("selected")
    next.set("format", format)
    return `/api/plan-aktivnosti/izvoz?${next.toString()}`
  }
  const klasa = "group/tt relative flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 transition-colors"
  return (
    <div className="flex items-center gap-2">
      <a href={href("xlsx")} className={cn(klasa, "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700")} data-testid="izvoz-excel" aria-label="Izvoz Excel">
        <FileSpreadsheet className="h-[18px] w-[18px]" aria-hidden />
        <Tooltip>Izvoz Excel</Tooltip>
      </a>
      <a href={href("pdf")} className={cn(klasa, "text-red-600 hover:bg-red-50 hover:text-red-700")} data-testid="izvoz-pdf" aria-label="Izvoz PDF">
        <FileText className="h-[18px] w-[18px]" aria-hidden />
        <Tooltip>Izvoz PDF</Tooltip>
      </a>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + E2E**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/20-plan-aktivnosti.spec.ts --project=chromium`
Expected: typecheck clean; spec PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/ikona-tooltip.tsx components/domain/PlanIzvozDugmad.tsx
git commit -m "refactor(ui): reusable Tooltip komponenta + izvoz dugmad koriste je"
```

---

### Task 2: „Detalji" → Eye ikona (tabela termina)

**Files:**
- Modify: `components/domain/TerminiTable.tsx` (Link `termin-detalji`, ~red 83-90)
- Verify: `tests/e2e/03-termini.spec.ts` (`termin-detalji`)

**Interfaces:**
- Consumes: `IKONA_INLINE_KLASA`, `Tooltip` iz Task 1.

- [ ] **Step 1: Provjeri da testovi ne ciljaju vidljivi tekst „Detalji"**

Run: `grep -rn "termin-detalji\|getByText(\"Detalji\")\|name: \"Detalji\"" tests`
Expected: samo `data-testid="termin-detalji"` reference (nema getByText/role name „Detalji"). `aria-label="Detalji"` čuva accessible name za svaki slučaj.

- [ ] **Step 2: Zamijeni tekst ikonom**

U `TerminiTable.tsx` dodaj import `import { Eye } from "lucide-react"` i `import { IKONA_INLINE_KLASA, Tooltip } from "@/components/ui/ikona-tooltip"`. Zamijeni Link:

```tsx
<Link
  href={detailHref(r.id, currentSearch)}
  onClick={(e) => e.stopPropagation()}
  className={IKONA_INLINE_KLASA}
  data-testid="termin-detalji"
  aria-label="Detalji"
>
  <Eye className="h-4 w-4" aria-hidden />
  <Tooltip>Detalji</Tooltip>
</Link>
```

- [ ] **Step 3: Typecheck + E2E + vizuelni**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/03-termini.spec.ts -g "Detalji|detalji|renderuje tabelu" --project=chromium`
Expected: PASS (Detalji link i dalje otvara sheet).

- [ ] **Step 4: Commit**

```bash
git add components/domain/TerminiTable.tsx
git commit -m "feat(ui): Detalji u tabeli termina -> Eye ikona + tooltip"
```

---

### Task 3: „Preuzmi" → Download ikona (ujednači svuda)

**Files:**
- Modify: `components/domain/ZapisniciTabela.tsx:69-70` (`pregled-download`)
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx:279-280` (`klijent-dokument-download`)
- Modify: `components/domain/DokumentiSekcija.tsx:124-126` (`dokument-download`) — svesti na istu icon-only formu radi konzistentnosti
- Verify: `tests/e2e` specovi koji koriste te testid-ove

**Interfaces:**
- Consumes: `IKONA_INLINE_KLASA`, `Tooltip`.

- [ ] **Step 1: Provjeri test reference**

Run: `grep -rn "pregled-download\|klijent-dokument-download\|dokument-download\|Preuzmi" tests`
Expected: reference po `data-testid` (ne po vidljivom tekstu „Preuzmi"). Ako neki cilja tekst „Preuzmi", zadrži `aria-label="Preuzmi"` (accessible name ostaje).

- [ ] **Step 2: ZapisniciTabela — icon link**

Dodaj `import { Download } from "lucide-react"` i tooltip import. Zamijeni:

```tsx
<a href={`/api/dokumenti/${d.id}`} className={IKONA_INLINE_KLASA} data-testid="pregled-download" aria-label="Preuzmi">
  <Download className="h-4 w-4" aria-hidden />
  <Tooltip>Preuzmi</Tooltip>
</a>
```

- [ ] **Step 3: klijenti/[id] — icon link**

Dodaj importe (Download, IKONA_INLINE_KLASA, Tooltip). Zamijeni download `<a>` (linija ~279):

```tsx
<a href={`/api/dokumenti/${d.id}`} className={IKONA_INLINE_KLASA} data-testid="klijent-dokument-download" aria-label="Preuzmi">
  <Download className="h-4 w-4" aria-hidden />
  <Tooltip>Preuzmi</Tooltip>
</a>
```

- [ ] **Step 4: DokumentiSekcija — icon-only (ukloni tekst „Preuzmi")**

Zamijeni `<Download …/> Preuzmi` u icon-only sa tooltipom (koristi `IKONA_INLINE_KLASA`, `aria-label="Preuzmi"`, `data-testid="dokument-download"`). Zadrži `href`.

- [ ] **Step 5: Typecheck + E2E**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e --project=chromium -g "dokument|zapisnik|Preuzmi|download"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/domain/ZapisniciTabela.tsx "app/(dashboard)/klijenti/[id]/page.tsx" components/domain/DokumentiSekcija.tsx
git commit -m "feat(ui): Preuzmi -> Download ikona (ujednaceno) + tooltip"
```

---

### Task 4: „Obriši" dokument → Trash2 ikona (crveno)

**Files:**
- Modify: `components/domain/ObrisiDokumentButton.tsx:20-25`
- Modify: `components/domain/DokumentiSekcija.tsx` (Obriši dokument dugme, ~135)
- Verify: `tests/e2e` (`pregled-delete`, `obrisi`/`dokument` delete flow)

**Interfaces:**
- Consumes: `Tooltip`.

- [ ] **Step 1: ObrisiDokumentButton — icon submit**

Dodaj `import { Trash2, Loader2 } from "lucide-react"`. Zamijeni `<Button>` sadržaj (zadrži `data-testid="pregled-delete"`, `aria-label="Obriši zapisnik"`, `variant="ghost"`, `type="submit"`; dodaj `group/tt relative` na Button className preko `className`):

```tsx
<Button type="submit" variant="ghost" size="icon" disabled={pending} data-testid="pregled-delete" aria-label="Obriši zapisnik" className="group/tt relative text-red-600 hover:bg-red-50 hover:text-red-700">
  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
  <Tooltip>Obriši zapisnik</Tooltip>
</Button>
```
(Provjeri da `Button` prima `size="icon"`; ako ne, koristi `className` sa `h-9 w-9 p-0`.)

- [ ] **Step 2: DokumentiSekcija delete — isti obrazac (Trash2, crveno, tooltip „Obriši dokument")**, zadrži postojeći `data-testid`/`aria-label`.

- [ ] **Step 3: Typecheck + E2E**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e --project=chromium -g "obris|delete|zapisnik|dokument"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/domain/ObrisiDokumentButton.tsx components/domain/DokumentiSekcija.tsx
git commit -m "feat(ui): Obrisi dokument -> Trash2 ikona + tooltip"
```

---

### Task 5: Paginacija „Prethodna/Sljedeća" → strelice

**Files:**
- Modify: `app/(dashboard)/plan-aktivnosti/_views/lista.tsx` (pagination blok)
- Modify: `app/(dashboard)/klijenti/page.tsx:72-89` (pagination blok)
- Verify: `tests/e2e/03-termini.spec.ts` (Sljedeća), `tests/e2e/04-klijenti.spec.ts` (Sljedeća)

**Interfaces:**
- Consumes: `Tooltip`.

- [ ] **Step 1: KRITIČNO — testovi ciljaju po imenu „Sljedeća"/„Prethodna"**

Run: `grep -rn "Sljedeća\|Prethodna" tests`
`03-termini` i `04-klijenti` koriste `getByRole("link", { name: "Sljedeća" })`. Zato icon-dugme MORA imati `aria-label="Sljedeća"` / `aria-label="Prethodna"` (role=link name ostaje isti) — inače testovi padaju.

- [ ] **Step 2: lista.tsx — zamijeni tekst strelicama (zadrži Link/span strukturu i disabled stanje)**

Dodaj `import { ChevronLeft, ChevronRight } from "lucide-react"` + `Tooltip`. Za svako od „Prethodna"/„Sljedeća": ikona umjesto teksta, `aria-label` sa istim tekstom, `<Tooltip>` sa tekstom. `Strana X / Y` ostaje tekst. Primjer (Sljedeća, aktivno stanje):

```tsx
<Link href={pageHref(pageNum + 1)} aria-label="Sljedeća" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "group/tt relative")}>
  <ChevronRight className="h-4 w-4" aria-hidden />
  <Tooltip>Sljedeća</Tooltip>
</Link>
```
Disabled varijanta ostaje `<span>` sa istim `aria-label` + ikona + `opacity-50 pointer-events-none`.

- [ ] **Step 3: klijenti/page.tsx — isti obrazac** (Prethodna/Sljedeća, `aria-label`, ChevronLeft/Right, `klijenti-page` span ostaje).

- [ ] **Step 4: Typecheck + E2E**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/03-termini.spec.ts tests/e2e/04-klijenti.spec.ts --project=chromium`
Expected: PASS (paginacija testovi klikću po `name: "Sljedeća"` = aria-label).

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/plan-aktivnosti/_views/lista.tsx" "app/(dashboard)/klijenti/page.tsx"
git commit -m "feat(ui): paginacija Prethodna/Sljedeca -> strelice + tooltip (aria-label ocuvan)"
```

---

### Task 6: TopBar „Odjava" → LogOut ikona

**Files:**
- Modify: `components/shell/TopBar.tsx:19-24`
- Verify: `tests/e2e/01-smoke.spec.ts` (banner)

**Interfaces:**
- Consumes: `Tooltip`.

- [ ] **Step 1: Provjeri test reference na „Odjava"**

Run: `grep -rn "Odjava" tests`
Expected: nema (ili po role name). Ako nema — slobodno; svejedno stavi `aria-label="Odjava"`.

- [ ] **Step 2: Zamijeni**

Dodaj `import { LogOut } from "lucide-react"` + `Tooltip`. Zamijeni submit dugme:

```tsx
<form action={odjaviSe}>
  <button type="submit" aria-label="Odjava" className="group/tt relative inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
    <LogOut className="h-[18px] w-[18px]" aria-hidden />
    <Tooltip>Odjava</Tooltip>
  </button>
</form>
```

- [ ] **Step 3: Typecheck + E2E**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/01-smoke.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/shell/TopBar.tsx
git commit -m "feat(ui): TopBar Odjava -> LogOut ikona + tooltip"
```

---

### Task 7: „X" za zatvaranje u sheet header-u

**Files:**
- Modify: `components/domain/TerminSheet.tsx` (DialogHeader, dodaj X gore-desno; donje „Zatvori" dugme OSTAJE)
- Verify: `tests/e2e/03-termini.spec.ts` (`sheet-close`, „Zatvori sheet vraća na listu")

**Interfaces:**
- Consumes: `Tooltip`.

- [ ] **Step 1: Dodaj X u header (NE diraj postojeći `sheet-close` dugme na dnu — test ga koristi)**

Dodaj `import { X } from "lucide-react"`. U `DialogHeader` dodaj apsolutno pozicioniran X gore-desno koji zove `close`:

```tsx
<button type="button" onClick={close} aria-label="Zatvori" data-testid="sheet-close-x" className="group/tt absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
  <X className="h-4 w-4" aria-hidden />
  <Tooltip>Zatvori</Tooltip>
</button>
```
(DialogContent mora biti `relative` — provjeri; ako nije, dodaj `relative` na njegov className.)

- [ ] **Step 2: Typecheck + E2E**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/03-termini.spec.ts -g "Zatvori|sheet" --project=chromium`
Expected: PASS (postojeći `sheet-close` netaknut; novi `sheet-close-x` dodatni).

- [ ] **Step 3: Commit**

```bash
git add components/domain/TerminSheet.tsx
git commit -m "feat(ui): X za zatvaranje u header-u TerminSheet-a"
```

---

### Task 8: „Novi*" akcije → Plus + tekst (ujednači, NE icon-only)

**Files:**
- Modify: `components/domain/NoviTerminButton.tsx`, `NoviKlijentButton.tsx`, `NoviKorisnikButton.tsx`, `NovaVrstaButton.tsx`
- Verify: `tests/e2e` (`novi-termin-btn` itd.)

**Interfaces:** nema novih.

- [ ] **Step 1: Provjeri koji već imaju „+"**

Run: `grep -rn "Plus\|+ Novi\|novi-.*-btn\|Novi termin\|Novi klijent\|Novi korisnik\|Nova vrsta" components`
Utvrdi koji imaju ikonu; cilj: svi imaju `<Plus className="h-4 w-4" />` + tekst (icon+text, tekst OSTAJE).

- [ ] **Step 2: Dodaj `Plus` ikonu gdje fali** (import `{ Plus } from "lucide-react"`, ubaci prije teksta u dugme, `gap-2`). Zadrži sve `data-testid`.

- [ ] **Step 3: Typecheck + E2E**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/03-termini.spec.ts tests/e2e/04-klijenti.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/domain/NoviTerminButton.tsx components/domain/NoviKlijentButton.tsx components/domain/NoviKorisnikButton.tsx components/domain/NovaVrstaButton.tsx
git commit -m "feat(ui): Novi* akcije ujednacene sa Plus ikonom (icon+tekst)"
```

---

## Self-Review

- **Coverage:** Svih 5 prihvaćenih grupa pokriveno: Detalji (T2), Preuzmi ujednačeno (T3), Obriši (T4), paginacija (T5), Odjava (T6), + X u sheet-u (T7), + Novi* ujednačeno (T8), sve na dijeljenoj tooltip komponenti (T1).
- **Rizik/testovi:** Jedini test-osjetljivi slučaj je paginacija (T5) — testovi klikću po `name: "Sljedeća"/"Prethodna"`, zato je `aria-label` obavezan (naglašeno). Ostali ciljaju po `data-testid` (očuvani).
- **Pristupačnost:** svaka icon-only akcija = `aria-label` + `<Tooltip>` (isti tekst); `<svg>` `aria-hidden`.
- **NE mijenjati:** „Otkaži/Sačuvaj/Pošalji/dialog Zatvori" ostaju tekst; „Novi*" ostaje icon+tekst; donji `sheet-close` u TerminSheet ostaje (samo se DODAJE X u header).
