# Toast paritet na mutacijama — dizajn

**Datum:** 2026-07-11
**Status:** Spec (odobren dizajn, čeka plan)
**Autor:** brainstorming sesija (Claude + vlasnik)

---

## 1. Problem

Aplikacija već ima toast sistem (`sonner`, mount-an u `app/(dashboard)/layout.tsx`) i `audit_log`
tabelu koja preko `tg_audit()` trigera automatski loguje **svaku DB mutaciju** (server-side,
admin-read-only). Ali korisnički feedback je **nekonzistentan**: neke akcije daju
`toast.success`/`toast.error` (npr. `UlogaSelect`, `KlijentPodsjetniciForm`, `PrimaociCombobox`,
`KorisnikAkcije`), mnoge ne. Korisnik ne dobija pouzdanu potvrdu za akcije koje odradi.

**Cilj:** svaka serverska mutacija koja se već loguje u `audit_log` MORA korisniku dati toast
(uspjeh ili greška). Standardizovati **jedan obrazac** umjesto ad-hoc poziva, tako da paritet
(mutacija ⇄ log ⇄ toast) ne može da drifta kako se dodaju nove akcije.

## 2. Obim

**U obimu:**
- Dijeljeno jezgro: čista odlučna funkcija + dva ergonomska omotača (hook + imperativni helper).
- Coverage sweep: svaka mutaciona akcija/forma usvaja helper; postojeći ad-hoc `toast.*` se dedupuje.
- i18n ključevi za success poruke gdje fale.
- Unit test za odlučnu funkciju.

**Van obima (YAGNI):**
- In-app inbox / zvono u TopBar-u (trajne notifikacije).
- Klijentski „aktivnost" log (čisto klijentske validacije koje ne dođu do servera).
- Notifikacije klijentu (poslovno pravilo: klijent ne dobija app-notifikacije).
- „Notifikacija na svaki klik" (toast-spam; svjesno odbačeno).
- Bilo kakva izmjena `audit_log` / `tg_audit()` / RLS.

## 3. Kontekst koji se poštuje (postojeći kod)

- **`ActionResult` oblik** varira blago po akciji, ali kanon (dashboard) je:
  `{ ok: true } | { ok: false; errors?: Record<string,string[]|undefined>; message?: string }`.
  Uspjeh je „go" — **nema poruke na `ok:true`**, pa success tekst dolazi od pozivaoca (i18n).
- **Dva stila pozivanja akcija:**
  1. `useActionState` forme: `(_prev, formData) => ActionResult` → promjena state-a.
  2. Direktni `await` u event handleru (npr. `PrimaociCombobox`, `KorisnikAkcije`) → provjera `res.ok` inline.
- **Field-level greške** (`errors`) se već prikazuju inline pod poljima. Toast je za `message`-nivo greške i za uspjeh.

## 4. Arhitektura

### 4.1 Jezgro — `lib/akcija-toast.ts`

Čista, DOM-nezavisna odlučna funkcija (jedina jedinica s logikom → jedina koja se unit-testira):

```ts
export type AkcijaRezultat =
  | { ok: true }
  | { ok: false; message?: string; errors?: Record<string, string[] | undefined> }

export type ToastOdluka = { tip: "success" | "error"; poruka: string } | null

// Pravila:
//  ok:true                         -> { tip:"success", poruka: uspjehPoruka }
//  ok:false + message              -> { tip:"error",   poruka: message }
//  ok:false + samo errors (polja)  -> null  (inline prikaz, ne dupliramo toastom)
//  ok:false bez message ni errors  -> { tip:"error",   poruka: greskaFallback }
export function odlukaToast(
  res: AkcijaRezultat,
  uspjehPoruka: string,
  greskaFallback: string,
): ToastOdluka
```

### 4.2 Omotači (tanki, bez sopstvene logike)

Oba pozivaju `odlukaToast` i, ako vrati ne-`null`, okinu `toast[tip](poruka)`:

- **`useAkcijaToast(state, { uspjeh, greska })`** — hook za `useActionState` forme.
  `useEffect` na promjenu `state` (uz čuvanje reference da se ne okine dvaput za isti rezultat).
- **`toastRezultat(res, { uspjeh, greska })`** — imperativni helper za direktne `await` pozive.
  Vraća `res` (prolazno) da pozivalac može nastaviti (npr. `router.refresh()` na uspjeh).

### 4.3 Coverage sweep

Svaka mutaciona akcija/forma bira tačno jedan omotač po stilu pozivanja. Postojeći ad-hoc
`toast.*` pozivi se zamjenjuju helperom (dedup). Podjela po domenskim lane-ovima (isti kao ranije):
klijenti / termini / obilasci / podsjetnici. Svaki agent radi coverage u svom lane-u.

## 5. Redoslijed isporuke (bezkonfliktan)

1. **Jezgro prvo (main):** napraviti `lib/akcija-toast.ts` + `lib/akcija-toast.test.ts` + i18n
   ključevi (`common.sacuvano`, `common.obrisano`, `common.greska` i sl. gdje fale). Commit na `main`.
2. **Paralelni sweep (4 worktree-a):** tek nakon što jezgro postoji na `main`, 4 agenta granaju
   sa `main` i **samo usvajaju** helper u svojim domenskim komponentama. Nula preklapanja na
   dijeljenom `lib/akcija-toast.ts` (nijedan ga ne mijenja, samo importuje).
3. **Merge** redoslijedom kao ranije, uz `typecheck`/`lint`/`unit` provjere između.

## 6. Rukovanje greškama

- Jezgro je totalno (pokriva sve grane `ActionResult`-a); nikad ne baca.
- Dupli-toast zaštita u hooku: čuvati referencu zadnjeg obrađenog `state` objekta; okinuti samo
  na stvarnu promjenu (izbjeći React StrictMode dvostruko-mount i re-render okidanje).
- Field-level `errors` se NE toastaju (inline UI ostaje jedini prikaz) — sprječava dvostruko izvještavanje.

## 7. Testiranje

- **Unit (`lib/akcija-toast.test.ts`):** sve 4 grane `odlukaToast` (uspjeh, message-greška,
  samo-errors→null, prazna-greška→fallback). Vitest, node env, bez DOM-a.
- **Bez novih E2E** (cloud DEMO). Postojeći E2E ostaje; vizuelna provjera kroz `pnpm dev` po lane-u.

## 8. i18n

Success/greška poruke idu isključivo kroz `next-intl`. Dodati zajedničke ključeve u
`messages/{sr,en,de}.json` (paritet u sve 3 lokale). Preferirati generičke (`common.*`) gdje
akcija nema specifičnu poruku, specifične gdje kontekst nosi značenje (npr. „Klijent sačuvan").

## 9. Definicija „gotovo"

- [ ] `lib/akcija-toast.ts` + unit test (sve grane zelene).
- [ ] Svaka mutaciona akcija u sva 4 domena daje toast preko helpera (uspjeh i `message`-greška).
- [ ] Postojeći ad-hoc `toast.*` migriran na helper (bez preostalih direktnih poziva u mutacionim tokovima).
- [ ] i18n ključevi prisutni u `sr/en/de`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test:unit` čisto na spojenom `main`.
