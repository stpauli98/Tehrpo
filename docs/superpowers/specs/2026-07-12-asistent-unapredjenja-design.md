# Spec: Unapređenje "Asistent" taba

- **Datum:** 2026-07-12
- **Grana / worktree:** `feat/asistent-unapredjenja` → `.claude/worktrees/asistent` (off `main` @ f5f63bf)
- **Obim:** fokusiran, visok učinak (4 radna toka). Model se **ne mijenja** (`claude-sonnet-4-6`).
- **Cilj (riječima korisnika):** optimizuj, doradi, poboljšaj sigurnost, poboljšaj odgovore, UI/UX i pristup. Posmatrač (`pregled`) ne smije ništa — „ukloniti dugme“.

## 1. Kontekst i zatečeno stanje

Asistent je AI chat nad stvarnim podacima (termini, firme, prijedlog zapisnika).

- **Ruta:** `app/api/chat/route.ts` — NDJSON stream; upisuje user poruku → `runChat` → upisuje assistant poruku u `chat_poruke`.
- **Motor:** `lib/claude/chat.ts` — agentski loop (`MAX_KORACI=5`), model `claude-sonnet-4-6`, stream teksta + `tool`/`proposal` eventi.
- **Alati:** `lib/claude/tools.ts` — `searchTermini`, `listFirme`, `suggestGrupisanje`, `predloziZapisnik`.
- **Prompt:** `lib/claude/prompts.ts` — `SISTEM_PROMPT` (module-level const).
- **UI:** `AsistentChat.tsx`, `ChatMessage.tsx`, `ChatInput.tsx`, `SuggestedPills.tsx`, `NoviRazgovorButton.tsx`.
- **Podaci:** nema zasebne tabele razgovora — identitet razgovora je `konverzacija_id` na `chat_poruke`.
- **Pristup posmatrača — već blokiran na 3 nivoa:** Sidebar skriva stavku (`Sidebar.tsx:57`), stranica redirectuje `pregled` (`page.tsx:24`), RLS `chat_ins ( … and not je_pregled())` (migracija `20260711120000`). Dugme „Snimi zapisnik“ gejtovano `mozeUrediti`.

### Utvrđene slabosti (nezavisno od pristupa)
1. **Markdown se ne renderuje** — prompt traži `**bold**`/natuknice, `ChatMessage` prikazuje sirov tekst (`whitespace-pre-wrap`) → korisnik vidi doslovne `**`.
2. **Indikator alata prikazuje sirove nazive** (`searchTermini`) — ljudska labela se šalje (`ev.label`) ali se u `AsistentChat` sprema `ev.tool`.
3. **Pretraga po datumu ne radi** — prompt tvrdi „datumski raspon“, alat nema datumske parametre; model ne zna današnji datum.
4. **Nema rate-limita** — svaki `operater`/`admin` može neograničeno trošiti Anthropic API.
5. **API ruta nema eksplicitni role-guard** — oslanja se samo na RLS (vrati 500 umjesto čistog 403).
6. **Klijent šalje `history`** — moguća injekcija lažnih „assistant“ turnova; `konverzacija_id` vlasništvo se ne provjerava eksplicitno.

## 2. Radni tokovi

### WS1 — Sigurnost pristupa (verifikuj + otvrdni posmatrača)

**Verifikacija (read-only, bez pisanja):**
- SELECT iz `pg_policies where tablename='chat_poruke'` na **DEMO** (`DATABASE_URL_DEMO`) i **PROD** (`DATABASE_URL`) — potvrdi da postoje `chat_sel` (`korisnik_id = auth.uid()`) i `chat_ins` (`korisnik_id = auth.uid() and not je_pregled()`), tj. da je migracija `20260711120000` primijenjena na cloud.
- Ako **nije** primijenjena na nekom refu → spec ne mijenja proces: prijaviti korisniku, on pokreće `pnpm db:apply-cloud supabase/migrations/20260711120000_chat_poruke_vlasnik_scope.sql` (lockstep DEMO↔PROD). Migracijski fajl je već u repou i commitovan.

**Kod — eksplicitni guard u `app/api/chat/route.ts`:**
- Na početku `POST`: `const korisnik = await getTrenutniKorisnik()`.
  - `!korisnik` → **401** JSON `{ error: t("neovlasten") }`.
  - `korisnik.uloga === "pregled"` → **403** JSON `{ error: t("zabranjeno") }`.
- Čist odgovor umjesto trenutnog 500-iz-RLS. Defense-in-depth povrh RLS-a i redirecta.

**E2E:** proširiti `tests/e2e/18-auth-rls.spec.ts` (ili novi spec): `pregled` sesija `POST /api/chat` → **403**; `pregled` `GET /asistent` → redirect `/pregled`.

### WS2 — Robusnost i sigurnost razgovora

**Server-side rekonstrukcija historije (`app/api/chat/route.ts`):**
- `bodySchema`: **izbaci `history`**; ostaje `{ konverzacija_id, userText }`.
- Prije upisa nove poruke: učitaj **posljednjih 40** prethodnih poruka iz `chat_poruke` gdje `konverzacija_id = X and korisnik_id = auth.uid()` — `order created_at desc limit 40`, pa **obrni u ascending** za model (najnoviji kontekst, ne prvih 40); mapiraj u `ChatTurn[]`. (RLS već scope-uje po vlasniku; eksplicitni filter je jasnoća + provjera vlasništva.)
- `AsistentChat.tsx`: prestani slati `history` (tijelo = `{ konverzacija_id, userText }`). Optimistički UI i dalje koristi lokalni `poruke` state.
- Efekat: klijent ne može ubaciti lažne assistant turnove; `konverzacija_id` vlasništvo implicitno provjereno.

**Rate-limit (bez nove infrastrukture, `app/api/chat/route.ts`):**
- Prije **upisa** nove user poruke (da se nova ne broji), dva brza count upita nad `chat_poruke` za tekućeg korisnika (`uloga='user'`):
  - `created_at > (now - 60s)` ≥ **20** → **429**.
  - `created_at > (now - 24h)` ≥ **400** → **429**.
- Prag konstante u kodu (`RATE_LIMIT_PER_MIN = 20`, `RATE_LIMIT_PER_DAY = 400`), lako podesive. „Sada“ = `new Date(Date.now() - …)` (nodejs runtime rute).
- 429 JSON `{ error: t("previseZahtjeva") }` + `Retry-After` header. Koristi postojeći indeks `idx_chat_korisnik`.

### WS3 — Kvalitet odgovora (isti model, bolji prompt + alati)

**Datumski alat (`lib/claude/tools.ts`):**
- `searchTermini` input_schema: dodaj `rok_od` i `rok_do` (string, `YYYY-MM-DD`). U `executeTool`: validiraj format (regex `^\d{4}-\d{2}-\d{2}$`), pa `q.gte('rok_dospijeca', rok_od)` / `q.lte('rok_dospijeca', rok_do)`.
- Ažuriraj `description` alata da tačno opisuje datumske filtere.

**Današnji datum + prompt (`lib/claude/prompts.ts`, `lib/claude/chat.ts`):**
- Pretvori `SISTEM_PROMPT` (const) u funkciju `buildSistemPrompt(danas: string)` — ubaci rečenicu „Danas je {danas}.“ da „ovog mjeseca / ove sedmice“ rade.
- `chat.ts` poziva `buildSistemPrompt(new Date().toISOString().slice(0,10))` po zahtjevu; **model ostaje `claude-sonnet-4-6`**.
- Ukloni netačnu tvrdnju o datumima (sad je istinita); uskladi format sa markdown renderom.
- **Prije uređivanja `chat.ts`/`tools.ts`/`prompts.ts` → učitati `claude-api` skill** (pravilo iz CLAUDE.md). Ne dirati hardkodirani model id.
- Ažuriraj `lib/claude/prompts.test.ts` za funkcijski oblik + prisustvo datuma.

### WS4 — UI/UX polish

**Markdown render (`components/domain/ChatMessage.tsx`):**
- Dodaj zavisnosti: `react-markdown` + `remark-gfm` (`pnpm add`).
- Assistant poruke renderuj kroz `<ReactMarkdown remarkPlugins={[remarkGfm]}>` sa `skipHtml` (bez raw HTML → nema XSS). User poruke ostaju plain (`whitespace-pre-wrap`).
- Minimalne stilske komponente (p, ul, li, strong, a) da odgovaraju chat-mjehuru; linkovi `target=_blank rel=noopener noreferrer`.

**Labele alata (`AsistentChat.tsx` + `ChatMessage.tsx`):**
- U `AsistentChat`, na `ev.type==='tool'` spremi **`ev.label`** (ljudska labela) umjesto `ev.tool`. `UiPoruka.tools` sada drži labele.
- `ChatMessage` prikazuje labele suptilno (muted, mali). `alat_pozivi` u bazi i dalje čuva **sirove nazive** (audit) — nepromijenjeno; live UI pokazuje labele.

**a11y (`AsistentChat.tsx`):**
- Kontejner poruka: `role="log" aria-live="polite" aria-busy={busy}` (polite, da čitač najavi novi tekst bez preplavljivanja).

**Opciona optimizacija (`app/(dashboard)/asistent/page.tsx`), niska prioriteta:**
- Ne povlačiti cijelu `chat_poruke` tabelu: ograniči sidebar upit (npr. `limit` na razumno N, i/ili odvojen scope-ovan upit za poruke aktivnog razgovora). Uraditi samo ako ne uvodi regresiji sidebar liste; inače preskočiti.

## 3. i18n
Dodati ključeve na paritetu u `messages/{sr,en,de}.json` (bez ICU `one` za sr):
- `asistent.api.neovlasten` (401), `asistent.api.zabranjeno` (403), `asistent.api.previseZahtjeva` (429).

## 4. Van obima (YAGNI — sljedeća iteracija)
stop/kopiraj/regeneriši · brisanje/preimenovanje razgovora · AI-generisani naslovi · nadogradnja modela · keširanje odgovora · redizajn iz temelja · perzistencija labela alata na reload.

## 5. Testiranje
- **Unit (vitest, node):** prozor rate-limita (granice), build datum-filtera / validacija ISO, `prompts.test.ts` za `buildSistemPrompt`.
- **E2E (playwright, DEMO):** `pregled` → 403 na `/api/chat`; chat smoke u dry-run modu (`CHAT_DRY_RUN=1`) ostaje zelen. `--workers=1`.
- Postojeći `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:e2e` moraju biti zeleni. Backend testovi kroz Docker (pravilo korisnika).

## 6. Rizici i napomene
- **react-markdown bundle** na asistent ruti — prihvatljivo (autentikovan, desktop-only interni alat).
- **Rate-limit false-positive** ako korisnik legitimno pošalje >20/min — malo vjerovatno za ovaj workflow; prag podesiv.
- **Cloud RLS možda pending** — sigurnost posmatrača na DB nivou nije potpuno živa dok korisnik ne pokrene cloud apply (lockstep). Jasno prijaviti nakon verifikacije.
- **Bez nove DB migracije** za kod promjene; jedina DB akcija je verifikacija + eventualni apply postojeće migracije. `react-markdown` = promjena `package.json` (`pnpm install`).
- Editovanje Anthropic koda → `claude-api` skill prvo; model id nepromijenjen (2 mjesta u repou i dalje sinhronizovana).

## 7. Redoslijed implementacije (za plan)
1. WS1 verifikacija (DEMO+PROD) → izvještaj + eventualni apply-flag.
2. WS1 guard + i18n + E2E (najkraći put do sigurnosne koristi).
3. WS2 server-side historija + rate-limit + unit.
4. WS3 datum alat + prompt/datum + unit (`claude-api` skill).
5. WS4 markdown + labele + aria-live (+ opciona optimizacija).
6. Puni lint/typecheck/unit/e2e → PR.
