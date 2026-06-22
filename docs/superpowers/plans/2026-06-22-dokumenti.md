# Faza Dokumenti — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload dokumenata + AI generisanje .docx zapisnika u Supabase Storage, sa pregledom (mammoth) na `/pregled` i u termin/klijent UI.

**Architecture:** Privatni Storage bucket `tehpro-dokumenti`; storage I/O kroz service-role helper (`lib/supabase/storage.ts`, server-only). AI zapisnik je dual-mode (pravi `@anthropic-ai/sdk` claude-sonnet-4-6 kad ima ključ; deterministični mock .docx inače / kad je `ZAPISNIK_DRY_RUN=1`). docx generisanje preko `docx`, preview preko `mammoth`. Read iz `dokumenti` tabele + `termini_view`; write u `dokumenti` + Storage.

**Tech Stack:** Next.js 16.2.9 (App Router, RSC, Server Actions), React 19.2.4, TypeScript strict, `@supabase/supabase-js`, `@anthropic-ai/sdk`, `docx`, `mammoth`, Zod, Vitest, Playwright.

## Global Constraints

- **Next.js 16.2.9 / React 19.2.4 / TS strict** (`noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`). **Prije pisanja koda pročitati relevantni vodič u `node_modules/next/dist/docs/`** (AGENTS.md — Next 16 ima breaking changes).
- **DB: lokalni Docker Supabase.** Šema se mijenja ISKLJUČIVO migracijom + `pnpm db:reset && pnpm seed`. Runtime pristup samo preko `@supabase/supabase-js` SDK — direktan `pg`/`postgres` u app/ je zabranjen.
- **Storage I/O ide kroz service-role (admin) klijent u `lib/supabase/storage.ts` sa `import "server-only"`.** Ovo je sankcionisani izuzetak od pravila "admin samo u scripts/cron" — bucket je privatan a auth još nije implementiran; helper je jedina ulazna tačka. SUPABASE_SERVICE_ROLE_KEY je već u `.env.local` (seed ga koristi).
- **Storage cleanup = app-level** (`deleteDokumentAction` briše fajl pa red). DB trigger `tg_dokumenti_storage_cleanup` (spec §4.4) je NAMJERNO zamijenjen — PL/pgSQL ne može pozvati Storage backend na lokalu. Zabilježeno; budući upgrade može preko pg_net/edge funkcije.
- **POZNATO OGRANIČENJE (orphan fajlovi):** app-level cleanup pokriva samo DIREKTNO brisanje dokumenta. `dokumenti.termin_id → termini` je `ON DELETE CASCADE`, pa bi brisanje termina ostavilo orphan fajlove. U trenutnom kodu NE postoji termin-delete tok (klijent-delete je RESTRICT), pa rizik nije aktivan; adresira se kad/ako se doda termin-delete (pg_net/edge funkcija).
- **POZNATO OGRANIČENJE (bez auth-a):** download ruta `/api/dokumenti/[id]` i sve akcije nemaju auth provjeru — dosljedno cijeloj app-i (auth je odgođen na kasniju fazu, odluka iz Faze 1). Nije nova ranjivost ove faze; auth se dodaje app-wide kasnije.
- **AI dual-mode:** pravi Claude (`claude-sonnet-4-6`) kad `ANTHROPIC_API_KEY` postoji I `ZAPISNIK_DRY_RUN` nije `"1"`; inače deterministični mock .docx. E2E forsira dry-run preko Playwright `webServer.env`.
- **Upload prima:** `.docx`, `.pdf`, `image/png|jpeg|webp`; max 50 MB. AI generiše samo `.docx`. `/pregled` lista samo `generated_by_ai = true` (svi .docx → mammoth preview). KlijentTabs dokumenti tab lista SVE dokumente klijenta.
- **Upload je opcionalan** — `markIzvrseno` se NE mijenja; dokumenti se dodaju nezavisno, bilo kad.
- **@base-ui/react Select** zahtijeva `items: Record<value,label>` mapu da bi `SelectValue` prikazao labelu kad je zatvoren.
- **Desktop-only** (ESLint zabranjuje `sm:`/`md:` prefikse). ESLint zabranjuje `await` u petlji osim u `scripts/` (koristi `Promise.all`).
- **Bosanski UI copy.** Bez emojija osim postojećih obrazaca. **Bez dummy podataka** — E2E koristi seedovane termine + stvarne upload-ovane fajl-buffer-e.
- **Server actions vraćaju `ActionResult`** (`{ ok: true } | { ok: false; errors?; message? }`) + `revalidatePath(...)` nakon write-a.
- **Gate (svaka faza):** `pnpm build` + `pnpm lint` + `pnpm typecheck` + `pnpm test:unit` + `pnpm test:e2e` (chromium+webkit) na **SVJEŽEM serveru** (ubiti :3000 prije E2E — HMR-stale server daje lažne padove) + fresh-agent verifikacija. Tag `v0.8.0`.

---

### Task 1: Storage bucket `tehpro-dokumenti`

**Files:**
- Create: `supabase/migrations/20260622120000_dokumenti_storage_bucket.sql`
- Modify: `supabase/config.toml` (dodati bucket blok ispod linije 113, prije `[storage.s3_protocol]`)

**Interfaces:**
- Produces: privatni bucket `tehpro-dokumenti` (id == name), 50 MiB limit, allowed mime: docx/pdf/png/jpeg/webp. Konzumiraju ga `lib/supabase/storage.ts` (T2) i sve dalje.

- [ ] **Step 1: Napiši migraciju**

Create `supabase/migrations/20260622120000_dokumenti_storage_bucket.sql`:

```sql
-- Faza Dokumenti — Storage bucket za zapisnike/upload-ovane dokumente.
-- Privatni bucket; cleanup je app-level (vidi deleteDokumentAction).
-- Spec §4.4 DB trigger zamijenjen — PL/pgSQL ne može pozvati Storage backend lokalno.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tehpro-dokumenti',
  'tehpro-dokumenti',
  false,
  52428800, -- 50 MiB
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do nothing;
```

- [ ] **Step 2: Dodaj bucket u config.toml**

U `supabase/config.toml`, u sekciji `[storage]` — odmah ispod reda `file_size_limit = "50MiB"`, prije komentara `# Uncomment to configure local storage buckets` i prije `[storage.s3_protocol]` — ubaci:

```toml

[storage.buckets.tehpro-dokumenti]
public = false
file_size_limit = "50MiB"
allowed_mime_types = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf", "image/png", "image/jpeg", "image/webp"]
```

- [ ] **Step 3: Primijeni i verifikuj (bucket postoji nakon db:reset)**

Run:
```bash
pnpm db:reset && pnpm seed
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c \
  "select id, public, file_size_limit from storage.buckets where id='tehpro-dokumenti';"
```
Expected: tačno 1 red, `public = f`, `file_size_limit = 52428800`.

> Ako `db reset` ne kreira `storage` šemu prije migracija (red 0): fallback je oslanjanje na `config.toml` blok (kreira se na `supabase stop && supabase start`). U tom slučaju verifikuj nakon restarta umjesto reset-a i zabilježi u report.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622120000_dokumenti_storage_bucket.sql supabase/config.toml
git commit -m "feat(dokumenti): tehpro-dokumenti Storage bucket (privatni, 50MiB)"
```

---

### Task 2: Env + dependencies + `lib/supabase/storage.ts`

**Files:**
- Modify: `lib/env.ts` (dodati `ANTHROPIC_API_KEY`, `ZAPISNIK_DRY_RUN`)
- Modify: `.env.local.example` (dokumentovati nove varijable)
- Modify: `package.json` (deps preko `pnpm add`)
- Create: `lib/supabase/storage.ts`

**Interfaces:**
- Consumes: bucket iz T1; `createAdminSupabaseClient()` iz `lib/supabase/admin.ts`; `env` iz `lib/env.ts`.
- Produces:
  - `env.ANTHROPIC_API_KEY: string | undefined`, `env.ZAPISNIK_DRY_RUN: string | undefined`
  - `DOKUMENTI_BUCKET: "tehpro-dokumenti"`
  - `uploadDokument(path: string, body: Buffer | Uint8Array | ArrayBuffer, contentType: string): Promise<void>`
  - `downloadDokument(path: string): Promise<Buffer>`
  - `signedUrl(path: string, opts?: { downloadName?: string }): Promise<string>`
  - `removeDokument(path: string): Promise<void>`

- [ ] **Step 1: Instaliraj zavisnosti**

Run:
```bash
pnpm add @anthropic-ai/sdk docx mammoth
```
Expected: `package.json` dependencies sadrži `@anthropic-ai/sdk`, `docx`, `mammoth`.

- [ ] **Step 2: Proširi `lib/env.ts`**

U `lib/env.ts`, u `envSchema` dodaj poslije `CRON_SECRET: optionalSecret,`:
```ts
  ANTHROPIC_API_KEY: optionalSecret,
  ZAPISNIK_DRY_RUN: z.string().optional(),
```
i u `safeParse({...})` objekat dodaj poslije `CRON_SECRET: process.env.CRON_SECRET,`:
```ts
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ZAPISNIK_DRY_RUN: process.env.ZAPISNIK_DRY_RUN,
```

- [ ] **Step 3: Dokumentuj u `.env.local.example`**

Na kraj `.env.local.example` dodaj:
```bash

# AI zapisnik (Faza Dokumenti)
ANTHROPIC_API_KEY=
# Postavi na "1" da forsiraš mock zapisnik (E2E ga postavlja automatski)
ZAPISNIK_DRY_RUN=
```

- [ ] **Step 4: Napiši `lib/supabase/storage.ts`**

Create `lib/supabase/storage.ts`:
```ts
import "server-only"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export const DOKUMENTI_BUCKET = "tehpro-dokumenti"

export const ALLOWED_MIME = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const

export const MAX_BYTES = 52_428_800 // 50 MiB

/** Upload (upsert) u privatni bucket. */
export async function uploadDokument(
  path: string,
  body: Buffer | Uint8Array | ArrayBuffer,
  contentType: string,
): Promise<void> {
  const supabase = createAdminSupabaseClient()
  const { error } = await supabase.storage
    .from(DOKUMENTI_BUCKET)
    .upload(path, body, { contentType, upsert: true })
  if (error) throw new Error(`Upload nije uspio: ${error.message}`)
}

/** Skida fajl kao Node Buffer (za mammoth preview). */
export async function downloadDokument(path: string): Promise<Buffer> {
  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase.storage.from(DOKUMENTI_BUCKET).download(path)
  if (error || !data) throw new Error(`Download nije uspio: ${error?.message ?? "nema podataka"}`)
  return Buffer.from(await data.arrayBuffer())
}

/** Kratkotrajni potpisani URL; downloadName forsira preuzimanje sa tim imenom. */
export async function signedUrl(
  path: string,
  opts?: { downloadName?: string },
): Promise<string> {
  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase.storage
    .from(DOKUMENTI_BUCKET)
    .createSignedUrl(path, 60, opts?.downloadName ? { download: opts.downloadName } : undefined)
  if (error || !data) throw new Error(`Signed URL nije uspio: ${error?.message ?? "nema URL-a"}`)
  return data.signedUrl
}

/** App-level cleanup — briše fajl iz bucket-a. */
export async function removeDokument(path: string): Promise<void> {
  const supabase = createAdminSupabaseClient()
  const { error } = await supabase.storage.from(DOKUMENTI_BUCKET).remove([path])
  if (error) throw new Error(`Brisanje fajla nije uspio: ${error.message}`)
}
```

- [ ] **Step 5: Verifikuj typecheck/lint/build**

Run:
```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: bez grešaka. (Storage I/O se end-to-end provjerava u T7 E2E.)

- [ ] **Step 6: Commit**

```bash
git add lib/env.ts .env.local.example package.json pnpm-lock.yaml lib/supabase/storage.ts
git commit -m "feat(dokumenti): env (ANTHROPIC_API_KEY, ZAPISNIK_DRY_RUN) + storage helper + deps"
```

---

### Task 3: `lib/zapisnik` — docx generator + AI dual-mode (unit-tested)

**Files:**
- Create: `lib/zapisnik/template.ts` (čist; docx)
- Create: `lib/zapisnik/content.ts` (čist; tipovi + dry-run sadržaj + prompt builder)
- Create: `lib/zapisnik/generate.ts` (env+SDK; dual-mode)
- Create: `lib/zapisnik/template.test.ts`, `lib/zapisnik/content.test.ts`

**Interfaces:**
- Consumes: `docx`, `@anthropic-ai/sdk`, `env` (samo u `generate.ts`).
- Produces:
  - `content.ts`: `type ZapisnikInput = { klijent: string; lokacija: string | null; vrstaProvjere: string; datum: string; zaduzeni: string | null }`; `type ZapisnikContent = { nalaz: string; zakljucak: string; dryRun: boolean }`; `dryGenerateZapisnik(input: ZapisnikInput): ZapisnikContent`; `buildPrompt(input: ZapisnikInput): string`
  - `template.ts`: `type ZapisnikData = ZapisnikInput & { nalaz: string; zakljucak: string }`; `buildZapisnikDocx(data: ZapisnikData): Promise<Buffer>`
  - `generate.ts`: `generateZapisnik(input: ZapisnikInput): Promise<ZapisnikContent>`

> **Zašto razdvojeno:** `content.ts` i `template.ts` su ČISTI (ne import-uju `@/lib/env`) pa ih vitest može testirati — `env.ts` baca grešku bez env varijabli (vitest ne učitava `.env.local`). `generate.ts` (env+SDK) se pokriva E2E-jem (dry-run), ne unit-om.

- [ ] **Step 1: Napiši failing test za `content.ts`**

Create `lib/zapisnik/content.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { dryGenerateZapisnik, buildPrompt } from "./content"

describe("dryGenerateZapisnik", () => {
  it("deterministični sadržaj uključuje klijenta i vrstu provjere", () => {
    const c = dryGenerateZapisnik({
      klijent: "WAIKIKI",
      lokacija: "Banja Luka - Delta",
      vrstaProvjere: "Servis PP aparata",
      datum: "2026-06-22",
      zaduzeni: null,
    })
    expect(c.dryRun).toBe(true)
    expect(c.nalaz).toContain("WAIKIKI")
    expect(c.nalaz).toContain("Servis PP aparata")
    expect(c.zakljucak.length).toBeGreaterThan(10)
  })

  it("buildPrompt traži čist JSON odgovor na bosanskom", () => {
    const p = buildPrompt({
      klijent: "WAIKIKI", lokacija: null, vrstaProvjere: "Hidranti",
      datum: "2026-06-22", zaduzeni: "Marija K.",
    })
    expect(p).toContain("Hidranti")
    expect(p).toContain("JSON")
    expect(p).toContain("nalaz")
    expect(p).toContain("zakljucak")
  })
})
```

- [ ] **Step 2: Pokreni — mora pasti**

Run: `pnpm test:unit lib/zapisnik/content.test.ts`
Expected: FAIL — `Cannot find module './content'`.

- [ ] **Step 3: Napiši `lib/zapisnik/content.ts`**

```ts
export type ZapisnikInput = {
  klijent: string
  lokacija: string | null
  vrstaProvjere: string
  datum: string // YYYY-MM-DD
  zaduzeni: string | null
}

export type ZapisnikContent = { nalaz: string; zakljucak: string; dryRun: boolean }

/** Deterministični mock sadržaj — koristi se bez ANTHROPIC_API_KEY ili kad je ZAPISNIK_DRY_RUN=1. */
export function dryGenerateZapisnik(input: ZapisnikInput): ZapisnikContent {
  const lok = input.lokacija ? `, lokacija ${input.lokacija}` : ""
  return {
    nalaz:
      `Izvršena je provjera "${input.vrstaProvjere}" za klijenta ${input.klijent}${lok}, dana ${input.datum}. ` +
      `Tokom provjere pregledani su relevantni elementi u skladu sa važećim propisima zaštite na radu.`,
    zakljucak:
      `Na osnovu izvršene provjere utvrđeno je da stanje zadovoljava propisane uslove. ` +
      `Preporučuje se redovno održavanje i naredna provjera u zakonski propisanom intervalu.`,
    dryRun: true,
  }
}

export function buildPrompt(input: ZapisnikInput): string {
  return (
    `Ti si stručnjak za zaštitu na radu u firmi Tehpro (Bosna i Hercegovina). ` +
    `Napiši profesionalan zapisnik o izvršenoj provjeri.\n` +
    `Klijent: ${input.klijent}\n` +
    `Lokacija: ${input.lokacija ?? "—"}\n` +
    `Vrsta provjere: ${input.vrstaProvjere}\n` +
    `Datum izvršenja: ${input.datum}\n` +
    `Zaduženi: ${input.zaduzeni ?? "—"}\n\n` +
    `Vrati ISKLJUČIVO validan JSON oblika {"nalaz": "...", "zakljucak": "..."} na bosanskom jeziku, ` +
    `bez markdown ograda i bez dodatnog teksta. ` +
    `"nalaz" = 2-4 rečenice opisa izvršene provjere; "zakljucak" = 1-2 rečenice ocjene i preporuke.`
  )
}
```

- [ ] **Step 4: Pokreni — mora proći**

Run: `pnpm test:unit lib/zapisnik/content.test.ts`
Expected: PASS (2 testa).

- [ ] **Step 5: Napiši failing test za `template.ts`**

Create `lib/zapisnik/template.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { buildZapisnikDocx } from "./template"

describe("buildZapisnikDocx", () => {
  it("vraća validan .docx Buffer (OOXML/ZIP 'PK' magic)", async () => {
    const buf = await buildZapisnikDocx({
      klijent: "WAIKIKI",
      lokacija: "Banja Luka - Delta",
      vrstaProvjere: "Servis PP aparata",
      datum: "2026-06-22",
      zaduzeni: "Marija K.",
      nalaz: "Prva linija nalaza.\nDruga linija nalaza.",
      zakljucak: "Stanje zadovoljava.",
    })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK")
  })

  it("mammoth pročita generisani .docx (round-trip — pravi OOXML, ne samo ZIP)", async () => {
    const mammoth = (await import("mammoth")).default
    const buf = await buildZapisnikDocx({
      klijent: "WAIKIKI",
      lokacija: null,
      vrstaProvjere: "Hidranti",
      datum: "2026-06-22",
      zaduzeni: null,
      nalaz: "Provjera izvršena bez nedostataka.",
      zakljucak: "Stanje zadovoljava.",
    })
    const { value: html } = await mammoth.convertToHtml({ buffer: buf })
    expect(html).toContain("ZAPISNIK")
    expect(html).toContain("Provjera izvršena")
  })
})
```

- [ ] **Step 6: Pokreni — mora pasti**

Run: `pnpm test:unit lib/zapisnik/template.test.ts`
Expected: FAIL — `Cannot find module './template'`.

- [ ] **Step 7: Napiši `lib/zapisnik/template.ts`**

```ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx"
import type { ZapisnikInput } from "./content"

export type ZapisnikData = ZapisnikInput & { nalaz: string; zakljucak: string }

function red(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)],
  })
}

function odlomci(tekst: string): Paragraph[] {
  return tekst.split("\n").map((linija) => new Paragraph({ children: [new TextRun(linija)] }))
}

export async function buildZapisnikDocx(data: ZapisnikData): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "ZAPISNIK O IZVRŠENOJ PROVJERI", bold: true })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Tehpro — zaštita na radu", italics: true })],
          }),
          new Paragraph({ text: "" }),
          red("Klijent", data.klijent),
          red("Lokacija", data.lokacija ?? "—"),
          red("Vrsta provjere", data.vrstaProvjere),
          red("Datum izvršenja", data.datum),
          red("Zaduženi", data.zaduzeni ?? "—"),
          new Paragraph({ text: "" }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Nalaz", bold: true })] }),
          ...odlomci(data.nalaz),
          new Paragraph({ text: "" }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Zaključak", bold: true })] }),
          ...odlomci(data.zakljucak),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "" }),
          new Paragraph({ children: [new TextRun("Potpis ovlaštenog lica: ______________________________")] }),
        ],
      },
    ],
  })
  return Packer.toBuffer(doc)
}
```

- [ ] **Step 8: Pokreni — mora proći**

Run: `pnpm test:unit lib/zapisnik`
Expected: PASS (sva 3 testa).

- [ ] **Step 9: Napiši `lib/zapisnik/generate.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk"
import { env } from "@/lib/env"
import { dryGenerateZapisnik, buildPrompt, type ZapisnikInput, type ZapisnikContent } from "./content"

function dryRunMode(): boolean {
  return env.ZAPISNIK_DRY_RUN === "1" || !env.ANTHROPIC_API_KEY
}

export async function generateZapisnik(input: ZapisnikInput): Promise<ZapisnikContent> {
  if (dryRunMode()) return dryGenerateZapisnik(input)

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt(input) }],
  })
  const text = msg.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && "text" in b)
    .map((b) => b.text)
    .join("\n")
    .trim()

  try {
    const parsed = JSON.parse(text) as { nalaz?: string; zakljucak?: string }
    if (!parsed.nalaz || !parsed.zakljucak) throw new Error("nepotpun odgovor")
    return { nalaz: parsed.nalaz, zakljucak: parsed.zakljucak, dryRun: false }
  } catch {
    // Model nije vratio čist JSON — degradiraj na deterministični sadržaj umjesto pada.
    return { ...dryGenerateZapisnik(input), dryRun: false }
  }
}
```

- [ ] **Step 10: Verifikuj typecheck/lint**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: bez grešaka; svi unit testovi prolaze.

> Strukturni type guard (`b is { type: "text"; text: string }`) namjerno izbjegava vezivanje za naziv tipa iz SDK-a (`Anthropic.TextBlock` može varirati po verziji) — kompajlira se neovisno o tome gdje je tip deklarisan. Model `claude-sonnet-4-6` je TAČAN (vidi okruženje + spec); ne mijenjati na starije `claude-3-5-*`.

- [ ] **Step 11: Commit**

```bash
git add lib/zapisnik
git commit -m "feat(dokumenti): lib/zapisnik docx generator + AI dual-mode + unit testovi"
```

---

### Task 4: Server actions + download route

**Files:**
- Create: `app/(dashboard)/dokumenti/actions.ts` (feature folder bez page.tsx → nije ruta)
- Create: `app/api/dokumenti/[id]/route.ts` (GET → redirect na signed download URL)

**Interfaces:**
- Consumes: `lib/supabase/storage.ts` (T2), `lib/zapisnik/{generate,template}` (T3), `createServerSupabaseClient`, `ActionResult`.
- Produces (sve `(prev: ActionResult, formData: FormData) => Promise<ActionResult>` osim navedenog):
  - `uploadDokumentAction` — polja `termin_id` (uuid), `file` (File)
  - `generateZapisnikAction` — polje `termin_id` (uuid)
  - `deleteDokumentAction` — polje `dokument_id` (uuid)
  - GET `/api/dokumenti/[id]` → 302 redirect na signed URL sa download imenom

- [ ] **Step 1: Napiši `app/(dashboard)/dokumenti/actions.ts`**

```ts
'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import {
  uploadDokument,
  removeDokument,
  ALLOWED_MIME,
  MAX_BYTES,
} from "@/lib/supabase/storage"
import { generateZapisnik } from "@/lib/zapisnik/generate"
import { buildZapisnikDocx } from "@/lib/zapisnik/template"

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "dokument"
}

function revalidateDokumenti(klijentId?: string | null): void {
  revalidatePath("/termini")
  revalidatePath("/pregled")
  revalidatePath("/plan")
  revalidatePath("/prikaz")
  if (klijentId) revalidatePath(`/klijenti/${klijentId}`)
}

const uploadSchema = z.object({ termin_id: z.string().uuid("Termin je obavezan") })

export async function uploadDokumentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = uploadSchema.safeParse({ termin_id: formData.get("termin_id") })
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { termin_id } = parsed.data

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Izaberite fajl." }
  }
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return { ok: false, message: "Nedozvoljen tip fajla (docx, pdf, png, jpeg, webp)." }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: "Fajl je veći od 50 MB." }
  }

  const supabase = await createServerSupabaseClient()
  const { data: termin } = await supabase
    .from("termini")
    .select("id, klijent_id")
    .eq("id", termin_id)
    .maybeSingle()
  if (!termin) return { ok: false, message: "Termin ne postoji." }

  const naziv = safeName(file.name)
  const path = `termini/${termin_id}/${crypto.randomUUID()}-${naziv}`
  const bytes = Buffer.from(await file.arrayBuffer())

  try {
    await uploadDokument(path, bytes, file.type)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Upload nije uspio." }
  }

  const { error } = await supabase.from("dokumenti").insert({
    termin_id,
    naziv,
    storage_path: path,
    mime_type: file.type,
    velicina_bajt: file.size,
    generated_by_ai: false,
  })
  if (error) {
    try {
      await removeDokument(path) // rollback fajla ako DB upis padne
    } catch (cleanupErr) {
      console.error("Rollback brisanja fajla nije uspio (orphan):", cleanupErr)
    }
    return { ok: false, message: error.message }
  }

  revalidateDokumenti(termin.klijent_id)
  return { ok: true }
}

const genSchema = z.object({ termin_id: z.string().uuid("Termin je obavezan") })

export async function generateZapisnikAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = genSchema.safeParse({ termin_id: formData.get("termin_id") })
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { termin_id } = parsed.data

  const supabase = await createServerSupabaseClient()
  const { data: t } = await supabase
    .from("termini_view")
    .select("klijent_id, klijent_naziv, lokacija_naziv, vrsta_naziv, datum_izvrsenja, zaduzeni")
    .eq("id", termin_id)
    .maybeSingle()
  if (!t) return { ok: false, message: "Termin ne postoji." }

  const datum = (t.datum_izvrsenja ?? new Date().toISOString()).slice(0, 10)
  const content = await generateZapisnik({
    klijent: t.klijent_naziv ?? "—",
    lokacija: t.lokacija_naziv ?? null,
    vrstaProvjere: t.vrsta_naziv ?? "—",
    datum,
    zaduzeni: t.zaduzeni ?? null,
  })

  const docx = await buildZapisnikDocx({
    klijent: t.klijent_naziv ?? "—",
    lokacija: t.lokacija_naziv ?? null,
    vrstaProvjere: t.vrsta_naziv ?? "—",
    datum,
    zaduzeni: t.zaduzeni ?? null,
    nalaz: content.nalaz,
    zakljucak: content.zakljucak,
  })

  const naziv = `Zapisnik - ${t.vrsta_naziv ?? "provjera"} - ${datum}.docx`
  const path = `termini/${termin_id}/zapisnik-${crypto.randomUUID()}.docx`

  try {
    await uploadDokument(path, docx, DOCX_MIME)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Generisanje nije uspjelo." }
  }

  const { error } = await supabase.from("dokumenti").insert({
    termin_id,
    naziv,
    storage_path: path,
    mime_type: DOCX_MIME,
    velicina_bajt: docx.length,
    generated_by_ai: true,
  })
  if (error) {
    try {
      await removeDokument(path)
    } catch (cleanupErr) {
      console.error("Rollback brisanja fajla nije uspio (orphan):", cleanupErr)
    }
    return { ok: false, message: error.message }
  }

  revalidateDokumenti(t.klijent_id)
  return { ok: true }
}

const delSchema = z.object({ dokument_id: z.string().uuid() })

export async function deleteDokumentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = delSchema.safeParse({ dokument_id: formData.get("dokument_id") })
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { dokument_id } = parsed.data

  const supabase = await createServerSupabaseClient()
  const { data: dok } = await supabase
    .from("dokumenti")
    .select("storage_path, termin_id")
    .eq("id", dokument_id)
    .maybeSingle()
  if (!dok) return { ok: false, message: "Dokument ne postoji." }

  // klijent_id preko zasebnog upita (BEZ embed-a) — dokumenti↔termini ima dvostruku
  // FK relaciju u tipovima (termini + termini_view) pa embed kardinalnost nije pouzdana.
  const { data: termin } = await supabase
    .from("termini")
    .select("klijent_id")
    .eq("id", dok.termin_id)
    .maybeSingle()

  // App-level cleanup: prvo fajl, pa red (orphan red gori od orphan fajla).
  try {
    await removeDokument(dok.storage_path)
  } catch (cleanupErr) {
    console.error("Brisanje fajla iz Storage-a nije uspjelo (orphan):", cleanupErr)
  }
  const { error } = await supabase.from("dokumenti").delete().eq("id", dokument_id)
  if (error) return { ok: false, message: error.message }

  revalidateDokumenti(termin?.klijent_id ?? null)
  return { ok: true }
}
```

> Embed relacije (`termini(klijent_id)`) su NAMJERNO izbjegnute u cijeloj fazi — dokumenti↔termini dvostruka FK + view-ovi bez embed podrške čine kardinalnost/tipove nepouzdanim. Svuda koristimo zasebni upit + (gdje treba) in-memory mapu.

- [ ] **Step 2: Napiši download rutu `app/api/dokumenti/[id]/route.ts`**

```ts
import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { signedUrl } from "@/lib/supabase/storage"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: dok } = await supabase
    .from("dokumenti")
    .select("storage_path, naziv")
    .eq("id", id)
    .maybeSingle()
  if (!dok) return NextResponse.json({ error: "Dokument ne postoji" }, { status: 404 })

  const url = await signedUrl(dok.storage_path, { downloadName: dok.naziv })
  return NextResponse.redirect(url)
}
```

- [ ] **Step 3: Verifikuj typecheck/lint/build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: bez grešaka. (Funkcionalnost se provjerava E2E-jem u T7.)

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/dokumenti/actions.ts" "app/api/dokumenti/[id]/route.ts"
git commit -m "feat(dokumenti): upload/generate/delete server actions + download ruta"
```

---

### Task 5: Dokumenti sekcija u TerminSheet

**Files:**
- Create: `components/domain/DokumentiSekcija.tsx`
- Modify: `components/domain/TerminSheet.tsx` (zamijeniti placeholder sekciju `data-testid="sheet-dokumenti"`)
- Modify: `app/(dashboard)/termini/page.tsx`, `app/(dashboard)/plan/page.tsx`, `app/(dashboard)/prikaz/page.tsx` (fetch dokumenata za izabrani termin + proslijediti `dokumenti` u `TerminSheet`)

**Interfaces:**
- Consumes: akcije iz T4 (`uploadDokumentAction`, `generateZapisnikAction`, `deleteDokumentAction`); tip `DokumentRow = Database["public"]["Tables"]["dokumenti"]["Row"]`.
- Produces: `DokumentiSekcija({ terminId, dokumenti }: { terminId: string; dokumenti: DokumentRow[] })`; `TerminSheet` dobija novi **obavezni** prop `dokumenti: DokumentRow[]`.

- [ ] **Step 1: Napiši `components/domain/DokumentiSekcija.tsx`**

```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { FileText, Sparkles, Trash2, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  uploadDokumentAction,
  generateZapisnikAction,
  deleteDokumentAction,
  type ActionResult,
} from "@/app/(dashboard)/dokumenti/actions"
import type { Database } from "@/db/types"

type DokumentRow = Database["public"]["Tables"]["dokumenti"]["Row"]
const initial: ActionResult = { ok: true }

export function DokumentiSekcija({
  terminId,
  dokumenti,
}: {
  terminId: string
  dokumenti: DokumentRow[]
}) {
  const router = useRouter()
  const [uploadState, uploadAction, uploadPending] = useActionState(uploadDokumentAction, initial)
  const [genState, genAction, genPending] = useActionState(generateZapisnikAction, initial)
  const [delState, delAction, delPending] = useActionState(deleteDokumentAction, initial)
  const fileRef = useRef<HTMLInputElement>(null)

  // Refresh liste kad SE PROMIJENI ishod bilo koje akcije i taj (promijenjeni) ishod je uspjeh.
  // NE uslovljavati sa "sve tri ok" — zaglavljena greška iz jedne akcije bi blokirala
  // refresh nakon kasnijeg uspjeha druge akcije.
  const prev = useRef({ u: uploadState, g: genState, d: delState })
  useEffect(() => {
    const uChanged = uploadState !== prev.current.u
    const gChanged = genState !== prev.current.g
    const dChanged = delState !== prev.current.d
    if (!uChanged && !gChanged && !dChanged) return
    const uspjeh =
      (uChanged && uploadState.ok) || (gChanged && genState.ok) || (dChanged && delState.ok)
    prev.current = { u: uploadState, g: genState, d: delState }
    if (uspjeh) {
      if (uChanged && uploadState.ok && fileRef.current) fileRef.current.value = ""
      router.refresh()
    }
  }, [uploadState, genState, delState, router])

  const greska =
    (uploadState.ok === false && uploadState.message) ||
    (genState.ok === false && genState.message) ||
    (delState.ok === false && delState.message) ||
    null

  return (
    <section data-testid="sheet-dokumenti">
      <p className="text-xs uppercase tracking-wide text-slate-400">Dokumenti</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <form action={genAction}>
          <input type="hidden" name="termin_id" value={terminId} />
          <Button type="submit" variant="default" disabled={genPending} data-testid="generisi-zapisnik">
            <Sparkles className="w-4 h-4" aria-hidden /> {genPending ? "Generišem…" : "Generiši zapisnik (AI)"}
          </Button>
        </form>

        <form action={uploadAction} className="flex items-center gap-2">
          <input type="hidden" name="termin_id" value={terminId} />
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".docx,.pdf,image/png,image/jpeg,image/webp"
            data-testid="dokument-file"
            className="text-sm"
          />
          <Button type="submit" variant="outline" disabled={uploadPending} data-testid="dokument-upload-submit">
            {uploadPending ? "Šaljem…" : "Upload"}
          </Button>
        </form>
      </div>

      {greska && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {greska}
        </p>
      )}

      {dokumenti.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Nema dokumenata za ovaj termin.</p>
      ) : (
        <ul className="mt-3 space-y-2" data-testid="dokumenti-lista">
          {dokumenti.map((d) => (
            <li
              key={d.id}
              data-testid="dokument-red"
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="w-4 h-4 shrink-0 text-slate-400" aria-hidden />
                <span className="truncate">{d.naziv}</span>
                {d.generated_by_ai && (
                  <span data-testid="dokument-ai-badge" className="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-xs text-brand">AI</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <a
                  href={`/api/dokumenti/${d.id}`}
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                  data-testid="dokument-download"
                >
                  <Download className="w-4 h-4" aria-hidden /> Preuzmi
                </a>
                <form action={delAction}>
                  <input type="hidden" name="dokument_id" value={d.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    disabled={delPending}
                    data-testid="dokument-delete"
                    aria-label="Obriši dokument"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" aria-hidden />
                  </Button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

> **Napomena:** `lucide-react` ikone u repo-u — provjeri da `Sparkles`, `Trash2`, `Download`, `FileText` postoje u instaliranoj verziji; ako neka nedostaje, zamijeni najbližom postojećom.

- [ ] **Step 2: Zamijeni placeholder u `TerminSheet.tsx`**

U `components/domain/TerminSheet.tsx`:
1. Dodaj import na vrh (uz ostale):
```ts
import { DokumentiSekcija } from "@/components/domain/DokumentiSekcija"
import type { Database } from "@/db/types"
```
2. Proširi props tip — u potpisu komponente dodaj `dokumenti`:
```ts
export function TerminSheet({
  termin,
  istorija,
  dokumenti,
  closeHref,
}: {
  termin: TerminRow
  istorija: TerminRow[]
  dokumenti: Database["public"]["Tables"]["dokumenti"]["Row"][]
  closeHref: string
}) {
```
3. Zamijeni cijeli blok `{/* Dokumenti — placeholder (Faza 7) */}` … `</section>` (linije 151-157) sa:
```tsx
          {/* Dokumenti — upload + AI zapisnik */}
          <DokumentiSekcija terminId={termin.id ?? ""} dokumenti={dokumenti} />
```

- [ ] **Step 3: Fetch dokumenata + proslijedi u 3 pozivna mjesta**

U svakom od: `app/(dashboard)/termini/page.tsx`, `app/(dashboard)/plan/page.tsx`, `app/(dashboard)/prikaz/page.tsx` — pronađi mjesto gdje se rješava `selectedTermin` i renderuje `<TerminSheet ... />`. Tik prije render-a `TerminSheet` dodaj fetch:
```ts
  const dokumenti = selectedTermin?.id
    ? ((await supabase
        .from("dokumenti")
        .select("*")
        .eq("termin_id", selectedTermin.id)
        .order("uploaded_at", { ascending: false })).data ?? [])
    : []
```
i u JSX-u proslijedi prop:
```tsx
        <TerminSheet termin={selectedTermin} istorija={istorija} dokumenti={dokumenti} closeHref={closeHref} />
```
(U `plan/page.tsx` `supabase` je već u scope-u; u `termini`/`prikaz` koristi isti `supabase` klijent koji stranica već kreira. Ako `selectedTermin` može biti null pri render-u, `dokumenti` je `[]`.)

> **Scope napomena (svjesna odluka):** `TerminSheet` se renderuje na 3 mjesta (/termini, /plan, /prikaz). Pošto je `dokumenti` OBAVEZAN prop, sva 3 pozivna mjesta moraju ga proslijediti — inače TS ne kompajlira i dokumenti bi se vidjeli samo na jednom ekranu (nedosljedan UX). Ovo je nužna integraciona "ljepilo"-izmjena (isti 4-redni snippet), NE scope creep. Ne uvodi novu funkcionalnost van faze.

- [ ] **Step 4: Verifikuj build + vizuelno**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: bez grešaka.
Zatim pokreni dev (svjež) i preko preview alata otvori `/termini`, klikni termin → sheet → sekcija "Dokumenti" pokazuje dugmad "Generiši zapisnik (AI)" + file input + "Upload"; klik "Generiši" doda AI red sa "AI" oznakom. Screenshot kao dokaz.

- [ ] **Step 5: Commit**

```bash
git add components/domain/DokumentiSekcija.tsx components/domain/TerminSheet.tsx "app/(dashboard)/termini/page.tsx" "app/(dashboard)/plan/page.tsx" "app/(dashboard)/prikaz/page.tsx"
git commit -m "feat(dokumenti): DokumentiSekcija u TerminSheet (upload + AI zapisnik + brisanje)"
```

---

### Task 6: KlijentTabs dokumenti tab + `/pregled` + DocxPreview

**Files:**
- Create: `components/domain/DocxPreview.tsx`
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx` (zamijeniti placeholder `tab === "dokumenti"` blok)
- Modify: `app/(dashboard)/pregled/page.tsx` (zamijeniti `ComingSoon`)

**Interfaces:**
- Consumes: `downloadDokument` + mammoth (server-side), `deleteDokumentAction` (T4), `dokumenti` + `termini_view`.
- Produces: `DocxPreview({ html }: { html: string })`; prava `/pregled` stranica; popunjen dokumenti tab.

- [ ] **Step 1: Napiši `components/domain/DocxPreview.tsx`**

```tsx
export function DocxPreview({ html }: { html: string }) {
  return (
    <div
      data-testid="docx-preview"
      className="prose prose-sm max-w-none rounded-xl border border-slate-200 bg-white p-6"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
```

> **Bezbjednost:** mammoth proizvodi čist semantički HTML (bez `<script>`) iz .docx. `DocxPreview` se koristi SAMO na `/pregled` koja filtrira `generated_by_ai = true` (sadržaj koji MI generišemo — kontrolisani izvor). Upload-ovani (proizvoljni) dokumenti su SAMO za download, NE preview-uju se. Ako se ikad doda preview upload-ovanog .docx, prvo dodati DOMPurify sanitizaciju. Konverzija je server-side (T-step 3).

- [ ] **Step 2: Popuni dokumenti tab u `klijenti/[id]/page.tsx`**

1. Dodaj tip uz ostale (vrh fajla):
```ts
type DokumentRow = Database["public"]["Tables"]["dokumenti"]["Row"]
```
2. NE diraj postojeći `Promise.all` (linije 33-38). Dohvati dokumente preko termina koje stranica VEĆ ima (`termini` iz `terminiRes`), bez embed-a. Odmah nakon `const lokacije = (lokacijeRes.data ?? []) as LokacijaRow[]` (linija 44) dodaj:
```ts
  const terminIdsKlijenta = termini.map((t) => t.id).filter((x): x is string => !!x)
  const { data: dokData } = terminIdsKlijenta.length
    ? await supabase
        .from("dokumenti")
        .select("*")
        .in("termin_id", terminIdsKlijenta)
        .order("uploaded_at", { ascending: false })
    : { data: [] }
  const dokumenti = (dokData ?? []) as DokumentRow[]
```
> Bez embed-a (dvostruka-FK problem) — reuse `termini` koje stranica već dohvaća; jedan dodatni upit, nije N+1.

3. Zamijeni placeholder blok `{tab === "dokumenti" && ( ... )}` (linije 139-146) sa:
```tsx
      {tab === "dokumenti" && (
        <div data-testid="tab-dokumenti-content" className="rounded-xl border border-slate-200 overflow-hidden">
          {dokumenti.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Nema dokumenata za ovog klijenta.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Naziv", "Tip", "Datum", ""].map((c) => (
                    <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dokumenti.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{d.naziv}</td>
                    <td className="px-3 py-2 text-slate-500">{d.generated_by_ai ? "AI zapisnik" : "Upload"}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{formatDatum(d.uploaded_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <a href={`/api/dokumenti/${d.id}`} className="text-brand hover:underline" data-testid="klijent-dokument-download">
                        Preuzmi
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
```

- [ ] **Step 3: Napiši pravu `/pregled` stranicu**

Zamijeni cijeli sadržaj `app/(dashboard)/pregled/page.tsx`:
```tsx
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { downloadDokument } from "@/lib/supabase/storage"
import { DocxPreview } from "@/components/domain/DocxPreview"
import { ObrisiDokumentButton } from "@/components/domain/ObrisiDokumentButton"
import { formatDatum } from "@/lib/date"
import mammoth from "mammoth"

export default async function PregledPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const previewId = typeof sp.preview === "string" ? sp.preview : null

  const supabase = await createServerSupabaseClient()
  const { data: dokData } = await supabase
    .from("dokumenti")
    .select("id, naziv, storage_path, uploaded_at, termin_id")
    .eq("generated_by_ai", true)
    .order("uploaded_at", { ascending: false })
  const dokRedovi = dokData ?? []

  // termini_view je VIEW → nema embed relacija u supabase-js; dohvat zasebnim upitom + mapa.
  const terminIds = [...new Set(dokRedovi.map((d) => d.termin_id))]
  const { data: terminiData } = terminIds.length
    ? await supabase.from("termini_view").select("id, klijent_naziv, vrsta_naziv").in("id", terminIds)
    : { data: [] }
  const terminMap = new Map((terminiData ?? []).map((t) => [t.id, t]))

  const dokumenti = dokRedovi.map((d) => ({
    ...d,
    klijent_naziv: terminMap.get(d.termin_id)?.klijent_naziv ?? null,
    vrsta_naziv: terminMap.get(d.termin_id)?.vrsta_naziv ?? null,
  }))

  // Preview: skini izabrani .docx i konvertuj u HTML (server-side).
  let previewHtml: string | null = null
  let previewNaziv: string | null = null
  if (previewId) {
    const { data: dok } = await supabase
      .from("dokumenti")
      .select("storage_path, naziv")
      .eq("id", previewId)
      .maybeSingle()
    if (dok) {
      const buffer = await downloadDokument(dok.storage_path)
      const result = await mammoth.convertToHtml({ buffer })
      previewHtml = result.value
      previewNaziv = dok.naziv
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Pregled — AI zapisnici</h1>

      {dokumenti.length === 0 ? (
        <div data-testid="pregled-prazno" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          Još nema AI-generisanih zapisnika. Generiši ih iz detalja termina.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm" data-testid="pregled-tabela">
            <thead className="bg-slate-50">
              <tr>
                {["Klijent", "Vrsta provjere", "Datum", "Akcije"].map((c) => (
                  <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dokumenti.map((d) => (
                <tr key={d.id} data-testid="pregled-red" className="border-t border-slate-100">
                  <td className="px-3 py-2">{d.klijent_naziv ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{d.vrsta_naziv ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">{formatDatum(d.uploaded_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <Link href={`/pregled?preview=${d.id}`} className="text-brand hover:underline" data-testid="pregled-preview">
                        Pregled
                      </Link>
                      <a href={`/api/dokumenti/${d.id}`} className="text-brand hover:underline" data-testid="pregled-download">
                        Preuzmi
                      </a>
                      <ObrisiDokumentButton dokumentId={d.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewHtml !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">{previewNaziv}</h2>
            <Link href="/pregled" className="text-sm text-slate-500 hover:text-slate-700" data-testid="pregled-zatvori">
              Zatvori pregled
            </Link>
          </div>
          <DocxPreview html={previewHtml} />
        </div>
      )}
    </div>
  )
}
```

> Gornji pristup (dva upita + `Map`) je već no-embed rješenje — view-ovi nemaju embed relacije u supabase-js, pa nema cast-a (`as unknown`) ni runtime greške. `terminiData` redovi su tipizirani iz `termini_view` selecta.

- [ ] **Step 4: Napiši `ObrisiDokumentButton` (mali client wrapper)**

Create `components/domain/ObrisiDokumentButton.tsx`:
```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { deleteDokumentAction, type ActionResult } from "@/app/(dashboard)/dokumenti/actions"

const initial: ActionResult = { ok: true }

export function ObrisiDokumentButton({ dokumentId }: { dokumentId: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(deleteDokumentAction, initial)
  const prev = useRef(state)
  useEffect(() => {
    if (state !== prev.current) {
      prev.current = state
      if (state.ok) router.refresh()
    }
  }, [state, router])
  return (
    <form action={action}>
      <input type="hidden" name="dokument_id" value={dokumentId} />
      <Button type="submit" variant="ghost" disabled={pending} data-testid="pregled-delete" aria-label="Obriši zapisnik">
        {pending ? "Brišem…" : "Obriši"}
      </Button>
      {state.ok === false && state.message && (
        <span className="ml-2 text-xs text-red-600" role="alert">{state.message}</span>
      )}
    </form>
  )
}
```

- [ ] **Step 5: Verifikuj build + vizuelno**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: bez grešaka.
Dev (svjež): otvori `/pregled` (nakon što generišeš bar 1 AI zapisnik) → tabela lista zapisnik; klik "Pregled" → mammoth HTML render. Otvori `/klijenti/<id>?tab=dokumenti` → lista. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add components/domain/DocxPreview.tsx components/domain/ObrisiDokumentButton.tsx "app/(dashboard)/klijenti/[id]/page.tsx" "app/(dashboard)/pregled/page.tsx"
git commit -m "feat(dokumenti): /pregled lista + DocxPreview (mammoth) + klijent dokumenti tab"
```

---

### Task 7: E2E + phase gate + tag

**Files:**
- Create: `tests/e2e/08-dokumenti.spec.ts`
- Modify: `playwright.config.ts` (dodati `webServer.env.ZAPISNIK_DRY_RUN = "1"`)

**Interfaces:**
- Consumes: sve prethodno. Testira upload (PDF buffer), AI generisanje (dry-run), preview (mammoth), download (route), brisanje.

- [ ] **Step 1: Forsiraj dry-run AI u E2E (playwright.config.ts)**

U `playwright.config.ts`, `webServer` objekat proširi `env`:
```ts
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ZAPISNIK_DRY_RUN: "1" },
  },
```
> Da bi flag imao efekta, gate pokreće E2E na **svježem serveru** (Step 4 ubija :3000 prije pokretanja). Reuse zastarjelog servera bez flag-a bi pozvao pravi Claude.

- [ ] **Step 2: Napiši `tests/e2e/08-dokumenti.spec.ts`**

```ts
import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

// Otvara prvi termin u listi i vraća njegov sheet locator.
async function otvoriPrviTermin(page: import("@playwright/test").Page) {
  await page.goto("/termini")
  const prviRed = page.getByTestId("termin-row").first()
  await expect(prviRed).toBeVisible()
  await prviRed.click()
  await expect(page.getByTestId("termin-sheet")).toBeVisible()
}

test.describe("Faza Dokumenti — termin sheet", () => {
  test("generiši AI zapisnik (dry-run) → pojavi se u listi sa AI oznakom", async ({ page }) => {
    await otvoriPrviTermin(page)
    await page.getByTestId("generisi-zapisnik").click()
    await expect(page.getByTestId("dokumenti-lista")).toBeVisible()
    await expect(page.getByTestId("dokument-ai-badge").first()).toBeVisible()
  })

  test("upload PDF → pojavi se u listi", async ({ page }) => {
    await otvoriPrviTermin(page)
    await page.getByTestId("dokument-file").setInputFiles({
      name: "potpisani-zapisnik.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%test\n"),
    })
    await page.getByTestId("dokument-upload-submit").click()
    await expect(
      page.getByTestId("dokument-red").filter({ hasText: "potpisani-zapisnik.pdf" }),
    ).toBeVisible()
  })

  test("download link vodi na fajl (HTTP 200)", async ({ page }) => {
    await otvoriPrviTermin(page)
    const link = page.getByTestId("dokument-download").first()
    await expect(link).toBeVisible()
    const href = await link.getAttribute("href")
    expect(href).toMatch(/^\/api\/dokumenti\//)
    const resp = await page.request.get(href!)
    expect(resp.status()).toBe(200)
  })
})

test.describe("Faza Dokumenti — /pregled", () => {
  test("AI zapisnik se vidi na /pregled i preview renderuje HTML", async ({ page }) => {
    await page.goto("/pregled")
    await expect(page.getByTestId("pregled-tabela")).toBeVisible()
    await page.getByTestId("pregled-preview").first().click()
    await expect(page.getByTestId("docx-preview")).toBeVisible()
    await expect(page.getByTestId("docx-preview")).toContainText("ZAPISNIK")
  })

  test("brisanje zapisnika ga uklanja iz liste", async ({ page }) => {
    await page.goto("/pregled")
    const prijeRedova = await page.getByTestId("pregled-red").count()
    expect(prijeRedova).toBeGreaterThan(0)
    await page.getByTestId("pregled-delete").first().click()
    await expect
      .poll(async () => page.getByTestId("pregled-red").count())
      .toBeLessThan(prijeRedova)
  })
})

test.describe("Faza Dokumenti — bez console grešaka", () => {
  test("nema console grešaka na /pregled", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/pregled")
    await expect(page.getByRole("heading", { name: /AI zapisnici/i })).toBeVisible()
    expect(errors).toEqual([])
  })
})
```
> Provjeri da postoji `data-testid="termin-row"` u `TerminiTable`; ako je drugačiji (npr. `termin-red`), uskladi helper. Provjeri da `formatDatum` podnosi `uploaded_at` (timestamptz ISO string) — ako prikazuje "—", skrati na `slice(0,10)` u page-u prije `formatDatum`.

- [ ] **Step 3: Pokreni samo 08 na svježem serveru**

Run:
```bash
lsof -ti :3000 | xargs kill 2>/dev/null; sleep 1
pnpm db:reset >/dev/null && pnpm seed >/dev/null
pnpm exec playwright test tests/e2e/08-dokumenti.spec.ts --workers=1
```
Expected: svi 08 testovi prolaze (chromium + webkit). Ako padne — dijagnoza root-cause (ne slabiti asertacije).

- [ ] **Step 4: PUN gate (svjež server)**

Run:
```bash
lsof -ti :3000 | xargs kill 2>/dev/null; sleep 1
pnpm db:reset >/dev/null && pnpm seed >/dev/null
pnpm build && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e
```
Expected: build ✅, lint ✅, tsc ✅, unit ✅, E2E (01–08) sve prolazi na chromium+webkit.

- [ ] **Step 5: Commit + tag**

```bash
git add tests/e2e/08-dokumenti.spec.ts playwright.config.ts
git commit -m "test(dokumenti): E2E upload/generate/preview/download/delete + dry-run gate"
git tag v0.8.0
git push origin main --tags
```

- [ ] **Step 6: Fresh-agent verifikacija + memorija**

Dispatch novi `claude` agent bez konteksta sa: repo putanja, spec link, ovaj plan, gate komande. Neka nezavisno potvrdi da faza radi (build/lint/tsc/unit/E2E na svježem serveru + ručni a–h smoke /pregled + termin dokumenti). Po prolazu, ažuriraj `project_tehpro_mvp.md` memoriju sa v0.8.0 unosom (firma/lokacija ostaje; dodaj: bucket, storage helper, lib/zapisnik dual-mode, /pregled, app-level cleanup, ANTHROPIC_API_KEY u .env.local prije produkcije ako se koristi pravi AI).

---

## Self-Review

**1. Spec coverage:**
- §4.1 dokumenti tabela → već postoji (T0/ranije); koristi se u T4/T5/T6 ✅
- §4.4 Storage cleanup trigger → NAMJERNO zamijenjen app-level (T4) + dokumentovano u Global Constraints ✅ (deviacija od spec-a — surface-ovati reviewer-u/useru)
- Storage bucket `tehpro-dokumenti` → T1 ✅
- Upload UI (`DokumentUpload`) → T5 `DokumentiSekcija` (file input + submit) ✅
- AI .docx generisanje → T3 (`lib/zapisnik`) + T4 (`generateZapisnikAction`) ✅
- `/pregled` lista + DocxPreview (mammoth) → T6 ✅
- KlijentTabs dokumenti tab → T6 ✅
- Termin "Dokumenti" sekcija + "Generiši zapisnik (AI)" → T5 ✅
- Download → T4 ruta `/api/dokumenti/[id]` ✅
- E2E (upload, preview, AI mock, download) → T7 `08-dokumenti.spec.ts` ✅
- Out-of-scope (versioning, pravi Claude chat tool, bulk export) → nije uključeno ✅

**2. Placeholder scan:** Nema "TODO/TBD". "Napomene za implementera" su tačne tehničke smjernice za eksterne lib edge-case-ove (embed kardinalnost, SDK tip), ne placeholderi za NAŠU logiku — svaki ima konkretan fallback.

**3. Type consistency:**
- `ActionResult` definisan u `app/(dashboard)/dokumenti/actions.ts` (T4), import-ovan u T5/T6 komponentama ✅
- `DokumentRow = Database["public"]["Tables"]["dokumenti"]["Row"]` konzistentno (T5, T6) ✅
- `ZapisnikInput`/`ZapisnikContent`/`ZapisnikData` lanac content→template→generate konzistentan (T3) ✅
- `signedUrl(path, { downloadName })`, `uploadDokument(path, body, contentType)`, `removeDokument(path)` potpisi isti u T2 definiciji i T4 pozivima ✅
- `generateZapisnik(input)` (generate.ts) vs `generateZapisnikAction` (server action) — različita imena, namjerno ✅
