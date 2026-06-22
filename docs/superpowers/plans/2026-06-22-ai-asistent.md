# Faza AI Asistent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat asistent na `/asistent` — Claude (`claude-sonnet-4-6`) streaming + tool-use nad postojećim podacima + konverzacija history u `chat_poruke`, sa two-step prijedlogom zapisnika.

**Architecture:** Bez Vercel AI SDK — direktno `@anthropic-ai/sdk`. Route handler (`app/api/chat/route.ts`) pokreće manual agentic loop (`client.messages.stream()` po koraku → `on("text")` → `finalMessage()` → ako `stop_reason==="tool_use"` izvrši tool-ove batch-om → `tool_result` → ponovi do `end_turn`) i streamuje klijentu **NDJSON** događaje (`text`/`tool`/`proposal`/`error`/`done`). Frontend čita `response.body.getReader()` i parsira NDJSON. Poruke se persistiraju u `chat_poruke`. Dual-mode: bez `ANTHROPIC_API_KEY` ili sa `CHAT_DRY_RUN=1` → deterministička mock NDJSON sekvenca (E2E).

**Tech Stack:** Next.js 16.2.9 (route handler streaming, RSC, Server Actions), React 19.2.4, TS strict, `@anthropic-ai/sdk@^0.105.0`, `@supabase/supabase-js`, Zod, Vitest, Playwright.

## Global Constraints

- **Next.js 16.2.9 / React 19 / TS strict.** Prije pisanja koda pročitati relevantni vodič u `node_modules/next/dist/docs/` (AGENTS.md — Next 16 breaking changes). Route handler za stream: `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"` (precedent `app/api/cron/reminders/route.ts`).
- **Model:** `claude-sonnet-4-6` (literal, isti kao `lib/zapisnik/generate.ts`). NE raditi prefill assistant poruke (adaptive thinking → 400).
- **Bez Vercel AI SDK.** Streaming je custom NDJSON preko `ReadableStream`. Anthropic SDK API (`messages.stream`, `on("text")`, `finalMessage()`, `stop_reason`, `content` blokovi `tool_use` sa `.id/.name/.input`) — **verifikovati tačne nazive protiv `node_modules/@anthropic-ai/sdk` (v0.105.0) prije pisanja**; `.input` je već deserijalizovan JSON.
- **Tool-ovi vraćaju BATCH (array), nikad jedan-po-jedan** (spec §289). Read preko `createServerSupabaseClient()` (server klijent), NE admin.
- **Tool-ovi su READ-ONLY.** `predloziZapisnik` vraća SAMO predloženi tekst (ne snima). Snimanje je **two-step**: korisnik klikne potvrdu → `snimiZapisnik` server action. (Nema auth u MVP — write iz chata bi mijenjao podatke bez ograničenja; zato samo eksplicitni user-potvrđeni write.)
- **suggestGrupisanje grupiše po klijentu** (`klijent_naziv`).
- **Konverzacija persistence:** svaka user + finalna assistant poruka se INSERT-uje u `chat_poruke` (`konverzacija_id`, `uloga`, `sadrzaj`, `alat_pozivi` jsonb). Sidebar lista razgovora + učitavanje po `konverzacija_id`. `konverzacija_id` je client-generisan `crypto.randomUUID()`.
- **NDJSON event protokol** (jedan JSON po liniji, `\n`-terminated): `{"type":"text","text":string}` · `{"type":"tool","tool":string,"label":string}` · `{"type":"proposal","terminId":string,"klijent":string,"vrsta":string,"datum":string,"nalaz":string,"zakljucak":string}` · `{"type":"error","message":string}` · `{"type":"done"}`.
- **Dual-mode mock:** `CHAT_DRY_RUN === "1"` ILI `!ANTHROPIC_API_KEY` → deterministička mock sekvenca. Playwright `webServer.env` postavlja `CHAT_DRY_RUN: "1"` (uz postojeći `ZAPISNIK_DRY_RUN`). **E2E gate MORA pokrenuti svjež server** (ubiti :3000 prije) — `reuseExistingServer` bi inače reusovao server bez flag-a i pozvao pravi API.
- **Namjerne razlike od spec teksta** (ne greške): tool `predloziZapisnik` (spec ga zove `generateZapisnik` — read-only odluka), `suggestGrupisanje` (spec `suggestGrouping`), E2E `09-asistent.spec.ts` (spec kaže `08-` ali je `08` zauzet od Dokumenti).
- **Poznata ograničenja (MVP, bez auth-a — dosljedno cijeloj app-i):** (1) `konverzacija_id` je client-generisan, bez ownership-a → svako sa id-em vidi razgovor (single-tenant prihvatljivo; pri uvođenju auth-a dodati `created_by`); (2) tool_result vraća DB sadržaj modelu — prompt-injection rizik nizak (interni single-tenant podaci); (3) `chat_poruke.sadrzaj` validiran samo na route nivou (zod max 4000), bez DB CHECK-a.
- **Desktop-only** (ESLint zabranjuje `sm:`/`md:`). ESLint zabranjuje `await` u petlji osim `scripts/` → tool-ove izvršavati `Promise.all`. Bosanski UI copy. Bez emojija osim postojećih. **Bez dummy podataka** (E2E koristi mock event stream + seedovane podatke).
- **Gate:** `pnpm build` + `pnpm lint` + `pnpm typecheck` + `pnpm test:unit` + `pnpm test:e2e` (chromium+webkit) na **SVJEŽEM serveru** (ubiti :3000 prije E2E) + fresh-agent verifikacija. Tag `v0.9.0`.

---

### Task 1: `lib/claude` — prompts + tools (defs + executors) + unit testovi

**Files:**
- Create: `lib/claude/prompts.ts`
- Create: `lib/claude/tools.ts`
- Create: `lib/claude/grouping.ts` (čista funkcija — unit-testabilna)
- Create: `lib/claude/grouping.test.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient` (`@/lib/supabase/server`), `generateZapisnik` (`@/lib/zapisnik/generate`), `Database` tipovi (`@/db/types`).
- Produces:
  - `SISTEM_PROMPT: string`
  - `type ToolName = "searchTermini" | "listFirme" | "predloziZapisnik" | "suggestGrupisanje"`
  - `TOOL_LABELS: Record<ToolName, string>`
  - `CHAT_TOOLS` — `Anthropic.Tool[]` (raw JSON input_schema)
  - `type ToolResult = { forModel: string; proposal?: ProposalData }` gdje `ProposalData = { terminId: string; klijent: string; vrsta: string; datum: string; nalaz: string; zakljucak: string }`
  - `async function executeTool(name: string, input: unknown): Promise<ToolResult>`
  - `grupisiPoKlijentu(termini: Array<{ klijent_naziv: string | null; status_izvedeni: string | null }>): Array<{ klijent: string; ukupno: number; kasni: number }>` (iz grouping.ts)

- [ ] **Step 1: Napiši čistu grouping funkciju test (RED)**

Create `lib/claude/grouping.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { grupisiPoKlijentu } from "./grouping"

describe("grupisiPoKlijentu", () => {
  it("grupiše po klijentu i broji ukupno + kasni", () => {
    const out = grupisiPoKlijentu([
      { klijent_naziv: "WAIKIKI", status_izvedeni: "kasni" },
      { klijent_naziv: "WAIKIKI", status_izvedeni: "planirano" },
      { klijent_naziv: "CARMEUSE", status_izvedeni: "kasni" },
      { klijent_naziv: null, status_izvedeni: "planirano" },
    ])
    const w = out.find((g) => g.klijent === "WAIKIKI")
    expect(w).toEqual({ klijent: "WAIKIKI", ukupno: 2, kasni: 1 })
    expect(out.find((g) => g.klijent === "CARMEUSE")).toEqual({ klijent: "CARMEUSE", ukupno: 1, kasni: 1 })
    expect(out.some((g) => g.klijent === "—")).toBe(true) // null → "—"
  })

  it("sortira po broju kasni opadajuće", () => {
    const out = grupisiPoKlijentu([
      { klijent_naziv: "A", status_izvedeni: "planirano" },
      { klijent_naziv: "B", status_izvedeni: "kasni" },
    ])
    expect(out[0]?.klijent).toBe("B")
  })
})
```

- [ ] **Step 2: Pokreni — mora pasti**

Run: `pnpm test:unit lib/claude/grouping.test.ts` → FAIL (`Cannot find module './grouping'`).

- [ ] **Step 3: Napiši `lib/claude/grouping.ts`**

```ts
export type GrupaKlijent = { klijent: string; ukupno: number; kasni: number }

/** Grupiše termine po klijentu; sortira po broju kasnih (pa po ukupno) opadajuće. */
export function grupisiPoKlijentu(
  termini: Array<{ klijent_naziv: string | null; status_izvedeni: string | null }>,
): GrupaKlijent[] {
  const map = new Map<string, GrupaKlijent>()
  for (const t of termini) {
    const klijent = t.klijent_naziv ?? "—"
    const g = map.get(klijent) ?? { klijent, ukupno: 0, kasni: 0 }
    g.ukupno += 1
    if (t.status_izvedeni === "kasni") g.kasni += 1
    map.set(klijent, g)
  }
  return [...map.values()].sort((a, b) => b.kasni - a.kasni || b.ukupno - a.ukupno)
}
```

- [ ] **Step 4: Pokreni — mora proći**

Run: `pnpm test:unit lib/claude/grouping.test.ts` → PASS (2 testa).

- [ ] **Step 5: Napiši `lib/claude/prompts.ts`**

```ts
export const SISTEM_PROMPT = `Ti si AI asistent firme Tehpro (Bosna i Hercegovina), koja pruža usluge zaštite na radu, zaštite od požara i zaštite životne sredine. Pomažeš timu da prati periodične preglede, ispitivanja i provjere kod klijenata.

Imaš pristup alatima nad stvarnim podacima:
- searchTermini: pretraga termina (po klijentu, statusu, datumskom rasponu)
- listFirme: lista klijenata (firmi) sa brojem aktivnih/kasnih termina
- suggestGrupisanje: grupisanje termina po klijentu (pregled obaveza po firmi)
- predloziZapisnik: priprema prijedlog teksta zapisnika za jedan termin

Pravila:
- Odgovaraj na bosanskom jeziku, kratko i profesionalno.
- Kad korisnik traži podatke, KORISTI alate — ne izmišljaj termine, firme ni brojeve.
- Za zapisnik OBAVEZNO koristi predloziZapisnik alat; on samo PREDLAŽE tekst — korisnik ga sam potvrđuje i snima dugmetom u interfejsu. Nikad ne tvrdi da si zapisnik sačuvao.
- Ako alat ne vrati rezultate, jasno to reci.`
```

- [ ] **Step 6: Napiši `lib/claude/tools.ts`**

> Prije pisanja: potvrdi tip `Anthropic.Tool` i oblik `input_schema` u `node_modules/@anthropic-ai/sdk` (v0.105.0). Ako tip nije izvezen kao `Anthropic.Tool`, koristi `import type { Tool } from "@anthropic-ai/sdk/resources/messages"`.

```ts
import Anthropic from "@anthropic-ai/sdk"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { generateZapisnik } from "@/lib/zapisnik/generate"
import { grupisiPoKlijentu } from "./grouping"

export type ToolName = "searchTermini" | "listFirme" | "predloziZapisnik" | "suggestGrupisanje"

export const TOOL_LABELS: Record<ToolName, string> = {
  searchTermini: "Pretražujem termine…",
  listFirme: "Pregledam firme…",
  suggestGrupisanje: "Grupišem termine po klijentu…",
  predloziZapisnik: "Pripremam prijedlog zapisnika…",
}

export type ProposalData = {
  terminId: string
  klijent: string
  vrsta: string
  datum: string
  nalaz: string
  zakljucak: string
}
export type ToolResult = { forModel: string; proposal?: ProposalData }

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "searchTermini",
    description:
      "Pretraži termine (preglede/provjere). Vrati listu termina sa klijentom, vrstom, lokacijom, rokom i statusom. Koristi za upite tipa 'koji termini kasne', 'termini za WAIKIKI', 'šta dospijeva ovog mjeseca'.",
    input_schema: {
      type: "object",
      properties: {
        pretraga: { type: "string", description: "Tekst za pretragu po nazivu klijenta ili lokacije (opcionalno)" },
        status: { type: "string", enum: ["kasni", "planirano", "zakazano", "izvrseno", "otkazano"], description: "Filter po statusu (opcionalno)" },
        limit: { type: "number", description: "Maks. broj rezultata (default 20)" },
      },
    },
  },
  {
    name: "listFirme",
    description:
      "Lista klijenata (firmi) sa brojem aktivnih, kasnih i izvršenih termina. Koristi za 'koje firme imamo', 'koja firma najviše kasni'.",
    input_schema: {
      type: "object",
      properties: {
        pretraga: { type: "string", description: "Tekst za pretragu po nazivu firme (opcionalno)" },
        limit: { type: "number", description: "Maks. broj rezultata (default 20)" },
      },
    },
  },
  {
    name: "suggestGrupisanje",
    description:
      "Grupiši aktivne (kasne/planirane/zakazane) termine po klijentu — pregled obaveza po firmi, sortirano po broju kasnih. Koristi za planiranje obilazaka po klijentu.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "predloziZapisnik",
    description:
      "Pripremi PRIJEDLOG teksta zapisnika za jedan termin (po termin_id, koji dobiješ iz searchTermini). Vraća nalaz i zaključak. NE snima — korisnik potvrđuje snimanje u interfejsu.",
    input_schema: {
      type: "object",
      properties: { termin_id: { type: "string", description: "UUID termina iz searchTermini rezultata" } },
      required: ["termin_id"],
    },
  },
]

const MAX = 20

export async function executeTool(name: string, input: unknown): Promise<ToolResult> {
  const args = (input ?? {}) as Record<string, unknown>
  const supabase = await createServerSupabaseClient()

  if (name === "searchTermini") {
    let q = supabase
      .from("termini_view")
      .select("id, klijent_naziv, vrsta_naziv, lokacija_naziv, lokacija_grad, rok_dospijeca, status_izvedeni, datum_izvrsenja")
      .order("rok_dospijeca", { ascending: true })
      .limit(typeof args.limit === "number" ? Math.min(args.limit, 50) : MAX)
    if (typeof args.pretraga === "string" && args.pretraga.trim()) {
      const p = args.pretraga.trim().replace(/[%,()*:."'\\]/g, "").slice(0, 50)
      q = q.or(`klijent_naziv.ilike.%${p}%,lokacija_naziv.ilike.%${p}%`)
    }
    if (typeof args.status === "string") q = q.eq("status_izvedeni", args.status)
    const { data, error } = await q
    if (error) return { forModel: `Greška pri pretrazi termina: ${error.message}` }
    return { forModel: JSON.stringify(data ?? []) }
  }

  if (name === "listFirme") {
    let q = supabase
      .from("klijenti_view")
      .select("id, naziv, broj_aktivnih, broj_kasni, broj_izvrseno, broj_termina, broj_lokacija")
      .order("broj_kasni", { ascending: false })
      .limit(typeof args.limit === "number" ? Math.min(args.limit, 50) : MAX)
    if (typeof args.pretraga === "string" && args.pretraga.trim()) {
      const p = args.pretraga.trim().replace(/[%,()*:."'\\]/g, "").slice(0, 50)
      q = q.ilike("naziv", `%${p}%`)
    }
    const { data, error } = await q
    if (error) return { forModel: `Greška pri listanju firmi: ${error.message}` }
    return { forModel: JSON.stringify(data ?? []) }
  }

  if (name === "suggestGrupisanje") {
    const { data, error } = await supabase
      .from("termini_view")
      .select("klijent_naziv, status_izvedeni")
      .neq("status_izvedeni", "izvrseno")
    if (error) return { forModel: `Greška pri grupisanju: ${error.message}` }
    return { forModel: JSON.stringify(grupisiPoKlijentu(data ?? [])) }
  }

  if (name === "predloziZapisnik") {
    const terminId = typeof args.termin_id === "string" ? args.termin_id : ""
    if (!terminId) return { forModel: "Nedostaje termin_id." }
    const { data: t } = await supabase
      .from("termini_view")
      .select("klijent_naziv, lokacija_naziv, vrsta_naziv, datum_izvrsenja")
      .eq("id", terminId)
      .maybeSingle()
    if (!t) return { forModel: "Termin sa tim ID-em ne postoji." }
    const datum = (t.datum_izvrsenja ?? new Date().toISOString()).slice(0, 10)
    const c = await generateZapisnik({
      klijent: t.klijent_naziv ?? "—",
      lokacija: t.lokacija_naziv ?? null,
      vrstaProvjere: t.vrsta_naziv ?? "—",
      datum,
      zaduzeni: null,
    })
    return {
      forModel: `Prijedlog zapisnika je pripremljen za ${t.klijent_naziv ?? "—"} (${t.vrsta_naziv ?? "—"}). Korisniku je prikazano dugme za snimanje. Ukratko prepričaj nalaz i zaključak i reci mu da klikne "Snimi zapisnik" ako želi sačuvati.`,
      proposal: {
        terminId,
        klijent: t.klijent_naziv ?? "—",
        vrsta: t.vrsta_naziv ?? "—",
        datum,
        nalaz: c.nalaz,
        zakljucak: c.zakljucak,
      },
    }
  }

  return { forModel: `Nepoznat alat: ${name}` }
}
```

- [ ] **Step 7: Verifikuj**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint` → unit prolaze, bez TS/lint grešaka.

- [ ] **Step 8: Commit**

```bash
git add lib/claude/
git commit -m "feat(asistent): lib/claude prompts + 4 tools (read-only) + grupisanje + unit testovi"
```

---

### Task 2: env `CHAT_DRY_RUN` + chat core (`lib/claude/chat.ts`) + mock + unit testovi

**Files:**
- Modify: `lib/env.ts` (dodati `CHAT_DRY_RUN`)
- Modify: `.env.local.example`
- Create: `lib/claude/mock.ts` (čista deterministička event sekvenca — unit-testabilna)
- Create: `lib/claude/mock.test.ts`
- Create: `lib/claude/chat.ts` (agentic loop, env+SDK)

**Interfaces:**
- Consumes: `env`, `@anthropic-ai/sdk`, `SISTEM_PROMPT`, `CHAT_TOOLS`, `TOOL_LABELS`, `executeTool`, `ProposalData` (T1).
- Produces:
  - `type ChatEvent = { type: "text"; text: string } | { type: "tool"; tool: string; label: string } | { type: "proposal" } & ... ` — koristi diskriminisanu uniju:
    `type ChatEvent = | { type: "text"; text: string } | { type: "tool"; tool: string; label: string } | { type: "proposal"; data: ProposalData } | { type: "error"; message: string } | { type: "done" }`
  - `type ChatTurn = { role: "user" | "assistant"; text: string }`
  - `function mockChatEvents(userText: string): ChatEvent[]` (iz mock.ts)
  - `function chatDryRun(): boolean`
  - `async function runChat(history: ChatTurn[], userText: string, onEvent: (e: ChatEvent) => void): Promise<{ assistantText: string; toolsUsed: string[] }>`

- [ ] **Step 1: Proširi `lib/env.ts`**

U `envSchema` poslije `ZAPISNIK_DRY_RUN: z.string().optional(),` dodaj:
```ts
  CHAT_DRY_RUN: z.string().optional(),
```
i u `safeParse({...})` poslije `ZAPISNIK_DRY_RUN: process.env.ZAPISNIK_DRY_RUN,`:
```ts
  CHAT_DRY_RUN: process.env.CHAT_DRY_RUN,
```

- [ ] **Step 2: `.env.local.example`** — ispod `ZAPISNIK_DRY_RUN=` dodaj:
```bash
# Postavi na "1" da forsiraš mock chat odgovore (E2E ga postavlja automatski)
CHAT_DRY_RUN=
```

- [ ] **Step 3: Napiši mock test (RED)**

Create `lib/claude/mock.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { mockChatEvents } from "./mock"

describe("mockChatEvents", () => {
  it("uvijek završava 'done' i sadrži bar jedan 'text'", () => {
    const ev = mockChatEvents("koji termini kasne?")
    expect(ev.at(-1)).toEqual({ type: "done" })
    expect(ev.some((e) => e.type === "text")).toBe(true)
  })

  it("za upit o zapisniku emituje 'tool' i 'proposal'", () => {
    const ev = mockChatEvents("napravi zapisnik za prvi termin")
    expect(ev.some((e) => e.type === "tool")).toBe(true)
    const prop = ev.find((e) => e.type === "proposal")
    expect(prop && prop.type === "proposal" && prop.data.terminId).toBeTruthy()
  })

  it("za ostale upite emituje 'tool' (pretraga)", () => {
    const ev = mockChatEvents("prikaži firme")
    expect(ev.some((e) => e.type === "tool")).toBe(true)
  })
})
```

- [ ] **Step 4: Pokreni — mora pasti**

Run: `pnpm test:unit lib/claude/mock.test.ts` → FAIL.

- [ ] **Step 5: Napiši `lib/claude/mock.ts`**

```ts
import type { ChatEvent } from "./chat"

/** Deterministička mock sekvenca za E2E / rad bez ANTHROPIC_API_KEY.
 *  Ne poziva mrežu; grana se po ključnim riječima u upitu. */
export function mockChatEvents(userText: string): ChatEvent[] {
  const t = userText.toLowerCase()
  const wantsZapisnik = /zapisnik/.test(t)

  if (wantsZapisnik) {
    return [
      { type: "tool", tool: "predloziZapisnik", label: "Pripremam prijedlog zapisnika…" },
      { type: "text", text: "Pripremio sam prijedlog zapisnika. " },
      { type: "text", text: "Pogledaj nalaz i zaključak ispod pa klikni „Snimi zapisnik“ ako želiš sačuvati." },
      {
        type: "proposal",
        data: {
          terminId: "00000000-0000-0000-0000-000000000000",
          klijent: "Demo klijent",
          vrsta: "Demo provjera",
          datum: "2026-06-22",
          nalaz: "Mock nalaz za potrebe testiranja.",
          zakljucak: "Mock zaključak.",
        },
      },
      { type: "done" },
    ]
  }

  return [
    { type: "tool", tool: "searchTermini", label: "Pretražujem termine…" },
    { type: "text", text: "Evo pregleda na osnovu trenutnih podataka. " },
    { type: "text", text: "Pitaj me dalje za detalje o terminima ili firmama." },
    { type: "done" },
  ]
}
```

> NAPOMENA: mock `proposal.terminId` je all-zeros UUID; `snimiZapisnik` action (T3) mora to tretirati kao "termin ne postoji" i vratiti grešku (E2E test za confirm provjerava da dugme postoji i da klik vrati kontrolisanu poruku, bez stvarnog upisa — vidi T6). Ne koristiti dummy podatke u stvarnom putu.

- [ ] **Step 6: Pokreni — mora proći**

Run: `pnpm test:unit lib/claude/mock.test.ts` → PASS (3 testa).

- [ ] **Step 7: Napiši `lib/claude/chat.ts`**

> Prije pisanja: potvrdi u `node_modules/@anthropic-ai/sdk` (v0.105.0) da postoje `client.messages.stream(...)`, `.on("text", cb)`, `await stream.finalMessage()`, i da finalMessage ima `.stop_reason` i `.content` (blokovi sa `type`, a `tool_use` blok ima `.id/.name/.input`). Ako se imena razlikuju, prilagodi minimalno i zabilježi.

```ts
import Anthropic from "@anthropic-ai/sdk"
import { env } from "@/lib/env"
import { SISTEM_PROMPT } from "./prompts"
import { CHAT_TOOLS, TOOL_LABELS, executeTool, type ToolName, type ProposalData } from "./tools"
import { mockChatEvents } from "./mock"

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; label: string }
  | { type: "proposal"; data: ProposalData }
  | { type: "error"; message: string }
  | { type: "done" }

export type ChatTurn = { role: "user" | "assistant"; text: string }

export function chatDryRun(): boolean {
  return env.CHAT_DRY_RUN === "1" || !env.ANTHROPIC_API_KEY
}

const MAX_KORACI = 5

export async function runChat(
  history: ChatTurn[],
  userText: string,
  onEvent: (e: ChatEvent) => void,
): Promise<{ assistantText: string; toolsUsed: string[] }> {
  if (chatDryRun()) {
    let txt = ""
    const tools: string[] = []
    for (const e of mockChatEvents(userText)) {
      if (e.type === "text") txt += e.text
      if (e.type === "tool") tools.push(e.tool)
      onEvent(e)
    }
    return { assistantText: txt, toolsUsed: tools }
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: userText },
  ]

  let assistantText = ""
  const toolsUsed: string[] = []

  for (let korak = 0; korak < MAX_KORACI; korak++) {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SISTEM_PROMPT,
      tools: CHAT_TOOLS,
      messages,
    })
    stream.on("text", (delta) => {
      assistantText += delta
      onEvent({ type: "text", text: delta })
    })
    // eslint-disable-next-line no-await-in-loop -- agentic loop: svaki korak zavisi od prethodnog tool_result-a (ne može Promise.all)
    const msg = await stream.finalMessage()

    const toolUses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    )
    if (msg.stop_reason !== "tool_use" || toolUses.length === 0) break

    // Indikatori (batch) + izvrši sve tool-ove paralelno
    for (const tu of toolUses) {
      toolsUsed.push(tu.name)
      onEvent({ type: "tool", tool: tu.name, label: TOOL_LABELS[tu.name as ToolName] ?? "Radim…" })
    }
    // eslint-disable-next-line no-await-in-loop -- tool-ovi za OVAJ korak; sljedeći korak zavisi od ovih rezultata
    const results = await Promise.all(toolUses.map((tu) => executeTool(tu.name, tu.input)))
    results.forEach((r) => { if (r.proposal) onEvent({ type: "proposal", data: r.proposal }) })

    messages.push({ role: "assistant", content: msg.content })
    messages.push({
      role: "user",
      content: toolUses.map((tu, i) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: results[i]?.forModel ?? "",
      })),
    })
  }

  onEvent({ type: "done" })
  return { assistantText, toolsUsed }
}
```

- [ ] **Step 8: Verifikuj**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint` → unit prolaze; bez TS/lint grešaka.
> Ako TS prijavi da `Anthropic.ToolUseBlock`/`Anthropic.MessageParam` nisu izvezeni pod tim imenima, importuj iz `@anthropic-ai/sdk/resources/messages` ili koristi strukturni guard (`b.type === "tool_use"` + cast na `{ id: string; name: string; input: unknown }`). Zabilježi u report.

- [ ] **Step 9: Commit**

```bash
git add lib/env.ts .env.local.example lib/claude/mock.ts lib/claude/mock.test.ts lib/claude/chat.ts
git commit -m "feat(asistent): CHAT_DRY_RUN env + runChat agentic loop + deterministički mock + testovi"
```

---

### Task 3: `app/api/chat/route.ts` (streaming NDJSON + persistence) + `snimiZapisnik` action

**Files:**
- Create: `app/api/chat/route.ts`
- Create: `app/(dashboard)/asistent/actions.ts`

**Interfaces:**
- Consumes: `runChat`, `ChatTurn`, `ChatEvent` (T2); `createServerSupabaseClient`; `buildZapisnikDocx` (`@/lib/zapisnik/template`); `uploadDokument` (`@/lib/supabase/storage`); `ActionResult`.
- Produces:
  - POST `/api/chat` — body `{ konverzacija_id: string; userText: string; history: ChatTurn[] }` → `Response` (NDJSON stream, `Content-Type: application/x-ndjson`). Persistira user + assistant poruke u `chat_poruke`.
  - `snimiZapisnik(prev: ActionResult, formData: FormData): Promise<ActionResult>` — polja `termin_id`, `nalaz`, `zakljucak`.

- [ ] **Step 1: Napiši `app/api/chat/route.ts`**

```ts
import { z } from "zod"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { runChat, type ChatTurn, type ChatEvent } from "@/lib/claude/chat"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const bodySchema = z.object({
  konverzacija_id: z.string().uuid(),
  userText: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }))
    .max(40)
    .default([]),
})

export async function POST(req: Request): Promise<Response> {
  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await req.json())
  } catch {
    return new Response(JSON.stringify({ error: "Neispravan zahtjev" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }
  const { konverzacija_id, userText, history } = parsed

  const supabase = await createServerSupabaseClient()
  // Persist user poruku odmah (prije streama)
  await supabase.from("chat_poruke").insert({ konverzacija_id, uloga: "user", sadrzaj: userText })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"))
      try {
        const { assistantText, toolsUsed } = await runChat(history as ChatTurn[], userText, send)
        // Persist assistant poruku (sa korištenim alatima u alat_pozivi)
        await supabase.from("chat_poruke").insert({
          konverzacija_id,
          uloga: "assistant",
          sadrzaj: assistantText || "(bez teksta)",
          alat_pozivi: toolsUsed.length ? toolsUsed : null,
        })
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "Greška asistenta" })
        send({ type: "done" })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  })
}
```

- [ ] **Step 2: Napiši `app/(dashboard)/asistent/actions.ts`**

```ts
'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { buildZapisnikDocx } from "@/lib/zapisnik/template"
import { uploadDokument, removeDokument } from "@/lib/supabase/storage"

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

const schema = z.object({
  termin_id: z.string().uuid("Neispravan termin"),
  nalaz: z.string().min(1).max(8000),
  zakljucak: z.string().min(1).max(8000),
})

/** Two-step potvrda: snima predloženi (AI) zapisnik kao .docx u Storage + dokumenti red. */
export async function snimiZapisnik(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { termin_id, nalaz, zakljucak } = parsed.data

  const supabase = await createServerSupabaseClient()
  const { data: t } = await supabase
    .from("termini_view")
    .select("klijent_id, klijent_naziv, lokacija_naziv, vrsta_naziv, datum_izvrsenja")
    .eq("id", termin_id)
    .maybeSingle()
  if (!t) return { ok: false, message: "Termin ne postoji." }

  const datum = (t.datum_izvrsenja ?? new Date().toISOString()).slice(0, 10)
  const docx = await buildZapisnikDocx({
    klijent: t.klijent_naziv ?? "—",
    lokacija: t.lokacija_naziv ?? null,
    vrstaProvjere: t.vrsta_naziv ?? "—",
    datum,
    zaduzeni: null,
    nalaz,
    zakljucak,
  })
  const naziv = `Zapisnik - ${t.vrsta_naziv ?? "provjera"} - ${datum}.docx`
  const path = `termini/${termin_id}/zapisnik-${crypto.randomUUID()}.docx`

  try {
    await uploadDokument(path, docx, DOCX_MIME)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Snimanje nije uspjelo." }
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
      await removeDokument(path) // rollback fajla ako DB upis padne (kao generateZapisnikAction)
    } catch (e) {
      console.error("Rollback brisanja fajla nije uspio (orphan):", e)
    }
    return { ok: false, message: error.message }
  }

  revalidatePath("/pregled")
  if (t.klijent_id) revalidatePath(`/klijenti/${t.klijent_id}`)
  return { ok: true }
}
```

- [ ] **Step 3: Verifikuj**

Run: `pnpm typecheck && pnpm lint && pnpm build` → bez grešaka. Route + action se end-to-end testiraju u T6 (mock) i ručno (pravi AI).

- [ ] **Step 4: Commit**

```bash
git add "app/api/chat/route.ts" "app/(dashboard)/asistent/actions.ts"
git commit -m "feat(asistent): /api/chat NDJSON streaming + persistence + snimiZapisnik two-step action"
```

---

### Task 4: Chat UI komponente + streaming klijent hook

**Files:**
- Create: `components/domain/ChatMessage.tsx`
- Create: `components/domain/ChatInput.tsx`
- Create: `components/domain/SuggestedPills.tsx`
- Create: `components/domain/AsistentChat.tsx` (client orchestrator — drži state, čita stream, renderuje)

**Interfaces:**
- Consumes: `ChatEvent`/`ChatTurn` tipovi (re-deklarisani lokalno ili importovani iz `@/lib/claude/chat` — chat.ts nema "use server"/"server-only", ali importuje env; **da klijent ne povuče env, deklariši lake tipove lokalno u AsistentChat** umjesto importa iz chat.ts), `snimiZapisnik` (T3 action), `ProposalData`.
- Produces: `AsistentChat({ konverzacijaId, pocetnePoruke }: { konverzacijaId: string; pocetnePoruke: UiPoruka[] })` gdje `type UiPoruka = { role: "user" | "assistant"; text: string; proposal?: ProposalData; tools?: string[] }`.

> KRITIČNO: NE importuj iz `lib/claude/chat.ts` u klijentske komponente (povlači `@/lib/env` → curi server env u bundle + build greška). Deklariši `type ProposalData` i `type UiPoruka` lokalno u `AsistentChat.tsx`.

- [ ] **Step 1: `components/domain/SuggestedPills.tsx`**

```tsx
"use client"

const PITANJA = [
  "Koji termini kasne?",
  "Koje firme imamo i koliko kasne?",
  "Grupiši aktivne termine po klijentu",
] as const

export function SuggestedPills({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="suggested-pills">
      {PITANJA.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          data-testid="suggested-pill"
          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
        >
          {p}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: `components/domain/ChatInput.tsx`**

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

export function ChatInput({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("")
  function submit() {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText("")
  }
  return (
    <form
      className="flex items-end gap-2"
      data-testid="chat-input-form"
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit() } }}
        placeholder="Napiši pitanje…"
        rows={2}
        data-testid="chat-input"
        className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <Button type="submit" disabled={disabled} data-testid="chat-send">Pošalji</Button>
    </form>
  )
}
```

- [ ] **Step 3: `components/domain/ChatMessage.tsx`**

```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { snimiZapisnik, type ActionResult } from "@/app/(dashboard)/asistent/actions"

export type ProposalData = {
  terminId: string; klijent: string; vrsta: string; datum: string; nalaz: string; zakljucak: string
}
export type UiPoruka = { role: "user" | "assistant"; text: string; proposal?: ProposalData; tools?: string[] }

const initial: ActionResult = { ok: true }

function ZapisnikProposal({ p }: { p: ProposalData }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(snimiZapisnik, initial)
  const prev = useRef(state)
  useEffect(() => {
    if (state !== prev.current) { prev.current = state; if (state.ok) router.refresh() }
  }, [state, router])
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3" data-testid="zapisnik-proposal">
      <p className="text-xs uppercase tracking-wide text-slate-400">Prijedlog zapisnika · {p.klijent} · {p.vrsta}</p>
      <p className="mt-1 text-sm"><span className="font-medium">Nalaz:</span> {p.nalaz}</p>
      <p className="mt-1 text-sm"><span className="font-medium">Zaključak:</span> {p.zakljucak}</p>
      <form action={action} className="mt-2">
        <input type="hidden" name="termin_id" value={p.terminId} />
        <input type="hidden" name="nalaz" value={p.nalaz} />
        <input type="hidden" name="zakljucak" value={p.zakljucak} />
        <Button type="submit" disabled={pending} data-testid="snimi-zapisnik">
          {pending ? "Snimam…" : "Snimi zapisnik"}
        </Button>
        {state.ok === false && state.message && (
          <span className="ml-2 text-xs text-red-600" role="alert">{state.message}</span>
        )}
        {state.ok && prev.current !== initial && (
          <span className="ml-2 text-xs text-green-600" data-testid="zapisnik-snimljen">Snimljeno ✓</span>
        )}
      </form>
    </div>
  )
}

export function ChatMessage({ poruka }: { poruka: UiPoruka }) {
  const isUser = poruka.role === "user"
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"} data-testid={`msg-${poruka.role}`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${isUser ? "bg-brand text-white" : "bg-brand-light text-slate-800"}`}>
        {poruka.tools && poruka.tools.length > 0 && (
          <p className="mb-1 text-xs italic text-slate-500" data-testid="tool-indikator">
            Alati: {poruka.tools.join(", ")}
          </p>
        )}
        <p className="whitespace-pre-wrap">{poruka.text || (isUser ? "" : "…")}</p>
        {poruka.proposal && <ZapisnikProposal p={poruka.proposal} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `components/domain/AsistentChat.tsx`** (orchestrator)

```tsx
"use client"

import { useRef, useState } from "react"
import { ChatMessage, type UiPoruka, type ProposalData } from "@/components/domain/ChatMessage"
import { ChatInput } from "@/components/domain/ChatInput"
import { SuggestedPills } from "@/components/domain/SuggestedPills"

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; label: string }
  | { type: "proposal"; data: ProposalData }
  | { type: "error"; message: string }
  | { type: "done" }

export function AsistentChat({
  konverzacijaId,
  pocetnePoruke,
}: {
  konverzacijaId: string
  pocetnePoruke: UiPoruka[]
}) {
  const [poruke, setPoruke] = useState<UiPoruka[]>(pocetnePoruke)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  function scrollDown() {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
  }

  async function send(userText: string) {
    if (busy) return
    setBusy(true)
    const history = poruke.map((p) => ({ role: p.role, text: p.text }))
    setPoruke((prev) => [...prev, { role: "user", text: userText }, { role: "assistant", text: "", tools: [] }])
    scrollDown()

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ konverzacija_id: konverzacijaId, userText, history }),
      })
      if (!res.body) throw new Error("Nema stream-a")
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      // eslint-disable-next-line no-await-in-loop
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        buf += decoder.decode(chunk.value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          let ev: StreamEvent
          try { ev = JSON.parse(line) as StreamEvent } catch { continue } // preskoči nevalidnu/parcijalnu liniju
          setPoruke((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (!last || last.role !== "assistant") return prev
            if (ev.type === "text") last.text += ev.text
            else if (ev.type === "tool") last.tools = [...(last.tools ?? []), ev.tool]
            else if (ev.type === "proposal") last.proposal = ev.data
            else if (ev.type === "error") last.text += `\n[Greška: ${ev.message}]`
            return next
          })
          scrollDown()
        }
      }
    } catch (e) {
      setPoruke((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.role === "assistant") last.text += `\n[Greška veze: ${e instanceof Error ? e.message : "nepoznato"}]`
        return next
      })
    } finally {
      setBusy(false)
      scrollDown()
    }
  }

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-2" data-testid="chat-poruke">
        {poruke.length === 0 && (
          <p className="text-sm text-slate-500">Postavi pitanje o terminima, firmama ili zatraži prijedlog zapisnika.</p>
        )}
        {poruke.map((p, i) => <ChatMessage key={i} poruka={p} />)}
      </div>
      <div className="space-y-2 border-t border-slate-200 pt-3">
        {poruke.length === 0 && <SuggestedPills onPick={send} />}
        <ChatInput disabled={busy} onSend={send} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verifikuj**

Run: `pnpm typecheck && pnpm lint && pnpm build` → bez grešaka (posebno: nijedan klijentski fajl ne importuje `@/lib/env` direktno ili tranzitivno).

- [ ] **Step 6: Commit**

```bash
git add components/domain/ChatMessage.tsx components/domain/ChatInput.tsx components/domain/SuggestedPills.tsx components/domain/AsistentChat.tsx
git commit -m "feat(asistent): chat UI (ChatMessage/ChatInput/SuggestedPills/AsistentChat) + NDJSON stream reader"
```

---

### Task 5: `/asistent` stranica — sidebar (lista razgovora) + chat + učitavanje konverzacije

**Files:**
- Modify: `app/(dashboard)/asistent/page.tsx` (zamijeniti ComingSoon)
- Create: `components/domain/NoviRazgovorButton.tsx` (client — generiše novi `konverzacija_id` i navigira)

**Interfaces:**
- Consumes: `createServerSupabaseClient`; `AsistentChat` (+ `UiPoruka`); `chat_poruke` tabela.
- Produces: server stranica koja čita `?k=<konverzacija_id>` (učita poruke te konverzacije) + sidebar listu razgovora (distinct konverzacija_id sa prvom user porukom).

- [ ] **Step 1: `components/domain/NoviRazgovorButton.tsx`**

```tsx
"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function NoviRazgovorButton() {
  const router = useRouter()
  return (
    <Button
      variant="outline"
      data-testid="novi-razgovor"
      onClick={() => router.push(`/asistent?k=${crypto.randomUUID()}`)}
    >
      + Novi razgovor
    </Button>
  )
}
```

- [ ] **Step 2: Zamijeni `app/(dashboard)/asistent/page.tsx`**

```tsx
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { AsistentChat } from "@/components/domain/AsistentChat"
import { NoviRazgovorButton } from "@/components/domain/NoviRazgovorButton"
import type { UiPoruka, ProposalData } from "@/components/domain/ChatMessage"
import type { Database } from "@/db/types"

type PorukaRow = Database["public"]["Tables"]["chat_poruke"]["Row"]

export default async function AsistentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const aktivni = typeof sp.k === "string" ? sp.k : null

  const supabase = await createServerSupabaseClient()

  // Sidebar: prva user poruka po konverzaciji (distinct on)
  const { data: sve } = await supabase
    .from("chat_poruke")
    .select("konverzacija_id, uloga, sadrzaj, created_at")
    .order("created_at", { ascending: true })
  const razgovoriMap = new Map<string, { id: string; naslov: string; created_at: string }>()
  for (const r of sve ?? []) {
    if (!razgovoriMap.has(r.konverzacija_id) && r.uloga === "user") {
      razgovoriMap.set(r.konverzacija_id, {
        id: r.konverzacija_id,
        naslov: r.sadrzaj.slice(0, 60),
        created_at: r.created_at,
      })
    }
  }
  const razgovori = [...razgovoriMap.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))

  // Učitaj poruke aktivne konverzacije
  let pocetnePoruke: UiPoruka[] = []
  if (aktivni) {
    const poruke = (sve ?? []).filter((p) => p.konverzacija_id === aktivni)
    pocetnePoruke = poruke.map((p): UiPoruka => ({
      role: p.uloga as "user" | "assistant",
      text: p.sadrzaj,
    }))
  }

  // Bez ?k → koristi novi nasumični id (klijent generiše tek na slanje; ovdje placeholder preko linka)
  return (
    <div className="grid grid-cols-[260px_1fr] gap-4">
      <aside className="space-y-3 border-r border-slate-200 pr-4" data-testid="razgovori-sidebar">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-600">Razgovori</h2>
          <NoviRazgovorButton />
        </div>
        <ul className="space-y-1">
          {razgovori.length === 0 && <li className="text-xs text-slate-400">Nema razgovora.</li>}
          {razgovori.map((r) => (
            <li key={r.id}>
              <Link
                href={`/asistent?k=${r.id}`}
                data-testid="razgovor-link"
                className={`block truncate rounded-md px-2 py-1 text-sm hover:bg-slate-50 ${r.id === aktivni ? "bg-slate-100 font-medium" : "text-slate-600"}`}
              >
                {r.naslov || "Razgovor"}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section>
        <h1 className="mb-3 text-2xl font-semibold">Asistent</h1>
        {aktivni ? (
          <AsistentChat key={aktivni} konverzacijaId={aktivni} pocetnePoruke={pocetnePoruke} />
        ) : (
          <NoviRazgovorChat />
        )}
      </section>
    </div>
  )
}

// Kad nema ?k, generiši novi konverzacija_id na klijentu i odmah pokaži prazan chat.
function NoviRazgovorChat() {
  return (
    <div data-testid="prazan-asistent" className="rounded-xl border border-slate-200 p-6 text-sm text-slate-500">
      Klikni „+ Novi razgovor“ za početak, ili izaberi postojeći razgovor lijevo.
    </div>
  )
}
```

> ProposalData import je tip-only (zadovoljava lint `no-unused-vars` samo ako se koristi — ako ostane neiskorišten, ukloni ga; UiPoruka je dovoljan). Učitane stare poruke ne re-emituju `proposal` (proposal živi samo u živom streamu) — to je prihvatljivo za MVP (snimljeni zapisnik se vidi na /pregled).

- [ ] **Step 3: Verifikuj (build + vizuelno)**

Run: `pnpm typecheck && pnpm lint && pnpm build`.
Zatim dev (svjež): otvori `/asistent` → klikni „+ Novi razgovor“ → URL dobije `?k=<uuid>` → upiši „Koji termini kasne?“ → pošalji → assistant poruka se streamuje, tool indikator se pojavi. Provjeri `preview_console_logs` (bez grešaka) + screenshot.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/asistent/page.tsx" components/domain/NoviRazgovorButton.tsx
git commit -m "feat(asistent): /asistent stranica — sidebar razgovori + chat + učitavanje konverzacije"
```

---

### Task 6: E2E `09-asistent.spec.ts` + phase gate + tag

**Files:**
- Create: `tests/e2e/09-asistent.spec.ts`
- Modify: `playwright.config.ts` (`webServer.env` dodati `CHAT_DRY_RUN: "1"`)

**Interfaces:**
- Consumes: sve prethodno (mock put preko `CHAT_DRY_RUN`).

- [ ] **Step 1: playwright.config.ts** — `webServer.env` proširi:
```ts
    env: { ZAPISNIK_DRY_RUN: "1", CHAT_DRY_RUN: "1" },
```

- [ ] **Step 2: Napiši `tests/e2e/09-asistent.spec.ts`**

```ts
import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.describe("Faza 8 — AI Asistent (mock)", () => {
  test("novi razgovor → poruka → streaming odgovor + tool indikator", async ({ page }) => {
    await page.goto("/asistent")
    await page.getByTestId("novi-razgovor").click()
    await expect(page).toHaveURL(/\/asistent\?k=/)
    await page.getByTestId("chat-input").fill("Koji termini kasne?")
    await page.getByTestId("chat-send").click()
    // user poruka
    await expect(page.getByTestId("msg-user").last()).toContainText("Koji termini kasne?")
    // assistant tekst (mock) + tool indikator
    await expect(page.getByTestId("msg-assistant").last()).toContainText("pregled", { timeout: 10000 })
    await expect(page.getByTestId("tool-indikator").last()).toBeVisible()
  })

  test("upit za zapisnik → prijedlog sa dugmetom 'Snimi zapisnik'", async ({ page }) => {
    await page.goto("/asistent")
    await page.getByTestId("novi-razgovor").click()
    await page.getByTestId("chat-input").fill("Napravi zapisnik za prvi termin")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("zapisnik-proposal")).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId("snimi-zapisnik")).toBeVisible()
    // mock proposal koristi nepostojeći termin → klik vraća kontrolisanu grešku (bez upisa)
    await page.getByTestId("snimi-zapisnik").click()
    await expect(page.getByText(/Termin ne postoji|Snimljeno/)).toBeVisible({ timeout: 10000 })
  })

  test("follow-up poruka u istom razgovoru", async ({ page }) => {
    await page.goto("/asistent")
    await page.getByTestId("novi-razgovor").click()
    await page.getByTestId("chat-input").fill("Prikaži firme")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("msg-assistant").last()).toContainText("pregled", { timeout: 10000 })
    await page.getByTestId("chat-input").fill("A koji kasne?")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("msg-user")).toHaveCount(2)
  })

  test("razgovor se pojavi u sidebar listi nakon poruke", async ({ page }) => {
    await page.goto("/asistent")
    await page.getByTestId("novi-razgovor").click()
    await page.getByTestId("chat-input").fill("Test sidebar poruka")
    await page.getByTestId("chat-send").click()
    await expect(page.getByTestId("msg-assistant").last()).toBeVisible({ timeout: 10000 })
    await page.reload()
    await expect(page.getByTestId("razgovor-link").filter({ hasText: "Test sidebar poruka" })).toBeVisible()
  })

  test("nema console grešaka na /asistent", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/asistent")
    await expect(page.getByRole("heading", { name: "Asistent" })).toBeVisible()
    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 3: Pokreni 09 na svježem serveru**

```bash
lsof -ti :3000 | xargs kill 2>/dev/null; sleep 1
pnpm db:reset >/dev/null && pnpm seed >/dev/null
pnpm exec playwright test tests/e2e/09-asistent.spec.ts --workers=1
```
Expected: svi prolaze (chromium+webkit). Root-cause svaki pad (ne slabiti asertacije).

- [ ] **Step 4: PUN gate (svjež server)**

```bash
lsof -ti :3000 | xargs kill 2>/dev/null; sleep 1
pnpm db:reset >/dev/null && pnpm seed >/dev/null
pnpm build && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e
```
Expected: build/lint/tsc ✅, unit ✅, E2E (01–09, chromium+webkit) ✅.

- [ ] **Step 5: Commit (NE tagovati/pushati — čeka final review)**

```bash
git add tests/e2e/09-asistent.spec.ts playwright.config.ts
git commit -m "test(asistent): E2E streaming + tool indikator + zapisnik prijedlog + sidebar (CHAT_DRY_RUN)"
```

- [ ] **Step 6: Final whole-branch review + tag**

Controller: dispatch final code-reviewer (opus). Po prolazu: `git tag v0.9.0 && git push origin main --tags`, pa ažuriraj memoriju (v0.9.0). Prije produkcije: AI asistent koristi pravi ANTHROPIC_API_KEY (već u .env.local; potvrditi ručno jednim pravim upitom kao u Fazi Dokumenti).

---

## Self-Review

**1. Spec coverage:**
- Claude SDK + streaming → T2 runChat (`.stream()`) + T3 NDJSON route ✅
- 3-4 tools (searchTermini, listFirme, generateZapisnik→predloziZapisnik, suggestGrouping→suggestGrupisanje) → T1 ✅
- chat UI (poruke, streaming, tool indikatori) → T4 ✅ (ChatMessage tool-indikator, AsistentChat stream reader)
- konverzacija history → T3 persistence + T5 sidebar/učitavanje ✅
- app/api/chat/route.ts + lib/claude/{tools,prompts}.ts → T1/T3 ✅
- ChatMessage/ChatInput/SuggestedPills → T4 ✅
- tool vraća batch (array) → T1 (svi vraćaju JSON array; loop izvršava Promise.all) ✅
- E2E (streaming, tool call, follow-up) → T6 (09, ne 08 — zauzeto) ✅
- Out-of-scope: write iz chata (two-step approval umjesto), auth (nema) — svjesne odluke u Global Constraints ✅

**2. Placeholder scan:** Nema TODO/TBD. "Verifikuj API protiv node_modules" napomene su legitimne za eksterni SDK (Anthropic streaming/tool tipovi), ne placeholderi za našu logiku.

**3. Type consistency:**
- `ChatEvent`/`ChatTurn` definisani u `lib/claude/chat.ts` (T2), korišteni u T3 route; UI re-deklariše lokalni `StreamEvent`/`UiPoruka`/`ProposalData` (T4) NAMJERNO da klijent ne povuče env ✅
- `ProposalData` definisan u T1 tools.ts (server) I re-deklarisan u T4 ChatMessage.tsx (klijent) — isti oblik, namjerno razdvojeno (server vs client) ✅
- `ActionResult` u asistent/actions.ts (T3), import u ChatMessage (T4) ✅
- `executeTool`/`CHAT_TOOLS`/`TOOL_LABELS`/`SISTEM_PROMPT` (T1) → konzumira chat.ts (T2) ✅
- `runChat(history, userText, onEvent)` (T2) → konzumira route (T3) ✅
- `snimiZapisnik` polja `termin_id/nalaz/zakljucak` (T3) === skrivena polja forme (T4) ✅
- `buildZapisnikDocx`/`uploadDokument` potpisi (Faza Dokumenti) === pozivi u snimiZapisnik (T3) ✅
