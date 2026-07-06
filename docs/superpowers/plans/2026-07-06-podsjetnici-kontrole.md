# Kontrole email podsjetnika — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin u Postavkama dobija prekidač za automatsko dnevno slanje podsjetnika i dugme „Pokreni sada" koje odmah okine slanje i prikaže rezultat.

**Architecture:** Flag `podsjetnici_aktivni` u tabeli `postavke` (per-instanca); cron ruta gate-uje SAMO GET (Vercel cron putanju), POST ostaje pun za ručno/test. UI u postojećoj sekciji podsjetnika; „Pokreni sada" server action zove sopstvenu cron rutu POST-om sa Bearer `CRON_SECRET` (admin klijent ostaje samo u cron ruti). Spec: `docs/superpowers/specs/2026-07-06-podsjetnici-kontrole-design.md`.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres migracije), next-intl, vitest, Playwright.

## Global Constraints

- Grana `feat/podsjetnici-kontrole`. Runner **pnpm**. Poslije svakog taska: `pnpm typecheck && pnpm test:unit` PASS.
- Default flaga je **`true`** (automatika već živa — default false bi je tiho ugasio).
- Gating VAŽI SAMO ZA GET; POST (ručno/test/e2e) NIKAD ne gleda flag.
- Čitanje flaga tolerantno: nedostaje red/kolona → tretiraj kao `true`.
- i18n: novi ključevi u `postavke` namespace u SVA TRI kataloga u istom commitu (paritet test); sr stil kao okolni tekstovi; Pattern C u actions (`postavke.actions` translator već postoji u fajlu).
- `db/types.ts` se NE piše ručno — regeneriše se sa `pnpm db:types` (lokalni stack mora biti pokrenut: `supabase start` + `pnpm db:reset`).
- Admin-only zaštita akcija po postojećem obrascu u `app/(dashboard)/postavke/actions.ts` (pogledaj kako postojeće akcije provjeravaju ulogu i uradi ISTO).
- Nikad admin/service-role Supabase klijent u app/ request putu — „Pokreni sada" ide fetch-om na cron rutu.

---

### Task 1: Migracija + gating u cron ruti

**Files:**
- Create: `supabase/migrations/20260706120000_postavke_podsjetnici_aktivni.sql`
- Create: `lib/reminders/gating.ts`
- Test: `lib/reminders/gating.test.ts`
- Modify: `app/api/cron/reminders/route.ts`
- Regen: `db/types.ts` (preko `pnpm db:types`)

**Interfaces:**
- Produces: `podsjetniciAktivni(row: { podsjetnici_aktivni: boolean } | null | undefined): boolean` iz `lib/reminders/gating.ts`; kolona `postavke.podsjetnici_aktivni: boolean` u tipovima; GET cron odgovor pri isključenom flagu: `{ ok: true, skipped: "podsjetnici_iskljuceni" }`.

- [ ] **Step 1: Migracija**

`supabase/migrations/20260706120000_postavke_podsjetnici_aktivni.sql`:

```sql
-- Prekidač automatskog dnevnog slanja podsjetnika (per-instanca; default uključeno
-- jer je Vercel cron već aktivan — isključivanje je svjesna radnja admina u Postavkama).
alter table postavke add column podsjetnici_aktivni boolean not null default true;
```

- [ ] **Step 2: Primijeni lokalno + regeneriši tipove**

Run: `supabase start` (ako ne radi već) `&& pnpm db:reset && pnpm db:types`
Expected: reset prolazi; `git diff db/types.ts` pokazuje `podsjetnici_aktivni: boolean` u postavke Row/Insert/Update.

- [ ] **Step 3: Failing test za gating**

`lib/reminders/gating.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { podsjetniciAktivni } from "./gating"

describe("podsjetniciAktivni", () => {
  it("true kad je flag true", () => {
    expect(podsjetniciAktivni({ podsjetnici_aktivni: true })).toBe(true)
  })
  it("false kad je flag false", () => {
    expect(podsjetniciAktivni({ podsjetnici_aktivni: false })).toBe(false)
  })
  it("default true kad reda nema (tolerantno na fazu prije migracije)", () => {
    expect(podsjetniciAktivni(null)).toBe(true)
    expect(podsjetniciAktivni(undefined)).toBe(true)
  })
})
```

Run: `pnpm vitest run lib/reminders/gating.test.ts` → FAIL (modul ne postoji).

- [ ] **Step 4: Implementacija**

`lib/reminders/gating.ts`:

```ts
// Da li je automatsko (cron) slanje podsjetnika uključeno za ovu instancu.
// Nedostajući red/kolona = uključeno: sigurnosna tolerancija za trenutak
// između deploy-a koda i primjene migracije (spec §Ponašanje).
export function podsjetniciAktivni(
  row: { podsjetnici_aktivni: boolean } | null | undefined,
): boolean {
  return row?.podsjetnici_aktivni ?? true
}
```

Run: `pnpm vitest run lib/reminders/gating.test.ts` → PASS (3/3).

- [ ] **Step 5: Gating u ruti (SAMO GET)**

U `app/api/cron/reminders/route.ts`, u `handle(req)` poslije auth provjere a prije `runReminders` (dodati import `podsjetniciAktivni` iz `@/lib/reminders/gating`; `createAdminSupabaseClient` se tada kreira prije grane):

```ts
  const supabase = createAdminSupabaseClient()

  // Prekidač važi SAMO za automatski (Vercel cron) GET; POST (ručno/test) uvijek radi.
  if (req.method === "GET") {
    const { data: post } = await supabase
      .from("postavke")
      .select("podsjetnici_aktivni")
      .eq("id", 1)
      .maybeSingle()
    if (!podsjetniciAktivni(post)) {
      return NextResponse.json({ ok: true, skipped: "podsjetnici_iskljuceni" })
    }
  }
```

(postojeći try/catch oko `runReminders` ostaje; `const supabase = ...` se ne duplira.)

- [ ] **Step 6: Puna verifikacija + commit**

Run: `pnpm typecheck && pnpm test:unit` → PASS (svi postojeći + 3 nova).
```bash
git add supabase/migrations/20260706120000_postavke_podsjetnici_aktivni.sql lib/reminders/gating.ts lib/reminders/gating.test.ts app/api/cron/reminders/route.ts db/types.ts
git commit -m "feat(podsjetnici): flag podsjetnici_aktivni + gating GET cron putanje"
```

---

### Task 2: Server akcije — toggle i „Pokreni sada"

**Files:**
- Modify: `app/(dashboard)/postavke/actions.ts`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json` (ključevi `postavke.actions.*` — vidi Step 2)

**Interfaces:**
- Consumes: kolona `postavke.podsjetnici_aktivni` (Task 1); postojeći `ActionResult` tip i admin-provjera obrazac iz istog fajla; `env.CRON_SECRET` iz `@/lib/env`.
- Produces:
  - `updatePodsjetniciAktivni(_prev: ActionResult, formData: FormData): Promise<ActionResult>` — checkbox polje `aktivni` ("on" | null).
  - `pokreniPodsjetnikeSada(): Promise<PokreniRezultat>` gdje `type PokreniRezultat = { ok: true; poslano: number; preskoceno: number; greske: number } | { ok: false; message: string }` (export iz istog fajla).

- [ ] **Step 1: Akcije**

U `app/(dashboard)/postavke/actions.ts` (prati POSTOJEĆI obrazac fajla za admin provjeru i update — pogledaj kako to radi postojeća `updatePostavke` i uradi identično; ispod je logika koja se dodaje):

```ts
export async function updatePodsjetniciAktivni(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  // ista admin/uloga provjera kao u updatePostavke
  const aktivni = formData.get("aktivni") === "on"
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("postavke")
    .update({ podsjetnici_aktivni: aktivni })
    .eq("id", 1)
  if (error) return { ok: false, message: t("podsjetniciToggleGreska") }
  revalidatePath("/postavke")
  return { ok: true }
}

export type PokreniRezultat =
  | { ok: true; poslano: number; preskoceno: number; greske: number }
  | { ok: false; message: string }

export async function pokreniPodsjetnikeSada(): Promise<PokreniRezultat> {
  // ista admin/uloga provjera kao u updatePostavke; ne-admin → { ok: false, message: t("samoAdmin") }
  if (!env.CRON_SECRET) return { ok: false, message: t("pokreniNijeKonfigurisan") }
  const h = await headers()
  const proto = h.get("x-forwarded-proto") ?? "https"
  const host = h.get("host")
  if (!host) return { ok: false, message: t("pokreniGreska") }
  const res = await fetch(`${proto}://${host}/api/cron/reminders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CRON_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: false }),
    cache: "no-store",
  })
  if (!res.ok) return { ok: false, message: t("pokreniGreska") }
  const data = (await res.json()) as { sent?: unknown[]; skipped?: unknown[]; errors?: unknown[] }
  return {
    ok: true,
    poslano: data.sent?.length ?? 0,
    preskoceno: data.skipped?.length ?? 0,
    greske: data.errors?.length ?? 0,
  }
}
```

(import `headers` iz `next/headers`; `env` je već importovan u fajlu — provjeri.)

- [ ] **Step 2: i18n ključevi (sva tri kataloga, isti commit)**

`messages/sr.json` → `postavke.actions`: `"podsjetniciToggleGreska": "Greška pri snimanju postavke podsjetnika."`, `"samoAdmin": "Samo administrator može pokrenuti podsjetnike."`, `"pokreniNijeKonfigurisan": "CRON_SECRET nije konfigurisan na ovom deploymentu."`, `"pokreniGreska": "Pokretanje podsjetnika nije uspjelo."`
en: "Error saving reminder setting." / "Only an administrator can run reminders." / "CRON_SECRET is not configured on this deployment." / "Running reminders failed."
de: "Fehler beim Speichern der Erinnerungseinstellung." / "Nur ein Administrator kann Erinnerungen ausführen." / "CRON_SECRET ist auf diesem Deployment nicht konfiguriert." / "Ausführen der Erinnerungen fehlgeschlagen."

- [ ] **Step 3: Verifikacija + commit**

Run: `pnpm typecheck && pnpm test:unit` → PASS (paritet test čuva kataloge).
```bash
git add "app/(dashboard)/postavke/actions.ts" messages/sr.json messages/en.json messages/de.json
git commit -m "feat(podsjetnici): server akcije — toggle automatike i Pokreni sada"
```

---

### Task 3: UI u sekciji podsjetnika + e2e

**Files:**
- Create: `components/domain/PodsjetniciKontrole.tsx`
- Modify: `app/(dashboard)/postavke/page.tsx` (select + render uz `ReminderForm`)
- Modify: `messages/{sr,en,de}.json` (ključevi `postavke.podsjetniciKontrole.*`)
- Test: dopuna `tests/e2e/06-podsjetnici.spec.ts`

**Interfaces:**
- Consumes: `updatePodsjetniciAktivni`, `pokreniPodsjetnikeSada`, `PokreniRezultat` (Task 2); postojeći UI obrasci: toggle kao `components/domain/PrimaPodsjetnikeToggle.tsx`, potvrda kao dijalog obrazac iz `components/domain/ObrisiDokumentButton.tsx` (`components/ui/dialog.tsx`).

- [ ] **Step 1: Komponenta**

`components/domain/PodsjetniciKontrole.tsx` ("use client") — pročitaj prvo `PrimaPodsjetnikeToggle.tsx` (toggle obrazac sa useActionState) i `ObrisiDokumentButton.tsx` (dialog potvrda) pa napravi:

- Toggle „Automatsko slanje" (`name="aktivni"`, checked iz propa `aktivni: boolean`, submit odmah na promjenu preko `useActionState(updatePodsjetniciAktivni, { ok: true })`, `data-testid="podsjetnici-aktivni-toggle"`).
- Dugme „Pokreni sada" (`data-testid="pokreni-podsjetnike"`) → otvara dialog potvrde (tekst: `t("potvrda")`) → na potvrdu `startTransition(async () => setRezultat(await pokreniPodsjetnikeSada()))`; dok traje: disabled + `t("saljem")`.
- Prikaz rezultata ispod (`data-testid="pokreni-rezultat"`): ok → `t("rezultat", { poslano, preskoceno, greske })`; !ok → poruka greške.

Ključevi `postavke.podsjetniciKontrole` (sr / en / de):
`naslov`: "Automatsko slanje" / "Automatic sending" / "Automatischer Versand"
`opis`: "Dnevno slanje podsjetnika (06:00 UTC). Isključivanje zaustavlja samo automatiku — ručno pokretanje uvijek radi." / "Daily reminder sending (06:00 UTC). Turning it off stops only the schedule — manual runs always work." / "Täglicher Erinnerungsversand (06:00 UTC). Das Ausschalten stoppt nur den Zeitplan — manuelle Ausführung funktioniert immer."
`pokreni`: "Pokreni sada" / "Run now" / "Jetzt ausführen"
`potvrda`: "Poslati podsjetnike svim primaocima odmah?" / "Send reminders to all recipients now?" / "Erinnerungen jetzt an alle Empfänger senden?"
`saljem`: "Šaljem…" / "Sending…" / "Wird gesendet…"
`rezultat`: "Poslano: {poslano} · Preskočeno: {preskoceno} · Greške: {greske}" / "Sent: {poslano} · Skipped: {preskoceno} · Errors: {greske}" / "Gesendet: {poslano} · Übersprungen: {preskoceno} · Fehler: {greske}"
`otkazi`: koristi postojeći `common.otkazi` (NE dupliraj).

- [ ] **Step 2: Wire u stranicu**

U `app/(dashboard)/postavke/page.tsx`: proširi postojeći select postavki sa `podsjetnici_aktivni` i renderuj `<PodsjetniciKontrole aktivni={post?.podsjetnici_aktivni ?? true} />` u istoj sekciji odmah uz `<ReminderForm …/>` (linija ~39).

- [ ] **Step 3: e2e dopuna (failing prvo)**

U `tests/e2e/06-podsjetnici.spec.ts`, u describe „Postavke UI" dodaj:

```ts
test("toggle automatskog slanja se perzistira", async ({ page }) => {
  await page.goto("/postavke")
  const toggle = page.getByTestId("podsjetnici-aktivni-toggle")
  await expect(toggle).toBeVisible()
  const prije = await toggle.isChecked()
  await toggle.click()
  await expect(toggle).toBeChecked({ checked: !prije })
  await page.reload()
  await expect(page.getByTestId("podsjetnici-aktivni-toggle")).toBeChecked({ checked: !prije })
  // vrati na početno stanje da test ne mijenja ponašanje instance
  await page.getByTestId("podsjetnici-aktivni-toggle").click()
  await expect(page.getByTestId("podsjetnici-aktivni-toggle")).toBeChecked({ checked: prije })
})
```

Run PRIJE implementacije UI-ja: `pnpm exec playwright test tests/e2e/06-podsjetnici.spec.ts -g "toggle automatskog" --project=chromium --workers=1` → FAIL (testid ne postoji). Poslije Step 1-2 → PASS. (Napomena: e2e gađa cloud DEMO bazu — migracija iz Taska 4 mora biti primijenjena na DEMO PRIJE pokretanja ovog testa; ako Task 4 još nije prošao, pokreni protiv lokalnog stacka ili odgodi ovaj run u Task 4 verifikaciju i zabilježi.)

- [ ] **Step 4: Verifikacija + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit` → PASS; dijakritički sweep novog fajla (samo komentari).
```bash
git add components/domain/PodsjetniciKontrole.tsx "app/(dashboard)/postavke/page.tsx" messages/sr.json messages/en.json messages/de.json tests/e2e/06-podsjetnici.spec.ts
git commit -m "feat(podsjetnici): UI kontrole u Postavkama — toggle + Pokreni sada"
```

---

### Task 4: Cloud migracije + merge + runtime verifikacija (KONTROLER radi ovaj task — dira PROD)

**Files:** nema novih izmjena koda; operativni task.

**Interfaces:**
- Consumes: migracija iz Taska 1; grana kompletna i reviewovana.

- [ ] **Step 1: Migracija na DEMO cloud** (`mtwwotmwrasozmcgqwhc`): pokušaj Supabase MCP `apply_migration` na DEMO projektu; ako DEMO nije dostupan kroz MCP, `DATABASE_URL=<demo pooler URL> pnpm db:apply-cloud supabase/migrations/20260706120000_postavke_podsjetnici_aktivni.sql` (URL/lozinku ima korisnik — pitati ako fali). Provjera: REST `GET /rest/v1/postavke?select=podsjetnici_aktivni` vraća kolonu.
- [ ] **Step 2: Migracija na PROD** (`fqtqkehjidkzeasiegnq`): `pnpm db:apply-cloud supabase/migrations/20260706120000_postavke_podsjetnici_aktivni.sql` (DATABASE_URL iz .env.local = PROD — provjeri ref prije!). Ovo je PROD write — uraditi uz izričitu potvrdu korisnika u sesiji.
- [ ] **Step 3: e2e iz Taska 3 protiv cloud DEMO** sada prolazi: `pnpm exec playwright test tests/e2e/06-podsjetnici.spec.ts --workers=1` → zeleno (uz poznate pre-existing izuzetke ako ih ima).
- [ ] **Step 4: Merge** — PR `feat/podsjetnici-kontrole` → main (checks zeleni) → auto-deploy sva tri projekta.
- [ ] **Step 5: Runtime verifikacija na produkciji** (tehpro-demo): (a) GET cron sa Bearer tajnom dok je toggle ISKLJUČEN u UI → `{ok:true, skipped:"podsjetnici_iskljuceni"}`; (b) toggle UKLJUČEN → GET pokreće engine; (c) dugme „Pokreni sada" u UI → šalje dospjele podsjetnike, rezultat prikazan, email stiže na nmil32@icloud.com; (d) ponovljeni klik → poslano 0 / preskočeno N (idempotencija).
- [ ] **Step 6: Ledger + memorija** — zabilježi ishod u `.superpowers/sdd/progress.md` i ažuriraj memory `reminder-engine-status`.

---

## Self-Review (obavljen)

- **Spec pokrivenost:** flag+default+tolerantno čitanje (T1), gating samo GET (T1 Step 5), toggle akcija + Pokreni sada preko fetch/CRON_SECRET (T2), UI u sekciji podsjetnika + i18n + e2e persist (T3), migracije DEMO→PROD prije merge-a koda + runtime verifikacija uklj. idempotenciju (T4). ✓
- **Placeholderi:** nema TBD; upute „prati postojeći obrazac" uvijek imenuju TAČAN referentni fajl/funkciju. ✓
- **Konzistentnost:** `podsjetniciAktivni` (T1) ↔ ruta (T1); `updatePodsjetniciAktivni`/`pokreniPodsjetnikeSada`/`PokreniRezultat` (T2) ↔ UI (T3); testid-ovi `podsjetnici-aktivni-toggle`/`pokreni-podsjetnike`/`pokreni-rezultat` dosljedni (T3). ✓
- **Redoslijed rizika:** migracije na cloud (T4 Step 1-2) idu PRIJE merge-a koda (T4 Step 4), a kod je ionako tolerantan na nedostajuću kolonu. ✓
