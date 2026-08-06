# Korisnici: trajno brisanje + edit (ime/email) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** U `/postavke` → „Korisnici" dodati „Uredi podatke" (ime + email) i „Obriši trajno" (samo za deaktivirane korisnike) — spec: `docs/superpowers/specs/2026-08-06-korisnici-brisanje-edit-design.md`.

**Architecture:** Dvije nove server akcije u `app/(dashboard)/postavke/actions.ts` po postojećem obrascu (zahtijevajAdmina → zod → SSR/RLS klijent → revalidatePath). Auth Admin API (service-role) samo za brisanje/izmjenu login naloga, sa rollback-om na pad drugog koraka. UI: dvije nove stavke u postojećem dropdown-u `KorisnikAkcije` + nova dialog komponenta `UrediKorisnikaDialog`. Bez migracije baze.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (SSR + Auth Admin API), zod, next-intl, shadcn/Base UI dijalozi, Playwright E2E.

## Global Constraints

- Package manager: **pnpm**. Dev server: `pnpm dev` (nikad plain `next dev` — `--webpack` obavezan).
- Grana: **`feat/korisnici-brisanje-edit`** (već postoji, bazirana na `origin/main`). Merge u `main` = produkcijski deploy; main zaštićen → na kraju PR, **bez push-a na main**.
- Domenski jezik: bosanski/srpski (latinica) — identifikatori, poruke, commit poruke.
- i18n: novi ključevi idu u **sva tri** kataloga `messages/{sr,en,de}.json` u istoj izmjeni (next-intl type-check prisiljava paritet); **bez ICU `one` kategorije za sr**.
- SSR (RLS) klijent za sve upise u `korisnici` (audit trigger bilježi admina kao aktera). Admin/service-role klijent **isključivo** za Auth Admin API pozive, uz komentar `// integracija-dozvoli: admin-klijent — Supabase Auth Admin API nema anon ekvivalent`.
- Bez migracija baze; `db/types.ts` se ne dira.
- Desktop-only: bez `sm:`/`md:` Tailwind breakpointa (lint error).
- E2E ide na cloud DEMO (`--workers=1`), throwaway korisnici na `@tehpro.test` domenu (NE `@example.com`), čišćenje u `finally`.
- Verifikacija prije svake commit poruke: `pnpm typecheck && pnpm lint` prolaze.

## Napomena o redoslijedu testova

Server akcije u ovom repou nemaju unit-test konvenciju (mutacije idu na Supabase; pokriva ih E2E na DEMO bazi — vidi CLAUDE.md „Tests"). Zato je ciklus po tasku: implementacija → `pnpm typecheck`/`pnpm lint` → commit, a puni E2E test ciklus je Task 4 (spec fajl se piše i pokreće tamo). Ne dodavati vitest testove za akcije.

---

### Task 1: i18n ključevi (sr/en/de)

**Files:**
- Modify: `messages/sr.json`
- Modify: `messages/en.json`
- Modify: `messages/de.json`

**Interfaces:**
- Produces: ključevi `postavke.korisnikAkcije.{urediPodatke,obrisiTrajno,obrisiPotvrdaNaslov,obrisiPotvrdaOpis,korisnikObrisan}`, novi namespace `postavke.urediKorisnika.{naslov,poljeIme,poljeEmail,submit,submitPending}`, `postavke.actions.{prvoDeaktiviraj,vlastitiNalogBrisanje,brisanjeAuthGreska}` — koriste ih Task 2 (akcije) i Task 3 (UI).

- [ ] **Step 1: Dodaj ključeve u `messages/sr.json`**

U objekat `postavke.korisnikAkcije` (poslije `"resetPotvrdaOpis"`) dodaj:

```json
"urediPodatke": "Uredi podatke",
"obrisiTrajno": "Obriši trajno",
"obrisiPotvrdaNaslov": "Trajno obrisati korisnika?",
"obrisiPotvrdaOpis": "Nalog {email} se trajno uklanja i ne može se vratiti. Postojeći zapisi (klijenti, termini, dokumenti, audit) ostaju, ali bez imena ovog korisnika kao aktera.",
"korisnikObrisan": "Korisnik obrisan."
```

Kao novi objekat pod `postavke` (npr. odmah poslije `"noviKorisnik"`) dodaj:

```json
"urediKorisnika": {
  "naslov": "Uredi korisnika",
  "poljeIme": "Ime i prezime",
  "poljeEmail": "Email",
  "submit": "Sačuvaj",
  "submitPending": "Čuvanje…"
}
```

U objekat `postavke.actions` dodaj:

```json
"prvoDeaktiviraj": "Korisnik se prije brisanja mora deaktivirati.",
"vlastitiNalogBrisanje": "Ne možeš obrisati vlastiti nalog.",
"brisanjeAuthGreska": "Brisanje naloga nije dovršeno. Pokušaj ponovo."
```

- [ ] **Step 2: Isti ključevi u `messages/en.json`** (ista mjesta u strukturi):

```json
"urediPodatke": "Edit details",
"obrisiTrajno": "Delete permanently",
"obrisiPotvrdaNaslov": "Permanently delete user?",
"obrisiPotvrdaOpis": "The account {email} will be permanently removed and cannot be restored. Existing records (clients, deadlines, documents, audit) remain, but without this user's name as the actor.",
"korisnikObrisan": "User deleted."
```

```json
"urediKorisnika": {
  "naslov": "Edit user",
  "poljeIme": "Full name",
  "poljeEmail": "Email",
  "submit": "Save",
  "submitPending": "Saving…"
}
```

```json
"prvoDeaktiviraj": "The user must be deactivated before deletion.",
"vlastitiNalogBrisanje": "You cannot delete your own account.",
"brisanjeAuthGreska": "Account deletion did not complete. Please try again."
```

- [ ] **Step 3: Isti ključevi u `messages/de.json`**:

```json
"urediPodatke": "Daten bearbeiten",
"obrisiTrajno": "Endgültig löschen",
"obrisiPotvrdaNaslov": "Benutzer endgültig löschen?",
"obrisiPotvrdaOpis": "Das Konto {email} wird endgültig entfernt und kann nicht wiederhergestellt werden. Bestehende Einträge (Kunden, Fristen, Dokumente, Audit) bleiben erhalten, jedoch ohne den Namen dieses Benutzers als Akteur.",
"korisnikObrisan": "Benutzer gelöscht."
```

```json
"urediKorisnika": {
  "naslov": "Benutzer bearbeiten",
  "poljeIme": "Vor- und Nachname",
  "poljeEmail": "E-Mail",
  "submit": "Speichern",
  "submitPending": "Speichern…"
}
```

```json
"prvoDeaktiviraj": "Der Benutzer muss vor dem Löschen deaktiviert werden.",
"vlastitiNalogBrisanje": "Du kannst dein eigenes Konto nicht löschen.",
"brisanjeAuthGreska": "Die Kontolöschung wurde nicht abgeschlossen. Bitte erneut versuchen."
```

- [ ] **Step 4: Verifikuj**

Run: `pnpm typecheck && pnpm lint`
Expected: oba prolaze (novi ključevi su nekorišteni — to je OK).

- [ ] **Step 5: Commit**

```bash
git add messages/sr.json messages/en.json messages/de.json
git commit -m "i18n(postavke): ključevi za uredi podatke + trajno brisanje korisnika"
```

---

### Task 2: Server akcije `obrisiKorisnika` + `urediKorisnika`

**Files:**
- Modify: `app/(dashboard)/postavke/actions.ts` (dodati na kraj sekcije „Admin: upravljanje korisnicima", tj. odmah poslije funkcije `postaviDodjele`, prije sekcije „Uređivanje / deaktivacija vrste")

**Interfaces:**
- Consumes: postojeće — `zahtijevajAdmina()`, `createServerSupabaseClient()`, `createAdminSupabaseClient()`, `UUID_RE`, `t` (namespace `postavke.actions`), `ActionResult`, ključevi iz Task 1.
- Produces: `obrisiKorisnika(korisnikId: string): Promise<ActionResult>` i `urediKorisnika(_prev: ActionResult, formData: FormData): Promise<ActionResult>` — koristi ih Task 3.

- [ ] **Step 1: Dodaj kod u `actions.ts`**

```ts
// ─── Trajno brisanje korisnika (samo deaktivirani) ───────────────────────────

/**
 * Trajno briše korisnika: prvo profil (SSR/RLS klijent → audit trigger zabilježi
 * ADMINA kao aktera), zatim auth nalog (Admin API). Dozvoljeno SAMO za deaktivirane
 * (potvrđena odluka 06.08.2026.) — time je zadnji aktivni admin automatski zaštićen,
 * jer se aktivan korisnik ne može obrisati, a postaviAktivan brani deaktivaciju
 * zadnjeg admina. Posljedica brisanja: audit_log.korisnik_id i kreirao_id kolone
 * postaju NULL (svjesno prihvaćeno), korisnik_klijent/chat_poruke idu cascade.
 */
export async function obrisiKorisnika(korisnikId: string): Promise<ActionResult> {
  const ja = await zahtijevajAdmina()
  if (!UUID_RE.test(korisnikId)) return { ok: false, message: t("korisnikNePostoji") }
  if (korisnikId === ja.id) return { ok: false, message: t("vlastitiNalogBrisanje") }
  const supabase = await createServerSupabaseClient()
  // Puni snapshot reda — služi za rollback ako brisanje auth naloga padne.
  const { data: meta, error: selErr } = await supabase
    .from("korisnici")
    .select("*")
    .eq("id", korisnikId)
    .maybeSingle()
  if (selErr) return { ok: false, message: selErr.message }
  if (!meta) return { ok: false, message: t("korisnikNePostoji") }
  if (meta.aktivan) return { ok: false, message: t("prvoDeaktiviraj") }
  const { error: delErr } = await supabase.from("korisnici").delete().eq("id", korisnikId)
  if (delErr) return { ok: false, message: delErr.message }
  // integracija-dozvoli: admin-klijent — Supabase Auth Admin API nema anon ekvivalent
  const admin = createAdminSupabaseClient()
  const { error: authErr } = await admin.auth.admin.deleteUser(korisnikId)
  if (authErr) {
    // Rollback: vrati profil red iz snapshota (SSR klijent — korisnici_wr = je_admin(),
    // audit hvata aktera; created_at i dozvole se vraćaju identično). Dodjele firmi su
    // već otišle cascade-om i NE vraćaju se — admin ih po potrebi ponovo postavi.
    const { error: rbErr } = await supabase.from("korisnici").insert(meta)
    if (rbErr) console.error("Rollback profila nakon pada auth brisanja nije uspio:", korisnikId, rbErr.message)
    return { ok: false, message: t("brisanjeAuthGreska") }
  }
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Uređivanje korisnika (ime + email) ──────────────────────────────────────

const urediKorisnikaSchema = z.object({
  id: z.string().uuid(),
  ime: z.string().trim().min(1, t("imeObavezno")).max(120),
  email: z.string().email(t("emailNeispravan")),
})

/**
 * Mijenja ime i email korisnika. Email se prvo mijenja u auth sistemu (Admin API,
 * email_confirm — važi odmah, interni alat), pa u profilu (SSR klijent → audit sa
 * akterom). Pad drugog koraka → rollback auth emaila na stari. Vlastiti nalog se
 * smije uređivati (nije destruktivno).
 */
export async function urediKorisnika(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await zahtijevajAdmina()
  const parsed = urediKorisnikaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, ime, email } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { data: meta, error: selErr } = await supabase
    .from("korisnici")
    .select("email")
    .eq("id", id)
    .maybeSingle()
  if (selErr) return { ok: false, message: selErr.message }
  if (!meta) return { ok: false, message: t("korisnikNePostoji") }
  const stariEmail = meta.email
  const emailPromijenjen = email.toLowerCase() !== stariEmail.toLowerCase()
  if (emailPromijenjen) {
    // integracija-dozvoli: admin-klijent — Supabase Auth Admin API nema anon ekvivalent
    const admin = createAdminSupabaseClient()
    const { error: authErr } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true })
    if (authErr) {
      return { ok: false, message: /already|registered|exists/i.test(authErr.message)
        ? t("korisnikEmailPostoji") : t("greskaFallback") }
    }
  }
  const { error: updErr } = await supabase.from("korisnici").update({ ime, email }).eq("id", id)
  if (updErr) {
    if (emailPromijenjen) {
      // integracija-dozvoli: admin-klijent — Supabase Auth Admin API nema anon ekvivalent
      const admin = createAdminSupabaseClient()
      const { error: rbErr } = await admin.auth.admin.updateUserById(id, { email: stariEmail, email_confirm: true })
      if (rbErr) console.error("Rollback auth emaila nije uspio:", id, rbErr.message)
    }
    return { ok: false, message: /duplicate|unique/i.test(updErr.message) ? t("korisnikEmailPostoji") : updErr.message }
  }
  revalidatePath("/postavke")
  return { ok: true }
}
```

- [ ] **Step 2: Verifikuj**

Run: `pnpm typecheck && pnpm lint`
Expected: oba prolaze. Ako `insert(meta)` prijavi tip-grešku (Row vs Insert), destrukturiraj snapshot eksplicitno u Insert oblik sa svim kolonama: `{ id, ime, email, uloga, aktivan, created_at, prima_podsjetnike, smije_brisati_svoje, smije_brisati_tudje, smije_brisati_klijente, smije_zatvoriti_bez_nalaza }` iz `meta`.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/postavke/actions.ts"
git commit -m "feat(postavke): akcije obrisiKorisnika (samo deaktivirani, rollback) i urediKorisnika (ime+email)"
```

---

### Task 3: UI — `UrediKorisnikaDialog` + stavke u `KorisnikAkcije`

**Files:**
- Create: `components/domain/UrediKorisnikaDialog.tsx`
- Modify: `components/domain/KorisnikAkcije.tsx`
- Modify: `components/domain/KorisniciTabela.tsx:151` (proslijediti `ime`)

**Interfaces:**
- Consumes: `urediKorisnika`, `obrisiKorisnika` iz Task 2; postojeće `PotvrdiBrisanjeDialog` (testId ide na DialogContent, potvrdno dugme se nalazi po roli+labeli), `FieldError`, `useAkcijaToast`, `toastRezultat`.
- Produces: `UrediKorisnikaDialog({ trigger, korisnikId, ime, email })`; `KorisnikAkcije` dobija novi prop `ime: string`. Test-idjevi za Task 4: `uredi-${id}`, `uredi-korisnik-ime-${id}`, `uredi-korisnik-email-${id}`, `uredi-korisnik-submit-${id}`, `obrisi-${id}`, `obrisi-potvrdi-${id}`.

- [ ] **Step 1: Kreiraj `components/domain/UrediKorisnikaDialog.tsx`**

Obrazac je kopija `NoviKorisnikButton` (remount forme kroz `instanca` brojač), ali: dialog se otvara kroz proslijeđeni `trigger` (skriveno dugme iz `KorisnikAkcije` — Base UI unmount ograničenje), polja su predpopunjena, a id-jevi/test-idjevi nose `korisnikId` jer komponenta postoji po REDU tabele (nije singleton — fiksni id-jevi bi se sudarali).

```tsx
"use client"
import { useActionState, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAkcijaToast } from "@/components/akcija-toast"
import { urediKorisnika, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FieldError } from "./FieldError"

const initial: ActionResult = { ok: true }

export function UrediKorisnikaDialog({
  trigger,
  korisnikId,
  ime,
  email,
}: {
  trigger: React.ReactElement
  korisnikId: string
  ime: string
  email: string
}) {
  const t = useTranslations("postavke.urediKorisnika")
  const [open, setOpen] = useState(false)
  // `instanca` remount-uje formu pri svakom otvaranju (isti trik kao NoviKorisnikButton):
  // briše zaostale greške i vraća polja na proslijeđene vrijednosti.
  const [instanca, setInstanca] = useState(0)
  const zatvori = useCallback(() => setOpen(false), [])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setInstanca((n) => n + 1)
        setOpen(o)
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader><DialogTitle>{t("naslov")}</DialogTitle></DialogHeader>
        <UrediKorisnikaForma key={instanca} korisnikId={korisnikId} ime={ime} email={email} onGotovo={zatvori} />
      </DialogContent>
    </Dialog>
  )
}

function UrediKorisnikaForma({
  korisnikId,
  ime,
  email,
  onGotovo,
}: {
  korisnikId: string
  ime: string
  email: string
  onGotovo: () => void
}) {
  const t = useTranslations("postavke.urediKorisnika")
  const tc = useTranslations("common")
  const router = useRouter()
  const [state, action, pending] = useActionState(urediKorisnika, initial)
  const submitted = useRef(false)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      onGotovo()
      router.refresh()
    }
  }, [state, pending, router, onGotovo])

  const greske = state.ok === false ? state.errors : undefined
  const idImeGreska = `uredi-korisnik-ime-greska-${korisnikId}`
  const idEmailGreska = `uredi-korisnik-email-greska-${korisnikId}`

  return (
    <form
      action={(fd) => {
        submitted.current = true
        action(fd)
      }}
      className="space-y-3"
    >
      <input type="hidden" name="id" value={korisnikId} />
      <div>
        <label className="block text-sm">
          <span className="text-muted-foreground">{t("poljeIme")}</span>
          <Input
            name="ime"
            required
            defaultValue={ime}
            data-testid={`uredi-korisnik-ime-${korisnikId}`}
            aria-describedby={greske?.ime ? idImeGreska : undefined}
          />
        </label>
        <FieldError id={idImeGreska} errors={greske?.ime} />
      </div>
      <div>
        <label className="block text-sm">
          <span className="text-muted-foreground">{t("poljeEmail")}</span>
          <Input
            name="email"
            type="email"
            required
            defaultValue={email}
            data-testid={`uredi-korisnik-email-${korisnikId}`}
            aria-describedby={greske?.email ? idEmailGreska : undefined}
          />
        </label>
        <FieldError id={idEmailGreska} errors={greske?.email} />
      </div>
      {state.ok === false && state.message && (
        <p className="text-sm text-destructive" role="alert">{state.message}</p>
      )}
      <Button type="submit" disabled={pending} className="w-full" data-testid={`uredi-korisnik-submit-${korisnikId}`}>
        {pending ? t("submitPending") : t("submit")}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Izmijeni `components/domain/KorisnikAkcije.tsx`**

Tačne izmjene (ostatak fajla netaknut):

1. U import sa `lucide-react` dodaj `Pencil` i `Trash2`:
```ts
import { MoreHorizontal, Send, UserX, UserCheck, KeyRound, Pencil, Trash2 } from "lucide-react"
```
2. Dodaj import ispod `PotvrdiBrisanjeDialog`:
```ts
import { UrediKorisnikaDialog } from "./UrediKorisnikaDialog"
```
3. U import akcija dodaj SAMO `obrisiKorisnika` (`urediKorisnika` koristi `UrediKorisnikaDialog` interno, ne ovaj fajl):
```ts
import { posaljiTestniEmail, postaviAktivan, posaljiResetKorisniku, obrisiKorisnika } from "@/app/(dashboard)/postavke/actions"
```
4. Proširi props — dodaj `ime: string`:
```ts
export function KorisnikAkcije({
  korisnikId,
  ime,
  email,
  aktivan,
  jeJa,
}: {
  korisnikId: string
  ime: string
  email: string
  aktivan: boolean
  jeJa: boolean
}) {
```
5. Pored postojećih ref-ova dodaj dva nova:
```ts
const urediTriggerRef = useRef<HTMLButtonElement>(null)
const obrisiTriggerRef = useRef<HTMLButtonElement>(null)
```
6. U `DropdownMenuContent`, IZMEĐU stavke „Pošalji reset" i stavke „Deaktiviraj/Aktiviraj", ubaci:
```tsx
<DropdownMenuItem onClick={() => otvoriDialog(urediTriggerRef)} data-testid={`uredi-${korisnikId}`}>
  <Pencil aria-hidden /> {t("urediPodatke")}
</DropdownMenuItem>
```
7. ODMAH POSLIJE stavke „Deaktiviraj/Aktiviraj" (kao zadnju stavku menija — destruktivno na dnu):
```tsx
{!aktivan && (
  <DropdownMenuItem
    variant="destructive"
    onClick={() => otvoriDialog(obrisiTriggerRef)}
    data-testid={`obrisi-${korisnikId}`}
  >
    <Trash2 aria-hidden /> {t("obrisiTrajno")}
  </DropdownMenuItem>
)}
```
8. Kod sibling dijaloga (poslije reset dijaloga, prije/poslije deaktivacijskog — redoslijed siblinga nebitan) dodaj:
```tsx
<UrediKorisnikaDialog
  trigger={<button type="button" ref={urediTriggerRef} tabIndex={-1} aria-hidden className="hidden" />}
  korisnikId={korisnikId}
  ime={ime}
  email={email}
/>

{!aktivan && (
  <PotvrdiBrisanjeDialog
    trigger={<button type="button" ref={obrisiTriggerRef} tabIndex={-1} aria-hidden className="hidden" />}
    naslov={t("obrisiPotvrdaNaslov")}
    opis={t("obrisiPotvrdaOpis", { email })}
    potvrdiLabel={t("obrisiTrajno")}
    testId={`obrisi-potvrdi-${korisnikId}`}
    onPotvrdi={async () => {
      const res = await obrisiKorisnika(korisnikId)
      if (res.ok) toast.success(t("korisnikObrisan"))
      return res.ok ? res : { ok: false as const, message: res.message ?? t("greska") }
    }}
    onUspjeh={() => router.refresh()}
  />
)}
```

- [ ] **Step 3: Izmijeni `components/domain/KorisniciTabela.tsx`**

Liniju 151 (`<KorisnikAkcije korisnikId={k.id} email={k.email} aktivan={k.aktivan} jeJa={jeJa} />`) zamijeni sa:

```tsx
<KorisnikAkcije korisnikId={k.id} ime={k.ime} email={k.email} aktivan={k.aktivan} jeJa={jeJa} />
```

- [ ] **Step 4: Verifikuj**

Run: `pnpm typecheck && pnpm lint`
Expected: oba prolaze.

- [ ] **Step 5: Commit**

```bash
git add components/domain/UrediKorisnikaDialog.tsx components/domain/KorisnikAkcije.tsx components/domain/KorisniciTabela.tsx
git commit -m "feat(postavke): UI — uredi podatke korisnika + obriši trajno (samo deaktivirani)"
```

---

### Task 4: E2E test

**Files:**
- Create: `tests/e2e/39-korisnici-uredi-obrisi.spec.ts`

**Interfaces:**
- Consumes: `db`, `ensureOperater(email, lozinka, ime) → Promise<string /* id */>`, `deleteKorisnikByEmail(email)` iz `tests/e2e/db.ts`; test-idjevi iz Task 3; toast poruke iz Task 1 (sr katalog — E2E ide na sr locale kao i ostali specovi).

- [ ] **Step 1: Napiši spec**

```ts
import { test, expect } from "@playwright/test"
import { db, ensureOperater, deleteKorisnikByEmail } from "./db"

// Uredi podatke (ime+email) + trajno brisanje korisnika u /postavke → Korisnici.
// Throwaway operateri sa jedinstvenim @tehpro.test emailovima (isti obrazac kao
// 25-nalozi-lozinke; NE @example.com — Supabase Auth ga odbija) + čišćenje u finally.
// Admin je default storageState; sekcija "Korisnici" je collapsible (defaultOpen=false).
test.describe("Korisnici: uredi i obriši", () => {
  test("B1: uredi podatke — novo ime i email vidljivi u tabeli", async ({ page }) => {
    const ts = Date.now()
    const stariEmail = `e2e-uredi-${ts}@tehpro.test`
    const noviEmail = `e2e-uredjen-${ts}@tehpro.test`
    const staroIme = `E2E Uredi ${ts}`
    const novoIme = `E2E Uredjen ${ts}`
    const id = await ensureOperater(stariEmail, "Lozinka1!", staroIme)
    try {
      await page.goto("/postavke")
      await page.getByRole("button", { name: "Korisnici" }).click()
      await page.getByTestId("korisnici-pretraga").fill(staroIme)
      await page.getByTestId(`akcije-${id}`).click()
      await page.getByTestId(`uredi-${id}`).click()
      await page.getByTestId(`uredi-korisnik-ime-${id}`).fill(novoIme)
      await page.getByTestId(`uredi-korisnik-email-${id}`).fill(noviEmail)
      await page.getByTestId(`uredi-korisnik-submit-${id}`).click()
      await expect(page.getByText("Sačuvano")).toBeVisible({ timeout: 15_000 })
      // router.refresh() povlači svjež server-render — pretraži po NOVOM imenu.
      await page.getByTestId("korisnici-pretraga").fill(novoIme)
      await expect(page.getByText(noviEmail)).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteKorisnikByEmail(noviEmail)
      await deleteKorisnikByEmail(stariEmail)
    }
  })

  test("B2: obriši trajno — skriveno za aktivnog; deaktiviran se briše skupa sa auth nalogom", async ({ page }) => {
    const ts = Date.now()
    const email = `e2e-brisi-${ts}@tehpro.test`
    const ime = `E2E Brisi ${ts}`
    const id = await ensureOperater(email, "Lozinka1!", ime)
    try {
      await page.goto("/postavke")
      await page.getByRole("button", { name: "Korisnici" }).click()
      await page.getByTestId("korisnici-pretraga").fill(ime)

      // Aktivan korisnik: menija ima, "Obriši trajno" NEMA.
      await page.getByTestId(`akcije-${id}`).click()
      await expect(page.getByTestId(`deaktiviraj-${id}`)).toBeVisible()
      await expect(page.getByTestId(`obrisi-${id}`)).toHaveCount(0)

      // Deaktiviraj (potvrda u dijalogu; testId je na DialogContent, dugme po labeli).
      await page.getByTestId(`deaktiviraj-${id}`).click()
      await page
        .getByTestId(`deaktiviraj-potvrdi-${id}`)
        .getByRole("button", { name: "Deaktiviraj korisnika" })
        .click()
      await expect(page.getByText("Korisnik deaktiviran.")).toBeVisible({ timeout: 15_000 })

      // Obriši trajno.
      await page.getByTestId(`akcije-${id}`).click()
      await page.getByTestId(`obrisi-${id}`).click()
      await page
        .getByTestId(`obrisi-potvrdi-${id}`)
        .getByRole("button", { name: "Obriši trajno" })
        .click()
      await expect(page.getByText("Korisnik obrisan.")).toBeVisible({ timeout: 15_000 })

      // Red je nestao iz tabele (router.refresh poslije uspjeha).
      await expect(page.getByTestId(`akcije-${id}`)).toHaveCount(0, { timeout: 15_000 })

      // Auth nalog stvarno oslobođen (listUsers default strana pokriva mali DEMO skup —
      // isti oslonac kao deleteKorisnikByEmail).
      const { data: list } = await db.auth.admin.listUsers()
      expect(list?.users.some((u) => u.email?.toLowerCase() === email.toLowerCase())).toBe(false)
    } finally {
      await deleteKorisnikByEmail(email)
    }
  })
})
```

- [ ] **Step 2: Pokreni spec (boot-uje vlastiti dev server, ide na cloud DEMO)**

Run: `pnpm exec playwright test tests/e2e/39-korisnici-uredi-obrisi.spec.ts`
Expected: 4 passed (2 testa × chromium + webkit). Ako padne — NE krpiti retry-em; koristiti superpowers:systematic-debugging.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/39-korisnici-uredi-obrisi.spec.ts
git commit -m "test(e2e): uredi podatke + trajno brisanje korisnika u postavkama"
```

---

### Task 5: Finalna verifikacija + PR

- [ ] **Step 1: Pune provjere**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: sve prolazi (unit testovi netaknuti ovim radom — samo regresiona potvrda).

- [ ] **Step 2: Ručna provjera u aplikaciji (opciono ali preporučeno)**

`pnpm dev` → prijava kao admin → `/postavke` → Korisnici: (a) „Uredi podatke" mijenja ime/email; (b) aktivan korisnik nema „Obriši trajno"; (c) deaktiviran ima, potvrda jasno upozorava, red nestaje.

- [ ] **Step 3: Push + PR (main je zaštićen — NIKAD direktan push na main)**

```bash
git push -u origin feat/korisnici-brisanje-edit
gh pr create --title "Korisnici: uredi podatke + trajno brisanje (samo deaktivirani)" --body "$(cat <<'EOF'
## Šta
- /postavke → Korisnici: nova stavka „Uredi podatke" (ime + email, sinhronizacija sa auth sistemom uz rollback) i „Obriši trajno" (vidljivo samo za deaktivirane korisnike).
- Brisanje: profil se briše SSR/RLS klijentom (audit bilježi admina kao aktera), zatim auth nalog Admin API-jem; pad drugog koraka vraća profil iz snapshota.
- Bez migracija baze.

## Spec
docs/superpowers/specs/2026-08-06-korisnici-brisanje-edit-design.md

## Test
- E2E: tests/e2e/39-korisnici-uredi-obrisi.spec.ts (uredi; guard za aktivnog; deaktiviraj→obriši→auth oslobođen)
- pnpm typecheck / lint / test:unit zeleni

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Javi korisniku PR link** — merge odlučuje korisnik (merge u main = produkcijski deploy na tri projekta).
