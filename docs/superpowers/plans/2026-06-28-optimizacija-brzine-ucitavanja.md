# Optimizacija brzine učitavanja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Učiniti da se aplikacija učitava i navigira osjetno brže — region uz bazu, instant skeleton shell, paralelni upiti, klijentski keš za prikaze, i selektivni server-keš referentnih podataka.

**Architecture:** Pristup C (Hibrid). Faza 1 = infrastruktura + rendering (region `dub1`, `loading.tsx` streaming, `Promise.all`, `cache()` dedup). Faza 2 = TanStack Query klijentski keš za `plan-aktivnosti` prikaze + prefetch. Faza 3 = `unstable_cache` + `revalidateTag` SAMO za org-wide referentne podatke (`vrste_provjera`) preko admin (service-role) klijenta. Bez `cacheComponents`/PPR.

**Tech Stack:** Next.js 16.2.9 (App Router, modifikovan), React 19.2.4, @supabase/ssr, TanStack Query v5, TypeScript, pnpm, Playwright.

## Global Constraints

- **Putanja sadrži razmak** (`Ai Forward`) → Turbopack puca; `--webpack` je OBAVEZAN za lokalni `dev`/`build` (`pnpm dev` već ima `--webpack`; za lokalni build koristi `pnpm exec next build --webpack`). Vercel build je čista putanja — bez izmjena.
- **Region:** cilj `dub1` (Dublin = Supabase `eu-west-1`/Irska); fallback `fra1` (Frankfurt). Verifikacija: `x-vercel-id` NE smije sadržati `iad1`.
- **Bez `cacheComponents`/PPR** (van obima, spec §3).
- **Faza 3 `unstable_cache` SAMO za org-wide referentne podatke** (`vrste_provjera`). `unstable_cache` NE smije zvati `cookies()` → mora koristiti `createAdminSupabaseClient()` (service-role, zaobilazi RLS). **Lista `klijenti` je RLS-skopirana → NE keširati globalno** (curilo bi između uloga).
- **TanStack Query je klijentski (browser) keš** — server rute ostaju dinamične (`cookies()` u `proxy.ts`/`server.ts`).
- **Grana:** sav rad na `perf/optimizacija-brzine-ucitavanja`.
- **Kapije kvaliteta po tasku:** `pnpm typecheck` + `pnpm lint` + `pnpm test:e2e` moraju biti zeleni prije commita. E2E auth ide preko `tests/e2e/auth.setup.ts` (REST login + cookie injection); `E2E_ADMIN_EMAIL`/`E2E_ADMIN_LOZINKA` u `.env.local`.
- **Prije Faze 2/3 pročitaj** (AGENTS.md zahtjev): `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`, `06-fetching-data.md`, `09-revalidating.md`, `02-guides/prefetching.md`.

---

## Faza 0 — Baseline mjerenje

### Task 0: Skripta za mjerenje TTFB + baseline

**Files:**
- Create: `scripts/measure-ttfb.sh`
- Depends: `tests/e2e/.auth/admin.json` (nastaje od `pnpm test:e2e`)

**Interfaces:**
- Produces: `scripts/measure-ttfb.sh` — mjeri TTFB autentifikovanih ruta lokalno; koristi se za prije/poslije poređenje u svim fazama.

- [ ] **Step 1: Kreiraj skriptu**

```bash
#!/usr/bin/env bash
# Mjeri TTFB ključnih ruta. Auth preko Supabase REST logina (bez Playwrighta).
# Upotreba: bash scripts/measure-ttfb.sh [BASE_URL]   (default http://localhost:3000)
set -euo pipefail
BASE_URL="${1:-http://localhost:3000}"
set -a; [ -f .env.local ] && . ./.env.local; set +a
: "${NEXT_PUBLIC_SUPABASE_URL:?}"; : "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?}"; : "${E2E_ADMIN_EMAIL:?}"; : "${E2E_ADMIN_LOZINKA:?}"

AUTH=$(curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "Content-Type: application/json" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -d "{\"email\":\"$E2E_ADMIN_EMAIL\",\"password\":\"$E2E_ADMIN_LOZINKA\"}")
REF=$(printf '%s' "$NEXT_PUBLIC_SUPABASE_URL" | sed -E 's#https?://([^.]+)\..*#\1#')
COOKIE="sb-${REF}-auth-token=base64-$(printf '%s' "$AUTH" | jq -c '.' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')"

measure() { printf '%-46s ' "$2"; curl -s -o /dev/null -H "Cookie: $COOKIE" \
  -w 'TTFB %{time_starttransfer}s | total %{time_total}s\n' "$BASE_URL$1"; }

echo "== Region header =="; curl -s -o /dev/null -D - "$BASE_URL/prijava" | grep -i x-vercel-id || echo "(lokalno — nema x-vercel-id)"
echo "== TTFB =="
measure "/pregled" "Pregled (4 upita)"
measure "/plan-aktivnosti" "Plan aktivnosti (lista, 5 upita)"
measure "/plan-aktivnosti?view=matrica" "Plan aktivnosti (matrica)"
measure "/plan-aktivnosti?view=kalendar" "Plan aktivnosti (kalendar)"
measure "/klijenti" "Klijenti"
measure "/obilasci" "Obilasci"
```

- [ ] **Step 2: Pripremi auth i pokreni baseline**

Run: `pnpm test:e2e --grep @smoke || pnpm test:e2e` (da nastane `tests/e2e/.auth/admin.json`), zatim u drugom terminalu `pnpm dev`, pa `bash scripts/measure-ttfb.sh`
Expected: ispis TTFB po ruti. **Zapiši brojeve** u commit poruku kao baseline.

- [ ] **Step 3: Commit**

```bash
git add scripts/measure-ttfb.sh
git commit -m "perf(measure): skripta za TTFB mjerenje + baseline brojevi"
```

---

## Faza 1 — Infrastruktura i rendering

### Task 1: Region `dub1` (vercel.json)

**Files:**
- Create: `vercel.json`

**Interfaces:**
- Produces: Vercel deploy izvršava funkcije u EU regionu uz Supabase.

- [ ] **Step 1: Kreiraj `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["dub1"]
}
```

- [ ] **Step 2: Deploy**

Run: `vercel --prod --yes`
Expected: `READY`.

- [ ] **Step 3: Verifikuj region**

Run: `curl -s -o /dev/null -D - https://demo.nextpixel.dev/prijava | grep -i x-vercel-id`
Expected: drugi segment NIJE `iad1` (npr. `dub1`/`fra1`). Ako Vercel odbije `dub1` (plan), promijeni na `["fra1"]` i ponovi.

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "perf(infra): Vercel region dub1 uz Supabase eu-west-1"
```

### Task 2: Skeleton komponenta + `loading.tsx` po rutama (instant shell)

**Files:**
- Create: `components/ui/skeleton.tsx`
- Create: `app/(dashboard)/pregled/loading.tsx`
- Create: `app/(dashboard)/plan-aktivnosti/loading.tsx`
- Create: `app/(dashboard)/klijenti/loading.tsx`
- Create: `app/(dashboard)/obilasci/loading.tsx`

**Interfaces:**
- Produces: `<Skeleton className="…" />` reusable; `loading.tsx` po ruti → Next automatski streamuje shell dok se `page.tsx` async resolvuje (ne treba ručni `<Suspense>`).

- [ ] **Step 1: Skeleton komponenta**

```tsx
import { cn } from "@/lib/utils"

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200", className)} {...props} />
}
```

- [ ] **Step 2: `pregled/loading.tsx`**

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function PregledLoading() {
  return (
    <div className="space-y-6">
      <div><Skeleton className="h-8 w-32 mb-2" /><Skeleton className="h-4 w-48" /></div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {[0,1,2,3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="lg:col-span-2 h-80 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `plan-aktivnosti/loading.tsx`**

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function PlanAktivnostiLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-48" /><Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {[0,1,2,3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
      <div className="space-y-2">
        {[0,1,2,3,4,5,6,7,8,9].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `klijenti/loading.tsx`**

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function KlijentiLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-10 w-32" /></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[0,1,2,3,4,5,6,7,8].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: `obilasci/loading.tsx`**

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function ObilasciLoading() {
  return (
    <div className="space-y-6">
      <div><Skeleton className="h-8 w-40 mb-2" /><Skeleton className="h-4 w-72" /></div>
      <div className="flex items-center gap-4 flex-wrap">
        {[0,1,2].map((i) => <Skeleton key={i} className="h-10 w-36" />)}
      </div>
      {[0,1,2].map((g) => (
        <div key={g} className="rounded-xl border border-slate-200 p-4 space-y-3">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {[0,1,2,3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Verifikuj**

Run: `pnpm typecheck && pnpm lint`
Expected: bez grešaka.
Run: `pnpm dev`, otvori `/pregled`, `/plan-aktivnosti`, `/klijenti`, `/obilasci`
Expected: skeleton se vidi instant, pa sadržaj.

- [ ] **Step 7: Commit**

```bash
git add components/ui/skeleton.tsx "app/(dashboard)"/*/loading.tsx
git commit -m "perf(ui): Skeleton + loading.tsx instant shell po dashboard rutama"
```

### Task 3: Ukloni waterfall u `obilasci`

**Files:**
- Modify: `app/(dashboard)/obilasci/page.tsx`

**Interfaces:**
- Consumes: `createServerSupabaseClient`, `groupByGrad`, filteri iz `searchParams` (postojeći).
- Produces: isti rezultat, ali `lokGrad` i `termini_view` upiti idu paralelno.

- [ ] **Step 1: Zamijeni uzastopne await-ove paralelnim**

Trenutno (waterfall): `await from("lokacije")` pa kasnije `await q`. Zamijeni blok tako da se oba izvrše u `Promise.all`:

```tsx
const supabase = await createServerSupabaseClient()

const lokGradPromise = supabase.from("lokacije").select("grad")

let q = supabase
  .from("termini_view")
  .select("id, klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, lokacija_grad, rok_dospijeca, status_izvedeni")
  .gte("rok_dospijeca", od)
  .lte("rok_dospijeca", doIso)
if (status === "aktivni") q = q.not("status_izvedeni", "in", "(izvrseno,otkazano)")
else if (status !== "svi") q = q.eq("status_izvedeni", status)
if (grad === "__bez__") q = q.is("lokacija_grad", null)
else if (grad && grad !== "svi") q = q.eq("lokacija_grad", grad)

const [lokGradRes, terminiRes] = await Promise.all([
  lokGradPromise,
  q.order("lokacija_grad", { ascending: true }).order("rok_dospijeca", { ascending: true }),
])

const gradovi = Array.from(
  new Set((lokGradRes.data ?? []).map((l) => l.grad).filter((g): g is string => !!g && g.trim() !== "")),
).sort((a, b) => a.localeCompare(b))
const grupe = groupByGrad((terminiRes.data ?? []) as ObilazakItem[])
```

(Zadrži postojeća imena varijabli `od`, `doIso`, `status`, `grad`, `ObilazakItem`, `groupByGrad` iz datoteke; mijenja se samo redoslijed/izvršavanje upita.)

- [ ] **Step 2: Verifikuj**

Run: `pnpm typecheck && pnpm test:e2e`
Expected: zeleno; `obilasci` prikaz isti (gradovi u dropdownu + grupe po gradu).

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/obilasci/page.tsx"
git commit -m "perf(obilasci): paralelizuj lokacije+termini (ukloni waterfall)"
```

### Task 4: Ukloni waterfall u `plan-aktivnosti` lista (rep upita)

**Files:**
- Modify: `app/(dashboard)/plan-aktivnosti/_views/lista.tsx`

**Interfaces:**
- Consumes: postojeći `selectedTermin`, `TerminRow`, `supabase`.
- Produces: isti `selectedTermin` + `istorija` + `dokumenti`, dohvaćeni paralelno.

- [ ] **Step 1: Spoji uslovne dohvate u `Promise.all`**

Glavni `Promise.all` (stats+lista+dropdowns) ostaje. Rep (povijest izvršenih + dokumenti za selektovani termin) trenutno je uzastopan — zamijeni ga jednim paralelnim blokom:

```tsx
const [istorija, dokumenti] = selectedTermin
  ? await Promise.all([
      supabase
        .from("termini_view").select("*")
        .eq("klijent_id", selectedTermin.klijent_id)
        .eq("vrsta_provjere_id", selectedTermin.vrsta_provjere_id)
        .eq("status", "izvrseno")
        .neq("id", selectedTermin.id ?? "")
        .order("datum_izvrsenja", { ascending: false })
        .limit(5)
        .then((r) => (r.data ?? []) as TerminRow[]),
      selectedTermin.id
        ? supabase.from("dokumenti").select("*").eq("termin_id", selectedTermin.id)
            .order("uploaded_at", { ascending: false }).then((r) => r.data ?? [])
        : Promise.resolve([]),
    ])
  : [[], []]
```

(Prilagodi tačna imena polja/varijabli postojećem kodu `lista.tsx`; suština: ono što je bilo dva uzastopna `await` postaje jedan `Promise.all`.)

- [ ] **Step 2: Verifikuj**

Run: `pnpm typecheck && pnpm test:e2e`
Expected: zeleno; otvaranje detalja termina pokazuje istoriju + dokumente.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/plan-aktivnosti/_views/lista.tsx"
git commit -m "perf(plan-aktivnosti): paralelizuj istoriju+dokumente za selektovani termin"
```

### Task 5: `cache()` dedup za `getTrenutniKorisnik`

**Files:**
- Modify: `lib/auth/current-user.ts`

**Interfaces:**
- Produces: `getTrenutniKorisnik()` se u jednom renderu izvršava jednom čak i ako ga zovu i layout i stranica.

- [ ] **Step 1: Umotaj u React `cache`**

Na vrh datoteke dodaj `import { cache } from "react"`, i izvuci postojeće tijelo u internu funkciju umotanu u `cache`:

```tsx
import { cache } from "react"
// ... postojeći importi ...

export const getTrenutniKorisnik = cache(
  async function getTrenutniKorisnikImpl(): Promise<TrenutniKorisnik | null> {
    // ... POSTOJEĆE tijelo funkcije bez izmjena ...
  },
)
```

- [ ] **Step 2: Verifikuj**

Run: `pnpm typecheck && pnpm lint && pnpm test:e2e`
Expected: zeleno; ponašanje identično.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/current-user.ts
git commit -m "perf(auth): React cache() dedup za getTrenutniKorisnik po renderu"
```

### Faza 1 — verifikacija i mjerenje

- [ ] **Step 1:** `pnpm test:e2e` zelen.
- [ ] **Step 2:** `vercel --prod --yes`, pa `bash scripts/measure-ttfb.sh https://demo.nextpixel.dev` — uporedi s baselineom; potvrdi `x-vercel-id` EU region.
- [ ] **Step 3:** Zabilježi prije/poslije u commit poruci (`perf(faza-1): mjerenja`).

---

## Faza 2 — Klijentski keš (TanStack Query) za prikaze

### Task 6: Instaliraj TanStack Query + provider

**Files:**
- Modify: `package.json` (dependency)
- Create: `providers/dashboard-query-provider.tsx`
- Modify: `app/(dashboard)/layout.tsx`

**Interfaces:**
- Produces: `<DashboardQueryProvider>` koji daje `QueryClient` svim klijentskim komponentama dashboarda.

- [ ] **Step 1: Instaliraj**

Run: `pnpm add @tanstack/react-query`
Expected: dodato u `package.json` dependencies.

- [ ] **Step 2: Provider (client)**

```tsx
"use client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"

export function DashboardQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, gcTime: 300_000, retry: 1, refetchOnWindowFocus: false } },
    }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
```

(`useState` inicijalizator → jedan `QueryClient` po korisniku/tabu, bez dijeljenja između zahtjeva.)

- [ ] **Step 3: Umotaj dashboard layout**

U `app/(dashboard)/layout.tsx` importuj provider i umotaj postojeće `return` stablo:

```tsx
import { DashboardQueryProvider } from "@/providers/dashboard-query-provider"
// ...
return (
  <DashboardQueryProvider>
    {/* POSTOJEĆE stablo (DesktopOnlyGate, TopBar, Sidebar, main, Toaster) bez izmjena */}
  </DashboardQueryProvider>
)
```

- [ ] **Step 4: Verifikuj**

Run: `pnpm typecheck && pnpm lint && pnpm test:e2e`
Expected: zeleno; nema hydration grešaka u konzoli.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml providers/dashboard-query-provider.tsx "app/(dashboard)/layout.tsx"
git commit -m "feat(perf): TanStack Query provider u dashboard layoutu"
```

### Task 7: Route handleri za podatke prikaza

**Files:**
- Create: `app/api/plan-aktivnosti/lista/route.ts`
- Create: `app/api/plan-aktivnosti/matrica/route.ts`
- Create: `app/api/plan-aktivnosti/kalendar/route.ts`

**Interfaces:**
- Produces: GET rute koje vraćaju JSON istih oblika kao trenutni `_views` (server-side, `cookies()` auth/RLS očuvan).

> Prije pisanja: pročitaj `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. Svaka ruta koristi `createServerSupabaseClient()` (cookies → dinamično, RLS poštovan).

- [ ] **Step 1: `lista/route.ts`** — preslikaj `Promise.all` iz `_views/lista.tsx` (stats + paginirana lista + dropdownovi). Čita filtere iz `req.nextUrl.searchParams`, vraća `{ rows, total, stats, klijenti, vrste, lokacije }`.

```ts
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1)
  const from = (page - 1) * 50, to = from + 49
  // izgradi listQuery iz filtera identično postojećem _views/lista.tsx
  let listQuery = supabase.from("termini_view").select("*", { count: "exact" })
  const status = sp.get("status")
  if (status && status !== "svi") listQuery = listQuery.eq("status_izvedeni", status)
  // ... ostali filteri (q, klijent, vrsta, lokacija, mjesec, godina) kao u postojećem view-u ...
  const [statsRes, listRes, klijentiRes, vrsteRes, lokacijeRes] = await Promise.all([
    supabase.rpc("get_termini_stats"),
    listQuery.range(from, to),
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("vrste_provjera").select("id, naziv").eq("aktivna", true).order("naziv"),
    supabase.from("lokacije").select("id, naziv, klijent_id").order("naziv"),
  ])
  return NextResponse.json({
    rows: listRes.data ?? [], total: listRes.count ?? 0,
    stats: statsRes.data?.[0] ?? null,
    klijenti: klijentiRes.data ?? [], vrste: vrsteRes.data ?? [], lokacije: lokacijeRes.data ?? [],
  })
}
```

- [ ] **Step 2: `matrica/route.ts`** i **`kalendar/route.ts`** — preslikaj upite iz `_views/matrica.tsx` i `_views/kalendar.tsx`, vrati `{ matrixRows, kolone, klijenti }` odn. `{ termini }`. (Isti `select`/filteri kao u trenutnim view-ovima.)

- [ ] **Step 3: Verifikuj rute**

Run: `pnpm dev`, pa s auth cookie-jem (iz `scripts/measure-ttfb.sh` pristup) `curl` na `/api/plan-aktivnosti/lista?page=1`
Expected: JSON `{ rows, total, stats, klijenti, vrste, lokacije }`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/plan-aktivnosti"
git commit -m "feat(perf): route handleri za plan-aktivnosti podatke (lista/matrica/kalendar)"
```

### Task 8: Query funkcije + konverzija prikaza u klijentske `useQuery`

**Files:**
- Create: `lib/queries/plan-aktivnosti.ts`
- Modify: `app/(dashboard)/plan-aktivnosti/_views/lista.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/_views/matrica.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx`

**Interfaces:**
- Consumes: route handleri iz Task 7; `DashboardQueryProvider` iz Task 6.
- Produces: `getTerminiLista(filters)`, `getTerminiMatrica(params)`, `getTerminiKalendar(godina, mjesec)`; prikazi su `"use client"` i čitaju iz keša (prebacivanje view-a = bez novog mrežnog upita ako je keš svjež).

- [ ] **Step 1: Query funkcije**

```ts
function qs(o: Record<string, unknown>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v != null && v !== "") p.set(k, String(v))
  return p.toString()
}
export async function getTerminiLista(f: Record<string, unknown>) {
  const r = await fetch(`/api/plan-aktivnosti/lista?${qs(f)}`); if (!r.ok) throw new Error("lista"); return r.json()
}
export async function getTerminiMatrica(f: Record<string, unknown>) {
  const r = await fetch(`/api/plan-aktivnosti/matrica?${qs(f)}`); if (!r.ok) throw new Error("matrica"); return r.json()
}
export async function getTerminiKalendar(godina: number, mjesec: number) {
  const r = await fetch(`/api/plan-aktivnosti/kalendar?${qs({ godina, mjesec })}`); if (!r.ok) throw new Error("kalendar"); return r.json()
}
```

- [ ] **Step 2: `lista.tsx` → `"use client"` + `useQuery`** (čita `searchParams` preko `useSearchParams`, renderuje skeleton iz Task 2 dok `isPending`). Referentni dropdownovi: `useQuery(['plan-referentni'], …, { staleTime: 3_600_000 })`.

```tsx
"use client"
import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { getTerminiLista } from "@/lib/queries/plan-aktivnosti"
// ... renderovanje preostaje isto, podaci dolaze iz data ...
```

- [ ] **Step 3:** Isto za `matrica.tsx` (`getTerminiMatrica`) i `kalendar.tsx` (`getTerminiKalendar`) — `queryKey` uključuje sve relevantne filtere; `staleTime: 60_000`.

- [ ] **Step 4: Verifikuj instant prebacivanje**

Run: `pnpm test:e2e`
Expected: zeleno. Ručno: `pnpm dev`, DevTools Network → prebaci lista↔matrica↔kalendar drugi put → NEMA novih `/api/plan-aktivnosti/*` poziva dok je keš svjež.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/plan-aktivnosti.ts "app/(dashboard)/plan-aktivnosti/_views"
git commit -m "feat(perf): plan-aktivnosti prikazi preko TanStack Query (instant view-switch)"
```

### Task 9: Prefetch navigacije + invalidacija na mutacije

**Files:**
- Modify: `components/shell/Sidebar.tsx`
- Modify: `app/(dashboard)/termini/actions.ts` (+ mjesta koja zovu termini mutacije iz klijenta)

**Interfaces:**
- Produces: sidebar linkovi prefetchuju rute; izmjene termina invalidiraju TanStack ključeve da lista/matrica/kalendar pokažu svjež podatak.

- [ ] **Step 1: Sidebar `prefetch`**

U `Sidebar.tsx` dodaj `prefetch` na `<Link>`:

```tsx
<Link key={href} href={href} prefetch className={...} aria-current={...}>
```

- [ ] **Step 2: Invalidacija keša nakon mutacije termina**

Komponenta koja poziva server akcije termina (forma/sheet) treba nakon uspjeha pozvati `queryClient.invalidateQueries({ queryKey: ["termini-lista"] })` (+ `"termini-matrica"`, `"termini-kalendar"`). Dodaj `useQueryClient()` i invalidaciju u `onSuccess` handler te komponente.

- [ ] **Step 3: Verifikuj svježinu**

Run: `pnpm test:e2e`
Expected: zeleno; nakon `markIzvrseno`/`updateTermin` lista pokazuje novi status bez ručnog refresha.

- [ ] **Step 4: Commit**

```bash
git add components/shell/Sidebar.tsx "app/(dashboard)/termini/actions.ts"
git commit -m "feat(perf): Link prefetch + invalidacija TanStack keša na izmjenu termina"
```

### Faza 2 — verifikacija i mjerenje

- [ ] `pnpm test:e2e` zelen; `bash scripts/measure-ttfb.sh` + ručno: drugi put otvaranje prikaza je instant. Commit `perf(faza-2): mjerenja`.

---

## Faza 3 — Selektivni server-keš (vođen mjerenjem)

> Radi se SAMO ako mjerenja poslije Faze 1+2 pokažu da prvi-load referentnih dropdownova i dalje značajno košta. Inače preskočiti (YAGNI).

### Task 10: `unstable_cache` za `vrste_provjera` (org-wide) + invalidacija

**Files:**
- Create: `lib/cache.ts`
- Modify: `app/(dashboard)/postavke/actions.ts`
- Modify: čitaoci `vrste_provjera` koji NE trebaju RLS-skopiranje: `app/(dashboard)/postavke/page.tsx`, `app/(dashboard)/klijenti/[id]/page.tsx`, `app/api/plan-aktivnosti/lista/route.ts` (dropdown vrste)

**Interfaces:**
- Produces: `getCachedVrste()` (keš s tagom `vrste`), `revalidateVrste()`.
- **Constraint:** `unstable_cache` NE smije zvati `cookies()` → koristi `createAdminSupabaseClient()` (service-role). `vrste_provjera` je org-wide referentno (svi vide iste vrste), pa je RLS-bypass ovdje bezbjedan. **NE raditi isto za `klijenti`/`termini`** (RLS-skopirano / dinamično).

- [ ] **Step 1: `lib/cache.ts`**

```ts
import { unstable_cache, revalidateTag } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

// Org-wide referentno: vrste provjera (svi korisnici vide iste). Service-role jer unstable_cache ne smije čitati cookies.
export const getCachedVrste = unstable_cache(
  async () => {
    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from("vrste_provjera")
      .select("id, naziv, podrazumevani_interval_mjeseci, zakonski_osnov, aktivna, vodi_dokumentaciju")
      .order("aktivna", { ascending: false })
      .order("naziv")
    return data ?? []
  },
  ["vrste-provjera"],
  { tags: ["vrste"], revalidate: 3600 },
)

export function revalidateVrste() {
  revalidateTag("vrste")
}
```

- [ ] **Step 2: Invalidacija u `postavke/actions.ts`**

U akcijama koje mijenjaju vrste (`updateIntervali`, `createVrsta`, `updateVrsta`, `postaviVrstaAktivna`) dodaj `import { revalidateVrste } from "@/lib/cache"` i pozovi `revalidateVrste()` uz postojeći `revalidatePath("/postavke")`.

- [ ] **Step 3: Zamijeni čitanja vrste cached getterom** tamo gdje se traži puna/aktivna lista vrsta za prikaz (ne mijenjati upite vezane za konkretnog klijenta/RLS). Npr. u `postavke/page.tsx` zamijeni `supabase.from("vrste_provjera")...` sa `await getCachedVrste()`.

- [ ] **Step 4: Verifikuj keš + svježinu**

Run: `pnpm typecheck && pnpm test:e2e`
Expected: zeleno. Ručno: izmijeni interval vrste u `/postavke` → lista vrsta odmah pokazuje novu vrijednost (tag invalidiran). Drugi load `/postavke` ne radi novi `vrste_provjera` upit (keš).

- [ ] **Step 5: Commit**

```bash
git add lib/cache.ts "app/(dashboard)/postavke/actions.ts" "app/(dashboard)/postavke/page.tsx"
git commit -m "perf(faza-3): unstable_cache za vrste_provjera (admin client) + revalidateTag"
```

### Faza 3 — verifikacija

- [ ] `pnpm test:e2e` zelen; mjerenje potvrđuje niži TTFB na rutama koje koriste vrste; svježina nakon izmjene vrste OK. Commit `perf(faza-3): mjerenja`.

---

## Završna verifikacija (cijeli plan)

- [ ] `pnpm typecheck && pnpm lint && pnpm test:e2e` — sve zeleno.
- [ ] `vercel --prod --yes`; `x-vercel-id` = EU region; `bash scripts/measure-ttfb.sh https://demo.nextpixel.dev` — TTFB osjetno niži vs Faza 0 baseline.
- [ ] Demo login (`demo@nextpixel.dev`) → navigacija i prebacivanje prikaza djeluju instant; podaci svježi nakon upisa.
- [ ] `superpowers:requesting-code-review` prije merge u `main`.

## Self-review (popunjeno)

- **Pokrivenost spec-a:** §5 Faza 1 → Tasks 1–5; Faza 2 → Tasks 6–9; Faza 3 → Task 10. §8 mjerenje → Task 0 + faza-verifikacije. §6 sigurnost → Global Constraints + Task 10 (admin client, samo vrste). §7 greške/čekanje → Task 2 (loading.tsx). ✅
- **Placeholderi:** nema TBD/TODO; svaki korak ima konkretan kod/komandu. Mjesta označena „prilagodi postojećem kodu" odnose se na preslikavanje POSTOJEĆIH upita (njihov tačan oblik je u izvornim fajlovima i u workflow nalazima), ne na nedostajuću logiku.
- **Tip-konzistentnost:** `getTerminiLista/Matrica/Kalendar` (Task 8) zovu rute iz Task 7; `getCachedVrste/revalidateVrste` (Task 10) konzistentni; `DashboardQueryProvider` (Task 6) koristi se u Task 8/9. ✅
